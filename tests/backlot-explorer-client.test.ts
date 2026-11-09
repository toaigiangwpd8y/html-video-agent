import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import { findBrowserExecutable } from '../src/web-capture/app-session.js';
import { startBacklotServer } from '../src/backlot/server.js';
import { loadWorkspace, runKnowledgeCli } from '../packages/app-explorer/index.mjs';
import { registerApp, resolveAppWorkspace } from '../src/app-explorer/registry.js';

const { chromium } = await import('playwright-core');
declare global { interface Window { panel?: { destroy(): void; selectApp(id: string): void }; responseGuard?: (current: any, response: any) => boolean } }
const publicDir = fileURLToPath(new URL('../packages/app-explorer/public/', import.meta.url));
const initialRoot = `<div id="explorerRoot" class="app-explorer-panel"></div><script type="module">
import { mountExplorerPanel, isCurrentExplorerResponse } from '/panel.js';
const root = document.querySelector('#explorerRoot');
root.innerHTML = await fetch('/panel.html').then(r => r.text());
window.responseGuard = isCurrentExplorerResponse;
window.panel = mountExplorerPanel(root, { apiBase: '/api/explorer/apps', appId: 'a' });
</script>`;

function syntheticPng(color: string) {
  const canvas = createCanvas(1, 1);
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return canvas.toBuffer('image/png');
}
const discoveryPng = syntheticPng('#336699');
const appBPng = syntheticPng('#cc2244');

function stateFor(id: string, name: string, discoveryOnly = false) {
  const steps = [
    { id: 'list', title: 'Project list', action: 'Open project list', observed: 'The list appears.', screenshot: 'discovery/list.png' },
    { id: 'detail', title: 'Project detail', action: 'Open a project', observed: 'The detail appears.', screenshot: 'discovery/detail.png' },
  ];
  const feature = { id: 'projects.list', title: `${name} projects`, area: 'Projects', summary: 'Browse recorded projects.', status: 'partial', entry: null, steps, nextActions: [], questions: [] };
  const executions = [
    { executionId: `${id}-run-1`, date: '2026-10-01', outcome: 'success', role: 'Admin', contextId: 'ctx-admin', steps: [{ id: 'proof', action: 'Observe outcome', observed: 'Saved', evidenceRefs: ['run/proof.png'] }], completionCriteria: [] },
    { executionId: `${id}-run-2`, date: '2026-10-02', outcome: 'failure', role: 'Viewer', contextId: 'ctx-viewer', steps: [{ id: 'proof-viewer', action: 'Inspect visible evidence', observed: 'Failure shown', evidenceRefs: ['run/proof.png'] }], completionCriteria: [] },
  ];
  return {
    app: { id, name, baseUrl: `https://${id}.example` }, schemaVersion: 2, revision: `${id}-r1`,
    summary: { total: 1, verified: 0, partial: 1, discovered: 0, blocked: 0, tasks: 0 },
    features: [feature], featureViews: [{ feature, discoverySteps: steps, scenarios: discoveryOnly ? [] : [{ id: `${id}-scenario`, role: 'Admin', contextId: 'ctx-admin', goal: 'List projects', executions }], selected: discoveryOnly ? null : { scenarioId: `${id}-scenario` }, openTasks: [], questions: [], coverage: { exclusions: [] }, coverageByContext: {}, verification: { verifiedScenarioIds: [], unknownScenarioIds: discoveryOnly ? [] : [`${id}-scenario`] } }],
    contexts: [{ id: 'ctx-admin', role: 'Admin' }, { id: 'ctx-viewer', role: 'Viewer' }], journeys: [], tasks: [], frontier: { tasks: [] }, scenarios: [],
    frontierSummary: { state: 'ready' }, frontierCounts: { ready: 0, waiting: 0, blocked: 0, done: 0 }, activeRuns: [], latestRun: null,
  };
}

