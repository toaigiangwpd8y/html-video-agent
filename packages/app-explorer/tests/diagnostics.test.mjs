import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { initWorkspace, loadWorkspace } from '../lib/store.mjs';
import { startRun, stopRun } from '../lib/runs.mjs';
import { recordDiagnostic, readDiagnostics, createDiagnosticsReader } from '../lib/diagnostics.mjs';
import { withWorkspaceLock } from '../lib/revisions.mjs';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-diagnostics-'));
  initWorkspace(dir, 'Diagnostics test', 'https://example.org');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const fixedNow = '2026-10-16T10:00:00.000Z';
const event = (id, fields = {}) => ({ id, runId: 'run.one', taskId: 'app.discover.root', timestamp: fixedNow,
  operation: 'workspace_read', phase: 'error', status: 'failed', errorCode: 'io_error', ...fields });

async function collectReadyChild(child, { startupTimeoutMs = 5_000, completionTimeoutMs = 5_000 } = {}) {
  let stdout = '';
  let readySeen = false;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
    if (!readySeen && stdout.split(/\r?\n/).includes('READY')) { readySeen = true; resolveReady(); }
  });
  let closedResult;
  const closed = new Promise((resolve) => child.once('close', (code, signal) => {
    closedResult = { code, signal };
    resolve(closedResult);
  }));
  let startupTimer;
  let completionTimer;
  try {
    const startup = await Promise.race([
      ready.then(() => ({ ready: true })),
      closed.then((result) => ({ closed: result })),
      new Promise((resolve) => { startupTimer = setTimeout(() => resolve({ timeout: 'startup' }), startupTimeoutMs); }),
    ]);
    if (startup.timeout) throw new Error(`Lock helper exceeded startup READY deadline (${startupTimeoutMs}ms).`);
    if (startup.closed) throw new Error(`Lock helper exited before import-ready handshake (code ${startup.closed.code}, signal ${startup.closed.signal}).`);
    const completion = await Promise.race([
      closed.then((result) => ({ closed: result })),
      new Promise((resolve) => { completionTimer = setTimeout(() => resolve({ timeout: 'completion' }), completionTimeoutMs); }),
    ]);
    if (completion.timeout) throw new Error(`Lock helper exceeded post-READY completion deadline (${completionTimeoutMs}ms).`);
    if (completion.closed.code !== 0) throw new Error(`Lock helper exited with code ${completion.closed.code}, signal ${completion.closed.signal}.`);
    return stdout;
  } finally {
    clearTimeout(startupTimer);
    clearTimeout(completionTimer);
    if (!closedResult) {
      child.kill();
      await closed;
    }
  }
}

test('diagnostics enforce the metadata allowlist and never advance CURRENT', async (t) => {
  const dir = workspace(t);
  const revision = loadWorkspace(dir).revision;
  await assert.rejects(recordDiagnostic(dir, event('diag.bad', { argv: ['--token', 'secret'] })), /Unexpected diagnostic field/);
  await assert.rejects(recordDiagnostic(dir, event('diag.bad', { url: 'https://example.org/?token=secret' })), /Unexpected diagnostic field/);
  await assert.rejects(recordDiagnostic(dir, event('diag.bad', { stderr: 'password=hunter2' })), /Unexpected diagnostic field/);
  const result = await recordDiagnostic(dir, event('diag.one', { operationId: 'op.safe-1', durationMs: 23, exitCode: 1, recovery: 'retry' }));
  assert.equal(result.duplicate, false);
  assert.equal(loadWorkspace(dir).revision, revision);
  const page = readDiagnostics(dir);
  assert.equal(page.events.length, 1);
  assert.equal(page.events[0].operationId, 'op.safe-1');
  assert.equal(page.events[0].durationMs, 23);
  assert.equal(page.events[0].exitCode, 1);
  assert.equal(page.events[0].recovery, 'retry');
  assert.equal(JSON.stringify(page).includes('secret'), false);
  for (const field of ['input', 'stdout', 'profile']) await assert.rejects(recordDiagnostic(dir, event(`diag.${field}`, { [field]: 'private' })), /Unexpected diagnostic field/);
});

