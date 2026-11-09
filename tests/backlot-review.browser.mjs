// Desktop acceptance harness. Real Backlot static server + real SSE; all HITL writes
// are intercepted in Playwright and never reach the host. No production state changes.
import assert from 'node:assert/strict';
import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { startBacklotServer } from '../dist/src/backlot/server.js';

const root = process.cwd();
const fixtureRoot = resolve(root, 'tests/.tmp-backlot-review-browser');
const outArg = process.argv.find(arg => arg.startsWith('--output-dir='));
const out = resolve(root, outArg ? outArg.slice('--output-dir='.length) : 'output/ux-review');
const baseline = process.argv.includes('--baseline');
await mkdir(resolve(fixtureRoot, 'dist/src/backlot'), { recursive: true });
await mkdir(resolve(fixtureRoot, 'assets'), { recursive: true });
await mkdir(resolve(fixtureRoot, 'output'), { recursive: true });
await mkdir(out, { recursive: true });
await cp(resolve(root, 'dist/src/backlot/web'), resolve(fixtureRoot, 'dist/src/backlot/web'), { recursive: true });
const mediaFile = resolve(fixtureRoot, 'output/final.mp4');
if (!existsSync(mediaFile)) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x23262c:s=640x360:r=24', '-t', '20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', mediaFile]);
const media = await readFile(mediaFile);
const browserPath = [process.env.CHROME_PATH, process.env.CHROMIUM_PATH,
  ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap(p => [resolve(p, 'Google/Chrome/Application/chrome.exe'), resolve(p, 'Microsoft/Edge/Application/msedge.exe')]),
  chromium.executablePath()].filter(Boolean).find(p => existsSync(p));
