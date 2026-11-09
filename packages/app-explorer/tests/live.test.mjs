import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadWorkspace } from '../lib/store.mjs';
import { createServer } from '../server.mjs';
import { heartbeatRun } from '../lib/runs.mjs';
import { knowledgeRevisionChanged } from '../public/live-utils.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(root, '..');

async function waitFor(url) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { return await fetch(url); } catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  throw lastError;
}

function runCli(args, cwd = project) {
  const result = spawn(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true });
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    result.stdout.on('data', chunk => stdout += chunk);
    result.stderr.on('data', chunk => stderr += chunk);
    result.once('error', reject);
    result.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `CLI exited ${code}`)));
  });
}

function listenEphemeral(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function fixtureWorkspace(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-live-'));
  let cleanup = async () => {};
  t.after(async () => {
    await cleanup();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const data = path.join(temp, 'workspace');
  fs.cpSync(path.join(project, 'examples', 'demo-knowledge'), data, { recursive: true });
  await runCli(['tools/knowledge.mjs', 'migrate', '--data', data]);
  return { temp, data, setCleanup: (action) => { cleanup = action; } };
}

async function startLiveServerChild(dataDir, { port = 0, startupTimeoutMs = 10_000 } = {}) {
  const helper = path.join(project, 'tests', 'fixtures', 'live-server-child.mjs');
  const child = spawn(process.execPath, [helper, dataDir, String(port)], {
    cwd: project, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let stdout = '', stderr = '', pending = '', closedResult;
  let resolveReady, resolveSpawnError;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const spawnError = new Promise((resolve) => { resolveSpawnError = resolve; });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => {
    closedResult = { code, signal };
    resolve(closedResult);
  }));
  child.once('error', resolveSpawnError);
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
    pending += chunk;
    const rows = pending.split(/\r?\n/);
    pending = rows.pop() || '';
    for (const row of rows) {
      try {
        const message = JSON.parse(row);
        if (message.type === 'READY' && message.host === '127.0.0.1' && Number.isInteger(message.port) && message.port > 0) resolveReady(message);
      } catch {}
    }
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  let timeoutHandle;
  const outcome = await Promise.race([
    ready.then((message) => ({ message })),
    closed.then((result) => ({ closed: result })),
    spawnError.then((error) => ({ error })),
    new Promise((resolve) => { timeoutHandle = setTimeout(() => resolve({ timeout: true }), startupTimeoutMs); }),
  ]);
  clearTimeout(timeoutHandle);
  if (outcome.message) {
    return {
      port: outcome.message.port,
      close: async () => {
        if (!closedResult) child.kill();
        await closed;
      },
    };
  }
  if (!closedResult) {
    child.kill();
    await closed;
  }
  const detail = outcome.timeout ? 'startup READY deadline exceeded after ' + startupTimeoutMs + ' ms'
    : outcome.error ? 'spawn error: ' + outcome.error.message
      : 'child exited before READY (code ' + outcome.closed?.code + ', signal ' + outcome.closed?.signal + ')';
  throw new Error('Live server helper ' + detail + '; stdout=' + stdout.trim() + '; stderr=' + stderr.trim());
}

async function fixture(t, clock = null) {
  const { data, setCleanup } = await fixtureWorkspace(t);
  let port;
  if (clock) {
    const server = createServer({ dataDir: data, staticDir: path.join(project, 'public'), now: () => clock.value });
    port = await listenEphemeral(server);
    setCleanup(() => closeServer(server));
  } else {
    const server = await startLiveServerChild(data);
    port = server.port;
    setCleanup(server.close);
  }
  const base = 'http://127.0.0.1:' + port;
  await waitFor(base + '/api/state');
  return { data, base };
}

test('spawned live server reports its OS-assigned loopback port after listening', async (t) => {
  const { data } = await fixtureWorkspace(t);
  const server = await startLiveServerChild(data);
  t.after(server.close);
  const response = await fetch('http://127.0.0.1:' + server.port + '/api/state');
  assert.equal(response.status, 200);
  assert.ok((await response.json()).revision);
});

test('spawned live server reports EADDRINUSE metadata when its requested port is occupied', async (t) => {
  const { data } = await fixtureWorkspace(t);
  const occupied = http.createServer((_request, response) => response.end('occupied'));
  const port = await listenEphemeral(occupied);
  t.after(() => closeServer(occupied));
  await assert.rejects(startLiveServerChild(data, { port }), (error) => {
    assert.match(error.message, /child exited before READY/);
    assert.match(error.message, /EADDRINUSE/);
    assert.match(error.message, /"address":"127\.0\.0\.1"/);
    assert.match(error.message, new RegExp('\"port\":' + port));
    return true;
  });
});

test('live state sees an atomic CLI knowledge update without restarting the server', async (t) => {
  const { data, base } = await fixture(t);
  const before = await (await fetch(`${base}/api/state`)).json();
  assert.ok(before.frontierSummary);
  assert.ok(before.frontierSummary.counts);
  assert.ok(Object.hasOwn(before, 'activeRuns'));
  assert.ok(before.frontierCounts.ready >= 0);
  assert.ok(before.frontierCounts.waiting >= 0);
  assert.ok(before.frontierCounts.blocked >= 0);
  assert.ok(before.syncedAt);
  const feature = structuredClone(loadWorkspace(data).features[0]);
  feature.summary = `${feature.summary} Updated live.`;
  const observation = path.join(path.dirname(data), 'observation.json');
  fs.writeFileSync(observation, JSON.stringify({ version: 2, features: [feature] }));
  await runCli(['tools/knowledge.mjs', 'apply', observation, '--data', data, '--expected-revision', before.revision]);
  const after = await (await fetch(`${base}/api/state`)).json();
  assert.notEqual(after.revision, before.revision);
  assert.equal(after.features.find(item => item.id === feature.id).summary, feature.summary);
  assert.equal(after.revision, loadWorkspace(data).revision);
});

test('heartbeat freshness changes on the same knowledge revision', async (t) => {
  const clock = { value: new Date() };
  const { data, base } = await fixture(t, clock);
  const scopeFile = path.join(path.dirname(data), 'scope.json');
  fs.writeFileSync(scopeFile, JSON.stringify({ role: 'member', date: '2026-10-16' }));
  const started = JSON.parse(await runCli(['tools/knowledge.mjs', 'run', 'start', scopeFile, '--data', data, '--json']));
  const beat = JSON.parse(await runCli(['tools/knowledge.mjs', 'run', 'heartbeat', started.run.id, '--lease', started.run.leaseId, '--task', started.run.currentTaskId, '--data', data, '--json']));
  const fresh = await (await fetch(`${base}/api/head`)).json();
  const run = fresh.activeRuns.find(item => item.currentTaskId);
  assert.ok(run);
  assert.equal(run.status, 'running');
  assert.equal(fresh.latestRun.status, 'running');
  const detailed = await (await fetch(base + '/api/state')).json();
  assert.equal(detailed.frontier.tasks.find(task => task.id === run.currentTaskId).status, 'running');
  assert.equal(detailed.features.find(feature => feature.id === 'projects.create').status, 'partial');
  assert.ok(fresh.frontierCounts.ready >= 0);
  const durableHeartbeat = loadWorkspace(data).runs.find(item => item.id === run.id).heartbeatAt;
  clock.value = new Date(Date.parse(beat.heartbeatAt) + 30_000);
  const renewal = await heartbeatRun(data, run.id, { leaseId: started.run.leaseId, taskId: run.currentTaskId, now: clock.value });
  const renewed = await (await fetch(base + '/api/head')).json();
  assert.equal(renewed.revision, fresh.revision);
  assert.equal(renewed.activeRuns.find(item => item.id === run.id).heartbeatAt, renewal.heartbeatAt);
  assert.equal(loadWorkspace(data).runs.find(item => item.id === run.id).heartbeatAt, durableHeartbeat);
  clock.value = new Date(Date.parse(renewal.heartbeatAt) + 121_000);
  const stale = await (await fetch(base + '/api/head')).json();
  assert.equal(stale.revision, fresh.revision);
  assert.equal(stale.activeRuns.find(item => item.id === run.id).status, 'interrupted');
  assert.equal(stale.activeRuns.find(item => item.id === run.id).stale, true);
});

test('currentTask is attributed to the newest active run shown by the dashboard', async (t) => {
  const { data, base } = await fixture(t);
  const scopeFile = path.join(path.dirname(data), 'scope.json');
  fs.writeFileSync(scopeFile, JSON.stringify({ role: 'member', date: '2026-10-16' }));
  await runCli(['tools/knowledge.mjs', 'run', 'start', scopeFile, '--data', data, '--json']);
  await runCli(['tools/knowledge.mjs', 'run', 'start', scopeFile, '--data', data, '--json']);
  const response = await (await fetch(base + '/api/state')).json();
  const shown = response.activeRuns.find(run => run.id === response.displayRunId);
  assert.ok(shown);
  assert.equal(response.displayRunId, response.activeRuns.at(-1).id);
  assert.equal(response.currentTask, shown.currentTaskId);
  assert.ok(response.activeRuns.length >= 2);
});
test('activity API advances known cursors and asks for resync on unknown cursors', async (t) => {
  const { data, base } = await fixture(t);
  const initial = await (await fetch(`${base}/api/activity`)).json();
  assert.deepEqual(initial.events, []);
  assert.equal(initial.resync, false);

  const scopeFile = path.join(path.dirname(data), 'scope.json');
  fs.writeFileSync(scopeFile, JSON.stringify({ role: 'member', date: '2026-10-16' }));
  await runCli(['tools/knowledge.mjs', 'run', 'start', scopeFile, '--data', data, '--json']);
  const update = await (await fetch(`${base}/api/activity?after=${encodeURIComponent(initial.cursor ?? '')}`)).json();
  assert.equal(update.resync, false);
  assert.equal(update.events.length, 1);
  assert.equal(update.events[0].type, 'task_started');
  assert.equal(update.cursor, update.events[0].id);
  assert.ok(update.events[0].revision);
  const known = await (await fetch(`${base}/api/activity?after=${encodeURIComponent(update.cursor)}`)).json();
  assert.deepEqual(known.events, []);

  const unknown = await (await fetch(`${base}/api/activity?after=event.missing`)).json();
  assert.equal(unknown.resync, true);
  assert.equal(unknown.reason, 'unknown_cursor');
  assert.equal(unknown.cursor, update.cursor);
});


test('V1 head polling keeps its null revision stable', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-v1-head-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.writeFileSync(path.join(temp, 'catalog.json'), JSON.stringify({
    app: { name: 'V1 fixture', baseUrl: 'http://127.0.0.1' }, features: [], journeys: [],
  }), 'utf8');
  const server = createServer({ dataDir: temp, staticDir: path.join(project, 'public') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const first = await (await fetch(base + '/api/head')).json();
  const second = await (await fetch(base + '/api/head')).json();
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.revision, null);
  assert.equal(second.revision, null);
  assert.equal(knowledgeRevisionChanged(first.revision, second.revision), false);
});