test('diagnostic CLI records only allowlisted metadata', (t) => {
  const dir = workspace(t);
  const input = path.join(dir, 'event.json');
  fs.writeFileSync(input, JSON.stringify(event('diag.cli', { operationId: 'op.cli' })), 'utf8');
  const result = spawnSync(process.execPath, ['tools/knowledge.mjs', 'diagnostic', 'record', input, '--data', dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).duplicate, false);
  assert.equal(readDiagnostics(dir).events[0].operationId, 'op.cli');
  assert.equal(loadWorkspace(dir).revision, 'r000001');
});

test('diagnostic IDs deduplicate and cursors resync across generations', async (t) => {
  const dir = workspace(t);
  const first = await recordDiagnostic(dir, event('diag.one'));
  const duplicate = await recordDiagnostic(dir, event('diag.one', { phase: 'finish', status: 'succeeded' }));
  const otherDir = workspace(t);
  assert.equal(readDiagnostics(otherDir, { after: first.cursor }).resync, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.cursor, first.cursor);
  assert.equal(readDiagnostics(dir, { after: 'invalid-cursor' }).resync, true);
});

test('diagnostics paginate by delivered record offsets without skipping duplicates or gaps', async (t) => {
  const dir = workspace(t);
  for (let index = 1; index <= 5; index++) await recordDiagnostic(dir, event(`diag.page-${index}`));
  const file = path.join(dir, 'runtime', 'diagnostics.jsonl');
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  fs.appendFileSync(file, lines[1] + '\n{malformed-row}\n', 'utf8');
  const first = readDiagnostics(dir, { limit: 2 });
  assert.equal(first.resync, true);
  assert.equal(first.gap, true);
  assert.deepEqual(first.events.map((item) => item.id), ['diag.page-1', 'diag.page-2']);
  assert.equal(first.hasMore, true);
  const second = readDiagnostics(dir, { after: first.cursor, limit: 2 });
  assert.deepEqual(second.events.map((item) => item.id), ['diag.page-3', 'diag.page-4']);
  assert.equal(second.hasMore, true);
  const third = readDiagnostics(dir, { after: second.cursor, limit: 2 });
  assert.deepEqual(third.events.map((item) => item.id), ['diag.page-5']);
  assert.equal(third.hasMore, false);
  assert.equal(third.resync, false);
});

test('diagnostic reading reports malformed and truncated tails as gaps without exposing bytes', async (t) => {
  const dir = workspace(t);
  await recordDiagnostic(dir, event('diag.one'));
  const file = path.join(dir, 'runtime', 'diagnostics.jsonl');
  fs.appendFileSync(file, '{"password":"must-not-leak"}', 'utf8');
  const page = readDiagnostics(dir);
  assert.equal(page.gap, true);
  assert.equal(page.resync, true);
  assert.equal(page.events.some((item) => JSON.stringify(item).includes('must-not-leak')), false);
  await recordDiagnostic(dir, event('diag.two'));
  const repaired = readDiagnostics(dir);
  assert.equal(repaired.gap, false);
  assert.deepEqual(repaired.events.map((item) => item.id), ['diag.one', 'diag.two']);
  fs.appendFileSync(file, '{malformed-complete-row}\n', 'utf8');
  assert.equal(readDiagnostics(dir).gap, true);
  await recordDiagnostic(dir, event('diag.three'));
  assert.equal(readDiagnostics(dir).gap, false);
});

test('concurrent diagnostic appends serialize and retain every unique event', async (t) => {
  const dir = workspace(t);
  await Promise.all(Array.from({ length: 8 }, (_, i) => recordDiagnostic(dir, event(`diag.${i + 1}`))));
  const page = readDiagnostics(dir);
  assert.equal(page.events.length, 8);
  assert.equal(new Set(page.events.map((item) => item.id)).size, 8);
});

