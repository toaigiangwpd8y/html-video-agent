import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyObservation, initWorkspace, loadWorkspace } from '../lib/store.mjs';
import { getWorkPacket, createDraft } from '../lib/agent-workflow.mjs';
import { startRun, advanceRun, heartbeatRun } from '../lib/runs.mjs';
import { transitionTask } from '../lib/frontier.mjs';
import { compatibilityLeaseId, readPresence, writePresence } from '../lib/presence.mjs';

function workspace(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-')); initWorkspace(dir, 'Test', 'https://example.test'); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function task(id, sequence, contextId = null) { return { id, key: id, nodeId: 'root.app', kind: 'discover_area', status: 'queued', dependencies: [], goal: id, completionCriteria: ['Observe'], entry: { url: '/' }, contextId, depth: 1, sequence, attempts: 0, lastProgressAt: null, checkpoint: null, blocker: null }; }
function feature(id, title = id) { return { id, title, area: 'Area', summary: title, status: 'partial', entry: {}, steps: [], questions: [], nextActions: [] }; }
function doneRoot(dir) { const data = loadWorkspace(dir); return transitionTask(data.frontier, 'app.discover.root', { status: 'done' }).tasks[0]; }

test('work packet resolves one revision and returns only linked feature data', (t) => {
  const dir = workspace(t);
  applyObservation(dir, { version: 2, baseRevision: loadWorkspace(dir).revision, features: [feature('items.create'), feature('reports.export')], frontier: { tasks: [doneRoot(dir), { ...task('task.items', 0), featureId: 'items.create' }, { ...task('task.reports', 1), featureId: 'reports.export' }] } });
  const packet = getWorkPacket(dir);
  assert.equal(packet.receipt.revision, loadWorkspace(dir).revision);
  assert.equal(packet.linked.feature.id, 'items.create');
  assert.equal(packet.linked.feature.id === 'reports.export', false);
  const draft = createDraft(packet, { workspaceDir: dir });
  assert.equal(draft.baseRevision, packet.receipt.revision);
  assert.deepEqual(draft.features[0], packet.linked.feature);
});

test('draft retains the complete feature and source snapshots for all linked role scenarios', (t) => {
  const dir = workspace(t); const initial = loadWorkspace(dir);
  const featureRecord = feature('items.create', 'Create item');
  const contexts = [
    { id: 'ctx.member', role: 'Member', tenantAlias: 'demo', environment: 'test' },
    { id: 'ctx.admin', role: 'Admin', tenantAlias: 'demo', environment: 'test' },
  ];
  const scenario = (id, contextId) => ({ id, featureId: featureRecord.id, contextId, goal: 'Create an item', preconditions: [], completionCriteria: [], steps: [], outcome: 'unknown', evidenceRefs: [], testedContext: null, lastVerifiedAt: null });
  applyObservation(dir, { version: 2, baseRevision: initial.revision, features: [featureRecord], inventory: { contexts }, scenarios: [scenario('items.create.member', 'ctx.member'), scenario('items.create.admin', 'ctx.admin')], frontier: { tasks: [doneRoot(dir), { ...task('task.member', 0, 'ctx.member'), featureId: featureRecord.id, scenarioId: 'items.create.member' }, { ...task('task.admin', 1, 'ctx.admin'), featureId: featureRecord.id, scenarioId: 'items.create.admin' }] } });
  const after = loadWorkspace(dir); const generated = after.frontier.tasks.find((item) => item.contextId === 'ctx.member' && item.id !== 'task.member' && item.status === 'queued');
  if (generated) applyObservation(dir, { version: 2, baseRevision: after.revision, frontier: { tasks: [transitionTask(after.frontier, generated.id, { status: 'done' }).tasks.find((item) => item.id === generated.id)] } });
  const packet = getWorkPacket(dir);
  const draft = createDraft(packet, { workspaceDir: dir });
  assert.deepEqual(draft.features[0], packet.linked.feature);
  assert.deepEqual(draft.source.linkedScenarios.map((item) => item.id), ['items.create.member', 'items.create.admin']);
});

test('run advance atomically finishes and claims FIFO next task; retry is idempotent', (t) => {
  const dir = workspace(t);
  const base = loadWorkspace(dir).revision;
  applyObservation(dir, { version: 2, baseRevision: base, features: [feature('items.create')], frontier: { tasks: [doneRoot(dir), task('task.one', 0), task('task.two', 1)] } });
  const { run } = startRun(dir, {}, null, { id: 'run.advance' });
  const before = loadWorkspace(dir);
  const packet = getWorkPacket(dir, { runId: run.id });
  const observation = createDraft(packet, { workspaceDir: dir });
  const request = { taskId: run.currentTaskId, checkpoint: { result: 'observed' }, observation };
  const result = advanceRun(dir, run.id, request, { expectedRevision: before.revision, requestId: 'request.one', leaseId: run.leaseId, now: '2026-10-16T12:00:00Z' });
  assert.equal(result.run.currentTaskId, 'task.two', JSON.stringify({ run: result.run, tasks: loadWorkspace(dir).frontier.tasks }));
  assert.equal(result.work.next.id, 'task.two');
  assert.equal(result.receipt.revision, 'r000004');
  const retried = advanceRun(dir, run.id, request, { expectedRevision: before.revision, requestId: 'request.one', leaseId: run.leaseId });
  assert.deepEqual(retried.receipt, result.receipt);
  assert.throws(() => advanceRun(dir, run.id, { ...request, checkpoint: { result: 'changed' } }, { expectedRevision: before.revision, requestId: 'request.one', leaseId: run.leaseId }), /different payload/i);
  const loaded = loadWorkspace(dir);
  assert.equal(loaded.frontier.tasks.find((item) => item.id === 'task.one').status, 'done');
  assert.equal(loaded.frontier.tasks.find((item) => item.id === 'task.two').status, 'running');
  assert.equal(loaded.activity.filter((event) => event.type === 'task_finished').length, 1);
});

test('run advance retry after CURRENT crash returns the committed event and ownership', async (t) => {
  const dir = workspace(t); const base = loadWorkspace(dir).revision;
  applyObservation(dir, { version: 2, baseRevision: base, features: [feature('items.create')],
    frontier: { tasks: [doneRoot(dir), task('task.crash.one', 0), task('task.crash.two', 1)] } });
  const { run } = startRun(dir, {}, null, { id: 'run.crash-after-current' });
  await heartbeatRun(dir, run.id, { leaseId: run.leaseId, taskId: run.currentTaskId, now: run.heartbeatAt });
  const before = loadWorkspace(dir);
  const packet = getWorkPacket(dir, { runId: run.id });
  const request = { taskId: run.currentTaskId, checkpoint: { result: 'committed' }, observation: createDraft(packet) };
  assert.throws(() => advanceRun(dir, run.id, request, { expectedRevision: before.revision,
    requestId: 'request.crash-after-current', leaseId: run.leaseId, crashAt: 'after-current' }), /simulated crash after current/i);
  const committed = loadWorkspace(dir);
  assert.equal(committed.runs[0].currentTaskId, 'task.crash.two');
  assert.equal(readPresence(dir, committed.runs[0]).taskId, 'task.crash.two');
  assert.equal(committed.activity.filter((event) => event.requestId === 'request.crash-after-current').length, 1);
  fs.rmSync(path.join(dir, '.revision.lock'), { force: true });
  const retried = advanceRun(dir, run.id, request, { expectedRevision: before.revision,
    requestId: 'request.crash-after-current', leaseId: run.leaseId });
  assert.equal(retried.duplicate, true);
  assert.equal(retried.run.currentTaskId, 'task.crash.two');
  assert.equal(retried.receipt.revision, committed.revision);
  assert.equal(loadWorkspace(dir).activity.filter((event) => event.requestId === 'request.crash-after-current').length, 1);
});

test('run advance retry after guard crash retains old CURRENT and recovers one runtime owner', async (t) => {
  const dir = workspace(t); const base = loadWorkspace(dir).revision;
  applyObservation(dir, { version: 2, baseRevision: base, features: [feature('items.create')],
    frontier: { tasks: [doneRoot(dir), task('task.guard.one', 0), task('task.guard.two', 1)] } });
  const { run } = startRun(dir, {}, null, { id: 'run.crash-after-guard' });
  await heartbeatRun(dir, run.id, { leaseId: run.leaseId, taskId: run.currentTaskId, now: run.heartbeatAt });
  const before = loadWorkspace(dir);
  const packet = getWorkPacket(dir, { runId: run.id });
  const request = { taskId: run.currentTaskId, checkpoint: { result: 'recoverable' }, observation: createDraft(packet) };
  assert.throws(() => advanceRun(dir, run.id, request, { expectedRevision: before.revision,
    requestId: 'request.crash-after-guard', leaseId: run.leaseId, crashAt: 'after-before-current' }), /after beforecurrent guard/i);
  const interrupted = loadWorkspace(dir);
  assert.equal(interrupted.revision, before.revision);
  assert.equal(interrupted.runs[0].currentTaskId, run.currentTaskId);
  const runtime = readPresence(dir, interrupted.runs[0]);
  assert.equal(runtime.taskId, 'task.guard.two');
  assert.equal(runtime.retired, undefined);
  assert.equal(interrupted.runs.filter((item) => item.currentTaskId === 'task.guard.two').length, 0);
  fs.rmSync(path.join(dir, '.revision.lock'), { force: true });
  const retried = advanceRun(dir, run.id, request, { expectedRevision: before.revision,
    requestId: 'request.crash-after-guard', leaseId: run.leaseId });
  assert.equal(retried.duplicate, false);
  const recovered = loadWorkspace(dir);
  assert.equal(recovered.runs[0].currentTaskId, 'task.guard.two');
  assert.equal(readPresence(dir, recovered.runs[0]).taskId, 'task.guard.two');
  assert.equal(recovered.runs.filter((item) => item.currentTaskId === 'task.guard.two').length, 1);
  assert.equal(recovered.activity.filter((event) => event.requestId === 'request.crash-after-guard').length, 1);
});

test('run advance accepts a prepared base or an explicit expected revision', (t) => {
  const dir = workspace(t); const revision = loadWorkspace(dir).revision;
  applyObservation(dir, { version: 2, baseRevision: revision, frontier: { tasks: [doneRoot(dir), task('task.one', 0)] } });
  const { run } = startRun(dir, {}, null, { id: 'run.cas' });
  const packet = getWorkPacket(dir, { runId: run.id });
  const acceptedByBase = advanceRun(dir, run.id, createDraft(packet, { workspaceDir: dir }), { requestId: 'request.cas2', leaseId: run.leaseId });
  assert.equal(acceptedByBase.receipt.revision, 'r000004');

  const expectedDir = workspace(t); const expectedBase = loadWorkspace(expectedDir).revision;
  applyObservation(expectedDir, { version: 2, baseRevision: expectedBase, frontier: { tasks: [doneRoot(expectedDir), task('task.expected', 0)] } });
  const expectedRun = startRun(expectedDir, {}, null, { id: 'run.expected' }).run;
  const expectedPacket = getWorkPacket(expectedDir, { runId: expectedRun.id });
  const { baseRevision, ...withoutBase } = createDraft(expectedPacket, { workspaceDir: expectedDir });
  assert.throws(() => advanceRun(expectedDir, expectedRun.id, withoutBase, { requestId: 'request.expected.missing', leaseId: expectedRun.leaseId }), /baseRevision or matching --expected-revision/i);
  const acceptedByExpected = advanceRun(expectedDir, expectedRun.id, withoutBase, { requestId: 'request.expected', leaseId: expectedRun.leaseId, expectedRevision: expectedPacket.receipt.revision });
  assert.equal(acceptedByExpected.receipt.revision, 'r000004');
});

test('advance does not claim blocked or out-of-context peers', (t) => {
  const dir = workspace(t); const initial = loadWorkspace(dir);
  const member = { id: 'ctx.member', role: 'Member', tenantAlias: 'test', environment: 'test', date: '2026-10-16' };
  const admin = { ...member, id: 'ctx.admin', role: 'Admin' };
  const blocked = { ...task('task.blocked', 1, member.id), status: 'blocked', blocker: { type: 'authorization', reason: 'Unavailable', requiredChange: 'Provide context' } };
  applyObservation(dir, { version: 2, baseRevision: initial.revision, inventory: { contexts: [member, admin] }, frontier: { tasks: [doneRoot(dir), task('task.current', 0, member.id), blocked, task('task.admin', 2, admin.id)] } });
  let scoped = loadWorkspace(dir);
  const generatedRoot = scoped.frontier.tasks.find((item) => item.contextId === member.id && item.id !== 'task.current' && item.status === 'queued');
  if (generatedRoot) applyObservation(dir, { version: 2, baseRevision: scoped.revision, frontier: { tasks: [transitionTask(scoped.frontier, generatedRoot.id, { status: 'done' }).tasks.find((item) => item.id === generatedRoot.id)] } });
  const { run } = startRun(dir, { contextId: member.id }, null, { id: 'run.scope' });
  const packet = getWorkPacket(dir, { runId: run.id });
  const result = advanceRun(dir, run.id, createDraft(packet, { workspaceDir: dir }), { expectedRevision: loadWorkspace(dir).revision, requestId: 'request.scope', leaseId: run.leaseId });
  const loaded = loadWorkspace(dir);
  assert.equal(result.run.currentTaskId, null);
  assert.equal(loaded.frontier.tasks.find((item) => item.id === 'task.blocked').status, 'blocked');
  assert.equal(loaded.frontier.tasks.find((item) => item.id === 'task.admin').status, 'queued');
});

test('work, draft, and run advance CLI contracts return packets and receipts', (t) => {
  const dir = workspace(t); const base = loadWorkspace(dir).revision;
  applyObservation(dir, { version: 2, baseRevision: base, frontier: { tasks: [doneRoot(dir), task('task.cli.one', 0), task('task.cli.two', 1)] } });
  const invoke = (...args) => spawnSync(process.execPath, ['tools/knowledge.mjs', ...args, '--data', dir], { encoding: 'utf8' });
  let result = invoke('work', '--json');
  assert.equal(result.status, 0, result.stderr);
  const packetFile = path.join(dir, 'packet.json'); fs.writeFileSync(packetFile, result.stdout, 'utf8');
  const draftFile = path.join(dir, 'draft.json');
  result = invoke('draft', '--packet', packetFile, '--output', draftFile);
  assert.equal(result.status, 0, result.stderr);
  const draft = JSON.parse(fs.readFileSync(draftFile, 'utf8'));
  assert.equal(draft.baseRevision, loadWorkspace(dir).revision);
  const startedFile = path.join(dir, 'scope.json'); fs.writeFileSync(startedFile, '{}');
  result = invoke('run', 'start', startedFile, '--json'); assert.equal(result.status, 0, result.stderr);
  const started = JSON.parse(result.stdout); const advancePacket = getWorkPacket(dir, { runId: started.run.id });
  assert.equal(started.work.activeRun.leaseId, started.run.leaseId);
  const advanceDraft = createDraft(advancePacket, { workspaceDir: dir });
  assert.equal(fs.existsSync(path.join(dir, 'evidence', started.run.id)), true);
  const advanceFile = path.join(dir, 'advance.json'); fs.writeFileSync(advanceFile, JSON.stringify(advanceDraft), 'utf8');
  result = invoke('run', 'advance', started.run.id, advanceFile, '--lease', started.run.leaseId, '--request-id', 'request.cli');
  assert.equal(result.status, 0, result.stderr);
  const advanced = JSON.parse(result.stdout);
  assert.equal(advanced.receipt.revision, loadWorkspace(dir).revision);
  assert.ok(advanced.work);
});

test('draft CLI rejects a packet from another workspace before mutating either workspace', (t) => {
  const sourceDir = workspace(t); const targetDir = workspace(t);
  const base = loadWorkspace(sourceDir).revision;
  applyObservation(sourceDir, { version: 2, baseRevision: base, frontier: { tasks: [doneRoot(sourceDir), task('task.foreign', 0)] } });
  const { run } = startRun(sourceDir, {}, null, { id: 'run.foreign' });
  const packet = getWorkPacket(sourceDir, { runId: run.id });
  const packetFile = path.join(targetDir, 'foreign-packet.json');
  const outputFile = path.join(targetDir, 'foreign-draft.json');
  fs.writeFileSync(packetFile, JSON.stringify(packet), 'utf8');
  const result = spawnSync(process.execPath, ['tools/knowledge.mjs', 'draft', '--packet', packetFile, '--output', outputFile, '--data', targetDir], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /workspace/i);
  assert.equal(fs.existsSync(path.join(sourceDir, 'evidence', run.id)), false);
  assert.equal(fs.existsSync(path.join(targetDir, 'evidence', run.id)), false);
  assert.equal(fs.existsSync(outputFile), false);
});

test('draft rejects missing or ambiguous workspace receipt paths before creating evidence', (t) => {
  const dir = workspace(t); const base = loadWorkspace(dir).revision;
  applyObservation(dir, { version: 2, baseRevision: base, frontier: { tasks: [doneRoot(dir), task('task.receipt', 0)] } });
  const { run } = startRun(dir, {}, null, { id: 'run.receipt' });
  const packet = getWorkPacket(dir, { runId: run.id });
  if (process.platform === 'win32') {
    const caseVariant = structuredClone(packet);
    caseVariant.receipt.workspaceRoot = caseVariant.receipt.workspaceRoot.replace(/[a-z]/g, (letter) => letter.toUpperCase());
    assert.doesNotThrow(() => createDraft(caseVariant, { workspaceDir: dir, runId: null }));
  }
  const missingRoot = structuredClone(packet); delete missingRoot.receipt.workspaceRoot;
  assert.throws(() => createDraft(missingRoot, { workspaceDir: dir }), /explicit absolute workspace root/i);
  const malformedCatalog = structuredClone(packet); malformedCatalog.receipt.catalogPath = process.execPath;
  assert.throws(() => createDraft(malformedCatalog, { workspaceDir: dir }), /outside its workspace root/i);
  assert.equal(fs.existsSync(path.join(dir, 'evidence', run.id)), false);
});

test('packet coverage retains unrelated workspace gaps with and without a selected task', (t) => {
  const question = { id: 'q.open', text: 'What about this path?', state: 'open', contextId: null, taskIds: [], evidenceRefs: [] };
  const noTaskDir = workspace(t); const noTaskBase = loadWorkspace(noTaskDir).revision;
  applyObservation(noTaskDir, { version: 2, baseRevision: noTaskBase, features: [{ ...feature('reports.export'), questions: [question] }], frontier: { tasks: [doneRoot(noTaskDir)] } });
  const noTaskPacket = getWorkPacket(noTaskDir);
  assert.equal(noTaskPacket.next, null);
  assert.ok(noTaskPacket.coverage.gaps.some((gap) => gap.featureId === 'reports.export' && gap.questionId === question.id));

  const taskDir = workspace(t); const taskBase = loadWorkspace(taskDir).revision;
  applyObservation(taskDir, { version: 2, baseRevision: taskBase, features: [feature('items.create'), { ...feature('reports.export'), questions: [question] }], frontier: { tasks: [doneRoot(taskDir), { ...task('task.items', 0), featureId: 'items.create' }] } });
  const taskPacket = getWorkPacket(taskDir);
  assert.equal(taskPacket.next.id, 'task.items');
  assert.ok(taskPacket.coverage.gaps.some((gap) => gap.featureId === 'reports.export' && gap.questionId === question.id));
});

test('work packet uses its revision coverage index without opening unrelated features', (t) => {
  const dir = workspace(t); const base = loadWorkspace(dir).revision;
  const question = { id: 'q.open', text: 'Still unknown?', state: 'open', contextId: null, taskIds: [], evidenceRefs: [] };
  applyObservation(dir, { version: 2, baseRevision: base,
    features: [feature('items.create'), { ...feature('reports.export'), questions: [question] }],
    frontier: { tasks: [doneRoot(dir), { ...task('task.items', 0), featureId: 'items.create' }] } });
  const data = loadWorkspace(dir);
  fs.writeFileSync(path.join(data.dataDir, 'features', 'reports.export.json'), '{broken json', 'utf8');
  const packet = getWorkPacket(dir);
  assert.equal(packet.linked.feature.id, 'items.create');
  assert.ok(packet.coverage.gaps.some((gap) => gap.featureId === 'reports.export'));
});

test('work packet falls back to a full coverage audit when an older V2 snapshot has no indexes', (t) => {
  const dir = workspace(t); const base = loadWorkspace(dir).revision;
  const question = { id: 'q.open', text: 'Still unknown?', state: 'open', contextId: null, taskIds: [], evidenceRefs: [] };
  applyObservation(dir, { version: 2, baseRevision: base,
    features: [{ ...feature('reports.export'), questions: [question] }], frontier: { tasks: [doneRoot(dir)] } });
  const data = loadWorkspace(dir);
  fs.rmSync(path.join(data.dataDir, 'manifest.json'));
  const packet = getWorkPacket(dir);
  assert.ok(packet.coverage.gaps.some((gap) => gap.featureId === 'reports.export' && gap.questionId === question.id));
});

test('createDraft defaults its selected workspace to the packet receipt root', (t) => {
  const dir = workspace(t); const base = loadWorkspace(dir).revision;
  applyObservation(dir, { version: 2, baseRevision: base, frontier: { tasks: [doneRoot(dir), task('task.direct-draft', 0)] } });
  const packet = getWorkPacket(dir);
  assert.equal(createDraft(packet).baseRevision, packet.receipt.revision);
});

test('work --run serializes the legacy lease and links the currently owned task first', (t) => {
  const dir = workspace(t); const base = loadWorkspace(dir).revision;
  applyObservation(dir, { version: 2, baseRevision: base, frontier: { tasks: [doneRoot(dir), task('task.owned', 0), task('task.next', 1)] } });
  const { run } = startRun(dir, {}, null, { id: 'run.legacy' });
  const data = loadWorkspace(dir); const runsFile = path.join(data.dataDir, 'runs.json');
  fs.writeFileSync(runsFile, JSON.stringify(data.runs.map(({ leaseId, ...record }) => record)), 'utf8');
  const cli = spawnSync(process.execPath, ['tools/knowledge.mjs', 'work', '--run', run.id, '--json', '--data', dir], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const packet = JSON.parse(cli.stdout);
  assert.equal(packet.activeRun.leaseId, compatibilityLeaseId(run.id));
  assert.equal(packet.next.id, run.currentTaskId);
  assert.notEqual(packet.next.id, 'task.next');
});


test('work --run reports effective stale and renewed presence beside the stored status', async (t) => {
  const dir = workspace(t); const base = loadWorkspace(dir).revision;
  applyObservation(dir, { version: 2, baseRevision: base, frontier: { tasks: [doneRoot(dir), task('task.liveness', 0), task('task.after-liveness', 1)] } });
  const { run } = startRun(dir, {}, null, { id: 'run.packet-liveness' });
  const invoke = (...args) => spawnSync(process.execPath, ['tools/knowledge.mjs', ...args, '--data', dir, '--json'], { encoding: 'utf8' });
  await writePresence(dir, { runId: run.id, leaseId: run.leaseId, taskId: run.currentTaskId, heartbeatAt: '2020-01-01T00:00:00.000Z' });
  const stalePacketResult = invoke('work', '--run', run.id);
  assert.equal(stalePacketResult.status, 0, stalePacketResult.stderr);
  const stalePacket = JSON.parse(stalePacketResult.stdout);
  const staleNextResult = invoke('next');
  assert.equal(staleNextResult.status, 0, staleNextResult.stderr);
  const staleNext = JSON.parse(staleNextResult.stdout);
  const staleState = staleNext.frontier.activeRuns.find((item) => item.id === run.id);
  assert.equal(stalePacket.receipt.revision, loadWorkspace(dir).revision);
  assert.equal(stalePacket.next.id, run.currentTaskId);
  assert.equal(stalePacket.activeRun.leaseId, run.leaseId);
  assert.equal(stalePacket.activeRun.storedStatus, 'running');
  assert.equal(stalePacket.activeRun.status, staleState.status);
  assert.equal(stalePacket.activeRun.stale, staleState.stale);
  assert.equal(stalePacket.activeRun.status, 'interrupted');
  assert.equal(stalePacket.activeRun.stale, true);

  await writePresence(dir, { runId: run.id, leaseId: run.leaseId, taskId: run.currentTaskId, heartbeatAt: new Date().toISOString() });
  const livePacketResult = invoke('work', '--run', run.id);
  assert.equal(livePacketResult.status, 0, livePacketResult.stderr);
  const livePacket = JSON.parse(livePacketResult.stdout);
  const liveNextResult = invoke('next');
  assert.equal(liveNextResult.status, 0, liveNextResult.stderr);
  const liveNext = JSON.parse(liveNextResult.stdout);
  const liveState = liveNext.frontier.activeRuns.find((item) => item.id === run.id);
  assert.equal(livePacket.receipt.revision, stalePacket.receipt.revision);
  assert.equal(livePacket.next.id, stalePacket.next.id);
  assert.equal(livePacket.activeRun.leaseId, run.leaseId);
  assert.equal(livePacket.activeRun.storedStatus, 'running');
  assert.equal(livePacket.activeRun.status, liveState.status);
  assert.equal(livePacket.activeRun.stale, liveState.stale);
  assert.equal(livePacket.activeRun.status, 'running');
  assert.equal(livePacket.activeRun.stale, false);
});