assert.ok(browserPath, 'A locally installed Chromium browser is required');
const instance = await startBacklotServer({ root: fixtureRoot, port: 0, openBrowser: false });
let realHostMutations = 0;
instance.server.on('request', req => {
  if (req.method === 'POST' && req.url?.startsWith('/api/hitl/')) realHostMutations++;
});
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const results = [];
const posts = [];
let stateFetches = 0;
let failState = false;
let holdNextState = false;
let heldStateResponse = null;
let mutation = async () => ({ status: 200, body: { ok: true } });
const project = { meta: { title: 'A clearer way to review video', width: 1920, height: 1080, fps: 30, durationsInFrames: 1800, constraints: {} }, scenes: [] };
const pending = () => ({
  hitl: { protocol: 'video-hitl/1', status: 'REVIEW_REQUIRED', phase: 'needs_visual_review', checkpoint: 'VISUAL_REVIEW', message: 'Visual review is ready for your decision.' },
  currentPhase: 'needs_visual_review', stages: [{ id: 'hyperframes_renderer', name: 'Renderer', status: 'active' }],
  requestText: 'A short product walkthrough.', clarification: null, videoBrief: null,
  productionProfile: null, scriptText: null, scriptReview: null, storyboardReview: null,
  canonicalProject: project, storyboard: project, projectState: { projectId: 'review-fixture', revision: 3, projectHash: 'fixture-project-hash' },
  assetManifest: { version: '1', assets: [] }, productionPreflight: null, semanticPreflight: null,
  productionPreflightApproval: { status: 'APPROVED' }, reopenStatus: { generation: 0, pending: [] }, theme: null,
  rendererOptions: [{ id: 'remotion', label: 'Remotion', version: '4.0.527', available: true }], rendererSelection: { selected: 'remotion' },
  renderer: { id: 'remotion', phase: 'VISUAL_REVIEW', projectDir: 'remotion/generated', previewUrl: `${instance.url}/fixture-studio`, sourceHash: 'sha256:' + 'a'.repeat(64), finalized: false },
  previewExists: false, finalVideoExists: false, finalizedDelivery: false, evidenceFiles: [], finalManifest: null,
});
let state = pending();
await context.route('**/api/state', async route => {
  stateFetches++;
  if (holdNextState) {
    holdNextState = false;
    const snapshot = JSON.stringify(state);
    await new Promise(resolve => { heldStateResponse = async () => { await route.fulfill({ status: 200, contentType: 'application/json', body: snapshot }); resolve(); }; });
    return;
  }
  await route.fulfill({ status: failState ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failState ? { error: 'Fixture unavailable' } : state) });
});
await context.route('**/api/hitl/**', async route => {
  const request = route.request();
  posts.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
  const result = await mutation(request);
  await route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.body) });
});
await context.route('**/fixture-studio', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic Studio endpoint</title><h1>Studio fixture</h1><p>This endpoint verifies navigation only, not renderer operation.</p>' }));
await context.route(/\/media\/output\/final\.mp4(?:\?.*)?$/, route => route.fulfill({ status: 200, contentType: 'video/mp4', body: media }));
async function check(name, fn) {
  try { await fn(); results.push({ name, status: 'passed' }); console.log('PASS', name); }
  catch (error) { results.push({ name, status: 'failed', error: error.message }); console.log('FAIL', name, error.stack || error.message); }
}
async function open(next = pending()) {
  state = next; failState = false;
  await page.goto(instance.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#topProjectTitle')?.textContent?.includes('A clearer'));
  await page.waitForFunction(() => document.querySelector('#connectionIndicator')?.classList.contains('online'));
}
let serial = 0;
async function update(next = state) {
  state = next;
  const before = stateFetches;
  await writeFile(resolve(fixtureRoot, 'assets/sse-probe.txt'), String(++serial));
  await page.waitForFunction(() => document.querySelector('#connectionIndicator')?.classList.contains('online'));
  const until = Date.now() + 7000;
  while (stateFetches <= before && Date.now() < until) await new Promise(r => setTimeout(r, 30));
  assert.ok(stateFetches > before, 'Real filesystem SSE must refetch state');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
async function navigate(stage) {
  await page.locator(`[data-stage="${stage}"]`).click();
  await page.locator(`#page-${stage}`).waitFor({ state: 'visible' });
}

try {
  await check('P0 clarification input, focus and node survive real SSE', async () => {
    const next = pending(); next.hitl = { status: 'INPUT_REQUIRED', phase: 'needs_user_input', checkpoint: 'CLARIFICATION', payload: { questions: [{ id: 'audience', question: 'Who is the audience?' }] } };
    await open(next);
    const input = page.locator('#clarifyFormContainer input');
    await input.fill('Video editors');
    await input.evaluate(el => { el.focus(); el.setSelectionRange(2, 6); window.__input = el; });
    await update();
    assert.equal(await input.inputValue(), 'Video editors');
    assert.equal(await input.evaluate(el => el === window.__input && el === document.activeElement && el.selectionStart === 2 && el.selectionEnd === 6), true);
    next.hitl.payload.questions = [{ id: 'format', question: 'Which format?' }];
    await update(next);
    assert.equal(await page.locator('#clarifyFormContainer input').inputValue(), '', 'New questions cannot inherit unrelated draft');
  });
  await check('P0 real video playback survives unrelated SSE', async () => {
    const next = pending(); next.finalVideoExists = true;
    await open(next); await navigate('final_render');
    const video = page.locator('#finalVideoPlayerSlot video');
    await video.evaluate(async el => {
      el.muted = true; window.__video = el;
      if (el.readyState < 1) await new Promise(r => el.addEventListener('loadedmetadata', r, { once: true }));
      await el.play();
    });
    await page.waitForFunction(() => window.__video.currentTime > 0.15 && !window.__video.paused);
    const beforePlayback = await video.evaluate(el => el.currentTime);
    await update();
    assert.equal(await video.evaluate(el => el === window.__video), true, 'Video node was replaced');
    const afterPlayback = await video.evaluate(el => ({ paused: el.paused, time: el.currentTime }));
    assert.equal(afterPlayback.paused, false, `Playback paused at ${afterPlayback.time}`);
    assert.ok(afterPlayback.time >= beforePlayback, `Playback reset from ${beforePlayback} to ${afterPlayback.time}`);
  });
  await check('Review feedback survives unrelated SSE with focus', async () => {
    await open();
    const field = page.locator('#reviewChanges-VISUAL_REVIEW');
    await field.fill('Hold the opening scene for one more second.');
    await field.focus();
    await update();
    assert.equal(await field.inputValue(), 'Hold the opening scene for one more second.');
    assert.equal(await field.evaluate(el => el === document.activeElement), true);
  });
  if (baseline) {
    await open();
    await page.screenshot({ path: resolve(out, 'before-1440.png'), fullPage: true });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: resolve(out, 'before-1024.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await check('Regression proof: changing source after opening Studio must block approval until current source is opened', async () => {
      const sourceA = pending();
      await open(sourceA);
      const popupPromise = page.waitForEvent('popup');
      await page.locator('#rendererPreviewLink').click();
      const popup = await popupPromise; await popup.close();
      const sourceB = pending(); sourceB.renderer.sourceHash = 'sha256:' + 'b'.repeat(64);
      await update(sourceB);
      assert.equal(await page.locator('#approveRendererReviewBtn').isDisabled(), true,
        'Approval must be blocked because Studio was opened for a different source');
    });
  } else {
    const approve = () => page.locator('#approveRendererReviewBtn');
    const feedback = () => page.locator('#reviewChanges-VISUAL_REVIEW');
    const submit = () => page.locator('#rendererReviewHitlActionSlot .hitl-review-changes-submit');
    const message = () => page.locator('#reviewActionMessage');
    const status = () => page.locator('#reviewStatusLabel');
    const acceptDialog = async fn => { page.once('dialog', d => d.accept()); await fn(); };
    await check('Preview uses the selected real Studio URL, not old final media', async () => {
      const next = pending(); next.finalVideoExists = true;
      await open(next);
      assert.equal(await page.locator('.review-launcher').isVisible(), true);
      assert.equal(await page.locator('.renderer-player-slot').count(), 0, 'Review must not render a fake preview box');
      assert.equal(await page.locator('#reviewDetails').evaluate(el => el.open), false, 'Technical details start collapsed');
      assert.equal(await page.locator('#rendererPreviewLink').getAttribute('href'), next.renderer.previewUrl);
      assert.equal(await page.locator('#page-remotion_composition video').count(), 0);
      const popupPromise = page.waitForEvent('popup');
      await page.locator('#rendererPreviewLink').click();
      const popup = await popupPromise; await popup.waitForLoadState();
      assert.equal(popup.url(), next.renderer.previewUrl); await popup.close();
    });
    await check('Opening source A then receiving source B requires opening B before approval', async () => {
      await open();
      const sourceAIdentity = await page.locator('#rendererSourceHash').textContent();
      const popupPromise = page.waitForEvent('popup');
      await page.locator('#rendererPreviewLink').click();
      const popupA = await popupPromise; await popupA.close();
      await page.evaluate(() => { window.__staleApproveHandler = document.querySelector('#approveRendererReviewBtn').onclick; });
      const next = pending(); next.renderer.sourceHash = 'sha256:' + 'b'.repeat(64);
      await update(next);
      assert.notEqual(await page.locator('#rendererSourceHash').textContent(), sourceAIdentity);
      assert.equal(await approve().isDisabled(), true);
      assert.match(await page.locator('#reviewStatusDescription').textContent(), /open the current source|mở lại nguồn hiện tại/i);
      let count = posts.length;
      let staleHandlerDialogs = 0;
      const staleDialogHandler = dialog => { staleHandlerDialogs++; dialog.accept(); };
      page.on('dialog', staleDialogHandler);
      await page.evaluate(() => window.__staleApproveHandler());
      await new Promise(r => setTimeout(r, 100));
      page.off('dialog', staleDialogHandler);
      assert.equal(staleHandlerDialogs, 0, 'A stale approval handler must not even ask for approval');
      assert.equal(posts.length, count, 'A stale handler must not POST for an unopened replacement source');
      const popupBPromise = page.waitForEvent('popup');
      await page.locator('#rendererPreviewLink').click();
      const popupB = await popupBPromise; await popupB.close();
      assert.equal(await approve().isEnabled(), true);
      mutation = async () => ({ status: 200, body: { ok: true } });
      await acceptDialog(() => approve().click());
      assert.deepEqual(posts.at(-1), { path: '/api/hitl/approve', body: { checkpoint: 'VISUAL_REVIEW' } });
      assert.equal(posts.length, count + 1, 'Only the existing approval request is sent');
    });
    await check('Approved review offers truthful delivery navigation without a render mutation', async () => {
      const next = pending();
      next.hitl = { status: 'READY', phase: 'ready_to_render' };
      next.renderer.visualApproval = { status: 'approved', approvedBy: 'HUMAN', sourceHash: next.renderer.sourceHash };
      await open(next);
      assert.equal(await page.locator('#reviewApprovedNextStep').isVisible(), true);
      assert.equal(await page.locator('#reviewLauncher').isVisible(), false);
      assert.equal(await page.locator('#reviewStatusDescription').isVisible(), false);
      assert.match(await page.locator('#reviewApprovedCopy').textContent(), /agent can now render|agent có thể bắt đầu render video/i);
      assert.match(await page.locator('#reviewApprovedHeading').textContent(), /Ready for rendering|Sẵn sàng render/);
      const before = posts.length;
      await page.locator('#reviewDetails summary').click();
      assert.equal(await page.locator('#reviewDetailsStudioLink').isVisible(), true);
      const approvedStudioPopupPromise = page.waitForEvent('popup');
      await page.locator('#reviewDetailsStudioLink').click();
      const approvedStudioPopup = await approvedStudioPopupPromise;
      assert.equal(approvedStudioPopup.url(), next.renderer.previewUrl);
      await approvedStudioPopup.close();
      await page.locator('#reviewApprovedNextStep a').click();
      assert.equal(posts.length, before);
      assert.match(page.url(), /stage=final_render/);

      const qaPending = pending(); qaPending.hitl = next.hitl;
      qaPending.renderer.visualApproval = next.renderer.visualApproval;
      qaPending.finalVideoExists = true;
      await open(qaPending);
      assert.match(await page.locator('#reviewApprovedHeading').textContent(), /Render checks pending|Chờ kiểm tra video/);
      assert.match(await page.locator('#reviewApprovedCopy').textContent(), /waiting for final checks|đang chờ kiểm tra cuối/i);
      assert.match(await page.locator('#reviewApprovedNextStep a').textContent(), /Review render checks|Xem kiểm tra video/);
      await page.screenshot({ path: resolve(out, 'desktop-approved-qa-pending.png'), fullPage: true });

      const ready = pending(); ready.hitl = next.hitl;
      ready.renderer.visualApproval = next.renderer.visualApproval;
      ready.finalVideoExists = true; ready.finalizedDelivery = true;
      await open(ready);
      assert.match(await page.locator('#reviewApprovedHeading').textContent(), /Delivery ready|Sẵn sàng bàn giao/);
      assert.match(await page.locator('#reviewApprovedCopy').textContent(), /video and its evidence are ready|video cuối cùng và bằng chứng đã sẵn sàng/i);
      assert.match(await page.locator('#reviewApprovedNextStep a').textContent(), /View completed delivery|Xem video đã bàn giao/);
      await page.screenshot({ path: resolve(out, 'desktop-delivery-ready.png'), fullPage: true });
      assert.equal(posts.length, before, 'Approved navigation and state rendering do not start a render or other host action');
    });
    await check('Empty feedback validates inline without a host POST', async () => {
      await open(); const count = posts.length;
      await submit().click();
      assert.equal(posts.length, count);
      assert.equal(await message().getAttribute('data-kind'), 'error');
      assert.equal(await feedback().evaluate(el => el === document.activeElement), true);
    });
    await check('Cancel approval sends no request', async () => {
      await open(); const count = posts.length;
      page.once('dialog', d => d.dismiss()); await approve().click();
      assert.equal(posts.length, count);
      assert.equal(await approve().isEnabled(), true);
    });
    await check('Approve payload unchanged; actions locked through pending SSE', async () => {
      await open(); let release;
      mutation = async () => new Promise(r => { release = r; });
      const count = posts.length;
      await acceptDialog(() => approve().click());
      await page.waitForFunction(() => document.querySelector('#approveRendererReviewBtn').disabled);
      await update();
      assert.equal(await approve().isDisabled(), true);
      assert.equal(await submit().isDisabled(), true);
      assert.equal(posts.length, count + 1);
      assert.deepEqual(posts.at(-1), { path: '/api/hitl/approve', body: { checkpoint: 'VISUAL_REVIEW' } });
      state = pending(); state.hitl = { status: 'READY', phase: 'ready_to_render' }; state.renderer.visualApproval = { status: 'approved', approvedBy: 'HUMAN', sourceHash: state.renderer.sourceHash };
      release({ status: 200, body: { ok: true } });
      await approve().waitFor({ state: 'hidden' });
      assert.match(await status().textContent(), /approved|đã duyệt/i);
      await page.screenshot({ path: resolve(out, 'desktop-approved.png'), fullPage: true });
    });
    await check('Request failure retains feedback, reports inline and permits retry', async () => {
      await open(); mutation = async () => ({ status: 409, body: { ok: false, error: 'Source changed; review the new source.' } });
      await feedback().fill('Make the closing title easier to read.');
      await acceptDialog(() => submit().click());
      await page.waitForFunction(() => document.querySelector('#reviewActionMessage').dataset.kind === 'error');
      assert.equal(await feedback().inputValue(), 'Make the closing title easier to read.');
      assert.equal(await approve().isEnabled(), true);
      assert.equal(await submit().isEnabled(), true);
      assert.match(await message().textContent(), /Source changed/);
    });
    await check('Approval rejection remains pending with inline error', async () => {
      await open(); mutation = async () => ({ status: 409, body: { ok: false, error: 'Source identity changed. Open a fresh review.' } });
      await acceptDialog(() => approve().click());
      await page.waitForFunction(() => document.querySelector('#reviewActionMessage').dataset.kind === 'error');
      assert.equal(await approve().isVisible(), true);
      assert.equal(await approve().isEnabled(), true);
      assert.match(await message().textContent(), /Source identity changed/);
      assert.match(await status().textContent(), /awaiting|chờ bạn duyệt/i);
    });
    await check('Request Changes locks both actions while pending across SSE', async () => {
      await open(); await feedback().fill('Use a slower transition into the product view.');
      let release; mutation = async () => new Promise(r => { release = r; });
      await acceptDialog(() => submit().click());
      await page.waitForFunction(() => document.querySelector('#reviewChanges-VISUAL_REVIEW').disabled);
      await update();
      assert.equal(await approve().isDisabled(), true); assert.equal(await submit().isDisabled(), true);
      release({ status: 503, body: { ok: false, error: 'Fixture temporary failure' } });
      await page.waitForFunction(() => !document.querySelector('#reviewChanges-VISUAL_REVIEW').disabled);
      assert.equal(await feedback().inputValue(), 'Use a slower transition into the product view.');
    });
    await check('Request Changes payload and host-confirmed revision state', async () => {
      await open(); await feedback().fill('Hold the opening frame longer.');
      mutation = async () => { state = pending(); state.hitl = { status: 'WORKING', phase: 'revision_requested', checkpoint: 'VISUAL_REVIEW', payload: { reviewChange: { feedback: 'Hold the opening frame longer.' } } }; return { status: 200, body: { ok: true } }; };
      await acceptDialog(() => submit().click());
      await approve().waitFor({ state: 'hidden' });
      assert.deepEqual(posts.at(-1), { path: '/api/hitl/request-changes', body: { checkpoint: 'VISUAL_REVIEW', feedback: 'Hold the opening frame longer.' } });
      assert.match(await status().textContent(), /changes requested|đã yêu cầu chỉnh sửa/i);
      assert.match(await message().textContent(), /Hold the opening frame/);
      assert.equal(await submit().isVisible(), false);
      await page.screenshot({ path: resolve(out, 'desktop-changes-requested.png'), fullPage: true });
    });
    await check('Old-source draft retained; acknowledgement resets on each source', async () => {
      await open(); await feedback().fill('Increase title contrast.');
      const next = pending(); next.renderer.sourceHash = 'sha256:' + 'b'.repeat(64); await update(next);
      assert.equal(await feedback().inputValue(), 'Increase title contrast.');
      assert.equal(await page.locator('#reviewOldDraftNotice').isVisible(), true);
      assert.equal(await submit().isDisabled(), true);
      await page.locator('#reviewDraftAcknowledge').check();
      assert.equal(await submit().isEnabled(), true);
      next.renderer.sourceHash = 'sha256:' + 'c'.repeat(64); await update(next);
      assert.equal(await page.locator('#reviewDraftAcknowledge').isChecked(), false);
      assert.equal(await submit().isDisabled(), true);
      await page.screenshot({ path: resolve(out, 'desktop-source-changed.png'), fullPage: true });
    });
    await check('Same source hash in a new project revision still requires draft acknowledgement', async () => {
      await open(); await feedback().fill('Adjust the title for this revision.');
      const next = pending(); next.projectState.revision = 4; await update(next);
      assert.equal(await feedback().inputValue(), 'Adjust the title for this revision.');
      assert.equal(await page.locator('#reviewOldDraftNotice').isVisible(), true);
      assert.equal(await submit().isDisabled(), true);
    });
    await check('No renderer, authoring and untrusted preview cannot approve', async () => {
      const none = pending(); none.renderer = null; none.rendererSelection = null;
      await open(none); assert.equal(await approve().isVisible(), false); assert.equal(await page.locator('#rendererPreviewLink').isVisible(), false);
      const authoring = pending(); authoring.renderer.phase = 'AUTHORING'; delete authoring.renderer.previewUrl; authoring.hitl = { status: 'WORKING', phase: 'authoring' };
      await update(authoring); assert.equal(await approve().isVisible(), false); assert.match(await status().textContent(), /production|authoring|đang sản xuất/i);
      const unsafe = pending(); unsafe.renderer.previewUrl = 'https://example.com/not-local'; await update(unsafe);
      assert.equal(await approve().isVisible(), false); assert.equal(await page.locator('#rendererPreviewLink').isVisible(), false);
      await page.screenshot({ path: resolve(out, 'desktop-unavailable.png'), fullPage: true });
    });
    await check('Renderer identity mismatch cannot show the wrong preview or approve', async () => {
      const next = pending(); next.renderer.id = 'hyperframes';
      await open(next);
      assert.equal(await approve().isVisible(), false);
      assert.equal(await page.locator('#rendererPreviewLink').isVisible(), false);
      assert.match(await status().textContent(), /mismatch|unavailable|không khớp/i);
    });
    await check('Malformed approval metadata cannot display host approval', async () => {
      const next = pending(); next.renderer.visualApproval = { status: 'approved', sourceHash: next.renderer.sourceHash };
      await open(next);
      assert.match(await status().textContent(), /awaiting|chờ bạn duyệt/i);
      assert.equal(await approve().isVisible(), true);
    });
    await check('A confirmed new delivery reloads media while same delivery retains it', async () => {
      const next = pending(); next.finalVideoExists = true; next.finalManifest = { sourceHash: next.renderer.sourceHash, output: { sha256: 'sha256:' + '1'.repeat(64) } };
      await open(next); await navigate('final_render');
      await page.locator('#finalVideoPlayerSlot video').evaluate(el => { window.__deliveryPlayer = el; window.__deliveryUrl = el.querySelector('source')?.src || el.src; });
      await update(next);
      assert.equal(await page.locator('#finalVideoPlayerSlot video').evaluate(el => el === window.__deliveryPlayer), true);
      next.finalManifest.output.sha256 = 'sha256:' + '2'.repeat(64); await update(next);
      assert.equal(await page.locator('#finalVideoPlayerSlot video').evaluate(el => el !== window.__deliveryPlayer || (el.querySelector('source')?.src || el.src) !== window.__deliveryUrl), true, 'New delivery identity must reload or replace old media');
    });
    await check('New renderer source reloads pre-finalized media with unchanged project revision', async () => {
      const next = pending(); next.finalVideoExists = true; next.finalManifest = null;
      await open(next); await navigate('final_render');
      const url = await page.locator('#finalVideoPlayerSlot video').evaluate(el => el.querySelector('source')?.src || el.src);
      next.renderer.sourceHash = 'sha256:' + 'e'.repeat(64); await update(next);
      const updatedUrl = await page.locator('#finalVideoPlayerSlot video').evaluate(el => el.querySelector('source')?.src || el.src);
      assert.notEqual(updatedUrl, url);
      next.finalManifest = { sourceHash: 'sha256:' + 'a'.repeat(64), output: { sha256: 'sha256:' + '9'.repeat(64) } };
      await update(next);
      assert.equal(await page.locator('#finalVideoPlayerSlot video').evaluate(el => el.querySelector('source')?.src || el.src), updatedUrl, 'A stale previous-source manifest cannot replace current source identity');
    });
    await check('State fetch failure is visible and preserves feedback', async () => {
      await open(); await feedback().fill('Keep this feedback during reconnection.');
      failState = true; await page.locator('#refreshBtn').click();
      await page.waitForFunction(() => /unavailable|failed|stale|could not|unable|error|mất kết nối|không thể cập nhật trạng thái duyệt/i.test(document.querySelector('#reviewActionMessage')?.textContent || document.querySelector('#connectionLabel')?.textContent || ''));
      assert.equal(await feedback().inputValue(), 'Keep this feedback during reconnection.');
      assert.equal(await approve().isDisabled(), true);
      assert.equal(await submit().isDisabled(), true);
      await page.screenshot({ path: resolve(out, 'desktop-stale.png'), fullPage: true });
      failState = false; await page.locator('#refreshBtn').click();
    });
    await check('Approved state fetch failure marks last-known review state stale', async () => {
      const approved = pending();
      approved.hitl = { status: 'READY', phase: 'ready_to_render' };
      approved.renderer.visualApproval = { status: 'approved', approvedBy: 'HUMAN', sourceHash: approved.renderer.sourceHash };
      await open(approved);
      assert.equal(await page.locator('#reviewStatusLabel').getAttribute('data-state'), 'approved');
      assert.equal(await page.locator('#reviewStatusDescription').isHidden(), true);
      failState = true; await page.locator('#refreshBtn').click();
      await page.waitForFunction(() => document.querySelector('#reviewStatusLabel')?.dataset.state === 'error');
      assert.equal(await page.locator('#reviewStatusDescription').isVisible(), true);
      assert.match(await page.locator('#reviewStatusDescription').textContent(), /last known review state.*before acting|trạng thái duyệt gần nhất.*trước khi tiếp tục/i);
      assert.equal(await page.locator('#rendererReviewHitlActionSlot').isHidden(), true);
      assert.equal(await page.locator('#approveRendererReviewBtn').isHidden(), true);
      await page.screenshot({ path: resolve(out, 'desktop-approved-stale.png'), fullPage: true });
      failState = false; await page.locator('#refreshBtn').click();
      await page.waitForFunction(() => document.querySelector('#reviewStatusLabel')?.dataset.state === 'approved');
    });
    await check('First-load error is visible and recoverable', async () => {
      state = pending();
      failState = true;
      await page.goto(instance.url + '/?stage=remotion_composition', { waitUntil: 'domcontentloaded' });
      await page.locator('#reviewStatusLabel').filter({ hasText: /unavailable|mất kết nối/i }).waitFor({ state: 'visible' });
      failState = false; await page.locator('#refreshBtn').click();
      await approve().waitFor({ state: 'visible' });
    });
    await check('An older delayed state response cannot replace a newer source', async () => {
      await open();
      holdNextState = true;
      await page.locator('#refreshBtn').click();
      const deadline = Date.now() + 3000;
      while (!heldStateResponse && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
      assert.ok(heldStateResponse, 'Older request must be held');
      const next = pending(); next.renderer.sourceHash = 'sha256:' + 'd'.repeat(64);
      await update(next);
      const release = heldStateResponse; heldStateResponse = null; await release();
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      assert.equal(await page.locator('#rendererSourceHash').textContent(), next.renderer.sourceHash);
    });
    await check('Keyboard navigation, focus retention and deep-link re-entry', async () => {
      await open();
      const nav = page.locator('[data-stage="remotion_composition"]');
      assert.match(await nav.evaluate(el => el.tagName), /A|BUTTON/);
      await nav.focus(); await update();
      assert.equal(await nav.evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Enter');
      assert.match(page.url(), /remotion_composition|visual.review|review/);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('#page-remotion_composition.active').waitFor();
      await page.locator('#rendererPreviewLink').focus();
      const focus = await page.locator('#rendererPreviewLink').evaluate(el => { const s = getComputedStyle(el); return { style: s.outlineStyle, width: s.outlineWidth }; });
      assert.notEqual(focus.style, 'none'); assert.notEqual(focus.width, '0px');
    });
    await check('Desktop layout at 1440, 1280 and 1024 without horizontal overflow', async () => {
      await open();
      for (const [width, height] of [[1440, 1000], [1280, 900], [1024, 768]]) {
        await page.setViewportSize({ width, height });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Horizontal overflow at ${width}`);
        await page.screenshot({ path: resolve(out, `desktop-${width}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await feedback().focus();
      await page.screenshot({ path: resolve(out, 'desktop-keyboard-focus.png'), fullPage: true });
    });
  }
} finally {
  await browser.close();
  await instance.stop();
  await writeFile(resolve(out, baseline ? 'baseline-results.json' : 'browser-results.json'), JSON.stringify({ baseline, browserPath, results, pageErrors: errors, interceptedPosts: posts, realHostMutations }, null, 2));
}
if (results.some(r => r.status === 'failed') || errors.length || realHostMutations) process.exitCode = 1;
