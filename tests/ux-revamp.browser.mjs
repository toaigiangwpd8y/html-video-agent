// Desktop walkthrough for Backlot and read-only App Explorer.
// Backlot state and HITL writes are synthetic/intercepted; Explorer reads an isolated demo fixture.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { startBacklotServer } from '../dist/src/backlot/server.js';

const repo = process.cwd();
const mode = process.argv.find(arg => arg.startsWith('--mode='))?.split('=')[1] || 'after';
const out = resolve(repo, 'output/ux-revamp/' + mode);
const fixture = await mkdtemp(resolve(tmpdir(), 'backlot-ux-revamp-'));
const web = resolve(fixture, 'dist/src/backlot/web');
const explorerWorkspace = resolve(fixture, 'workspaces/demo-app');
await mkdir(out, { recursive: true });
await mkdir(web, { recursive: true });
await mkdir(explorerWorkspace, { recursive: true });
await cp(resolve(repo, 'dist/src/backlot/web'), web, { recursive: true });
await cp(resolve(repo, 'packages/app-explorer/examples/demo-knowledge'), explorerWorkspace, { recursive: true });
await mkdir(resolve(fixture, '.app-explorer'), { recursive: true });
await writeFile(resolve(fixture, '.app-explorer/registry.json'), JSON.stringify({
  version: 1,
  apps: [{ id: 'demo-app', name: 'TaskFlow Demo', url: 'https://example.test', workspaceRelativePath: 'workspaces/demo-app' }],
}, null, 2));
const browserPath = [process.env.CHROME_PATH, process.env.CHROMIUM_PATH,
  ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap(p => [resolve(p, 'Google/Chrome/Application/chrome.exe'), resolve(p, 'Microsoft/Edge/Application/msedge.exe')]),
  chromium.executablePath()].filter(Boolean).find(p => existsSync(p));