test('independent Node processes serialize diagnostic appends through the workspace fence', async (t) => {
  const dir = workspace(t);
  const moduleUrl = new URL('../lib/diagnostics.mjs', import.meta.url).href;
  const children = Array.from({ length: 6 }, (_, i) => {
    const payload = event(`diag.child-${i + 1}`);
    const script = `import { recordDiagnostic } from ${JSON.stringify(moduleUrl)}; await recordDiagnostic(${JSON.stringify(dir)}, ${JSON.stringify(payload)});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    return new Promise((resolve, reject) => {
      let stderr = '';
      child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`child exited ${code}: ${stderr}`)));
    });
  });
  await Promise.all(children);
  const page = readDiagnostics(dir);
  assert.equal(page.events.length, 6);
  assert.equal(new Set(page.events.map((item) => item.id)).size, 6);
});
test('workspace lock waits through transient empty lock initialization and fences persistent corruption', async (t) => {
  const dir = workspace(t);
  const lock = path.join(dir, '.revision.lock');
  fs.writeFileSync(lock, '', 'utf8');
  const owner = new Promise((resolve) => setTimeout(() => {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: 'test.owner' }), 'utf8');
    setTimeout(() => { fs.unlinkSync(lock); resolve(); }, 35);
  }, 35));
  const result = await withWorkspaceLock(dir, () => 'acquired after owner release');
  await owner;
  assert.equal(result, 'acquired after owner release');
  fs.writeFileSync(lock, '{still-corrupt', 'utf8');
  await assert.rejects(withWorkspaceLock(dir, () => 'must not run'), /unreadable.*manual recovery/i);
  assert.equal(fs.readFileSync(lock, 'utf8'), '{still-corrupt');
});

test('workspace lock retries a stale-owner observation replaced before recovery fencing', async (t) => {
  const dir = workspace(t);
  const lock = path.join(dir, '.revision.lock');
  const recovery = path.join(dir, '.revision.recovery.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: 2147483647, hostname: os.hostname(), token: 'dead.owner' }), 'utf8');
  const originalLink = fs.linkSync;
  let replaced = false;
  fs.linkSync = function(source, file) {
    if (!replaced && path.resolve(String(file)) === path.resolve(recovery)) {
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, hostname: os.hostname(), token: 'new.owner' }), 'utf8');
      replaced = true;
      setTimeout(() => { if (fs.existsSync(lock)) fs.unlinkSync(lock); }, 40);
    }
    return originalLink.call(fs, source, file);
  };
  try {
    const result = await withWorkspaceLock(dir, () => 'acquired after stale observation changed');
    assert.equal(replaced, true);
    assert.equal(result, 'acquired after stale observation changed');
  } finally { fs.linkSync = originalLink; }
});

test('async workspace lock times out instead of spinning behind an orphan recovery guard', async (t) => {
  const dir = workspace(t);
  const lock = path.join(dir, '.revision.lock');
  const recovery = path.join(dir, '.revision.recovery.lock');
  const deadOwner = JSON.stringify({ pid: 2147483647, hostname: os.hostname(), token: 'dead.owner' });
  const orphanGuard = JSON.stringify({ pid: 2147483647, hostname: os.hostname(), token: 'orphan.guard' });
  fs.writeFileSync(lock, deadOwner, 'utf8');
  fs.writeFileSync(recovery, orphanGuard, 'utf8');
  const moduleUrl = new URL('../lib/revisions.mjs', import.meta.url).href;
  const script = `import { withWorkspaceLock } from ${JSON.stringify(moduleUrl)}; console.log('READY'); try { await withWorkspaceLock(${JSON.stringify(dir)}, () => 'unexpected', { timeoutMs: 90 }); console.log('unexpected acquisition'); } catch (error) { console.log(error.message); }`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = await collectReadyChild(child);
  assert.match(stdout, /Timed out waiting for workspace revision lock/i);
  assert.equal(fs.readFileSync(lock, 'utf8'), deadOwner);
  assert.equal(fs.readFileSync(recovery, 'utf8'), orphanGuard);
});

test('lock helper startup timeout kills and reaps a child that never sends READY', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  await assert.rejects(collectReadyChild(child, { startupTimeoutMs: 100, completionTimeoutMs: 100 }), /startup READY deadline/);
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'startup timeout reaps the child process');
});

test('workspace lock serializes asynchronous callbacks and releases after throws', async (t) => {
  const dir = workspace(t);
  const order = [];
  await Promise.all([
    withWorkspaceLock(dir, async () => { order.push('a-start'); await new Promise((resolve) => setTimeout(resolve, 20)); order.push('a-end'); }),
    withWorkspaceLock(dir, () => { order.push('b'); }),
  ]);
  assert.deepEqual(order, ['a-start', 'a-end', 'b']);
  await assert.rejects(withWorkspaceLock(dir, () => { throw new Error('callback failed'); }), /callback failed/);
  assert.equal(await withWorkspaceLock(dir, () => 'released'), 'released');
});


test('diagnostic head metadata is cursor-neutral across continued pages on a persistent gap', async (t) => {
  const dir = workspace(t);
  for (let index = 1; index <= 5; index++) await recordDiagnostic(dir, event('diag.head-' + index));
  const file = path.join(dir, 'runtime', 'diagnostics.jsonl');
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  fs.appendFileSync(file, lines[1] + '\n{"password":"private-must-not-leak"}\n', 'utf8');
  const reader = createDiagnosticsReader(dir);
  const initialHead = reader.head();
  assert.equal(initialHead.gap, true);
  assert.equal(Object.hasOwn(initialHead, 'resync'), false);
  assert.equal(JSON.stringify(initialHead).includes('private-must-not-leak'), false);
  const firstHead = reader.head();
  assert.deepEqual(firstHead, initialHead);
  assert.equal(reader.counters.scans, 1);

  const first = reader.read({ limit: 2 });
  assert.equal(first.resync, true);
  assert.deepEqual(first.events.map((item) => item.id), ['diag.head-1', 'diag.head-2']);
  const headAfterFirst = reader.head();
  assert.equal(headAfterFirst.cursor, initialHead.cursor);
  const second = reader.read({ after: first.cursor, limit: 2 });
  assert.equal(second.resync, false);
  assert.deepEqual(second.events.map((item) => item.id), ['diag.head-3', 'diag.head-4']);
  assert.equal(reader.head().cursor, initialHead.cursor);
  const third = reader.read({ after: second.cursor, limit: 2 });
  assert.equal(third.resync, false);
  assert.deepEqual(third.events.map((item) => item.id), ['diag.head-5']);
  assert.equal(third.hasMore, false);
  assert.equal(reader.head().cursor, initialHead.cursor);
  assert.equal(reader.head().gap, true);
  assert.equal(reader.counters.scans, 1);
});

test('manual workflow diagnostics record sanitized draft and missing-evidence failures', (t) => {
  const dir = workspace(t);
  const invoke = (payload) => {
    const input = path.join(dir, 'event.json');
    fs.writeFileSync(input, JSON.stringify(payload), 'utf8');
    return spawnSync(process.execPath, ['tools/knowledge.mjs', 'diagnostic', 'record', input, '--data', dir], { encoding: 'utf8' });
  };
  const base = { runId: 'run.manual-diagnostic', taskId: 'task.manual-diagnostic', timestamp: fixedNow, phase: 'error', status: 'failed', recovery: 'retry' };
  for (const [id, operation, errorCode] of [
    ['diag.draft-invalid', 'workspace_read', 'draft_packet_invalid'],
    ['diag.evidence-missing', 'workspace_write', 'evidence_directory_missing'],
  ]) {
    const result = invoke({ ...base, id, operation, errorCode });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).duplicate, false);
  }
  const events = readDiagnostics(dir).events;
  assert.deepEqual(events.map(({ operation, errorCode }) => [operation, errorCode]), [
    ['workspace_read', 'draft_packet_invalid'], ['workspace_write', 'evidence_directory_missing'],
  ]);
  const rejected = invoke({ ...base, id: 'diag.raw-prose', operation: 'workspace_read', errorCode: 'draft_packet_invalid', message: 'private raw stderr' });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Unexpected diagnostic field/i);
  assert.equal(JSON.stringify(readDiagnostics(dir)).includes('private raw stderr'), false);
});
