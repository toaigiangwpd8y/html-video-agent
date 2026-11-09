import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { applyObservation, loadWorkspace, runKnowledgeCli, startRun, writePresence } from '../packages/app-explorer/index.mjs';
import { startBacklotServer } from '../src/backlot/server.js';
import { registerApp, registerSourceAlias, resolveAppWorkspace } from '../src/app-explorer/registry.js';
import { createAppExplorerReaders, getAppDerivedProjection, getAppExplorerReaders } from '../src/app-explorer/service.js';
import { readConfinedFile } from '../src/app-explorer/safe-file.js';

async function withHost(fn: (root: string, parent: string) => Promise<void>) {
  const parent = await mkdtemp(join(tmpdir(), 'backlot-explorer-api-'));
  const root = join(parent, 'host');
  await mkdir(root);
  try { await fn(root, parent); } finally { await rm(parent, { recursive: true, force: true }); }
}

async function register(root: string, id: string) {
  await registerApp(root, { id, name: id.toUpperCase(), url: `https://${id}.example` });
  const workspace = await resolveAppWorkspace(root, id);
  await cp(resolve('packages/app-explorer/examples/demo-knowledge'), workspace, { recursive: true });
  await runKnowledgeCli(['migrate', '--data', workspace], { cwd: root, stdout: () => {}, stderr: () => {} });
  return workspace;
}

test('Backlot mounts read-only Explorer projections for registered apps only', async () => withHost(async (root) => {
  const a = await register(root, 'app-a');
  const b = await register(root, 'app-b');
  const changedB = startRun(b, {}, null, { id: 'run.only-in-b' });
  const instance = await startBacklotServer({ root, port: 0 });
  try {
    const apps = await (await fetch(`${instance.url}/api/explorer/apps`)).json() as any[];
    assert.deepEqual(apps.map((app) => app.id), ['app-a', 'app-b']);
    assert.ok(!JSON.stringify(apps).includes('session'));
    const headA = await fetch(`${instance.url}/api/explorer/apps/app-a/head`);
    assert.equal(headA.status, 200);
    const appAHead = await headA.json() as any;
    assert.ok(appAHead.revision);
    const appBHead = await (await fetch(`${instance.url}/api/explorer/apps/app-b/head`)).json() as any;
    assert.equal(appBHead.revision, changedB.receipt.revision);
    assert.notEqual(appAHead.revision, appBHead.revision);
    const protectedResponse = await fetch(`${instance.url}/api/explorer/apps/app-a/head`, { headers: { Origin: 'http://example.com' } });
    assert.equal(protectedResponse.status, 403);
    assert.match(protectedResponse.headers.get('content-security-policy') || '', /connect-src 'self'/);
    assert.equal((await fetch(`${instance.url}/api/explorer/apps/unknown/head`)).status, 404);
    assert.equal((await fetch(`${instance.url}/api/explorer/apps/app-a/session`)).status, 404);
    assert.equal((await fetch(`${instance.url}/api/explorer/apps/app-a/head`, { method: 'POST' })).status, 405);
    const videoState = await (await fetch(`${instance.url}/api/state`)).json() as any;
    assert.ok(Array.isArray(videoState.stages));
    assert.equal(videoState.schemaVersion, undefined);
    const state = await (await fetch(`${instance.url}/api/explorer/apps/app-a/state`)).json() as any;
    assert.equal(state.app.name, 'TaskFlow Demo');
    assert.notEqual(a, b);
  } finally { await instance.stop(); }
}));

