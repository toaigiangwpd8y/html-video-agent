import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyObservation, initWorkspace, loadWorkspace, exportDocs } from '../lib/store.mjs';
import { createWorkspaceReader } from '../lib/workspace-reader.mjs';
import { createServer } from '../server.mjs';
import { getWorkPacket, createDraft } from '../lib/agent-workflow.mjs';
import { advanceRun, heartbeatRun, startRun } from '../lib/runs.mjs';
import { transitionTask } from '../lib/frontier.mjs';
import { readPresence } from '../lib/presence.mjs';
import { auditCoverage, reconcileCoverage } from '../lib/coverage.mjs';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-hardening-integrated-'));
  initWorkspace(dir, 'Synthetic integrated acceptance', 'https://synthetic.invalid');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function task(id, sequence) {
  return { id, key: id, nodeId: 'root.app', kind: 'discover_area', status: 'queued', dependencies: [], goal: id,
    completionCriteria: ['Record the synthetic result.'], entry: { url: '/' }, contextId: null, depth: 1, sequence,
    attempts: 0, lastProgressAt: null, checkpoint: null, blocker: null };
}
function doneRoot(dir) { return transitionTask(loadWorkspace(dir).frontier, 'app.discover.root', { status: 'done' }).tasks[0]; }
function feature(id, summary = id) { return { id, title: id, area: 'Synthetic', summary, status: 'partial', entry: {}, steps: [], questions: [], nextActions: [] }; }
function seed(dir) {
  const base = loadWorkspace(dir).revision;
  applyObservation(dir, { version: 2, baseRevision: base, features: [feature('items.create'), feature('reports.export')],
    frontier: { tasks: [doneRoot(dir), task('task.one', 0), task('task.two', 1)] } });
}
test('integrated coverage gap reconciles, resolves with evidence, and closes only through explicit exclusion', async (t) => {
  const dir = workspace(t);
  const context = { id: 'member.fixture', role: 'member', tenantAlias: 'synthetic', environment: 'fixture', date: '2026-10-17' };
  const question = { id: 'q.synthetic-persistence', text: 'Does the synthetic preference persist after reload?', state: 'open', contextId: context.id, taskIds: [], evidenceRefs: [] };
  const initial = loadWorkspace(dir);
  applyObservation(dir, { version: 2, baseRevision: initial.revision, inventory: { contexts: [context] },
    features: [feature('settings.preference', 'Synthetic preference')], frontier: { tasks: [doneRoot(dir)] } });
  const beforeAudit = auditCoverage(loadWorkspace(dir));
  assert.equal(beforeAudit.state, 'needs_reconciliation');
  assert.ok(beforeAudit.gaps.some((gap) => gap.featureId === 'settings.preference'));
  const before = loadWorkspace(dir);
  applyObservation(dir, { version: 2, baseRevision: before.revision, features: [{ ...feature('settings.preference', 'Synthetic preference'), questions: [question] }] });
  const afterQuestion = loadWorkspace(dir);
  const reconciled = await reconcileCoverage(dir, { contextId: context.id, expectedRevision: afterQuestion.revision });
  assert.equal(reconciled.taskIds.length, 1);
  const assigned = loadWorkspace(dir);
  const followup = assigned.frontier.tasks.find((item) => item.id === reconciled.taskIds[0]);
  assert.equal(followup.status, 'queued');
  assert.equal(assigned.features[0].questions[0].taskIds[0], followup.id);

  const evidenceRef = 'coverage/question-result.txt';
  fs.mkdirSync(path.join(dir, 'evidence', 'coverage'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', evidenceRef), 'Synthetic fixture persistence result observed after reload.\n', 'utf8');
  const done = transitionTask(assigned.frontier, followup.id, { status: 'done' }).tasks.find((item) => item.id === followup.id);
  const resolved = { ...assigned.features[0], coverageExclusion: { reason: 'No additional preference branches are exposed by this synthetic fixture.', contextId: context.id },
    questions: [{ ...assigned.features[0].questions[0], state: 'resolved', evidenceRefs: [evidenceRef] }] };
  applyObservation(dir, { version: 2, baseRevision: assigned.revision, features: [resolved], frontier: { tasks: [done] } });
  const closed = auditCoverage(loadWorkspace(dir));
  assert.equal(closed.state, 'clear');
  assert.equal(closed.counts.gaps, 0);
  assert.equal(loadWorkspace(dir).features[0].questions[0].state, 'resolved');
  assert.equal(loadWorkspace(dir).frontier.tasks.find((item) => item.id === followup.id).status, 'done');
  assert.equal(loadWorkspace(dir).features[0].coverageExclusion.contextId, context.id);
});

test('integrated advance accepts nested V2, rejects missing/stale/conflicting CAS, and lifecycle uses a fresh revision', async (t) => {
  const nestedDir = workspace(t); seed(nestedDir);
  const run = startRun(nestedDir, {}, null, { id: 'run.nested-cas' }).run;
  const packet = getWorkPacket(nestedDir, { runId: run.id });
  const draft = createDraft(packet, { workspaceDir: nestedDir });
  const nested = { taskId: run.currentTaskId, observation: { version: 2, baseRevision: packet.receipt.revision, features: draft.features } };
  const accepted = advanceRun(nestedDir, run.id, nested, { leaseId: run.leaseId, requestId: 'request.nested-cas' });
  assert.equal(accepted.receipt.revision, 'r000004');

  const staleDir = workspace(t); seed(staleDir);
  const staleRun = startRun(staleDir, {}, null, { id: 'run.stale-cas' }).run;
  const stalePacket = getWorkPacket(staleDir, { runId: staleRun.id });
  const staleDraft = createDraft(stalePacket, { workspaceDir: staleDir });
  const missing = { taskId: staleRun.currentTaskId, observation: { version: 2, features: staleDraft.features } };
  assert.throws(() => advanceRun(staleDir, staleRun.id, missing, { leaseId: staleRun.leaseId, requestId: 'request.missing-cas' }), /baseRevision or matching --expected-revision/i);
  applyObservation(staleDir, { version: 2, baseRevision: loadWorkspace(staleDir).revision, features: [feature('reports.export', 'Intervening write')] });
  assert.throws(() => advanceRun(staleDir, staleRun.id,
    { taskId: staleRun.currentTaskId, observation: { ...staleDraft, baseRevision: stalePacket.receipt.revision } },
    { leaseId: staleRun.leaseId, requestId: 'request.stale-cas', expectedRevision: stalePacket.receipt.revision }), /Revision conflict/i);
  const current = loadWorkspace(staleDir).revision;
  assert.throws(() => advanceRun(staleDir, staleRun.id,
    { taskId: staleRun.currentTaskId, observation: { ...staleDraft, baseRevision: current } },
    { leaseId: staleRun.leaseId, requestId: 'request.mismatch-cas', expectedRevision: stalePacket.receipt.revision }), /conflicts with observation.baseRevision/i);

  const lifecycleDir = workspace(t); seed(lifecycleDir);
  const lifecycleRun = startRun(lifecycleDir, {}, null, { id: 'run.lifecycle-fresh-read' }).run;
  applyObservation(lifecycleDir, { version: 2, baseRevision: loadWorkspace(lifecycleDir).revision, features: [feature('reports.export', 'Unrelated fresh lifecycle revision')] });
  const lifecycleBase = loadWorkspace(lifecycleDir).revision;
  const lifecycle = advanceRun(lifecycleDir, lifecycleRun.id,
    { taskId: lifecycleRun.currentTaskId, checkpoint: { phase: 'fresh read lifecycle' } },
    { leaseId: lifecycleRun.leaseId, requestId: 'request.lifecycle-fresh-read' });
  assert.equal(lifecycle.receipt.revision, `r${String(Number(lifecycleBase.slice(1)) + 1).padStart(6, '0')}`);
});

test('integrated heartbeat, COW, cached poll, and export invariants hold at their observable boundaries', async (t) => {
  const dir = workspace(t); seed(dir);
  const before = loadWorkspace(dir);
  const featureBytes = fs.readFileSync(path.join(before.dataDir, 'features', 'items.create.json'));
  const run = startRun(dir, {}, null, { id: 'run.runtime-only' }).run;
  const afterStart = loadWorkspace(dir);
  const featureAtStart = fs.readFileSync(path.join(afterStart.dataDir, 'features', 'items.create.json'));
  const heartbeat = await heartbeatRun(dir, run.id, { leaseId: run.leaseId, taskId: run.currentTaskId });
  assert.equal(heartbeat.revision, afterStart.revision);
  assert.equal(loadWorkspace(dir).revision, afterStart.revision, 'heartbeat must not commit a knowledge revision');
  assert.deepEqual(fs.readFileSync(path.join(loadWorkspace(dir).dataDir, 'features', 'items.create.json')), featureAtStart);
  assert.deepEqual(featureAtStart, featureBytes);
  assert.equal(readPresence(dir, loadWorkspace(dir).runs[0]).taskId, run.currentTaskId);

  const reader = createWorkspaceReader(dir);
  reader.readKnowledge();
  let featureReads = 0;
  const originalRead = fs.readFileSync;
  fs.readFileSync = function(file, ...args) {
    if (String(file).includes(`${path.sep}features${path.sep}`)) featureReads++;
    return originalRead.call(this, file, ...args);
  };
  const app = createServer({ dataDir: dir });
  await new Promise((resolve, reject) => { app.once('error', reject); app.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/state')).status, 200);
    featureReads = 0;
    for (let index = 0; index < 4; index++) assert.equal((await fetch(base + '/api/state')).status, 200);
    assert.equal(featureReads, 0, 'unchanged warm state polls must not reread feature records');
    exportDocs(dir);
    const unchangedExport = exportDocs(dir);
    assert.equal(unchangedExport.changed, 0);
    assert.ok(unchangedExport.skipped > 0);
  } finally {
    fs.readFileSync = originalRead;
    await new Promise((resolve) => app.close(resolve));
  }

  const revisionBeforeChange = loadWorkspace(dir);
  const historiesBefore = { runs: revisionBeforeChange.runs, activity: revisionBeforeChange.activity, scenarios: revisionBeforeChange.scenarios.map((scenario) => ({ id: scenario.id, history: scenario.history })) };
  applyObservation(dir, { version: 2, baseRevision: revisionBeforeChange.revision, features: [feature('reports.export', 'Changed one feature only')] });
  const revisionAfterChange = loadWorkspace(dir);
  assert.deepEqual({ runs: revisionAfterChange.runs, activity: revisionAfterChange.activity, scenarios: revisionAfterChange.scenarios.map((scenario) => ({ id: scenario.id, history: scenario.history })) }, historiesBefore);
  const refreshedReader = createWorkspaceReader(dir);
  assert.equal(refreshedReader.readKnowledge().revision, revisionAfterChange.revision);
});