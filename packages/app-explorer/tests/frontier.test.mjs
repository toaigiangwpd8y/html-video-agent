import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { enqueue, frontierSummary, selectNext, transitionTask } from '../lib/frontier.mjs';
import { applyObservation as applyObservationRaw, initWorkspace, loadWorkspace } from '../lib/store.mjs';
import { auditCoverage } from '../lib/coverage.mjs';
import { deriveRunState } from '../lib/runs.mjs';

// These isolated tests construct each write from the current read receipt. Stale-write cases pass their saved receipt explicitly.
function applyObservation(dir, observation, options = {}) {
  const baseRevision = options.expectedRevision ?? observation.baseRevision ?? loadWorkspace(dir).revision;
  return applyObservationRaw(dir, { ...observation, baseRevision }, { ...options, expectedRevision: options.expectedRevision ?? baseRevision });
}

function emptyFrontier() { return { nodes: [], edges: [], tasks: [] }; }
function node(id, kind = 'area', taskIds = [], discoveryState = 'unseen') {
  return { id, kind, entryAliases: [], discoveryState, taskIds };
}
function task(id, nodeId, depth, sequence, changes = {}) {
  return { id, key: id, nodeId, kind: 'discover_area', status: 'queued', depth, sequence,
    dependencies: [], goal: `Inspect ${nodeId}`, completionCriteria: [], entry: {},
    attempts: 0, lastProgressAt: null, ...changes };
}

test('selectNext uses depth then durable FIFO sequence, independent of feature presentation', () => {
  const frontier = { nodes: [node('root', 'root', ['late', 'near', 'peer']), node('late-node'), node('near-node'), node('peer-node')], edges: [], tasks: [
    task('late', 'late-node', 2, 1, { featureId: 'z.feature' }),
    task('near', 'near-node', 1, 4, { featureId: 'a.feature', featureStatus: 'partial' }),
    task('peer', 'peer-node', 1, 5, { featureId: 'b.feature', featureStatus: 'discovered' }),
  ] };
  assert.equal(selectNext(frontier, [], '2026-10-16T00:00:00Z').id, 'near');
});

test('empty supplied contexts gate scoped tasks but leave unscoped root work selectable', () => {
  const frontier = { nodes: [node('scoped', 'area'), node('root', 'root')], edges: [], tasks: [
    task('scoped-task', 'scoped', 0, 0, { contextId: 'admin.demo' }),
    task('root-task', 'root', 0, 1),
  ] };
  assert.equal(selectNext(frontier, [], '2026-10-16T00:00:00Z').id, 'root-task');
  assert.equal(selectNext({ ...frontier, tasks: [frontier.tasks[0]] }, [], '2026-10-16T00:00:00Z'), null);
  assert.equal(frontierSummary({ ...frontier, tasks: [frontier.tasks[0]] }, [], '2026-10-16T00:00:00Z').state, 'waiting_user');
});

test('enqueue suppresses semantic duplicates, merges entry aliases, and preserves sequence across restart', () => {
  const first = enqueue(emptyFrontier(), { ...task('menu-a', 'items'), key: 'member.items.list.discover', entry: { url: '/items' } });
  const duplicate = enqueue(first, { ...task('menu-b', 'items'), key: 'member.items.list.discover', entry: { url: '/legacy-items' } });
  assert.equal(duplicate.tasks.length, 1);
  assert.deepEqual(duplicate.nodes[0].entryAliases, ['/items', '/legacy-items']);
  assert.equal(duplicate.tasks[0].sequence, 0);
  const next = enqueue(duplicate, { ...task('next', 'settings'), key: 'member.settings.root.discover' });
  assert.equal(next.tasks[1].sequence, 1);
  assert.equal(enqueue(structuredClone(next), { ...task('third', 'reports'), key: 'member.reports.root.discover' }).tasks[2].sequence, 2);
});