test('Explorer activity exposes sanitized capture progress independently of knowledge revision', async () => withHost(async (root) => {
  const workspace = await register(root, 'app-a');
  const runId = '4ea5b416-4593-41df-9662-824c3a5ea02b';
  const runDir = join(root, '.video', 'web-capture', 'runs', runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'progress.json'), JSON.stringify({ runId, appId: 'app-a', contextId: 'ctx-main', stepId: 'capture', state: 'waiting_for_reauthentication', timestamp: '2026-10-17T00:00:00.000Z', errorCode: 'SESSION_EXPIRED', endpoint: 'http://127.0.0.1:9222/private' }), 'utf8');
  const otherRunId = '4ea5b416-4593-41df-9662-824c3a5ea03c';
  const otherRunDir = join(root, '.video', 'web-capture', 'runs', otherRunId);
  await mkdir(otherRunDir, { recursive: true });
  await writeFile(join(otherRunDir, 'progress.json'), JSON.stringify({ runId: otherRunId, appId: 'app-b', contextId: 'ctx-main', stepId: 'capture', state: 'running', timestamp: '2026-10-17T00:00:01.000Z' }), 'utf8');
  const instance = await startBacklotServer({ root, port: 0 });
  try {
    const before = (await (await fetch(`${instance.url}/api/explorer/apps/app-a/head`)).json() as any).revision;
    const activity = await (await fetch(`${instance.url}/api/explorer/apps/app-a/activity`)).json() as any;
    assert.equal(activity.revision, before);
    assert.equal(activity.captureProgress.length, 1);
    assert.deepEqual(activity.captureProgress[0], { runId, appId: 'app-a', contextId: 'ctx-main', stepId: 'capture', state: 'waiting_for_reauthentication', timestamp: '2026-10-17T00:00:00.000Z', errorCode: 'SESSION_EXPIRED' });
    assert.equal(JSON.stringify(activity).includes('9222'), false);
    assert.equal((await (await fetch(`${instance.url}/api/explorer/apps/app-a/head`)).json() as any).revision, before);
    await writeFile(join(runDir, 'progress.json'), JSON.stringify({ runId, appId: 'app-a', contextId: 'ctx-main', stepId: 'capture', state: 'running', timestamp: '2026-10-17T00:00:02.000Z' }), 'utf8');
    const refreshed = await (await fetch(`${instance.url}/api/explorer/apps/app-a/activity`)).json() as any;
    assert.equal(refreshed.revision, before);
    assert.equal(refreshed.captureProgress[0].state, 'running');
    assert.equal((await readFile(join(workspace, 'CURRENT.json'), 'utf8')).length > 0, true);
  } finally { await instance.stop(); }
}));

test('derived Explorer views compute once per immutable revision and refresh after receipt change', async () => withHost(async (root) => {
  const workspace = await register(root, 'app-a');
  const readers = createAppExplorerReaders();
  const reader = await getAppExplorerReaders(root, 'app-a', readers);
  const first = reader.knowledge.readKnowledge();
  const projection = getAppDerivedProjection(reader, first);
  assert.equal(getAppDerivedProjection(reader, first), projection);
  assert.equal(reader.derivedBuilds, 1);
  startRun(workspace, {}, null, { id: 'run.cache-refresh' });
  const next = reader.knowledge.readKnowledge();
  assert.notEqual(next.revision, first.revision);
  assert.notEqual(getAppDerivedProjection(reader, next), projection);
  assert.equal(reader.derivedBuilds, 2);
}));

test('Explorer API failures for a replaced source alias never disclose its registered absolute root', async () => withHost(async (root, parent) => {
  const workspace = await register(root, 'app-a');
  const sourceRoot = join(parent, 'private-source-root'); await mkdir(sourceRoot);
  await registerSourceAlias(root, 'app-a', { alias: 'app-code', path: sourceRoot });
  const data = loadWorkspace(workspace);
  data.features[0].research = { sourceCandidates: [{ id: 'candidate', sourceAlias: 'app-code', relativePath: 'src/file.ts', status: 'candidate', note: 'Candidate.' }], controls: [] };
  applyObservation(workspace, { version: 2, baseRevision: data.revision, features: [data.features[0]] });
  await rm(sourceRoot, { recursive: true, force: true });
  const instance = await startBacklotServer({ root, port: 0 });
  try {
    const response = await fetch(`${instance.url}/api/explorer/apps/app-a/head`);
    assert.equal(response.status, 400);
    const body = await response.text();
    assert.match(body, /source directory is unavailable/i);
    assert.equal(body.includes(sourceRoot), false);
    assert.equal(body.includes(parent), false);
  } finally { await instance.stop(); }
}));

test('unchanged knowledge revision reflects presence expiry and renewal in the live head', async () => withHost(async (root) => {
  const workspace = await register(root, 'app-a');
  const started = startRun(workspace, {}, null, { id: 'run.presence', now: '2020-01-01T00:00:00.000Z' });
  const revision = started.receipt.revision;
  const instance = await startBacklotServer({ root, port: 0 });
  try {
    const expired = await (await fetch(`${instance.url}/api/explorer/apps/app-a/head`)).json() as any;
    const expiredRun = expired.activeRuns.find((run: any) => run.id === started.run.id);
    assert.equal(expired.revision, revision);
    assert.equal(expiredRun.stale, true);
    await writePresence(workspace, { runId: started.run.id, leaseId: started.run.leaseId, taskId: started.run.currentTaskId, heartbeatAt: new Date().toISOString() });
    const renewed = await (await fetch(`${instance.url}/api/explorer/apps/app-a/head`)).json() as any;
    const renewedRun = renewed.activeRuns.find((run: any) => run.id === started.run.id);
    assert.equal(renewed.revision, revision);
    assert.equal(renewedRun.stale, false);
    assert.notEqual(renewedRun.heartbeatAt, expiredRun.heartbeatAt);
  } finally { await instance.stop(); }
}));