async function fixture(t: any, { delayAppA = false, malformedAfterFirst = false, v1 = false, discoveryOnly = false, retryDiscoveryListOnce = false, retryDiscoveryListTwice = false, delayRetryEvidence = false, duplicateDiscoveryEvidence = false, changeDuringState = false, advanceDuringState = false, headDelayMs = 0, defaultPoll = false } = {}) {
  const counts: { head: Map<string, number>; state: Map<string, number>; activity: Map<string, number>; diagnostics: Map<string, number>; video: number } = { head: new Map(), state: new Map(), activity: new Map(), diagnostics: new Map(), video: 0 };
  const evidenceRequests: { appId: string; path: string; status: number }[] = [];
  const retryEvidenceUrls: string[] = [];
  let releaseA: () => void = () => {};
  let releaseRetryEvidence: () => void = () => {};
  let signalRetryEvidenceStarted: () => void = () => {};
  const retryEvidenceStarted = new Promise<void>(resolve => { signalRetryEvidenceStarted = resolve; });
  const delayedRetryEvidence = new Promise<void>(resolve => { releaseRetryEvidence = resolve; });
  const delayedA = new Promise<void>(resolve => { releaseA = resolve; });
  const currentRevisions = new Map<string, string | null>([['a', v1 ? null : 'a-r1'], ['b', 'b-r1']]);
  let discoveryPresent = true;
  let legacyMutation = false;
  let stateCapturedRevision: string | null | undefined;
  const flakyEvidenceCalls = new Map<string, number>();
  let activeHeadRequests = 0;
  let maxActiveHeadRequests = 0;
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const send = (value: unknown, status = 200, type = 'application/json') => { res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(value) : value); };
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (url.pathname === '/') return send(initialRoot, 200, 'text/html');
    const evidenceMatch = url.pathname.match(/^\/api\/explorer\/apps\/([^/]+)\/evidence\/(.+)$/);
    if (evidenceMatch) {
      const [, appId, path] = evidenceMatch;
      if (appId === 'a' && ['discovery/list.png', 'discovery/detail.png', 'discovery/export.png'].includes(path)) {
        if (path === 'discovery/list.png' && url.searchParams.has('retry')) {
          retryEvidenceUrls.push(`http://${req.headers.host}${req.url}`);
          signalRetryEvidenceStarted();
          if (delayRetryEvidence) await delayedRetryEvidence;
        }
        if ((retryDiscoveryListOnce || retryDiscoveryListTwice) && path === 'discovery/list.png') {
          const callCount = (flakyEvidenceCalls.get(path) || 0) + 1;
          flakyEvidenceCalls.set(path, callCount);
          const status = callCount <= (retryDiscoveryListTwice ? 2 : 1) ? 404 : 200;
          evidenceRequests.push({ appId, path, status });
          if (status === 404) return send({ error: 'synthetic first-attempt failure' }, 404);
        }
        if (!(retryDiscoveryListOnce || retryDiscoveryListTwice) || path !== 'discovery/list.png') evidenceRequests.push({ appId, path, status: 200 });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); return res.end(discoveryPng);
      }
      if (path === 'run/proof.png') {
        const body = appId === 'b' ? appBPng : discoveryPng;
        evidenceRequests.push({ appId, path, status: 200 });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); return res.end(body);
      }
      evidenceRequests.push({ appId, path, status: 404 });
      return send({ error: 'not found' }, 404);
    }
    if (['panel.js', 'live-utils.js', 'panel.html', 'style.css'].includes(url.pathname.slice(1))) { const route = url.pathname.slice(1); const type = route.endsWith('.js') ? 'text/javascript' : route.endsWith('.css') ? 'text/css' : 'text/html'; res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return createReadStream(join(publicDir, route)).pipe(res); }
    if (url.pathname === '/api/state') { counts.video++; return send({ title: 'video state stays separate' }); }
    const match = url.pathname.match(/^\/api\/explorer\/apps\/([^/]+)\/(head|state|activity|diagnostics)$/);
    if (!match) return send({ error: 'not found' }, 404);
    const id = match[1]!;
    const kind = match[2] as 'head' | 'state' | 'activity' | 'diagnostics';
    counts[kind].set(id, (counts[kind].get(id) || 0) + 1);
    if (kind === 'head') {
      activeHeadRequests++;
      maxActiveHeadRequests = Math.max(maxActiveHeadRequests, activeHeadRequests);
      if (headDelayMs) await new Promise(resolve => setTimeout(resolve, headDelayMs));
      activeHeadRequests--;
    }
    if (delayAppA && id === 'a' && kind === 'head' && (counts.head.get(id) || 0) === 1) await delayedA;
    const payload: any = v1 ? {
      app: { id, name: `${id.toUpperCase()} V1 workspace`, baseUrl: `https://${id}.example` }, schemaVersion: 1, revision: null,
      summary: { total: 1, verified: 0, partial: 1, discovered: 0, blocked: 0, tasks: 0 },
      features: [{ id: 'legacy.projects', title: `${id.toUpperCase()} legacy projects`, area: 'Projects', summary: 'V1 catalog entry.', status: 'partial', entry: null, steps: [], nextActions: [], questions: [] }],
      contexts: [], journeys: [], tasks: [], frontier: { tasks: [] },
    } : stateFor(id, id.toUpperCase(), discoveryOnly);
    if (duplicateDiscoveryEvidence && kind === 'state' && payload.featureViews?.[0]?.discoverySteps?.[0]) {
      payload.featureViews[0].discoverySteps.push({ ...payload.featureViews[0].discoverySteps[0], id: 'list-copy', title: 'Repeated evidence reference' });
    }
    if (kind === 'head') {
      if (malformedAfterFirst && (counts.head.get(id) || 0) === 3) return send({ revision: `${id}-r1`, features: null });
      if (v1) return send({ revision: null, schemaVersion: 1, syncedAt: new Date().toISOString(), summary: payload.summary, coverage: null, frontierSummary: { state: 'legacy_no_open_tasks' }, activeRuns: [], latestRun: null, frontierCounts: { ready: 0, waiting: 0, blocked: 0, done: 0, skipped: 0 }, displayRunId: null, currentTask: null, nextTask: null, activityCursor: null, diagnosticsCursor: null, diagnosticsGap: false });
      const alive = (counts.head.get(id) || 0) > 1;
      return send({ revision: currentRevisions.get(id), schemaVersion: 2, syncedAt: new Date().toISOString(), summary: payload.summary, coverage: {}, frontierSummary: { state: 'ready' }, activeRuns: alive ? [{ id: 'live-run', status: 'running', stale: false, currentTaskId: null }] : [], latestRun: null, frontierCounts: { ready: 0, waiting: 0, blocked: 0, done: 0 }, displayRunId: alive ? 'live-run' : null, currentTask: null, nextTask: null, activityCursor: null, diagnosticsCursor: null, diagnosticsGap: false });
    }
    if (kind === 'state') {
      const responseRevision = currentRevisions.get(id);
      if (changeDuringState && id === 'a' && (counts.state.get(id) || 0) === 1) {
        stateCapturedRevision = responseRevision;
        await new Promise(resolve => setTimeout(resolve, 80));
        currentRevisions.set('a', 'a-r2');
      }
      if (advanceDuringState && id === 'a' && (counts.state.get(id) || 0) === 1) {
        currentRevisions.set('a', 'a-r2');
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      payload.revision = changeDuringState && id === 'a' && stateCapturedRevision !== undefined && (counts.state.get(id) || 0) === 1 ? stateCapturedRevision : currentRevisions.get(id);
      if (v1 && legacyMutation) payload.features[0].title = 'A legacy projects committed';
      if (!v1 && currentRevisions.get(id) !== `${id}-r1`) {
        payload.features[0].title += ' updated';
        const committedEvidence = { id: 'export-proof', title: 'Export committed', action: 'Record export result', observed: 'The committed export is visible.', screenshot: 'discovery/export.png' };
        payload.features[0].steps.push(committedEvidence);
        payload.featureViews[0].discoverySteps.push(committedEvidence);
        payload.features.push({ id: 'reports.export', title: 'Export projects report', area: 'Reports', summary: 'Added by synthetic commit.', status: 'discovered', entry: null, steps: [], nextActions: [], questions: [] });
        payload.summary.total = 2; payload.summary.discovered = 1; payload.summary.partial = 1;
      }
      if (id === 'a' && !discoveryPresent && payload.featureViews?.[0]) { payload.features[0].steps = []; payload.featureViews[0].discoverySteps = []; }
      return send(payload);
    }
    if (kind === 'activity') return send({ events: [], cursor: null, resync: false, revision: payload.revision, captureProgress: [{ runId: `${id}-capture`, stepId: 'step-1', state: 'running', timestamp: '2026-10-17T00:00:00Z', appId: id }] });
    return send({ events: [], cursor: null, hasMore: false, resync: false, gap: false });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const browserPath = findBrowserExecutable(process.cwd(), { url: 'http://127.0.0.1' } as any);
  assert.ok(browserPath, 'A local browser executable is required for deterministic UI tests');
  const browser = await chromium.launch({ headless: true, executablePath: browserPath, timeout: 10000 });
  t.after(async () => { releaseA(); releaseRetryEvidence(); await browser.close(); (server as any).closeAllConnections?.(); await new Promise<void>(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);

  return { page, url: `http://127.0.0.1:${addr.port}/${defaultPoll ? '' : '?pollMs=1000'}`, counts, evidenceRequests, retryEvidenceUrls, retryEvidenceStarted, releaseRetryEvidence, releaseA, maxActiveHeadRequests: () => maxActiveHeadRequests, setRevision(revision: string) { currentRevisions.set('a', revision); }, setDiscoveryPresent(value: boolean) { discoveryPresent = value; }, commitLegacyMutation() { legacyMutation = true; } };
}

test('Explorer requests stay separate from video state and selects scenario/execution', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t);
  f.page.setDefaultTimeout(8000); await f.page.goto(f.url, { timeout: 8000 });
  await f.page.waitForFunction(() => window.panel && document.querySelector('#appIdentity')?.textContent.includes('A'));
  assert.equal(await f.page.evaluate(() => window.responseGuard!({ appId: 'a', generation: 1 }, { appId: 'a', generation: 1 })), true);
  assert.equal(await f.page.evaluate(() => window.responseGuard!({ appId: 'a', generation: 1 }, { appId: 'b', generation: 1 })), false);
  assert.equal(await f.page.evaluate(() => window.responseGuard!({ appId: 'a', generation: 1 }, { appId: 'a', generation: 2 })), false);
  assert.equal(f.counts.video, 0);
  assert.equal(f.counts.state.get('a'), 1);
  await f.page.locator('[data-feature="projects.list"]').click();
  assert.equal(await f.page.locator('[data-discovery-step]').count(), 2);
  assert.match(await f.page.locator('#featureDetail').textContent(), /Quan sát khi khám phá[\s\S]*Kịch bản và lần thực hiện/);
  await f.page.locator('[data-scenario-select]').selectOption('a-scenario');
  assert.equal(await f.page.locator('[data-scenario-select]').inputValue(), 'a-scenario');
  assert.equal(await f.page.locator('[data-discovery-step]').count(), 2);
  assert.match(await f.page.locator('#featureDetail').textContent(), /Mục tiêu: List projects/);
  await f.page.locator('[data-execution-select]').selectOption('a-run-2');
  assert.equal(await f.page.locator('.selected-outcome .status').textContent(), 'Chưa đạt');
  assert.ok(await f.page.locator('.selected-outcome .status').evaluate((el: Element) => el.classList.contains('blocked')), 'The localized outcome retains the underlying failure classification');
  assert.match(await f.page.locator('.selected-outcome').textContent(), /Viewer/);
  assert.match(await f.page.locator('#captureProgress').textContent(), /Tiến độ ghi nhận/i);
  await f.page.locator('[data-image]').first().click();
  assert.equal(await f.page.locator('#lightbox').isVisible(), true);
  await f.page.keyboard.press('Escape');
  const search = f.page.locator('#featureSearch');
  await search.fill('projects');
  await search.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 2));
  await f.page.evaluate(() => window.scrollTo(0, 500));
  const scrollBeforePoll = await f.page.evaluate(() => window.scrollY);
  await f.page.waitForTimeout(1100);
  assert.equal(await search.evaluate((el: HTMLInputElement) => el.selectionStart), 2);
  assert.equal(await f.page.evaluate(() => window.scrollY), scrollBeforePoll);
  await f.page.locator('[data-close-detail]').click();
  await f.page.evaluate(() => window.panel!.destroy());
  await f.page.locator('[data-feature="projects.list"]').click();
  assert.equal(await f.page.locator('#featureDetail').count(), 0);
});