test('shorter known route lowers queued task depth and ignores cycles', () => {
  const frontier = { nodes: [node('root', 'root'), node('a'), node('b'), node('c')], edges: [
    { from: 'root', to: 'a', relation: 'discovers' }, { from: 'a', to: 'b', relation: 'discovers' },
    { from: 'b', to: 'c', relation: 'discovers' }, { from: 'c', to: 'a', relation: 'discovers' },
  ], tasks: [task('root-task', 'root', 0, 0), task('c-task', 'c', 3, 1)] };
  const shorter = enqueue({ ...frontier, edges: [...frontier.edges, { from: 'root', to: 'b', relation: 'shortcut' }] },
    task('a-new', 'a', 0, 0));
  assert.equal(shorter.tasks.find((item) => item.id === 'c-task').depth, 2);
  assert.equal(shorter.tasks.find((item) => item.id === 'a-new').depth, 1);
});

test('continuation yields to an existing same-depth peer; dependencies gate readiness', () => {
  let frontier = { nodes: [node('a', 'area', ['long', 'peer']), node('b', 'branch', ['dependent'])], edges: [], tasks: [
    task('long', 'a', 1, 1, { status: 'running' }), task('peer', 'a', 1, 2),
    task('dependent', 'b', 1, 3, { dependencies: ['peer'] }),
  ] };
  frontier = transitionTask(frontier, 'long', { status: 'queued', checkpoint: { step: 'page 2' }, continuation: true });
  assert.equal(frontier.tasks.find((item) => item.id === 'long').sequence, 4);
  assert.equal(selectNext(frontier, [], '2026-10-16T00:00:00Z').id, 'peer');
  frontier = transitionTask(frontier, 'peer', { status: 'done' });
  assert.equal(selectNext(frontier, [], '2026-10-16T00:00:00Z').id, 'dependent');
});

test('blocked shallow work does not starve deeper ready work; external waits require due time', () => {
  const frontier = { nodes: [node('shallow', 'area', ['blocked']), node('deep', 'branch', ['external'])], edges: [], tasks: [
    task('blocked', 'shallow', 0, 1, { status: 'blocked', blocker: { type: 'auth', reason: 'Needs access', requiredChange: 'Grant member access' } }),
    task('external', 'deep', 2, 2, { status: 'waiting_external', blocker: { reason: 'Job runs', condition: 'job finishes', nextCheckAt: '2026-10-16T12:00:00Z' } }),
  ] };
  assert.equal(selectNext(frontier, [], '2026-10-16T11:59:00Z'), null);
  assert.equal(selectNext(frontier, [], '2026-10-16T12:00:00Z').id, 'external');
  assert.equal(frontierSummary(frontier, [], '2026-10-16T11:59:00Z').counts.blocked, 1);
});

test('unseen inventory and interrupted or waiting work never report exhausted', () => {
  const unseen = { nodes: [node('new-area', 'area', [], 'unseen')], edges: [], tasks: [] };
  assert.equal(frontierSummary(unseen, [], '2026-10-16T00:00:00Z').state, 'inventory_incomplete');
  const interrupted = { nodes: [node('root', 'root', ['running'], 'scanned')], edges: [], tasks: [task('running', 'root', 0, 0, { status: 'running' })] };
  assert.equal(frontierSummary(interrupted, [], '2026-10-16T00:00:00Z').state, 'interrupted');
  assert.deepEqual(frontierSummary(interrupted, [], '2026-10-16T00:00:00Z').recoverableTaskIds, ['running']);
  const waiting = { nodes: [node('root', 'root', ['wait'], 'scanned')], edges: [], tasks: [task('wait', 'root', 0, 0, {
    status: 'waiting_external', blocker: { reason: 'Job active', condition: 'complete', nextCheckAt: '2026-10-17T00:00:00Z' },
  })] };
  assert.equal(frontierSummary(waiting, [], '2026-10-16T00:00:00Z').state, 'waiting_external');
});