test('progress reader rejects a symlinked progress file', async (t) => withHost(async (root, parent) => {
  await register(root, 'app-a');
  const runId = '4ea5b416-4593-41df-9662-824c3a5ea04d';
  const runDirectory = join(root, '.video', 'web-capture', 'runs', runId);
  const outside = join(parent, 'outside-progress.json');
  await mkdir(runDirectory, { recursive: true });
  await writeFile(outside, JSON.stringify({ runId, appId: 'app-a', contextId: 'ctx-main', stepId: 'private', state: 'running', timestamp: '2026-10-17T00:00:00.000Z' }), 'utf8');
  try { await symlink(outside, join(runDirectory, 'progress.json'), 'file'); }
  catch (error) {
    if (['EPERM', 'ENOTSUP'].includes((error as { code?: string }).code ?? '')) { t.skip('Windows file symlinks require Developer Mode or symlink privilege.'); return; }
    throw error;
  }
  const instance = await startBacklotServer({ root, port: 0 });
  try {
    const result = await (await fetch(`${instance.url}/api/explorer/apps/app-a/activity`)).json() as any;
    assert.deepEqual(result.captureProgress, []);
  } finally { await instance.stop(); }
}));

test('progress reader ignores a Windows directory junction in the UUID run folder chain', async () => withHost(async (root, parent) => {
  await register(root, 'app-a');
  const runId = '4ea5b416-4593-41df-9662-824c3a5ea04e';
  const runsRoot = join(root, '.video', 'web-capture', 'runs');
  const outsideRun = join(parent, 'outside-run');
  await mkdir(runsRoot, { recursive: true });
  await mkdir(outsideRun, { recursive: true });
  await writeFile(join(outsideRun, 'progress.json'), JSON.stringify({ runId, appId: 'app-a', contextId: 'ctx-main', stepId: 'private', state: 'running', timestamp: '2026-10-17T00:00:00.000Z' }), 'utf8');
  await symlink(outsideRun, join(runsRoot, runId), 'junction');
  const instance = await startBacklotServer({ root, port: 0 });
  try {
    const result = await (await fetch(`${instance.url}/api/explorer/apps/app-a/activity`)).json() as any;
    assert.deepEqual(result.captureProgress, []);
  } finally { await instance.stop(); }
}));

test('confined evidence read rejects a directory swap between validation and open', async (t) => withHost(async (_root, parent) => {
  const evidenceRoot = join(parent, 'evidence');
  const runDirectory = join(evidenceRoot, 'run-1');
  const movedDirectory = join(parent, 'moved-run');
  const outsideDirectory = join(parent, 'outside-run');
  await mkdir(runDirectory, { recursive: true });
  await mkdir(outsideDirectory, { recursive: true });
  await writeFile(join(runDirectory, 'proof.txt'), 'approved', 'utf8');
  await writeFile(join(outsideDirectory, 'proof.txt'), 'private', 'utf8');
  let linkError: { code?: string } | undefined;
  await assert.rejects(() => readConfinedFile(evidenceRoot, 'run-1/proof.txt', { beforeOpen: async () => {
    await rename(runDirectory, movedDirectory);
    try { await symlink(outsideDirectory, runDirectory, 'junction'); }
    catch (error) { linkError = error as { code?: string }; }
  } }));
  if (linkError && ['EPERM', 'ENOTSUP'].includes(linkError.code ?? '')) t.skip('Directory junction creation is unavailable on this runner.');
}));

