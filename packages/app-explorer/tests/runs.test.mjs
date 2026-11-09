import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyObservation as applyObservationRaw, initWorkspace, loadWorkspace } from '../lib/store.mjs';

// These isolated tests construct each write from the current read receipt. Stale-write cases pass their saved receipt explicitly.
function applyObservation(dir, observation, options = {}) {
  const baseRevision = options.expectedRevision ?? observation.baseRevision ?? loadWorkspace(dir).revision;
  return applyObservationRaw(dir, { ...observation, baseRevision }, { ...options, expectedRevision: options.expectedRevision ?? baseRevision });
}
import { startRun, checkpointRun, stopRun, recordActivity, deriveRunState } from '../lib/runs.mjs';
import { frontierSummary, transitionTask } from '../lib/frontier.mjs';
import { browserInfoFromInspection, inspectBrowserCli } from '../lib/browser-capabilities.mjs';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-runs-'));
  initWorkspace(dir, 'Run test', 'https://example.org');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const fixedNow = '2026-10-16T10:00:00.000Z';

test('startRun claims the ready task and commits run plus event in one revision', (t) => {
  const dir = workspace(t);
  const before = loadWorkspace(dir).revision;
  const result = startRun(dir, { contextId: null, appId: 'example', password: 'never-store' }, { version: '1.2.3', capabilities: { snapshot: true } }, { now: fixedNow, id: 'run.one' });
  const data = loadWorkspace(dir);
  assert.equal(data.revision, 'r000002');
  assert.notEqual(data.revision, before);
  assert.equal(result.run.status, 'running');
  assert.equal(result.run.currentTaskId, 'app.discover.root');
  assert.equal(data.frontier.tasks.find((task) => task.id === result.run.currentTaskId).status, 'running');
  assert.equal(data.activity.length, 1);
  assert.equal(data.activity[0].type, 'task_started');
  assert.equal(data.activity[0].revision, data.revision);
  assert.equal('password' in data.runs[0].scope, false);
  assert.deepEqual(data.runs[0].capabilities, { snapshot: true });
});