test('run readiness ignores coverage gaps scoped only to another context', () => {
  const contexts = [{ id: 'member.demo' }, { id: 'admin.demo' }];
  const data = { contexts, features: [{ id: 'reports.list', status: 'verified', questions: [
    { id: 'q.admin', text: 'Admin path?', state: 'open', contextId: 'admin.demo', taskIds: [], evidenceRefs: [] },
  ] }], scenarios: [], frontier: { nodes: [], edges: [], tasks: [] } };
  const run = { id: 'run.member', status: 'running', scope: { contextId: 'member.demo' }, currentTaskId: null,
    heartbeatAt: '2026-10-16T00:00:00.000Z' };
  const state = deriveRunState(run, data.frontier, new Date('2026-10-16T00:00:01.000Z'), {
    contexts, inventory: { nodes: [] }, coverage: auditCoverage(data),
  });
  assert.equal(state.status, 'exhausted_in_scope');
});

test('frontier closure requires audited zero gaps while ready peers keep precedence', () => {
  const data = { features: [{ id: 'items.create', status: 'verified', questions: [
    { id: 'q.persist', text: 'Does it persist?', state: 'open', contextId: null, taskIds: [], evidenceRefs: [] },
  ] }], contexts: [], scenarios: [], frontier: { nodes: [], edges: [], tasks: [] } };
  const coverage = auditCoverage(data);
  assert.equal(frontierSummary(data.frontier, [], '2026-10-16T00:00:00Z', {}, { coverage }).state, 'needs_reconciliation');
  const readyFrontier = { nodes: [node('root', 'root', ['peer'], 'scanned')], edges: [], tasks: [task('peer', 'root', 0, 0)] };
  assert.equal(frontierSummary(readyFrontier, [], '2026-10-16T00:00:00Z', {}, { coverage }).state, 'ready');
  const clear = auditCoverage({ ...data, features: [{ id: 'items.create', status: 'verified', questions: [] }] });
  assert.equal(frontierSummary(data.frontier, [], '2026-10-16T00:00:00Z', {}, { coverage: clear }).state, 'exhausted_in_scope');
});

test('summary matches selection readiness, reports blocked dependency and blocked inventory', () => {
  const blocked = { nodes: [node('root', 'root'), node('shallow', 'area')], edges: [], tasks: [
    task('dependency', 'root', 0, 0, { status: 'blocked', blocker: { type: 'auth', reason: 'No access', requiredChange: 'Authorize context' } }),
    task('dependent', 'shallow', 1, 1, { dependencies: ['dependency'] }),
  ] };
  assert.equal(selectNext(blocked, [], '2026-10-16T00:00:00Z'), null);
  assert.equal(frontierSummary(blocked, [], '2026-10-16T00:00:00Z').state, 'blocked');
  const due = { nodes: [node('root', 'root')], edges: [], tasks: [task('external', 'root', 0, 0, {
    status: 'waiting_external', blocker: { reason: 'Job active', condition: 'Job completes', nextCheckAt: '2026-10-16T12:00:00Z' },
  })] };
  assert.ok(selectNext(due, [], '2026-10-16T12:00:00Z'));
  assert.equal(frontierSummary(due, [], '2026-10-16T12:00:00Z').state, 'ready');
  const blockedNode = { nodes: [node('locked', 'area', [], 'blocked')], edges: [], tasks: [] };
  assert.equal(frontierSummary(blockedNode, [], '2026-10-16T12:00:00Z').state, 'blocked');
});

test('a newly added authorized context gets its own shallow root discovery task', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-context-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initWorkspace(dir, 'Example', 'https://example.org');
  applyObservation(dir, { version: 2, inventory: { contexts: [{ id: 'admin.demo', role: 'Admin', tenantAlias: 'demo', environment: 'test', date: '2026-10-16' }] } });
  const frontier = loadWorkspace(dir).frontier;
  const root = frontier.tasks.find((item) => item.contextId === 'admin.demo');
  assert.ok(root);
  assert.equal(root.depth, 0);
  assert.equal(frontier.nodes.find((item) => item.id === root.nodeId).kind, 'root');
});