test('diagnostics pagination, evidence traversal and symlink access are constrained', async () => withHost(async (root, parent) => {
  const workspace = await register(root, 'app-a');
  await mkdir(join(workspace, 'runtime'), { recursive: true });
  const rows = [1, 2].map((n) => ({ id: `diagnostic-${n}`, runId: 'run-1', timestamp: `2026-10-17T00:00:0${n}.000Z`, operation: 'workspace_read', phase: 'finish', status: 'succeeded', durationMs: n }));
  await writeFile(join(workspace, 'runtime', 'diagnostics.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  await writeFile(join(workspace, 'runtime', 'diagnostics.generation'), '4ea5b416-4593-41df-9662-824c3a5ea02b\n', 'utf8');
  await mkdir(join(workspace, 'evidence', 'run-1'), { recursive: true });
  await writeFile(join(workspace, 'evidence', 'run-1', 'proof.txt'), 'safe evidence', 'utf8');
  await writeFile(join(parent, 'private.txt'), 'private evidence', 'utf8');
  let symlinkCreated = true;
  try { await symlink(join(parent, 'private.txt'), join(workspace, 'evidence', 'run-1', 'private.txt'), 'file'); }
  catch (error) { if (['EPERM', 'ENOTSUP'].includes((error as { code?: string }).code ?? '')) symlinkCreated = false; else throw error; }
  await mkdir(join(parent, 'private-dir'), { recursive: true });
  await writeFile(join(parent, 'private-dir', 'hidden.txt'), 'private evidence', 'utf8');
  let directorySymlinkCreated = true;
  try { await symlink(join(parent, 'private-dir'), join(workspace, 'evidence', 'run-1', 'linked-dir'), 'junction'); }
  catch (error) { if (['EPERM', 'ENOTSUP'].includes((error as { code?: string }).code ?? '')) directorySymlinkCreated = false; else throw error; }
  const instance = await startBacklotServer({ root, port: 0 });
  try {
    const first = await (await fetch(`${instance.url}/api/explorer/apps/app-a/diagnostics?limit=1`)).json() as any;
    assert.equal(first.events.length, 1);
    assert.equal(first.hasMore, true);
    const second = await (await fetch(`${instance.url}/api/explorer/apps/app-a/diagnostics?after=${encodeURIComponent(first.cursor)}&limit=1`)).json() as any;
    assert.equal(second.events[0].id, 'diagnostic-2');
    assert.equal((await fetch(`${instance.url}/api/explorer/apps/app-a/evidence/run-1/proof.txt`)).status, 200);
    assert.equal(await (await fetch(`${instance.url}/api/explorer/apps/app-a/evidence/run-1/proof.txt`)).text(), 'safe evidence');
    assert.notEqual((await fetch(`${instance.url}/api/explorer/apps/app-a/evidence/%2e%2e/private.txt`)).status, 200);
    if (symlinkCreated) assert.notEqual((await fetch(`${instance.url}/api/explorer/apps/app-a/evidence/run-1/private.txt`)).status, 200);
    if (directorySymlinkCreated) assert.notEqual((await fetch(`${instance.url}/api/explorer/apps/app-a/evidence/run-1/linked-dir/hidden.txt`)).status, 200);
  } finally { await instance.stop(); }
}));

test('evidence reads accept Unicode, spaces, percent signs, and nested refs while staying inside the evidence root', async () => withHost(async (root) => {
  const workspace = await register(root, 'app-a');
  const relativeRef = 'run/nested/Café notes 50%.png';
  const absolutePath = join(workspace, 'evidence', ...relativeRef.split('/'));
  await mkdir(join(workspace, 'evidence', 'run', 'nested'), { recursive: true });
  await writeFile(absolutePath, 'synthetic image evidence', 'utf8');
  const instance = await startBacklotServer({ root, port: 0 });
  try {
    const encodedRef = relativeRef.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    const response = await fetch(`${instance.url}/api/explorer/apps/app-a/evidence/${encodedRef}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'synthetic image evidence');
    assert.notEqual((await fetch(`${instance.url}/api/explorer/apps/app-a/evidence/run/nested/%2e%2e/%2e%2e/private.txt`)).status, 200);
  } finally { await instance.stop(); }
}));

test('reader retries after malformed CURRENT, refreshes changed revisions, and missing workspaces return 404', async () => withHost(async (root) => {
  const workspace = await register(root, 'app-a');
  const instance = await startBacklotServer({ root, port: 0 });
  try {
    const firstResponse = await fetch(`${instance.url}/api/explorer/apps/app-a/head`);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as any;
    const catalog = JSON.parse(await readFile(join(workspace, 'catalog.json'), 'utf8'));
    catalog.app.name = 'New revision';
    await writeFile(join(workspace, 'catalog.json'), JSON.stringify(catalog), 'utf8');
    // An unreceipted edit must not poison the immutable cached projection.
    assert.equal((await (await fetch(`${instance.url}/api/explorer/apps/app-a/state`)).json() as any).app.name, 'TaskFlow Demo');
    const { runKnowledgeCli } = await import('../packages/app-explorer/index.mjs');
    const started = startRun(workspace, {}, null, { id: 'run.revision-change' });
    assert.notEqual(started.receipt.revision, first.revision);
    const afterMigration = await fetch(`${instance.url}/api/explorer/apps/app-a/head`);
    assert.equal(afterMigration.status, 200);
    const refreshed = await afterMigration.json() as any;
    assert.notEqual(refreshed.revision, first.revision);

    const currentPath = join(workspace, 'CURRENT.json');
    const validCurrent = await readFile(currentPath, 'utf8');
    await writeFile(currentPath, '{broken', 'utf8');
    assert.equal((await fetch(`${instance.url}/api/explorer/apps/app-a/head`)).status, 400);
    await writeFile(currentPath, validCurrent, 'utf8');
    const recovered = await (await fetch(`${instance.url}/api/explorer/apps/app-a/head`)).json() as any;
    assert.equal(recovered.revision, refreshed.revision);
    assert.equal((await fetch(`${instance.url}/api/explorer/apps/app-missing/head`)).status, 404);
    await rm(workspace, { recursive: true, force: true });
    assert.equal((await fetch(`${instance.url}/api/explorer/apps/app-a/head`)).status, 404);
  } finally { await instance.stop(); }
}));