test('V2 discovery images render without scenarios and remain separate from verification', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t, { discoveryOnly: true });
  const evidenceStatuses: number[] = [];
  f.page.on('response', (response: any) => { if (response.url().includes('/evidence/discovery/')) evidenceStatuses.push(response.status()); });
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('#appIdentity')?.textContent.includes('A'));
  await f.page.locator('[data-feature="projects.list"]').click();
  assert.equal(await f.page.locator('[data-discovery-step]').count(), 2);
  const images = f.page.locator('[data-discovery-step] img');
  assert.equal(await images.count(), 2);
  for (const image of await images.all()) {
    await image.evaluate((img: HTMLImageElement) => img.decode());
    assert.equal(await image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), true);
  }
  assert.match(await f.page.locator('#featureDetail').textContent(), /Chưa ghi nhận kịch bản/);
  assert.match(await f.page.locator('#featureDetail').textContent(), /Chưa có kịch bản được xác minh/);
  assert.deepEqual(evidenceStatuses, [200, 200]);
  await f.page.evaluate(() => window.panel!.destroy());
});

test('synthetic CLI apply evidence is read by Backlot and decoded in the Explorer browser panel', { timeout: 45000 }, async (t: any) => {
  const parent = await mkdtemp(join(tmpdir(), 'explorer-recording-contract-'));
  const root = join(parent, 'host');
  await mkdir(root);
  await cp(resolve('dist/src/backlot/web'), join(root, 'dist/src/backlot/web'), { recursive: true });
  await registerApp(root, { id: 'synthetic-app', name: 'Synthetic App', url: 'https://synthetic.invalid' });
  const workspace = await resolveAppWorkspace(root, 'synthetic-app');
  await runKnowledgeCli(['init', '--data', workspace, '--name', 'Synthetic App', '--url', 'https://synthetic.invalid'], { cwd: root });
  const initial = loadWorkspace(workspace);
  const ref = 'run.synthetic/screen.png';
  const runDirectory = join(workspace, 'evidence', 'run.synthetic');
  await mkdir(runDirectory, { recursive: true });
  await writeFile(join(runDirectory, 'screen.png'), discoveryPng);
  const observationPath = join(parent, 'observation.json');
  await writeFile(observationPath, JSON.stringify({
    version: 2,
    baseRevision: initial.revision,
    features: [{ id: 'items.view', title: 'View item', area: 'Items', summary: 'Synthetic observed item view.', status: 'discovered', entry: { url: '/items' }, steps: [{ id: 'observe', title: 'Synthetic item result', action: 'Open the synthetic item', observed: 'The item is visible in the local fixture.', screenshot: ref }], questions: [], nextActions: [] }],
  }), 'utf8');
  const cliOutput: string[] = [];
  const applyStatus = await runKnowledgeCli(['apply', observationPath, '--data', workspace], { cwd: root, stdout: value => cliOutput.push(String(value)), stderr: value => cliOutput.push(String(value)) });
  assert.equal(applyStatus, 0, cliOutput.join('\n'));
  assert.ok(cliOutput.join('\n').includes('receipt'), 'the local CLI apply returns a revision receipt');

  const instance = await startBacklotServer({ root, port: 0 });
  const browserPath = findBrowserExecutable(process.cwd(), { url: 'http://127.0.0.1' } as any);
  assert.ok(browserPath, 'A local browser executable is required for deterministic UI tests');
  const browser = await chromium.launch({ headless: true, executablePath: browserPath, timeout: 10000 });
  t.after(async () => { await browser.close(); await instance.stop(); await rm(parent, { recursive: true, force: true }); });
  const stateResponse = await fetch(`${instance.url}/api/explorer/apps/synthetic-app/state`);
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json() as any;
  assert.equal(state.features[0].id, 'items.view');
  assert.deepEqual(state.featureViews[0].discoverySteps.map((step: any) => step.screenshot), [ref]);
  assert.deepEqual(state.featureViews[0].scenarios, [], 'a screenshot-only discovery observation does not claim scenario verification');
  const evidenceResponse = await fetch(`${instance.url}/api/explorer/apps/synthetic-app/evidence/${ref}`);
  assert.equal(evidenceResponse.status, 200);
  assert.match(evidenceResponse.headers.get('content-type') || '', /image\/png/);
  assert.deepEqual(Buffer.from(await evidenceResponse.arrayBuffer()), discoveryPng);

  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const evidenceStatuses: number[] = [];
  page.on('response', (response: any) => { if (response.url().includes('/evidence/run.synthetic/screen.png')) evidenceStatuses.push(response.status()); });
  await page.goto(`${instance.url}/explorer.html`);
  await page.waitForFunction(() => document.querySelector('[data-feature="items.view"]') !== null, { timeout: 8000 }).catch(async () => { throw new Error(await page.locator('body').innerText()); });
  await page.locator('[data-feature="items.view"]').click();
  const image = page.locator('[data-discovery-step] img');
  assert.equal(await image.count(), 1);
  await image.evaluate((img: HTMLImageElement) => img.decode());
  assert.equal(await image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 1), true);
  assert.deepEqual(evidenceStatuses, [200]);
});