test('applying a shorter discovery edge recomputes queued task depth in the stored revision', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-depth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initWorkspace(dir, 'Example', 'https://example.org');
  let data = loadWorkspace(dir);
  const root = data.frontier.nodes[0];
  const rootTask = data.frontier.tasks[0];
  const pathNodes = ['area-a', 'area-b', 'area-c'].map((id) => node(id, 'area', [`${id}-task`]));
  const pathTasks = pathNodes.map((item, index) => task(`${item.id}-task`, item.id, index + 1, index + 1));
  applyObservation(dir, { version: 2, frontier: {
    nodes: [{ ...root, discoveryState: 'scanned' }, ...pathNodes],
    edges: [{ from: root.id, to: 'area-a', relation: 'discovers' }, { from: 'area-a', to: 'area-b', relation: 'discovers' }, { from: 'area-b', to: 'area-c', relation: 'discovers' }],
    tasks: [{ ...rootTask, status: 'done' }, ...pathTasks],
  } });
  data = loadWorkspace(dir);
  assert.equal(data.frontier.tasks.find((item) => item.id === 'area-c-task').depth, 3);
  applyObservation(dir, { version: 2, frontier: { edges: [{ from: root.id, to: 'area-c', relation: 'shortcut' }] } });
  assert.equal(loadWorkspace(dir).frontier.tasks.find((item) => item.id === 'area-c-task').depth, 1);
});

test('V2 observation enqueue allocates sequence and suppresses duplicate semantic keys', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-enqueue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initWorkspace(dir, 'Example', 'https://example.org');
  const root = loadWorkspace(dir).frontier.nodes[0];
  const first = task('area-task', 'area-home', 99, 99, { key: 'default.area-home.root.discover', entry: { url: '/home' } });
  delete first.sequence;
  applyObservation(dir, { version: 2, frontier: {
    nodes: [node('area-home', 'area', [first.id])], edges: [{ from: root.id, to: 'area-home', relation: 'discovers' }], tasks: [first],
  } });
  assert.equal(loadWorkspace(dir).frontier.tasks.find((item) => item.id === first.id).sequence, 1);
  const duplicate = task('alias-task', 'area-home', 99, 99, { key: first.key, entry: { url: '/legacy-home' } });
  delete duplicate.sequence;
  applyObservation(dir, { version: 2, frontier: {
    nodes: [node('area-home', 'area', [first.id, duplicate.id])], tasks: [duplicate],
  } });
  const frontier = loadWorkspace(dir).frontier;
  assert.equal(frontier.tasks.filter((item) => item.key === first.key).length, 1);
  assert.deepEqual(frontier.nodes.find((item) => item.id === 'area-home').entryAliases, ['/home', '/legacy-home']);
});

test('block and explicit resume preserve the blocker reason and allocate a new FIFO position', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-block-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initWorkspace(dir, 'Example', 'https://example.org');
  const id = loadWorkspace(dir).frontier.tasks[0].id;
  const run = (args) => spawnSync(process.execPath, ['tools/knowledge.mjs', ...args, '--data', dir], { encoding: 'utf8' });
  assert.equal(run(['task', 'start', id]).status, 0);
  const blockerPath = path.join(dir, 'blocker.json');
  fs.writeFileSync(blockerPath, JSON.stringify({ type: 'approval', reason: 'Context access is missing.', requiredChange: 'Add the authorized role.' }));
  assert.equal(run(['task', 'block', id, blockerPath]).status, 0);
  const blocked = loadWorkspace(dir).frontier.tasks[0];
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.blocker.type, 'approval');
  assert.equal(run(['task', 'resume', id]).status, 0);
  const resumed = loadWorkspace(dir).frontier.tasks[0];
  assert.equal(resumed.status, 'queued');
  assert.equal(resumed.blocker, null);
  assert.equal(resumed.sequence, 1);
  assert.equal(run(['task', 'start', id]).status, 0);
  fs.writeFileSync(blockerPath, JSON.stringify({ status: 'waiting_external', blocker: {
    reason: 'A background job is running.', condition: 'Job completes.', nextCheckAt: '2099-01-01T00:00:00Z',
  } }));
  assert.equal(run(['task', 'block', id, blockerPath]).status, 0);
  const next = JSON.parse(run(['next', '--json']).stdout);
  assert.equal(next.task, null);
  assert.equal(next.frontier.state, 'waiting_external');
});

