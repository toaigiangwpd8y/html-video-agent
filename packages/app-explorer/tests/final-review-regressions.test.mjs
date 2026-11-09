import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { applyObservation, initWorkspace, loadWorkspace } from '../lib/store.mjs';
import { commitRevision, resolveRevision } from '../lib/revisions.mjs';
import { createServer } from '../server.mjs';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-final-review-'));
  initWorkspace(dir, 'Fixture', 'http://127.0.0.1:4173');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function feature(status = 'discovered') {
  return { id: 'items.create', title: 'Create item', area: 'Items', summary: 'Create an item.', status,
    entry: { url: '/items' }, steps: [], questions: [], nextActions: [] };
}
function base(dir) { return loadWorkspace(dir).revision; }

test('V2 apply requires an explicit source revision and rejects stale or conflicting receipts', (t) => {
  const dir = workspace(t);
  const observation = { version: 2, features: [feature()] };
  assert.throws(() => applyObservation(dir, observation), /requires expectedRevision or observation.baseRevision/i);
  const sourceRevision = base(dir);
  const receipt = applyObservation(dir, { ...observation, baseRevision: sourceRevision });
  assert.equal(receipt.revision, 'r000002');
  assert.throws(() => applyObservation(dir, { ...observation, baseRevision: sourceRevision }), /revision conflict/i);
  assert.throws(() => applyObservation(dir, { ...observation, baseRevision: receipt.revision }, { expectedRevision: sourceRevision }), /conflicts with observation.baseRevision/i);
});

test('activity events use the actual revision selected after orphan recovery', (t) => {
  const dir = workspace(t);
  const sourceRevision = base(dir);
  const snapshot = loadWorkspace(dir);
  assert.throws(() => commitRevision(dir, sourceRevision, snapshot, { crashAt: 'before-current' }), /simulated crash/i);
  fs.writeFileSync(path.join(dir, '.revision.lock'), JSON.stringify({ pid: 2147483647, hostname: os.hostname(), token: 'dead-owner' }));
  const receipt = applyObservation(dir, { version: 2, baseRevision: sourceRevision,
    events: [{ id: 'event.after-orphan', runId: 'run.synthetic', type: 'scenario_observed', timestamp: '2026-10-16T10:00:00Z', message: 'A synthetic observation.' }] });
  assert.equal(receipt.revision, 'r000003');
  assert.equal(loadWorkspace(dir).activity.at(-1).revision, receipt.revision);
});

test('active run task ownership must resolve to one running frontier task', (t) => {
  const dir = workspace(t);
  const data = loadWorkspace(dir);
  const root = data.frontier.tasks[0];
  const run = { id: 'run.synthetic', scope: {}, status: 'running', currentTaskId: root.id,
    startedAt: '2026-10-16T10:00:00Z', heartbeatAt: '2026-10-16T10:00:00Z', capabilities: {} };
  assert.throws(() => applyObservation(dir, { version: 2, baseRevision: data.revision, runs: [run] }), /owns task .* queued state/i);
  const running = { ...root, status: 'running' };
  const valid = applyObservation(dir, { version: 2, baseRevision: data.revision,
    frontier: { tasks: [running] }, runs: [run] });
  const after = loadWorkspace(dir);
  assert.equal(after.runs[0].currentTaskId, root.id);
  const duplicate = { ...run, id: 'run.other' };
  assert.throws(() => applyObservation(dir, { version: 2, baseRevision: valid.revision, runs: [run, duplicate] }), /multiple active runs/i);
});

test('run scope rejects unsupported keys and credential-bearing values on direct apply', (t) => {
  const dir = workspace(t);
  const run = { id: 'run.scope', scope: { password: 'do-not-store' }, status: 'interrupted', currentTaskId: null,
    startedAt: '2026-10-16T10:00:00Z', heartbeatAt: '2026-10-16T10:00:00Z', capabilities: {} };
  assert.throws(() => applyObservation(dir, { version: 2, baseRevision: base(dir), runs: [run] }), /Unsupported run scope field password/i);
  const unsafeValue = { ...run, scope: { appId: 'example', allowedActions: ['token=secret'] } };
  assert.throws(() => applyObservation(dir, { version: 2, baseRevision: base(dir), runs: [unsafeValue] }), /Sensitive run scope value/i);
});

test('next rejects an unsupported context filter with scoped-work guidance', (t) => {
  const dir = workspace(t);
  const result = spawnSync(process.execPath, ['tools/knowledge.mjs', 'next', '--context', 'member.demo', '--json', '--data', dir], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /next does not support --context/i);
  assert.match(result.stderr, /use work --context <id>/i);
  assert.doesNotMatch(result.stdout, /"task"\s*:/);
});