test('evidence image URLs follow the selected app when two apps share a relative ref', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t);
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('#appIdentity')?.textContent.includes('A'));
  await f.page.locator('[data-feature="projects.list"]').click();
  await f.page.locator('[data-execution-select]').selectOption('a-run-1');
  await f.page.locator('.scenario-screenshot[data-image][data-execution-id="a-run-1"]').click();
  const first = f.page.locator('#lightboxImg');
  await first.evaluate((img: HTMLImageElement) => img.decode());
  await f.page.evaluate(() => window.panel!.selectApp('b'));
  await f.page.waitForFunction(() => document.querySelector('#appIdentity')?.textContent.includes('B'));
  await f.page.locator('[data-feature="projects.list"]').click();
  await f.page.locator('[data-execution-select]').selectOption('b-run-1');
  await f.page.locator('.scenario-screenshot[data-image][data-execution-id="b-run-1"]').click();
  const second = f.page.locator('#lightboxImg');
  await second.evaluate((img: HTMLImageElement) => img.decode());
  assert.match(await second.getAttribute('src'), /\/apps\/b\/evidence\/run\/proof\.png$/);
  assert.equal(await second.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 1), true);
  assert.deepEqual(await second.evaluate((img: HTMLImageElement) => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d')!; context.drawImage(img, 0, 0); return [...context.getImageData(0, 0, 1, 1).data]; }), [204, 34, 68, 255]);
  assert.deepEqual(f.evidenceRequests.filter((request) => request.path === 'run/proof.png').map((request) => [request.appId, request.path, request.status]), [['a', 'run/proof.png', 200], ['b', 'run/proof.png', 200]]);
  await f.page.evaluate(() => window.panel!.destroy());
});