test('apply CLI expected revision rejects a stale scenario update without replacing current data', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-stale-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initWorkspace(dir, 'Example', 'https://example.org');
  const feature = { id: 'items.create', title: 'Create item', area: 'Items', summary: 'Create an item.', entry: { url: '/items' }, questions: [], nextActions: [] };
  const context = { id: 'admin.demo', role: 'Admin', tenantAlias: 'demo', environment: 'test', date: '2026-10-16' };
  const scenario = (goal) => ({ id: 'items.create.admin', featureId: 'items.create', contextId: context.id, goal,
    preconditions: [], completionCriteria: [], steps: [], outcome: 'unknown', evidenceRefs: [], testedContext: null, lastVerifiedAt: null });
  const area = node('items.create', 'feature', ['items.create.admin.verify'], 'scanned');
  const verify = task('items.create.admin.verify', area.id, 0, 0, { featureId: feature.id, scenarioId: 'items.create.admin', contextId: context.id, kind: 'verify_scenario', goal: 'Verify item creation' });
  const initial = applyObservation(dir, { version: 2, features: [feature], inventory: { contexts: [context] },
    scenarios: [scenario('Original goal')], frontier: { nodes: [area], tasks: [verify] } });
  const staleRevision = initial.revision;
  applyObservation(dir, { version: 2, scenarios: [scenario('Newer current goal')] }, { expectedRevision: staleRevision });
  const stalePath = path.join(dir, 'stale-observation.json');
  fs.writeFileSync(stalePath, JSON.stringify({ version: 2, scenarios: [scenario('Stale overwrite')] }));
  const cli = spawnSync(process.execPath, ['tools/knowledge.mjs', 'apply', stalePath, '--expected-revision', staleRevision, '--data', dir], { encoding: 'utf8' });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /Revision conflict/i);
  assert.equal(loadWorkspace(dir).scenarios.find((item) => item.id === scenario().id).goal, 'Newer current goal');
});

test('neutral frontier fixture schedules breadth before deep work and preserves blockers and duplicate identity', () => {
  const context = { id: 'member.test', role: 'Member' };
  let frontier = emptyFrontier();
  const areaA = { ...task('area-a', 'area-a', 1, 0), key: 'member.test.area-a.discover', entry: { url: '/a' } };
  const areaB = { ...task('area-b', 'area-b', 1, 1), key: 'member.test.area-b.discover', entry: { url: '/b' } };
  const roleRestricted = { ...task('role-limited', 'area-admin', 1, 2), status: 'blocked',
    blocker: { type: 'role', reason: 'Admin view is unavailable.', requiredChange: 'Record an authorized admin context.' } };
  const authorizationWait = { ...task('authorization-wait', 'area-private', 1, 3), contextId: context.id, status: 'waiting_user',
    blocker: { type: 'auth', reason: 'This task needs user action.', requiredChange: 'Provide the required authorized input.' } };
  const wizard = { ...task('wizard-start', 'wizard', 2, 4), kind: 'verify_scenario', key: 'member.test.record.create',
    entry: { url: '/records/new' } };
  for (const item of [areaA, areaB, roleRestricted, authorizationWait, wizard]) frontier = enqueue(frontier, item);
  frontier = enqueue(frontier, { ...areaA, id: 'area-a-alias', entry: { url: '/legacy-a' } });

  const selected = [];
  const finish = (id) => {
    selected.push(selectNext(frontier, [context], '2026-10-16T00:00:00Z').id);
    frontier = transitionTask(frontier, id, { status: 'done' });
  };
  finish('area-a');
  finish('area-b');
  finish('wizard-start');

  // The scheduler cannot resolve a waiting-user blocker; an explicit clear/requeue is required.
  assert.equal(selectNext(frontier, [context], '2026-10-16T00:00:00Z'), null);
  frontier = transitionTask(frontier, 'authorization-wait', { status: 'queued', blocker: null, continuation: true });
  selected.push(selectNext(frontier, [context], '2026-10-16T00:00:00Z').id);
  frontier = transitionTask(frontier, 'authorization-wait', { status: 'done' });

  assert.deepEqual(selected, ['area-a', 'area-b', 'wizard-start', 'authorization-wait']);
  assert.equal(frontier.tasks.filter((item) => item.key === areaA.key).length, 1);
  assert.deepEqual(frontier.nodes.find((item) => item.id === 'area-a').entryAliases, ['/a', '/legacy-a']);
  assert.equal(frontier.tasks.find((item) => item.id === 'role-limited').status, 'blocked');
});