test('run start persists the E browser-info contract from the installed executable', async (t) => {
  const executable = 'C:/Users/DMX/AppData/Local/Temp/app-explorer-browser-tools/node_modules/agent-browser/bin/agent-browser-win32-x64.exe';
  if (!fs.existsSync(executable)) return t.skip('Installed native agent-browser executable is unavailable.');
  const dir = workspace(t);
  const scopeFile = path.join(dir, 'scope.json');
  fs.writeFileSync(scopeFile, JSON.stringify({ appId: 'example' }));
  const inspection = await inspectBrowserCli(executable);
  assert.equal(inspection.diagnostics.length, 0);
  const browserInfo = browserInfoFromInspection(inspection);
  const result = spawnSync(process.execPath, ['tools/knowledge.mjs', 'run', 'start', scopeFile, '--browser', executable, '--data', dir, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const run = JSON.parse(result.stdout).run;
  assert.equal(run.browserVersion, browserInfo.version);
  assert.deepEqual(run.capabilities, browserInfo.capabilities);
  assert.equal(typeof run.capabilities, 'object');
});

test('run checkpoint and idempotent activity updates share one revision', (t) => {
  const dir = workspace(t);
  const run = startRun(dir, {}, null, { now: fixedNow, id: 'run.one' }).run;
  const prior = loadWorkspace(dir).revision;
  checkpointRun(dir, run.id, { page: 'list', next: 'inspect filters' }, { now: '2026-10-16T10:01:00.000Z', eventId: 'event.checkpoint' });
  const after = loadWorkspace(dir);
  assert.equal(after.revision, 'r000003');
  assert.notEqual(after.revision, prior);
  assert.deepEqual(after.runs[0].checkpoint, { page: 'list', next: 'inspect filters' });
  assert.equal(after.runs[0].heartbeatAt, run.heartbeatAt, 'checkpoint progress does not impersonate a presence heartbeat');
  assert.equal(after.activity.at(-1).type, 'run_checkpointed');
  assert.equal(after.activity.at(-1).checkpointRecorded, true);
  assert.equal(after.activity.at(-1).id, 'event.checkpoint');
  recordActivity(dir, { id: 'event.checkpoint', runId: run.id, taskId: run.currentTaskId, type: 'run_checkpointed', timestamp: fixedNow, message: 'duplicate' });
  const repeated = loadWorkspace(dir);
  assert.equal(repeated.revision, after.revision);
  assert.equal(repeated.activity.filter((event) => event.id === 'event.checkpoint').length, 1);
});


test('generic activity cannot claim a run checkpoint and empty checkpoint writes are rejected', (t) => {
  const dir = workspace(t);
  const run = startRun(dir, {}, null, { now: fixedNow, id: 'run.one' }).run;
  assert.throws(() => recordActivity(dir, { id: 'event.spoof', runId: run.id, type: 'run_checkpointed', checkpointRecorded: true, timestamp: fixedNow, message: 'forged' }), /requires.*checkpoint/i);
  assert.throws(() => checkpointRun(dir, run.id, null), /non-empty checkpoint/i);
  assert.throws(() => checkpointRun(dir, run.id, '   '), /non-empty checkpoint/i);
  assert.throws(() => checkpointRun(dir, run.id, []), /non-empty checkpoint/i);
  assert.throws(() => checkpointRun(dir, run.id, {}), /non-empty checkpoint/i);
  assert.throws(() => applyObservation(dir, {
    version: 2,
    runs: [run],
    events: [{ id: 'event.raw-spoof', runId: run.id, type: 'run_checkpointed', checkpointRecorded: true, timestamp: fixedNow, message: 'forged' }],
  }), /requires.*checkpoint/i);
  assert.equal(loadWorkspace(dir).activity.some((item) => item.id === 'event.spoof'), false);
  assert.equal(loadWorkspace(dir).activity.some((item) => item.id === 'event.raw-spoof'), false);
});

test('run stop is a pause event and does not claim a checkpoint', (t) => {
  const dir = workspace(t);
  const run = startRun(dir, {}, null, { now: fixedNow, id: 'run.one' }).run;
  stopRun(dir, run.id, 'Yielding to another task', { now: '2026-10-16T10:02:00.000Z' });
  const events = loadWorkspace(dir).activity;
  assert.equal(events.at(-1).type, 'run_paused');
  assert.equal(events.at(-1).message, 'Run paused.');
});

test('legacy ambiguous checkpoint events normalize to an honest state update label', async (t) => {
  const { normalizeLegacyActivityEvent } = await import('../lib/schema.mjs');
  const legacy = normalizeLegacyActivityEvent({ id: 'event.old', runId: 'run.one', taskId: 'task.one', type: 'run_checkpointed', timestamp: fixedNow, revision: 'r000001', message: 'Checkpoint saved.' });
  assert.equal(legacy.type, 'legacy_state_updated');
  assert.equal(legacy.message, 'Legacy lifecycle state updated; checkpoint details are unknown.');
  const recorded = normalizeLegacyActivityEvent({ id: 'event.new', runId: 'run.one', type: 'run_checkpointed', checkpointRecorded: true, timestamp: fixedNow, revision: 'r000001', message: 'Run checkpoint saved.' });
  assert.equal(recorded.type, 'run_checkpointed');
  const dir = workspace(t);
  const run = startRun(dir, {}, null, { now: fixedNow, id: 'run.one' }).run;
  recordActivity(dir, { id: 'event.legacy', runId: run.id, type: 'run_checkpointed', timestamp: fixedNow, message: 'ambiguous old event' });
  assert.equal(loadWorkspace(dir).activity.at(-1).type, 'legacy_state_updated');
});
test('stale lifecycle revisions cannot replace newer checkpoints or task claims', (t) => {
  const dir = workspace(t);
  const before = loadWorkspace(dir).revision;
  const { run } = startRun(dir, {}, null, { now: fixedNow, id: 'run.one' });
  const startRevision = loadWorkspace(dir).revision;
  assert.notEqual(startRevision, before);
  assert.throws(() => startRun(dir, {}, null, { id: 'run.stale', expectedRevision: before }), /Revision conflict/);
  assert.equal(loadWorkspace(dir).runs.length, 1);
  checkpointRun(dir, run.id, { page: 'new checkpoint' }, { now: '2026-10-16T10:01:00.000Z' });
  const committed = loadWorkspace(dir);
  assert.throws(() => checkpointRun(dir, run.id, { page: 'stale overwrite' }, { expectedRevision: startRevision }), /Revision conflict/);
  assert.deepEqual(loadWorkspace(dir).runs[0].checkpoint, { page: 'new checkpoint' });
  assert.equal(loadWorkspace(dir).revision, committed.revision);
});

test('activity messages come from event type and retain only linked task and evidence references', (t) => {
  const dir = workspace(t);
  const run = startRun(dir, {}, null, { now: fixedNow, id: 'run.one' }).run;
  const evidenceRef = 'run-01/evidence.png';
  fs.mkdirSync(path.join(dir, 'evidence', 'run-01'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', evidenceRef), 'fixture');
  const untrustedMessages = [
    'Run: rm -rf C:/private',
    'I ran custom-tool --secret=abc --target private',
    'Saved a screenshot with password=hunter2 and Bearer abc123',
  ];
  for (const [index, message] of untrustedMessages.entries()) {
    recordActivity(dir, { id: `event.untrusted.${index}`, runId: run.id, taskId: run.currentTaskId, type: 'evidence_added', timestamp: fixedNow,
      message, evidenceRefs: [evidenceRef], rawCommand: 'agent-browser --password hunter2', privatePayload: 'x' });
    const event = loadWorkspace(dir).activity.at(-1);
    assert.equal(event.message, `Evidence added for task ${run.currentTaskId} (1 linked evidence file).`);
    assert.equal(event.type, 'evidence_added');
    assert.equal(event.taskId, run.currentTaskId);
    assert.deepEqual(event.evidenceRefs, [evidenceRef]);
    assert.equal('rawCommand' in event, false);
    assert.equal('privatePayload' in event, false);
    assert.doesNotMatch(event.message, /rm -rf|custom-tool|hunter2|abc123|private/i);
  }
});

test('deriveRunState distinguishes a live owner from an abandoned running task', (t) => {
  const dir = workspace(t);
  const run = startRun(dir, {}, null, { now: fixedNow, id: 'run.one' }).run;
  const frontier = loadWorkspace(dir).frontier;
  assert.equal(deriveRunState(run, frontier, '2026-10-16T10:00:30.000Z').status, 'running');
  const stale = deriveRunState(run, frontier, '2026-10-16T10:10:00.000Z');
  assert.equal(stale.status, 'interrupted');
  assert.deepEqual(stale.recoverableTaskIds, [run.currentTaskId]);
  assert.deepEqual(frontierSummary(frontier).recoverableTaskIds, [run.currentTaskId]);
});

test('startRun readiness stays inside the requested context', (t) => {
  const dir = workspace(t);
  let data = loadWorkspace(dir);
  const rootDone = transitionTask(data.frontier, 'app.discover.root', { status: 'done' }).tasks.find((task) => task.id === 'app.discover.root');
  applyObservation(dir, { version: 2, frontier: { tasks: [rootDone] }, inventory: { contexts: [
    { id: 'member.one', role: 'member', tenantAlias: 'one', environment: 'test' },
    { id: 'admin.one', role: 'admin', tenantAlias: 'one', environment: 'test' },
  ] } });
  data = loadWorkspace(dir);
  const memberTask = data.frontier.tasks.find((task) => task.contextId === 'member.one');
  const memberBlocked = transitionTask(data.frontier, memberTask.id, { status: 'waiting_user', blocker: {
    type: 'authorization', reason: 'Member auth is unavailable.', requiredChange: 'Supply an authorized member context.',
  } }).tasks.find((task) => task.id === memberTask.id);
  applyObservation(dir, { version: 2, frontier: { tasks: [memberBlocked] } });
  const result = startRun(dir, { contextId: 'member.one' }, null, { id: 'run.member', now: fixedNow });
  assert.equal(result.run.currentTaskId, null);
  assert.equal(result.run.status, 'waiting_user');
});

test('blocked frontier state is interrupted with a specific reason', (t) => {
  const dir = workspace(t);
  const data = loadWorkspace(dir);
  const blocked = transitionTask(data.frontier, 'app.discover.root', { status: 'blocked', blocker: {
    type: 'tool', reason: 'A local tool is unavailable.', requiredChange: 'Restore the local tool.',
  } });
  applyObservation(dir, { version: 2, frontier: { tasks: [blocked.tasks[0]] } });
  const result = startRun(dir, {}, null, { id: 'run.blocked', now: fixedNow });
  assert.equal(result.run.status, 'interrupted');
  assert.match(result.run.stateReason, /blocked/i);
});

test('task block records an interrupted run instead of mislabeling it as user wait', (t) => {
  const dir = workspace(t);
  const { run } = startRun(dir, {}, null, { id: 'run.blocked' });
  const blockerFile = path.join(dir, 'blocker.json');
  fs.writeFileSync(blockerFile, JSON.stringify({ type: 'tool', reason: 'Local browser executable failed.', requiredChange: 'Restore the browser tool.' }));
  const result = spawnSync(process.execPath, ['tools/knowledge.mjs', 'task', 'block', run.currentTaskId, blockerFile, '--data', dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const updated = loadWorkspace(dir).runs.find((item) => item.id === run.id);
  assert.equal(updated.status, 'interrupted');
  assert.match(updated.stateReason, /Local browser executable failed/i);
});

test('unassigned inventory is interrupted with a discovery-specific reason', (t) => {
  const dir = workspace(t);
  const data = loadWorkspace(dir);
  const rootDone = transitionTask(data.frontier, 'app.discover.root', { status: 'done' }).tasks[0];
  applyObservation(dir, { version: 2, frontier: { nodes: [{ id: 'area.orphaned', kind: 'area', entryAliases: [], discoveryState: 'unseen', taskIds: [] }], tasks: [rootDone] } });
  const result = startRun(dir, {}, null, { id: 'run.inventory', now: fixedNow });
  assert.equal(result.run.status, 'interrupted');
  assert.match(result.run.stateReason, /unseen inventory node/i);
});

test('a run waiting for authorization remains waiting_user instead of exhausted', (t) => {
  const dir = workspace(t);
  const { run } = startRun(dir, {}, null, { now: fixedNow, id: 'run.one' });
  const data = loadWorkspace(dir);
  const frontier = transitionTask(data.frontier, run.currentTaskId, { status: 'waiting_user', blocker: {
    type: 'authorization', reason: 'The authorized role is not available.', requiredChange: 'Provide an authorized member context.',
  } });
  applyObservation(dir, { version: 2, frontier: { tasks: [frontier.tasks.find((task) => task.id === run.currentTaskId)] },
    runs: [{ ...run, status: 'waiting_user', currentTaskId: null }] });
  const after = loadWorkspace(dir);
  const state = deriveRunState(after.runs[0], after.frontier, fixedNow, { contexts: after.contexts, inventory: after.inventory });
  assert.equal(state.status, 'waiting_user');
  assert.equal(frontierSummary(after.frontier, after.contexts, fixedNow, after.inventory).state, 'waiting_user');
});

test('next does not expose an actively owned task as crash recovery', (t) => {
  const dir = workspace(t);
  startRun(dir, {}, null, { now: new Date().toISOString(), id: 'run.one' });
  const result = spawnSync(process.execPath, ['tools/knowledge.mjs', 'next', '--data', dir, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const next = JSON.parse(result.stdout);
  assert.equal(next.frontier.state, 'running');
  assert.deepEqual(next.frontier.recoverableTaskIds, []);
  assert.equal(next.frontier.activeRuns[0].currentTaskId, 'app.discover.root');
});

test('resume rejects a fresh owner and next never selects a live-owned queued task', (t) => {
  const dir = workspace(t);
  const { run } = startRun(dir, {}, null, { now: new Date().toISOString(), id: 'run.one' });
  const invoke = (...args) => spawnSync(process.execPath, ['tools/knowledge.mjs', ...args, '--data', dir], { encoding: 'utf8' });
  const resume = invoke('task', 'resume', run.currentTaskId);
  assert.notEqual(resume.status, 0);
  assert.match(resume.stderr, /fresh run owns/i);
  assert.equal(loadWorkspace(dir).frontier.tasks[0].status, 'running');
  const data = loadWorkspace(dir);
  const queued = transitionTask(data.frontier, run.currentTaskId, { status: 'queued' }).tasks[0];
  assert.throws(() => applyObservation(dir, { version: 2, frontier: { tasks: [queued] } }), /owns task .* queued state/i);
  const next = invoke('next', '--json');
  assert.equal(next.status, 0, next.stderr);
  assert.equal(JSON.parse(next.stdout).task, null);
});

test('explicit task recovery is allowed after stale or paused ownership', (t) => {
  const dir = workspace(t);
  const stale = startRun(dir, {}, null, { now: '2000-01-01T00:00:00.000Z', id: 'run.stale-owner' }).run;
  const invoke = (...args) => spawnSync(process.execPath, ['tools/knowledge.mjs', ...args, '--data', dir], { encoding: 'utf8' });
  let result = invoke('task', 'resume', stale.currentTaskId);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(loadWorkspace(dir).frontier.tasks[0].status, 'queued');

  const pausedDir = workspace(t);
  const { run } = startRun(pausedDir, {}, null, { id: 'run.paused-owner' });
  const stop = spawnSync(process.execPath, ['tools/knowledge.mjs', 'run', 'stop', run.id, 'Pause for review', '--data', pausedDir], { encoding: 'utf8' });
  assert.equal(stop.status, 0, stop.stderr);
  result = spawnSync(process.execPath, ['tools/knowledge.mjs', 'task', 'resume', run.currentTaskId, '--data', pausedDir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(loadWorkspace(pausedDir).frontier.tasks[0].status, 'queued');
});

test('run start, checkpoint, heartbeat, and stop are exposed by the CLI', (t) => {
  const dir = workspace(t);
  const scopeFile = path.join(dir, 'scope.json');
  const checkpointFile = path.join(dir, 'checkpoint.json');
  fs.writeFileSync(scopeFile, JSON.stringify({ contextId: null, appId: 'example' }));
  fs.writeFileSync(checkpointFile, JSON.stringify({ page: 'list' }));
  const invoke = (...args) => spawnSync(process.execPath, ['tools/knowledge.mjs', ...args, '--data', dir], { encoding: 'utf8' });
  let result = invoke('run', 'start', scopeFile, '--json');
  assert.equal(result.status, 0, result.stderr);
  const started = JSON.parse(result.stdout);
  const { id } = started.run;
  fs.writeFileSync(checkpointFile, JSON.stringify({ checkpoint: { page: 'list' } }));
  result = invoke('task', 'checkpoint', started.run.currentTaskId, checkpointFile);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(loadWorkspace(dir).activity.at(-1).type, 'task_checkpointed');
  fs.writeFileSync(checkpointFile, JSON.stringify({ page: 'list' }));
  result = invoke('run', 'checkpoint', id, checkpointFile, '--json');
  assert.equal(result.status, 0, result.stderr);
  result = invoke('run', 'heartbeat', id, '--lease', started.run.leaseId, '--task', started.run.currentTaskId, '--json');
  assert.equal(result.status, 0, result.stderr);
  result = invoke('run', 'stop', id, 'Yielding to another task', '--json');
  assert.equal(result.status, 0, result.stderr);
  const data = loadWorkspace(dir);
  assert.equal(data.runs[0].status, 'paused');
  assert.equal(data.runs[0].stopReason, 'Yielding to another task');
  assert.deepEqual(data.runs[0].checkpoint, { page: 'list' });
});