test('discovery lightbox preserves its identity across revision reloads and closes when its evidence is removed', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t, { discoveryOnly: true });
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('#appIdentity')?.textContent.includes('A'));
  await f.page.locator('[data-feature="projects.list"]').click();
  await f.page.locator('[data-discovery-step] button[data-image]').first().click();
  assert.equal(await f.page.locator('#lightbox').isVisible(), true);
  f.setRevision('a-r2');
  await f.page.waitForFunction(() => document.querySelector('[data-feature="projects.list"]')?.textContent.includes('updated'));
  assert.equal(await f.page.locator('#lightbox').isVisible(), true);
  f.setDiscoveryPresent(false);
  f.setRevision('a-r3');
  await f.page.waitForFunction(() => document.querySelector('[data-discovery-step]') === null);
  assert.equal(await f.page.locator('#lightbox').isVisible(), false);
  await f.page.evaluate(() => window.panel!.destroy());
});

test('failed evidence images show a keyboard-operable retry without marking the image loaded', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t, { discoveryOnly: true, retryDiscoveryListOnce: true });
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('#appIdentity')?.textContent.includes('A'));
  await f.page.locator('[data-feature="projects.list"]').click();
  const image = f.page.locator('[data-discovery-step] img').first();
  await f.page.waitForFunction(() => document.querySelector('[data-discovery-step] img')?.getAttribute('data-load-state') === 'error');
  const retry = f.page.getByRole('button', { name: /thử tải lại ảnh/i }).first();
  await retry.waitFor();
  assert.match(await retry.getAttribute('aria-label') || await retry.textContent() || '', /ảnh/i);
  assert.equal(await f.page.locator('[data-discovery-step] .evidence-image-status').first().getAttribute('data-state'), 'error');
  assert.match(await f.page.locator('[data-discovery-step] .evidence-image-status').first().textContent() || '', /Không tải được ảnh/);
  assert.equal(await image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), false);
  await retry.focus();
  await f.page.keyboard.press('Enter');
  await f.page.waitForFunction(() => document.querySelector('[data-discovery-step] .evidence-image-status')?.getAttribute('data-state') === 'loaded');
  assert.equal(await image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 1), true);
  assert.deepEqual(f.evidenceRequests.filter((request) => request.path === 'discovery/list.png').map((request) => [request.appId, request.path, request.status]), [['a', 'discovery/list.png', 404], ['a', 'discovery/list.png', 200]]);
  assert.equal(await f.page.locator('#featureDetail').count(), 1);
  await f.page.evaluate(() => window.panel!.destroy());
});