test('init creates a root task; next JSON reports readiness; task start and resume are revisioned', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-frontier-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initWorkspace(dir, 'Example', 'https://example.org');
  let data = loadWorkspace(dir);
  assert.equal(data.frontier.tasks.length, 1);
  assert.equal(data.frontier.tasks[0].depth, 0);
  const run = (args) => spawnSync(process.execPath, ['tools/knowledge.mjs', ...args, '--data', dir], { encoding: 'utf8' });
  const next = run(['next', '--json']);
  assert.equal(next.status, 0, next.stderr);
  const payload = JSON.parse(next.stdout);
  assert.equal(payload.task.id, data.frontier.tasks[0].id);
  assert.equal(payload.reason.depth, 0);
  const staleStart = run(['task', 'start', data.frontier.tasks[0].id, '--expected-revision', 'r000000']);
  assert.notEqual(staleStart.status, 0);
  assert.match(staleStart.stderr, /Revision conflict/i);
  assert.equal(loadWorkspace(dir).frontier.tasks[0].status, 'queued');
  const started = run(['task', 'start', data.frontier.tasks[0].id]);
  assert.equal(started.status, 0, started.stderr);
  data = loadWorkspace(dir);
  assert.equal(data.frontier.tasks[0].status, 'running');
  const resumed = run(['task', 'resume', data.frontier.tasks[0].id]);
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(loadWorkspace(dir).frontier.tasks[0].status, 'queued');
  const startedAgain = run(['task', 'start', data.frontier.tasks[0].id]);
  assert.equal(startedAgain.status, 0, startedAgain.stderr);
  const checkpointPath = path.join(dir, 'checkpoint.json');
  fs.writeFileSync(checkpointPath, JSON.stringify({ step: 'area inventory', findings: ['Home', 'Settings'] }));
  const checkpointed = run(['task', 'checkpoint', data.frontier.tasks[0].id, checkpointPath]);
  assert.equal(checkpointed.status, 0, checkpointed.stderr);
  assert.deepEqual(loadWorkspace(dir).frontier.tasks[0].checkpoint, { step: 'area inventory', findings: ['Home', 'Settings'] });
  const finishPath = path.join(dir, 'finish.json');
  fs.writeFileSync(finishPath, JSON.stringify({ completion: 'Visible areas recorded.' }));
  const finished = run(['task', 'finish', data.frontier.tasks[0].id, finishPath]);
  assert.equal(finished.status, 0, finished.stderr);
  assert.equal(loadWorkspace(dir).frontier.tasks[0].status, 'done');
  assert.deepEqual(loadWorkspace(dir).frontier.tasks[0].checkpoint, { completion: 'Visible areas recorded.' });
});