test('scenario context must exist even when the workspace inventory is empty', (t) => {
  const dir = workspace(t);
  const scenario = { id: 'items.create.member', featureId: 'items.create', contextId: 'member.missing',
    goal: 'Create item', preconditions: [], completionCriteria: [], steps: [], outcome: 'unknown',
    evidenceRefs: [], testedContext: null, lastVerifiedAt: null };
  assert.throws(() => applyObservation(dir, { version: 2, baseRevision: base(dir), features: [feature()], scenarios: [scenario] }), /Unknown context member.missing/i);
  const valid = applyObservation(dir, { version: 2, baseRevision: base(dir), features: [feature()],
    inventory: { contexts: [{ id: 'member.missing', role: 'member', tenantAlias: 'synthetic', environment: 'test', date: '2026-10-16' }] }, scenarios: [scenario],
    frontier: { nodes: [{ id: 'items.create', kind: 'capability', contextId: 'member.missing', discoveryState: 'unseen', entryAliases: ['/items'], taskIds: ['items.create.inspect'] }],
      tasks: [{ id: 'items.create.inspect', key: 'member.missing.items.create.inspect', nodeId: 'items.create', featureId: 'items.create', scenarioId: scenario.id, contextId: 'member.missing', kind: 'verify_scenario', status: 'queued', dependencies: [], goal: 'Inspect create item', depth: 1, completionCriteria: ['Record outcome'], entry: { url: '/items' }, attempts: 0, lastProgressAt: null }] } });
  assert.equal(valid.revision, 'r000002');
});

test('V2 feature verification ignores legacy feature-level claims without validated scenarios', (t) => {
  const dir = workspace(t);
  fs.mkdirSync(path.join(dir, 'evidence', 'synthetic'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', 'synthetic', 'result.png'), 'synthetic evidence');
  const claimed = { ...feature('verified'), testedContext: { role: 'member', date: '2026-10-16' }, lastVerifiedAt: '2026-10-16',
    steps: [{ id: 'open', title: 'Open', action: 'Open form', observed: 'Form appears', screenshot: 'synthetic/result.png' }] };
  applyObservation(dir, { version: 2, baseRevision: base(dir), features: [claimed] });
  assert.equal(loadWorkspace(dir).features[0].status, 'discovered');
});

test('V1 live readiness reports legacy work without claiming frontier exhaustion', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-v1-live-'));
  fs.cpSync(path.resolve('examples/demo-knowledge'), dir, { recursive: true });
  const server = createServer({ dataDir: dir, staticDir: path.resolve('public') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/state`);
  const state = await response.json();
  assert.equal(state.schemaVersion, 1);
  assert.ok(state.tasks.length > 0);
  assert.equal(state.frontierSummary.state, 'legacy_work_pending');
  assert.notEqual(state.frontierSummary.state, 'exhausted_in_scope');
});

test('dashboard feature cards use the shared V2 work projection with a V1 fallback', () => {
  const source = fs.readFileSync(path.resolve('public/panel.js'), 'utf8');
  assert.match(source, /data-key="feature:'\s*\+\s*clean\(f\.id\)\s*\+\s*'"/);
  assert.match(source, /state\.schemaVersion === 2 \? \(getFeatureView\(f\.id\)\?\.openTasks\.length \|\| 0\) : f\.nextActions\.length/);
  assert.match(source, /const linkedOpenTasks = state\.schemaVersion === 2/);
  assert.match(source, /state\.tasks\.find\(\(task\) => task\.id === id\)/);
});

test('dashboard feature copy preserves Vietnamese task labels and accessible names', () => {
  const source = fs.readFileSync(path.resolve('public/panel.js'), 'utf8');
  assert.match(source, /aria-label="M\u1edf '\s*\+\s*clean\(f\.title\)\s*\+\s*'">/);
  assert.ok(source.includes("num + ' bước · ' + nextCount + ' việc tiếp</span></span>'"));
  assert.ok(source.includes('<h3>C\u1ea7n t\u00ecm hi\u1ec3u ti\u1ebfp</h3>'));
  assert.ok(source.includes('Kh\u00f4ng c\u00f3 c\u00f4ng vi\u1ec7c \u0111ang ch\u1edd.'));
  assert.ok(source.includes("legacy_work_pending:'C\u00f2n vi\u1ec7c c\u0169 c\u1ea7n l\u00e0m'"));
  assert.ok(source.includes("legacy_no_open_tasks:'Kh\u00f4ng c\u00f2n vi\u1ec7c c\u0169 \u0111ang ch\u1edd'"));
  assert.ok(!source.includes('M? ${clean(f.title)}'));
  assert.ok(!source.includes('b??c ?'));
});