test('an in-flight evidence retry survives a poll render with its URL and keyboard focus', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t, { discoveryOnly: true, retryDiscoveryListOnce: true, delayRetryEvidence: true });
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('#appIdentity')?.textContent.includes('A'));
  await f.page.locator('[data-feature="projects.list"]').click();
  await f.page.waitForFunction(() => document.querySelector('[data-discovery-step] img')?.getAttribute('data-load-state') === 'error');
  const retry = f.page.getByRole('button', { name: /thử tải lại ảnh/i }).first();
  const retryHandle = await retry.elementHandle();
  assert.ok(retryHandle);
  await retry.focus();
  await f.page.keyboard.press('Enter');
  await f.retryEvidenceStarted;
  const requestedRetryUrl = f.retryEvidenceUrls[0];
  assert.ok(requestedRetryUrl.includes('?retry='), 'retry adds a cache-busting query');
  const pollDeadline = Date.now() + 5000;
  while ((f.counts.head.get('a') || 0) < 2 && Date.now() < pollDeadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok((f.counts.head.get('a') || 0) >= 2, 'a foreground poll ran while the retry request was still pending');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await f.page.locator('[data-discovery-step] img').first().evaluate((image: HTMLImageElement) => image.src), requestedRetryUrl);
  assert.equal(await f.page.locator('[data-discovery-step] .evidence-image-status').first().getAttribute('data-state'), 'loading');
  assert.equal(await retryHandle!.evaluate((button: HTMLButtonElement) => button.isConnected && document.activeElement === button), true, 'the same retry button node remains connected and focused after the poll render');
  f.releaseRetryEvidence();
  await f.page.waitForFunction(() => document.querySelector('[data-discovery-step] .evidence-image-status')?.getAttribute('data-state') === 'loaded');
  await f.page.evaluate(() => window.panel!.destroy());
});

test('a lightbox retry keeps its URL, loading status, and keyboard focus across revision refresh', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t, { discoveryOnly: true, retryDiscoveryListTwice: true, delayRetryEvidence: true });
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('#appIdentity')?.textContent.includes('A'));
  await f.page.locator('[data-feature="projects.list"]').click();
  await f.page.waitForFunction(() => document.querySelector('[data-discovery-step="list"] .evidence-image-status')?.getAttribute('data-state') === 'error');
  assert.equal(await f.page.locator('#lightbox').isHidden(), true);
  const thumbnailOpener = f.page.locator('[data-discovery-step="list"] button[data-image]');
  await thumbnailOpener.click();
  await f.page.waitForFunction(() => document.querySelector('#lightboxImageStatus')?.getAttribute('data-state') === 'error');
  const lightboxRetry = f.page.locator('#retryLightboxImage');
  const lightboxRetryHandle = await lightboxRetry.elementHandle();
  assert.ok(lightboxRetryHandle);
  await f.page.keyboard.press('Tab');
  assert.equal(await lightboxRetry.evaluate((button: HTMLButtonElement) => document.activeElement === button), true, 'the failed lightbox retry is reachable by keyboard');
  await f.page.keyboard.press('Enter');
  await f.retryEvidenceStarted;
  const requestedRetryUrl = f.retryEvidenceUrls[0];
  assert.ok(requestedRetryUrl.includes('?retry='), 'the lightbox retry request carries its cache-busting query');

  f.setRevision('a-r2');
  await f.page.waitForFunction(() => document.querySelector('[data-feature="projects.list"]')?.textContent.includes('updated'));
  assert.equal(await f.page.locator('#lightboxImg').evaluate((image: HTMLImageElement) => image.src), requestedRetryUrl, 'revision refresh keeps the in-flight retry URL');
  assert.equal(await f.page.locator('#lightboxImageStatus').getAttribute('data-state'), 'loading');
  assert.equal(await lightboxRetryHandle!.evaluate((button: HTMLButtonElement) => button.isConnected && document.activeElement === button), true, 'the same retry control remains focused after refresh');

  f.releaseRetryEvidence();
  await f.page.waitForFunction(() => document.querySelector('#lightboxImageStatus')?.getAttribute('data-state') === 'loaded');
  await f.page.locator('#lightboxImg').evaluate((image: HTMLImageElement) => image.decode());
  assert.equal(await f.page.locator('#lightboxImg').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 1), true);
  await f.page.evaluate(() => window.panel!.destroy());
});

test('repeated references get distinct retry controls tied to their own image', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t, { discoveryOnly: true, duplicateDiscoveryEvidence: true });
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('#appIdentity')?.textContent.includes('A'));
  await f.page.locator('[data-feature="projects.list"]').click();
  const repeatedImages = f.page.locator('[data-discovery-step] img[data-evidence-ref="discovery/list.png"]');
  await repeatedImages.first().waitFor();
  assert.equal(await repeatedImages.count(), 2);
  const ids = await repeatedImages.evaluateAll((images: HTMLImageElement[]) => images.map(image => image.dataset.evidenceId));
  assert.equal(new Set(ids).size, 2, 'the repeated references have distinct, stable image identities');
  for (const id of ids) assert.equal(await f.page.locator(`[data-evidence-retry="${id}"]`).count(), 1);
  await f.page.evaluate(() => window.panel!.destroy());
});

test('V1 panel accepts stable null-revision head and renders the catalog', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t, { v1: true });
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('#appIdentity')?.textContent.includes('V1 workspace'));
  await f.page.waitForFunction(() => document.querySelector('[data-feature="legacy.projects"]'));
  assert.match(await f.page.locator('#appIdentity').textContent(), /V1 workspace/);
  assert.match(await f.page.locator('[data-feature="legacy.projects"]').textContent(), /legacy projects/);
  assert.doesNotMatch(await f.page.locator('#liveStatus').textContent(), /Invalid Explorer head response/);
  assert.equal(f.counts.state.get('a'), 1);
  assert.ok((f.counts.head.get('a') || 0) >= 1);
  await f.page.evaluate(() => window.panel!.destroy());
});