assert.ok(browserPath, 'A local Chromium browser is required');
const instance = await startBacklotServer({ root: fixture, port: 0, openBrowser: false });
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const failures = [];
const posts = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const state = {
  hitl: { protocol: 'video-hitl/1', status: 'REVIEW_REQUIRED', phase: 'needs_visual_review', checkpoint: 'VISUAL_REVIEW', message: 'Bản dựng đang chờ bạn duyệt.' },
  currentPhase: 'needs_visual_review',
  stages: [{ id: 'request', status: 'completed' }, { id: 'script', status: 'completed' }, { id: 'storyboard', status: 'completed' }, { id: 'hyperframes_renderer', status: 'active' }],
  requestText: 'A concise synthetic request for a product walkthrough.',
  videoBrief: { objective: 'A clearer way to review video', aspectRatio: '16:9', durationSeconds: 60 },
  scriptText: '# Script fixture\n\nSynthetic copy retained as canonical artifact content.',
  storyboard: { meta: { title: 'A clearer way to review video', width: 1920, height: 1080, fps: 30, durationsInFrames: 1800, constraints: {} }, scenes: [] },
  canonicalProject: { meta: { title: 'A clearer way to review video', width: 1920, height: 1080, fps: 30, durationsInFrames: 1800, constraints: {} }, scenes: [] },
  projectState: { projectId: 'ux-fixture', revision: 3, projectHash: 'synthetic-hash' },
  assetManifest: { version: '1', assets: [] },
  rendererOptions: [{ id: 'remotion', label: 'Remotion', version: '4.0.527', available: true }],
  rendererSelection: { selected: 'remotion' },
  renderer: { id: 'remotion', phase: 'VISUAL_REVIEW', projectDir: 'remotion/generated', previewUrl: 'http://127.0.0.1/fixture-studio', sourceHash: 'sha256:' + 'a'.repeat(64), finalized: false },
  previewExists: false, finalVideoExists: false, finalizedDelivery: false, evidenceFiles: [],
};
await context.route('**/api/state', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) }));
await context.route('**/api/hitl/**', async route => {
  posts.push({ method: route.request().method(), path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
});

async function capture(name, width, height, url, ready) {
  await page.setViewportSize({ width, height });
  await page.goto(instance.url + url, { waitUntil: 'domcontentloaded' });
  await ready();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' overflows at ' + width + 'px');
  await page.screenshot({ path: resolve(out, name + '-' + width + '.png'), fullPage: true });
}
try {
  for (const [width, height] of [[1440, 1000], [1024, 768], [820, 900], [375, 812]]) {
    await capture('backlot-review-pending', width, height, '/?stage=remotion_composition', async () => page.locator('#reviewStatusLabel').waitFor({ state: 'visible' }));
    assert.equal((await page.locator('#approveRendererReviewBtn').textContent()).trim(), 'Duyệt bản dựng', 'Approval actions use the same language as the Backlot workspace');
    assert.ok((await page.locator('.hitl-review-changes-submit').allTextContents()).every(label => label.trim() === 'Yêu cầu chỉnh sửa'), 'Revision actions use the same language as the Backlot workspace');
    await page.locator('#pipelineStepper [data-stage="overview"]').click();
    await page.locator('#page-overview.active').waitFor();
    assert.equal(await page.locator('#hitlNoticeBar').isVisible(), false, 'The overview owns the pending-review action without repeating the alert');
    assert.equal(await page.locator('body > .skip-link').getAttribute('href'), '#stageViewport', 'Backlot provides a skip link to the primary content');
    await page.screenshot({ path: resolve(out, 'backlot-overview-' + width + '.png'), fullPage: true });
    assert.match(await page.locator('#overviewAttention h2').textContent(), /duyệt bản dựng/i);
    assert.doesNotMatch(await page.locator('#overviewSummary').textContent(), /đang chờ bạn duyệt/i, 'Project introduction does not repeat the next action');
    await page.locator('#overviewAttention [data-overview-stage]').click();
    await page.locator('#page-remotion_composition.active').waitFor();
    await page.locator('#pipelineStepper [data-stage="request_brief"]').click();
    await page.locator('#page-request_brief.active').waitFor();
    await page.screenshot({ path: resolve(out, 'backlot-content-' + width + '.png'), fullPage: true });
    assert.doesNotMatch(await page.locator('#page-request_brief').innerText(), /\bundefined\b/i, 'Missing Video Brief values are rendered as a neutral state');
    assert.match(await page.locator('#briefParameters').innerText(), /Chưa cung cấp/, 'Missing tone and pacing are labelled without fabricating content');
    for (const [stage, file, title] of [
      ['profile_script', 'backlot-stage-profile-script', 'Tiêu chí & kịch bản'],
      ['storyboard', 'backlot-stage-storyboard', 'Phân cảnh'],
      ['canonical_assets', 'backlot-stage-canonical-assets', 'Dự án & tư liệu'],
    ]) {
      await capture(file, width, height, '/?stage=' + stage, async () => page.locator('#page-' + stage + '.active .stage-page-header h1').waitFor());
      assert.match(await page.locator('#page-' + stage + '.active .stage-page-header h1').textContent(), new RegExp(title, 'i'));
      assert.doesNotMatch(await page.locator('#page-' + stage).innerText(), /\bundefined\b/i, stage + ' does not expose missing fields as undefined');
    }
    await capture('explorer-features', width, height, '/explorer.html?pollMs=1000', async () => page.locator('#main h1').filter({ hasText: 'Chức năng' }).waitFor());
    assert.equal(await page.locator('.app-switcher-wrap').isVisible(), false, 'The app switcher stays hidden when only one app is registered');
    assert.equal(await page.locator('.app-explorer-panel').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(17, 19, 22)', 'Explorer uses the shared graphite palette');
    if (width <= 900) {
      assert.equal(await page.locator('.layout-with-detail').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1, 'Explorer stacks feature details at tablet and mobile widths');
      assert.equal(await page.locator('.step').first().evaluate(el => el.querySelector('.step-num').getBoundingClientRect().right <= el.querySelector('.step-name').getBoundingClientRect().left), true, 'Explorer step numbers stay clear of their headings');
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(instance.url + '/explorer.html?pollMs=1000', { waitUntil: 'domcontentloaded' });
  await page.locator('#main h1').filter({ hasText: 'Chức năng' }).waitFor();
  await page.locator('#statusFilter').selectOption('verified');
  assert.ok(await page.locator('.feature-card').count() > 0, 'Status filter shows matching features');
  await page.locator('#statusFilter').selectOption('all');
  await page.locator('#featureSearch').fill('tạo dự án');
  const scrollBeforeSelection = await page.evaluate(() => scrollY);
  await page.locator('.feature-card').first().click();
  await page.locator('#featureDetail').waitFor();
  assert.equal(await page.evaluate(() => scrollY), scrollBeforeSelection, 'Selecting a feature does not jump the page');
  assert.match(page.url(), /feature=projects\.create/, 'Selected feature has a restorable deep link');
  const selectedTitle = await page.locator('#featureDetail h2').textContent();
  await page.waitForTimeout(1400);
  assert.equal(await page.locator('#featureDetail h2').textContent(), selectedTitle, 'Explorer polling retains selected feature');
  assert.equal(await page.locator('#featureSearch').inputValue(), 'tạo dự án', 'Explorer polling retains search');
  await page.screenshot({ path: resolve(out, 'explorer-feature-selected-1440.png'), fullPage: true });
  await page.screenshot({ path: resolve(out, 'explorer-feature-selected-viewport-1440.png') });
  await page.locator('[data-view="journeys"]').click();
  await page.locator('#main h1').waitFor();
  if (await page.locator('.journey-screenshot').count()) {
    await page.locator('.journey-screenshot').first().click();
    await page.locator('#lightbox:not([hidden])').waitFor();
    await page.screenshot({ path: resolve(out, 'explorer-evidence-lightbox-1440.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.locator('#lightbox[hidden]').waitFor();
  }
  await page.screenshot({ path: resolve(out, 'explorer-journeys-1440.png'), fullPage: true });
  assert.doesNotMatch(await page.locator('.journey-node-heading').first().innerText(), /projects\.create|scenario/i, 'Journey headings use readable feature names and localized types');
  await page.locator('[data-feature-from-journey]').first().click();
  await page.locator('#featureDetail').waitFor();
  assert.match(page.url(), /feature=projects\.create/, 'Opening a journey feature restores the selected feature URL');
  await page.locator('[data-close-detail]').click();
  assert.doesNotMatch(page.url(), /[?&]feature=/, 'Closing details clears feature selection from the URL');
  await page.locator('[data-area]').first().click();
  assert.doesNotMatch(page.url(), /[?&]feature=/, 'Area navigation clears stale feature identity from the URL');
  await page.locator('[data-view="journeys"]').click();
  await page.locator('[data-view="journeys"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-view="journeys"]').evaluate(el => el === document.activeElement), true, 'Keyboard activation keeps focus on the navigation control');
  await page.locator('[data-view="queue"]').click();
  await page.locator('#main h1').waitFor();
  assert.equal(await page.locator('.queue-open').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(37, 40, 47)', 'Explorer actions use dark neutral controls instead of light default buttons');
  await page.screenshot({ path: resolve(out, 'explorer-next-work-1440.png'), fullPage: true });
  assert.ok(await page.locator('#liveStatus').textContent(), 'Existing live status/next-work summary remains available');
  await page.locator('[data-view="activity"]').click();
  await page.locator('#main h1').filter({ hasText: 'Hoạt động' }).waitFor();
  await page.screenshot({ path: resolve(out, 'explorer-activity-1440.png'), fullPage: true });
  for (const view of ['journeys', 'queue', 'activity']) {
    await page.locator('[data-view="' + view + '"]').click();
    await page.locator('#main h1').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Explorer ' + view + ' fits the desktop viewport');
    assert.ok(await page.locator('#main h1').isVisible(), 'Explorer ' + view + ' remains operable at 1440px');
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const view of ['journeys', 'queue', 'activity']) {
    await page.locator('[data-view="' + view + '"]').click();
    await page.locator('#main h1').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Explorer ' + view + ' fits the 1024px desktop viewport');
    assert.ok(await page.locator('#main h1').isVisible(), 'Explorer ' + view + ' remains operable at 1024px');
  }

  // Use a synthetic, already approved delivery snapshot. No approval endpoint is called.
  state.hitl = { protocol: 'video-hitl/1', status: 'COMPLETED', phase: 'completed', checkpoint: 'VISUAL_REVIEW' };
  state.currentPhase = 'completed';
  state.renderer.visualApproval = { status: 'approved', approvedBy: 'HUMAN', sourceHash: state.renderer.sourceHash };
  state.renderer.finalized = false;
  state.finalVideoExists = false;
  state.finalizedDelivery = false;
  state.finalManifest = null;
  await capture('backlot-approved-next-step', 1440, 1000, '/?stage=remotion_composition', async () => page.locator('#reviewApprovedNextStep:visible').waitFor());
  assert.match(await page.locator('#reviewApprovedHeading').textContent(), /Sẵn sàng render/);
  await page.locator('#reviewApprovedNextStep a').click();
  await page.locator('#page-final_render.active').waitFor();
  await page.locator('#finalVideoBadge').filter({ hasText: 'Đang chờ' }).waitFor();
  assert.match(page.url(), /stage=final_render/, 'Approved navigation opens the existing delivery stage');
  assert.equal(await page.locator('#finalVideoPlayerSlot video').count(), 0, 'No fabricated media player appears when the synthetic fixture has no rendered video');
  assert.match(await page.locator('#finalVideoPlayerSlot').innerText(), /Video chưa được render/);
  await page.screenshot({ path: resolve(out, 'backlot-delivery-pending-1440.png'), fullPage: true });
  assert.equal(posts.length, 0, 'Delivery walkthrough must not submit human approval or revision');
  await page.setViewportSize({ width: 1024, height: 768 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Delivery stage fits the 1024px desktop viewport');
  await page.screenshot({ path: resolve(out, 'backlot-delivery-pending-1024.png'), fullPage: true });
  assert.equal(posts.length, 0, 'Visual walkthrough must not submit human approval or revision');

  await context.route('**/api/explorer/apps', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(instance.url + '/explorer.html?pollMs=1000', { waitUntil: 'domcontentloaded' });
  await page.locator('#appIdentity').waitFor({ state: 'visible' });
  assert.equal((await page.locator('#appIdentity').innerText()).trim(), 'Chưa có ứng dụng nào được đăng ký.', 'An empty workspace does not leave the app identity in a loading state');
  assert.equal((await page.locator('#liveStatus').innerText()).trim(), 'Workspace này chưa có ứng dụng được đăng ký.', 'An empty workspace explains its state in Vietnamese');
  assert.equal(await page.locator('.app-switcher-wrap').isVisible(), false, 'The app selector remains hidden with no registered apps');
  assert.equal(await page.locator('#agentBrowserDashboardLink').isVisible(), false, 'The unconfigured dashboard link remains hidden');

  await context.unroute('**/api/explorer/apps');
  await context.route('**/api/explorer/apps', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }));
  await page.goto(instance.url + '/explorer.html?pollMs=1000', { waitUntil: 'domcontentloaded' });
  await page.locator('#appIdentity').waitFor({ state: 'visible' });
  assert.equal((await page.locator('#appIdentity').innerText()).trim(), 'Không thể tải danh sách ứng dụng.', 'A registry failure clears the app identity loading state');
  assert.equal((await page.locator('#liveStatus').innerText()).trim(), 'Không thể tải danh sách ứng dụng. Hãy làm mới trang để thử lại.', 'A registry failure gives a clear recovery step');

  assert.deepEqual(errors, [], 'No browser runtime errors');
  assert.ok(failures.length === 0);
  console.log('PASS screenshots and Explorer flows (' + mode + '); ' + posts.length + ' intercepted HITL writes');
} catch (error) {
  failures.push(error.message);
  console.error('FAIL', error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await instance.stop();
  await writeFile(resolve(out, 'walkthrough-results.json'), JSON.stringify({ mode, failures, pageErrors: errors, interceptedHITLWrites: posts }, null, 2));
  await rm(fixture, { recursive: true, force: true });
}
