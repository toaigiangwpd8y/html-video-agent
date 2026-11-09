import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { intervalForStaleThreshold, pulseIsLive, runPresenceCompanion } from '../lib/presence-companion.mjs';
import { loadWorkspace, migrateWorkspace } from '../lib/store.mjs';
import { heartbeatRun, startRun, stopRun } from '../lib/runs.mjs';
import { withWorkspaceLock } from '../lib/revisions.mjs';
import { readPresence } from '../lib/presence.mjs';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-companion-'));
  fs.cpSync(path.resolve('examples/demo-knowledge'), dir, { recursive: true });
  migrateWorkspace(dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('companion cadence derives from configured stale threshold', () => {
  assert.equal(intervalForStaleThreshold(120_000), 40_000);
  assert.equal(intervalForStaleThreshold(1_000), 333);
  assert.throws(() => intervalForStaleThreshold(999), /stale threshold/i);
});

test('pulse is live only while its file is fresh and well formed', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-pulse-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pulse = path.join(dir, 'worker.pulse');
  fs.writeFileSync(pulse, 'alive', 'utf8');
  const now = Date.now();
  assert.equal(pulseIsLive(pulse, { now, staleAfterMs: 5_000 }), true);
  assert.equal(pulseIsLive(pulse, { now: now + 6_000, staleAfterMs: 5_000 }), false);
  fs.rmSync(pulse);
  assert.equal(pulseIsLive(pulse, { now, staleAfterMs: 5_000 }), false);
});

test('heartbeat rechecks worker liveness after waiting for workspace lock', async (t) => {
  const dir = workspace(t);
  const { run } = startRun(dir, {}, null, { id: 'run.companion-race' });
  let live = true;
  let release;
  const lock = withWorkspaceLock(dir, () => new Promise((resolve) => { release = resolve; }));
  while (!release) await new Promise((resolve) => setTimeout(resolve, 2));
  const pending = heartbeatRun(dir, run.id, { leaseId: run.leaseId, beforePresenceWrite: () => live });
  live = false;
  release();
  await lock;
  await assert.rejects(pending, /worker.*live|liveness/i);
  assert.equal(readPresence(dir, loadWorkspace(dir).runs[0]), null);
});

test('companion renews a live pulse then exits when that pulse disappears', async (t) => {
  const dir = workspace(t);
  const { run } = startRun(dir, {}, null, { id: 'run.companion-live' });
  const pulse = path.join(dir, 'worker.pulse');
  fs.writeFileSync(pulse, 'alive', 'utf8');
  const output = { value: '', write(chunk) { this.value += chunk; } };
  const controller = new AbortController();
  const running = runPresenceCompanion({ dataDir: dir, runId: run.id, leaseId: run.leaseId, pulsePath: pulse,
    staleAfterMs: 1_000, intervalMs: 50, signal: controller.signal, stdout: output, stderr: output });
  for (let index = 0; index < 50 && !readPresence(dir, loadWorkspace(dir).runs[0]); index++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(readPresence(dir, loadWorkspace(dir).runs[0]));
  fs.rmSync(pulse);
  const result = await running;
  assert.deepEqual(result, { stopped: true, reason: 'worker_pulse_missing_or_stale' });
  assert.match(output.value, /"type":"heartbeat"/);
  assert.match(output.value, /"type":"stopped"/);
});

test('missed pulse cannot renew presence and retired leases cannot be revived', async (t) => {
  const dir = workspace(t);
  const { run } = startRun(dir, {}, null, { id: 'run.companion-retired' });
  await assert.rejects(heartbeatRun(dir, run.id, { leaseId: run.leaseId, beforePresenceWrite: () => false }), /worker.*live|liveness/i);
  assert.equal(readPresence(dir, loadWorkspace(dir).runs[0]), null);
  stopRun(dir, run.id, 'fixture pause');
  await assert.rejects(heartbeatRun(dir, run.id, { leaseId: run.leaseId, beforePresenceWrite: () => true }), /paused|retired/i);
  assert.equal(readPresence(dir, loadWorkspace(dir).runs[0]).retired, true);
});
test('V2 heartbeat verifies ownership metadata without reading feature records', async (t) => {
  const dir = workspace(t);
  const { run } = startRun(dir, {}, null, { id: 'run.targeted-reader' });
  const reads = [];
  await heartbeatRun(dir, run.id, { leaseId: run.leaseId, onHeartbeatRead: (entry) => reads.push(entry) });
  assert.deepEqual(reads.map((entry) => entry.relative).sort(), ['activity.json', 'catalog.json', 'frontier.json', 'inventory.json', 'runs.json']);
  assert.equal(reads.some((entry) => entry.relative.startsWith('features/')), false);
});
test('a present V2 manifest with a changed ownership file fails closed', async (t) => {
  const dir = workspace(t);
  const { run } = startRun(dir, {}, null, { id: 'run.companion-hash' });
  const data = loadWorkspace(dir);
  const runsFile = path.join(data.dataDir, 'runs.json');
  fs.appendFileSync(runsFile, ' ', 'utf8');
  await assert.rejects(heartbeatRun(dir, run.id, { leaseId: run.leaseId }), /metadata hash mismatch/i);
  assert.equal(readPresence(dir, data.runs.find((item) => item.id === run.id)), null);
});
test('stopping an owned companion leaves its live worker pulse and run untouched', async (t) => {
  const dir = workspace(t);
  const { run } = startRun(dir, {}, null, { id: 'run.companion-stop' });
  const pulse = path.join(dir, 'worker.pulse');
  fs.writeFileSync(pulse, 'alive', 'utf8');
  const controller = new AbortController();
  const stream = { write() {} };
  const running = runPresenceCompanion({ dataDir: dir, runId: run.id, leaseId: run.leaseId, pulsePath: pulse,
    staleAfterMs: 1_000, intervalMs: 100, signal: controller.signal, stdout: stream, stderr: stream });
  for (let index = 0; index < 50 && !readPresence(dir, loadWorkspace(dir).runs[0]); index++) await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  assert.deepEqual(await running, { stopped: true, reason: 'requested' });
  assert.equal(fs.existsSync(pulse), true);
  assert.equal(loadWorkspace(dir).runs.find((item) => item.id === run.id).status, 'running');
  assert.equal(readPresence(dir, loadWorkspace(dir).runs[0]).retired, undefined);
});