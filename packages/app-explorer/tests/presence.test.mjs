import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyObservation, loadWorkspace, migrateWorkspace } from '../lib/store.mjs';
import { fenceStaleRunRecovery, startRun, heartbeatRun, stopRun } from '../lib/runs.mjs';
import { commitRevision, withWorkspaceLock } from '../lib/revisions.mjs';
import { readPresence, writePresence, effectiveHeartbeatAt } from '../lib/presence.mjs';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-presence-'));
  fs.cpSync(path.resolve('examples/demo-knowledge'), dir, { recursive: true });
  migrateWorkspace(dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const fixedNow = '2026-10-16T10:00:00.000Z';

test('matching lease heartbeat updates only presence and effective heartbeat', async (t) => {
  const dir = workspace(t);
  const { run } = startRun(dir, {}, null, { now: fixedNow, id: 'run.one' });
  const before = loadWorkspace(dir);
  const featureBytes = fs.readFileSync(path.join(before.dataDir, 'features', `${before.features[0].id}.json`));
  const runsBytes = fs.readFileSync(path.join(before.dataDir, 'runs.json'));
  const result = await heartbeatRun(dir, run.id, { leaseId: run.leaseId, taskId: run.currentTaskId, now: '2026-10-16T10:02:00.000Z' });
  const after = loadWorkspace(dir);
  assert.equal(result.revision, before.revision);
  assert.equal(after.revision, before.revision);
  assert.deepEqual(fs.readFileSync(path.join(after.dataDir, 'features', `${after.features[0].id}.json`)), featureBytes);
  assert.deepEqual(fs.readFileSync(path.join(after.dataDir, 'runs.json')), runsBytes);
  const preparedFeature = { ...before.features[0], summary: `${before.features[0].summary} Prepared before heartbeat.` };
  const applied = applyObservation(dir, { version: 2, baseRevision: before.revision, features: [preparedFeature] }, { expectedRevision: before.revision });
  assert.notEqual(applied.revision, before.revision, 'heartbeat-only updates do not invalidate an observation prepared from the prior revision');
  assert.equal(after.runs[0].heartbeatAt, fixedNow);
  assert.equal(after.runs[0].effectiveHeartbeatAt, '2026-10-16T10:02:00.000Z');
  assert.equal(readPresence(dir, after.runs[0]).heartbeatAt, '2026-10-16T10:02:00.000Z');
});

test('legacy runs fall back to their stored heartbeat until presence matches their lease', async (t) => {
  const dir = workspace(t);
  const { run } = startRun(dir, {}, null, { now: fixedNow, id: 'run.legacy' });
  const current = loadWorkspace(dir);
  const legacyRuns = current.runs.map(({ leaseId, ...stored }) => stored);
  commitSnapshot(dir, current, legacyRuns, {});
  const loaded = loadWorkspace(dir).runs[0];
  assert.equal(Object.keys(loaded).includes('leaseId'), false);
  assert.equal(effectiveHeartbeatAt(dir, loaded), fixedNow);
  await writePresence(dir, { runId: run.id, leaseId: loaded.leaseId, taskId: run.currentTaskId, heartbeatAt: '2026-10-16T10:04:00.000Z' });
  assert.equal(effectiveHeartbeatAt(dir, loaded), '2026-10-16T10:04:00.000Z');
});

test('legacy task lifecycle update persists its compatibility lease without serializing runtime overlay', (t) => {
  const dir = workspace(t);
  const run = startRun(dir, {}, null, { now: new Date().toISOString(), id: 'run.legacy-lifecycle' }).run;
  const initial = loadWorkspace(dir);
  commitSnapshot(dir, initial, initial.runs.map(({ leaseId, ...stored }) => stored), {});
  const legacyRun = loadWorkspace(dir).runs[0];
  const checkpointFile = path.join(dir, 'checkpoint.json');
  fs.writeFileSync(checkpointFile, JSON.stringify({ checkpoint: { page: 'legacy lifecycle' } }), 'utf8');
  const result = spawnSync(process.execPath, ['tools/knowledge.mjs', 'task', 'checkpoint', run.currentTaskId, checkpointFile, '--data', dir], { cwd: path.resolve('.'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const after = loadWorkspace(dir);
  const storedRuns = JSON.parse(fs.readFileSync(path.join(after.dataDir, 'runs.json'), 'utf8'));
  assert.equal(storedRuns[0].leaseId, legacyRun.leaseId);
  assert.equal(Object.hasOwn(storedRuns[0], 'effectiveHeartbeatAt'), false);
});

test('heartbeat requires the current lease and task and rejects mismatches', async (t) => {
  const dir = workspace(t);
  const { run } = startRun(dir, {}, null, { now: fixedNow, id: 'run.owner' });
  await assert.rejects(heartbeatRun(dir, run.id, { leaseId: 'lease.wrong', now: fixedNow }), /lease/i);
  await assert.rejects(heartbeatRun(dir, run.id, { leaseId: run.leaseId, taskId: 'task.wrong', now: fixedNow }), /task/i);
});


test('a heartbeat renewed after stale selection fences recovery under the commit lock', async (t) => {
  const dir = workspace(t);
  const { run } = startRun(dir, {}, null, { now: '2026-10-16T10:00:00.000Z', id: 'run.race' });
  const staleNow = '2026-10-16T10:10:00.000Z';
  assert.ok(Date.parse(staleNow) - Date.parse(run.heartbeatAt) > 120_000);
  await heartbeatRun(dir, run.id, { leaseId: run.leaseId, taskId: run.currentTaskId, now: staleNow });
  await assert.rejects(withWorkspaceLock(dir, () => fenceStaleRunRecovery(dir, [run.id], staleNow)), /renewed/i);
  assert.equal(readPresence(dir, loadWorkspace(dir).runs[0]).retired, undefined);
});

test('pause retires the lease and later heartbeats cannot revive the paused run', async (t) => {
  const dir = workspace(t);
  const { run } = startRun(dir, {}, null, { now: fixedNow, id: 'run.paused' });
  stopRun(dir, run.id, 'checkpointed pause', { now: '2026-10-16T10:01:00.000Z' });
  assert.equal(readPresence(dir, loadWorkspace(dir).runs[0]).retired, true);
  const resume = spawnSync(process.execPath, ['tools/knowledge.mjs', 'task', 'resume', run.currentTaskId, '--data', dir], { encoding: 'utf8' });
  assert.equal(resume.status, 0, resume.stderr);
  const replacement = startRun(dir, {}, null, { now: '2026-10-16T10:03:00.000Z', id: 'run.replacement' }).run;
  assert.notEqual(replacement.leaseId, run.leaseId);
  await assert.rejects(heartbeatRun(dir, run.id, { leaseId: run.leaseId, now: '2026-10-16T10:02:00.000Z' }), /paused|retired/i);
});

function commitSnapshot(dir, old, runs, options) {
  return commitRevision(dir, old.revision, { app: old.app, journeys: old.journeys, features: old.features,
    catalog: old.catalog, inventory: old.inventory, frontier: old.frontier, runs, activity: old.activity }, options);
}

test('crash before CURRENT leaves old ownership intact; crash after CURRENT leaves old lease retired', async (t) => {
  const beforeDir = workspace(t);
  const beforeRun = startRun(beforeDir, {}, null, { now: '2026-10-16T10:00:00.000Z', id: 'run.before' }).run;
  const before = loadWorkspace(beforeDir);
  assert.throws(() => commitSnapshot(beforeDir, before, before.runs, {
    beforeCurrent: () => fenceStaleRunRecovery(beforeDir, [beforeRun.id], '2026-10-16T10:10:00.000Z'), crashAt: 'before-current',
  }), /Simulated crash before CURRENT/);
  assert.equal(loadWorkspace(beforeDir).revision, before.revision);
  assert.equal(readPresence(beforeDir, loadWorkspace(beforeDir).runs[0]), null);

  const afterDir = workspace(t);
  const afterRun = startRun(afterDir, {}, null, { now: '2026-10-16T10:00:00.000Z', id: 'run.after' }).run;
  const after = loadWorkspace(afterDir);
  const interrupted = after.runs.map((run) => run.id === afterRun.id ? { ...run, currentTaskId: null, status: 'interrupted' } : run);
  assert.throws(() => commitSnapshot(afterDir, after, interrupted, {
    beforeCurrent: () => fenceStaleRunRecovery(afterDir, [afterRun.id], '2026-10-16T10:10:00.000Z'), crashAt: 'after-current',
  }), /Simulated crash after CURRENT/);
  const committed = loadWorkspace(afterDir);
  assert.notEqual(committed.revision, after.revision);
  assert.equal(committed.runs[0].status, 'interrupted');
  assert.equal(readPresence(afterDir, committed.runs[0]).retired, true);
  fs.rmSync(path.join(afterDir, '.revision.lock'), { force: true });
  await assert.rejects(heartbeatRun(afterDir, afterRun.id, { leaseId: afterRun.leaseId, now: '2026-10-16T10:11:00.000Z' }), /retired|task|interrupted/i);
});

test('crash after recovery fence but before CURRENT keeps old revision and rejects retired lease', async (t) => {
  const dir = workspace(t);
  const run = startRun(dir, {}, null, { now: '2026-10-16T10:00:00.000Z', id: 'run.fenced-crash' }).run;
  const before = loadWorkspace(dir);
  const interrupted = before.runs.map((item) => item.id === run.id ? { ...item, currentTaskId: null, status: 'interrupted' } : item);
  assert.throws(() => commitSnapshot(dir, before, interrupted, {
    beforeCurrent: () => fenceStaleRunRecovery(dir, [run.id], '2026-10-16T10:10:00.000Z'),
    crashAt: 'after-before-current',
  }), /after beforeCurrent guard/i);
  assert.equal(loadWorkspace(dir).revision, before.revision);
  assert.equal(readPresence(dir, loadWorkspace(dir).runs[0]).retired, true);
  fs.rmSync(path.join(dir, '.revision.lock'), { force: true });
  await assert.rejects(heartbeatRun(dir, run.id, { leaseId: run.leaseId, now: '2026-10-16T10:11:00.000Z' }), /retired/i);
});