test('late app A head cannot replace selected app B', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t, { delayAppA: true });
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel);
  await f.page.evaluate(() => { const wrap = document.querySelector('.app-switcher-wrap') as HTMLElement; wrap.hidden = false; const select = document.querySelector('#appSwitcher')!; select.innerHTML = '<option value="a">A</option><option value="b">B</option>'; });
  await f.page.locator('#appSwitcher').selectOption('b');
  await f.page.waitForFunction(() => document.querySelector('#appIdentity')?.textContent.includes('B'));
  f.releaseA();
  await f.page.waitForTimeout(100);
  assert.match(await f.page.locator('#appIdentity').textContent(), /B/);
  assert.ok((f.counts.state.get('b') || 0) >= 1);
  await f.page.evaluate(() => window.panel!.destroy());
});

test('unchanged revision refreshes liveness, retains last good state on malformed head, and teardown stops polling', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t, { malformedAfterFirst: true });
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('#appIdentity')?.textContent.includes('A'));
  await f.page.waitForFunction(() => document.querySelector('.run-state.is-running'));
  await f.page.waitForFunction(() => document.querySelector('#liveStatus')?.textContent.includes('Invalid Explorer head response'));
  assert.match(await f.page.locator('#appIdentity').textContent(), /A/);
  assert.match(await f.page.locator('[data-feature="projects.list"]').textContent(), /A projects/);
  assert.equal(f.counts.state.get('a'), 1);
  await f.page.waitForFunction(() => !document.querySelector('#liveStatus')?.textContent.includes('Invalid Explorer head response'));
  assert.ok((f.counts.head.get('a') || 0) >= 3);
  const countBeforeDestroy = f.counts.head.get('a') || 0;
  await f.page.evaluate(() => window.panel!.destroy());
  await f.page.waitForTimeout(1200);
  assert.equal(f.counts.head.get('a') || 0, countBeforeDestroy);
  await f.page.locator('[data-feature="projects.list"]').click();
  assert.equal(await f.page.locator('#featureDetail').count(), 0);
});

test('Explorer recovers after a temporary browser connection loss and renders the next committed evidence', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t);
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('#appIdentity')?.textContent.includes('A'));
  await f.page.locator('[data-feature="projects.list"]').click();

  let abortedHeadRequests = 0;
  await f.page.route('**/api/explorer/apps/a/head', async (route: any) => {
    if (abortedHeadRequests === 0) {
      abortedHeadRequests++;
      await route.abort();
      return;
    }
    await route.continue();
  });
  f.setRevision('a-r2');

  await f.page.waitForFunction(() => document.querySelector('#liveStatus')?.textContent.includes('lỗi cập nhật'));
  await f.page.locator('[data-feature="reports.export"]').waitFor();
  await f.page.waitForFunction(() => document.querySelector('[data-feature="projects.list"]')?.textContent.includes('updated'));
  const image = f.page.locator('[data-discovery-step="export-proof"] img[data-evidence-ref="discovery/export.png"]').first();
  await image.scrollIntoViewIfNeeded();
  await image.waitFor();
  await f.page.waitForFunction(() => {
    const img = document.querySelector('[data-discovery-step="export-proof"] img[data-evidence-ref="discovery/export.png"]');
    return img instanceof HTMLImageElement && img.complete;
  });
  assert.equal(abortedHeadRequests, 1, 'the first foreground refresh experienced a network-level failure');
  assert.equal(await image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), true);
  await image.evaluate((img: HTMLImageElement) => img.decode());
  assert.ok(f.evidenceRequests.some(request => request.appId === 'a' && request.path === 'discovery/export.png' && request.status === 200));
  await f.page.evaluate(() => window.panel!.destroy());
});

test('revision reload retains search caret, scroll, lightbox, scenario, and execution selection', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t);
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('#appIdentity')?.textContent.includes('A'));
  await f.page.locator('[data-feature="projects.list"]').click();
  await f.page.locator('[data-scenario-select]').selectOption('a-scenario');
  await f.page.locator('[data-execution-select]').selectOption('a-run-2');
  const search = f.page.locator('#featureSearch');
  await search.fill('projects');
  await search.evaluate((el: HTMLInputElement) => { el.focus(); el.setSelectionRange(2, 2); });
  await f.page.evaluate(() => window.scrollTo(0, 500));
  await f.page.locator('[data-image]').first().click();
  assert.equal(await f.page.locator('#lightbox').isVisible(), true);
  await f.page.evaluate(() => { window.scrollTo(0, 400); return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  const scrollBeforeRevision = await f.page.evaluate(() => window.scrollY);
  const maxScrollBeforeRevision = await f.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  assert.ok(scrollBeforeRevision < maxScrollBeforeRevision - 1, 'scroll retention check is away from the maximum scroll boundary');
  const commitAt = Date.now();
  f.setRevision('a-r2');
  await f.page.waitForFunction(() => document.querySelector('[data-feature="projects.list"]')?.textContent.includes('updated'));
  await f.page.locator('[data-feature="reports.export"]').waitFor();
  const committedEvidence = f.page.locator('[data-discovery-step="export-proof"] img[data-evidence-ref="discovery/export.png"]').first();
  await committedEvidence.waitFor();
  await committedEvidence.evaluate((image: HTMLImageElement) => image.decode());
  assert.ok(f.evidenceRequests.some(request => request.appId === 'a' && request.path === 'discovery/export.png' && request.status === 200));
  const commitLatencyMs = Date.now() - commitAt;
  assert.ok(commitLatencyMs < 3000, 'a committed feature becomes visible within three seconds');
  t.diagnostic(`synthetic V2 commit-to-feature-and-evidence latency: ${commitLatencyMs}ms`);
  assert.equal(await search.evaluate((el: HTMLInputElement) => el.selectionStart), 2);
  assert.equal(await f.page.evaluate(() => window.scrollY), scrollBeforeRevision);
  assert.equal(await f.page.locator('#lightbox').isVisible(), true);
  assert.equal(await f.page.locator('[data-scenario-select]').inputValue(), 'a-scenario');
  assert.equal(await f.page.locator('[data-execution-select]').inputValue(), 'a-run-2');
  assert.equal(await f.page.locator('.selected-outcome .status').textContent(), 'Chưa đạt');
  assert.ok(await f.page.locator('.selected-outcome .status').evaluate((el: Element) => el.classList.contains('blocked')), 'The localized outcome retains the underlying failure classification');
  await f.page.evaluate(() => window.panel!.destroy());
});

test('V1 null-revision feature commits appear on the next poll without inventing a revision', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t, { v1: true });
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('#appIdentity')?.textContent.includes('A'));
  await f.page.locator('[data-feature="legacy.projects"]').click();
  const stateReads = f.counts.state.get('a') || 0;
  const commitAt = Date.now();
  f.commitLegacyMutation();
  await f.page.locator('#featureDetail h2').filter({ hasText: 'A legacy projects committed' }).waitFor();
  assert.ok(Date.now() - commitAt < 3000, 'a V1 change becomes visible within three seconds');
  assert.ok((f.counts.state.get('a') || 0) > stateReads);
  assert.equal(await f.page.locator('#liveStatus').textContent().then(text => text?.includes('chưa có bản ghi') || false), true);
  await f.page.evaluate(() => window.panel!.destroy());
});

test('a V2 head change during a state request is reconciled before rendering', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t, { changeDuringState: true });
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('[data-feature="projects.list"]')?.textContent.includes('updated'));
  assert.equal(f.counts.state.get('a'), 2);
  await f.page.evaluate(() => window.panel!.destroy());
});

test('a V2 state newer than the requested head is accepted only after head confirmation', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t, { advanceDuringState: true });
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('[data-feature="projects.list"]')?.textContent.includes('updated'));
  assert.equal(f.counts.state.get('a'), 1);
  assert.equal(f.counts.head.get('a'), 2);
  await f.page.evaluate(() => window.panel!.destroy());
});

test('default foreground polling is one second, single-flight, and reuses unchanged V2 state', { timeout: 45000 }, async (t: any) => {
  const f = await fixture(t, { headDelayMs: 1100, defaultPoll: true });
  await f.page.goto(f.url);
  await f.page.waitForFunction(() => window.panel && document.querySelector('#appIdentity')?.textContent.includes('A'));
  const initialHeadCount = f.counts.head.get('a') || 0;
  const deadline = Date.now() + 3000;
  while ((f.counts.head.get('a') || 0) <= initialHeadCount && Date.now() < deadline) await f.page.waitForTimeout(50);
  assert.ok((f.counts.head.get('a') || 0) > initialHeadCount, 'the one-second default schedules another foreground poll within three seconds');
  assert.equal(f.counts.state.get('a'), 1);
  assert.equal(f.maxActiveHeadRequests(), 1);
  await f.page.evaluate(() => window.panel!.destroy());
});




test('Backlot serves the shared Explorer page and only exposes a validated loopback operator URL', { timeout: 30000 }, async () => {
  const parent = await mkdtemp(join(tmpdir(), 'backlot-explorer-static-'));
  const root = join(parent, 'host');
  const webSource = fileURLToPath(new URL('../src/backlot/web/', import.meta.url));
  const webOutput = resolve(root, 'dist/src/backlot/web');
  const oldDashboard = process.env.APP_EXPLORER_AGENT_BROWSER_DASHBOARD_URL;
  await mkdir(webOutput, { recursive: true });
  await cp(webSource, webOutput, { recursive: true });
  const instance = await startBacklotServer({ root, port: 0 });
  try {
    const page = await fetch(`${instance.url}/explorer.html`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /explorer.js/);
    const asset = await fetch(`${instance.url}/explorer-assets/panel.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') || '', /javascript/);
    process.env.APP_EXPLORER_AGENT_BROWSER_DASHBOARD_URL = `http://127.0.0.1:39173`;
    const allowed = await (await fetch(`${instance.url}/api/explorer/dashboard`)).json() as any;
    assert.equal(allowed.dashboardUrl, 'http://127.0.0.1:39173/');
    process.env.APP_EXPLORER_AGENT_BROWSER_DASHBOARD_URL = 'http://127.0.0.1:39173/json/version';
    const rejected = await (await fetch(`${instance.url}/api/explorer/dashboard`)).json() as any;
    assert.equal(rejected.dashboardUrl, null);
  } finally {
    if (oldDashboard === undefined) delete process.env.APP_EXPLORER_AGENT_BROWSER_DASHBOARD_URL;
    else process.env.APP_EXPLORER_AGENT_BROWSER_DASHBOARD_URL = oldDashboard;
    await instance.stop();
    await rm(parent, { recursive: true, force: true });
  }
});
