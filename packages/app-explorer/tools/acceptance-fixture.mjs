import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExplorerFixture } from '../tests/fixtures/explorer-app.mjs';
import { applyObservation, loadWorkspace } from '../lib/store.mjs';
import { commitRevision } from '../lib/revisions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const knowledge = path.join(root, 'tools', 'knowledge.mjs');
const dataDir = path.resolve(root, process.argv[2] || 'workspaces/acceptance-fixture-run');
const evidenceDir = path.join(dataDir, 'evidence', 'acceptance-live');
const screenshotDir = path.join(root, 'docs', 'acceptance', 'flow-hardening');
const browser = process.env.AGENT_BROWSER_BIN || 'C:/Users/DMX/AppData/Local/Temp/app-explorer-browser-tools/node_modules/agent-browser/bin/agent-browser-win32-x64.exe';
const session = 'task-i-integrated-20261017-r11';
const TEST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).format(new Date());
const dashboardUrl = 'http://localhost:4848';
let dashboardTabId;
let fixtureTabId;

function assertOwnedDataset() {
  if (fs.existsSync(path.join(dataDir, 'catalog.json')) || fs.existsSync(path.join(dataDir, 'CURRENT.json'))) {
    throw new Error(`Acceptance dataset already exists: ${dataDir}. Inspect it, then remove only that fixture dataset before a fresh run.`);
  }
}
function cli(args) {
  const output = execFileSync(node, [knowledge, ...args, '--data', dataDir, '--json'], { cwd: root, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  try { return JSON.parse(output); } catch { return output; }
}
function browserRun(args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    console.error('[acceptance] browser start:', args.join(' '));
    const child = spawn(browser, ['--session', session, '--headed', '--allowed-domains', '127.0.0.1', ...args], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      setTimeout(() => finish(new Error('agent-browser timed out after ' + timeoutMs + 'ms; stdout=' + stdout + '; stderr=' + stderr)), 1000).unref();
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => finish(new Error('agent-browser spawn failed: ' + error.message + '; stdout=' + stdout + '; stderr=' + stderr)));
    child.once('exit', (code, signal) => {
      if (timedOut || settled) return;
      const output = stdout;
      const elapsed = Date.now() - started;
      console.error('[acceptance] browser exit:', args[0], 'code=' + code, 'signal=' + signal, 'elapsedMs=' + elapsed);
      if (code !== 0) finish(new Error('agent-browser exited with code ' + code + '; signal=' + signal + '; stdout=' + output + '; stderr=' + stderr));
      else finish(null, output);
    });
  });
}
async function browserRead(...args) { heartbeatOwnedRuns(); const result = await browserRun(args); heartbeatOwnedRuns(); return result; }
async function tabIdForUrl(url) {
  const result = JSON.parse(await browserRead('tab', 'list', '--json'));
  const match = result.data?.tabs?.find((tab) => tab.url.startsWith(url));
  assert.ok(match, 'No open browser tab matches ' + url + '; tabs=' + JSON.stringify(result.data?.tabs || []));
  return match.tabId;
}
async function browserCall(...args) {
  heartbeatOwnedRuns();
  try { await browserRun(args, 20000); heartbeatOwnedRuns(); return ''; }
  catch (error) {
    let inspected = '(fresh snapshot unavailable)';
    try { inspected = await browserRead('snapshot'); } catch (snapshotError) { inspected += ' | snapshot failed: ' + snapshotError.message; }
    throw new Error('agent-browser ' + args[0] + ' command failed or timed out; inspect before any retry. Fresh snapshot: ' + inspected, { cause: error });
  }
}
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function currentDataFile(name) {
  const current = JSON.parse(fs.readFileSync(path.join(dataDir, 'CURRENT.json'), 'utf8'));
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'revisions', current.revision, name), 'utf8'));
}
async function capture(name) { const file = path.join(evidenceDir, name); await browserCall('screenshot', file); assert.ok(fs.statSync(file).size > 0); return file; }
async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function ready(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready: ${url}`);
}
function context(id, role) { return { id, role, tenantAlias: 'synthetic', environment: 'fixture', date: TEST_DATE }; }
function task(id, nodeId, kind, goal, entryPath, featureId = null) {
  return { id, key: id, nodeId, ...(featureId ? { featureId } : {}), kind, status: 'queued', goal, contextId: null, dependencies: [], depth: 1,
    completionCriteria: ['Record visible fixture state.'], entry: { url: entryPath }, attempts: 0, lastProgressAt: null };
}
function feature(id, title, area, summary, url, screenshot, action, observed) {
  return { id, title, area, summary, entry: { url }, questions: [], nextActions: [], status: 'discovered',
    steps: [{ id: 'observed', title, action, observed, screenshot }] };
}
function scenario(id, featureId, contextId, role, outcome, screenshot, action, observed) {
  return { id, featureId, contextId, goal: action, preconditions: [],
    completionCriteria: [{ id: 'result-visible', description: 'The expected synthetic result is visible.', met: true, evidenceRefs: [screenshot] }],
    steps: [{ id: 'inspect-result', action, observed, evidenceRefs: [screenshot] }], outcome,
    evidenceRefs: [screenshot], testedContext: { contextId, role, date: TEST_DATE }, lastVerifiedAt: TEST_DATE };
}

assertOwnedDataset();
fs.mkdirSync(evidenceDir, { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });
const fixture = createExplorerFixture();
const fixturePort = await freePort();
const appPort = await freePort();
let appProcess;
let fixtureListening = false;
let browserStarted = false;
const ownedRunIds = new Set();
function startOwnedRun(args) { const result = cli(args); if (result.run?.id) ownedRunIds.add(result.run.id); return result; }
function heartbeatOwnedRuns() {
  const runs = currentDataFile('runs.json');
  for (const id of ownedRunIds) {
    const run = runs.find((item) => item.id === id);
    if (!run || !['running', 'waiting_user', 'waiting_external'].includes(run.status)) continue;
    cli(['run', 'heartbeat', id, '--lease', run.leaseId, ...(run.currentTaskId ? ['--task', run.currentTaskId] : [])]);
  }
}
function stopOwnedRun(id, reason) { if (!ownedRunIds.has(id)) return; cli(['run', 'stop', id, reason]); ownedRunIds.delete(id); }
try {
  await new Promise((resolve) => fixture.listen(fixturePort, '127.0.0.1', resolve));
  fixtureListening = true;
  const browserInfo = cli(['doctor', '--browser', browser, '--json']).browserInfo;
  assert.equal(browserInfo.version, '0.39.1');
  cli(['init', '--name', 'Synthetic Acceptance Fixture', '--url', `http://127.0.0.1:${fixturePort}`]);
  const appEnv = { ...process.env, APP_EXPLORER_AGENT_BROWSER_DASHBOARD_URL: dashboardUrl };
  appProcess = spawn(node, ['server.mjs', '--data', dataDir, '--port', String(appPort)], { cwd: root, env: appEnv, stdio: 'ignore' });
  await ready(`http://127.0.0.1:${appPort}/api/state`);

  // Open the viewer before the run and before any new feature/evidence/task is applied.
  const initialDashboard = `http://127.0.0.1:${appPort}/?pollMs=1000`;
  await browserCall('open', initialDashboard);
  browserStarted = true;
  dashboardTabId = await tabIdForUrl(initialDashboard);
  await browserCall('wait', '#upstreamDashboardLink');
  let dashboardSnapshot = await browserRead('snapshot');
  assert.match(dashboardSnapshot, /Bản đồ chức năng|Feature map|Chức năng/i);
  assert.match(await browserRead('get', 'attr', '#upstreamDashboardLink', 'href'), /localhost:4848/);
  await capture('dashboard-before-work.png');

  const scopePath = path.join(dataDir, 'acceptance-scope.json');
  writeJson(scopePath, { appId: 'acceptance-fixture', role: 'member', tenantAlias: 'synthetic', environment: 'fixture', date: TEST_DATE, allowedActions: ['navigate', 'inspect', 'download synthetic export'] });
  const firstRun = startOwnedRun(['run', 'start', scopePath, '--browser', browser, '--session', 'fixture.member', '--json']);
  assert.equal(firstRun.run.currentTaskId, 'app.discover.root');
  const checkpointPath = path.join(dataDir, 'run-checkpoint.json');
  writeJson(checkpointPath, { phase: 'survey breadth', resumeAt: 'fixture workspace overview' });
  cli(['run', 'checkpoint', firstRun.run.id, checkpointPath]);
  cli(['run', 'heartbeat', firstRun.run.id, '--lease', firstRun.run.leaseId, '--task', firstRun.run.currentTaskId]);
  stopOwnedRun(firstRun.run.id, 'Simulated interruption before the fixture survey.');
  let next = cli(['next', '--json']);
  assert.equal(next.reason.code, 'interrupted');
  assert.ok(next.frontier.recoverableTaskIds.includes('app.discover.root'));
  cli(['task', 'resume', 'app.discover.root']);
  const resumedRun = startOwnedRun(['run', 'start', scopePath, '--browser', browser, '--session', 'fixture.member', '--json']);
  assert.equal(resumedRun.run.currentTaskId, 'app.discover.root');

  await browserCall('tab', 'new');
  const fixtureBaseUrl = `http://127.0.0.1:${fixturePort}/`;
  await browserCall('open', fixtureBaseUrl);
  fixtureTabId = await tabIdForUrl(fixtureBaseUrl);
  let snapshot = await browserRead('snapshot');
  for (const label of ['Projects', 'Reports', 'Settings']) assert.ok(snapshot.includes(label), `Missing breadth area ${label}`);
  await capture('fixture-breadth.png');

  await browserCall('click', '#roleViewer');
  await browserCall('click', '#openDenied');
  snapshot = await browserRead('snapshot');
  assert.match(snapshot, /Access denied/);
  assert.match(snapshot, /Viewer role/);
  const denialEvidence = await capture('expected-denial.png');
  await browserCall('click', '#goHome');
  await browserCall('click', '#startWizard');
  snapshot = await browserRead('snapshot');
  assert.match(snapshot, /Access denied/);
  assert.match(snapshot, /Viewer role/);
  const wizard_viewerEvidence = await capture('wizard-viewer-denial.png');
  await browserCall('click', '#goHome');
  await browserCall('click', '#roleMember');

  await browserCall('click', '#startWizard');
  const wizardStepEvidence = [];
  for (let step = 1; step <= 3; step++) {
    snapshot = await browserRead('snapshot');
    assert.ok(snapshot.includes(`Step ${step} of 3`), `Expected wizard step ${step}`);
    wizardStepEvidence.push(`acceptance-live/wizard-step-${step}.png`);
    await capture(`wizard-step-${step}.png`);
    await browserCall('click', '#continueWizard');
  }
  snapshot = await browserRead('snapshot');
  assert.match(snapshot, /Record created/);
  const wizardEvidence = await capture('wizard-result.png');
  await browserCall('click', '#goHome');

  await browserCall('click', '#openLogin');
  snapshot = await browserRead('snapshot');
  assert.match(snapshot, /Sign-in checkpoint \(synthetic\)/);
  assert.doesNotMatch(snapshot, /password|one.time|OTP/i);
  await browserCall('click', '#fixtureContinue');
  snapshot = await browserRead('snapshot');
  assert.match(snapshot, /Workspace ready/);
  const handoffEvidence = await capture('login-handoff-resumed.png');
  await browserCall('click', '#goHome');

  await browserCall('click', '#showDuplicate');
  snapshot = await browserRead('snapshot');
  assert.match(snapshot, /Duplicate state observed/);
  const duplicateEvidence = await capture('duplicate-state.png');
  await browserCall('click', '#goHome');

  await browserCall('click', '#openReports');
  await browserCall('click', '#prepareExport');
  await browserCall('wait', '--text', 'Download ready');
  const exportEvidence = await capture('async-export-ready.png');

  const copyEvidence = (source, name) => {
    const target = path.join(screenshotDir, name);
    fs.copyFileSync(source, target);
    return target;
  };
  const evidenceRefs = {
    breadth: 'acceptance-live/fixture-breadth.png', denial: 'acceptance-live/expected-denial.png', wizard: 'acceptance-live/wizard-result.png',
    login: 'acceptance-live/login-handoff-resumed.png', duplicate: 'acceptance-live/duplicate-state.png', export: 'acceptance-live/async-export-ready.png',
    wizard_viewer: 'acceptance-live/wizard-viewer-denial.png',
  };
  const updates = [
    feature('fixture.breadth', 'Survey application areas', 'Workspace', 'Survey visible top-level areas in the synthetic fixture.', '/', evidenceRefs.breadth, 'Inspect the workspace navigation.', 'Projects, Reports and Settings are visible.'),
    feature('fixture.permission-denial', 'Viewer access denial', 'Reports', 'Check the expected read denial for the Viewer role.', '/reports', evidenceRefs.denial, 'Open the admin report as Viewer.', 'The page shows Access denied for the Viewer role.'),
    feature('fixture.wizard', 'Create a record with the wizard', 'Projects', 'Complete the three-step synthetic record wizard.', '/projects', evidenceRefs.wizard, 'Complete all three wizard steps.', 'The final page shows Record created.'),
    feature('fixture.login-handoff', 'Resume after sign-in handoff', 'Workspace', 'Pause at a fake sign-in checkpoint and resume with a fixture identity.', '/', evidenceRefs.login, 'Continue after the synthetic checkpoint.', 'The workspace is ready after the fake identity handoff.'),
    feature('fixture.duplicate-state', 'Observe duplicate state', 'Settings', 'Inspect a duplicate synthetic state in Settings.', '/settings', evidenceRefs.duplicate, 'Open the duplicate state notice.', 'Two synthetic rows share the same label.'),
    feature('fixture.async-export', 'Download a report export', 'Reports', 'Wait for the asynchronous synthetic CSV export and verify the saved artifact.', '/reports', evidenceRefs.export, 'Prepare the CSV export.', 'Download ready is visible; artifact save remains unverified.'),
  ];
  const asyncExport = updates.find((item) => item.id === 'fixture.async-export');
  asyncExport.status = 'partial';
  asyncExport.questions = ['The browser download command canceled and no local artifact was verified.'];
  asyncExport.nextActions = [{ id: 'verify-saved-csv', goal: 'Save and inspect the synthetic CSV using a supported browser download path.', reason: 'The CLI canceled the download after an HTTP 200 response.', entryPath: '/reports' }];
  const contexts = [context('member.fixture', 'member'), context('viewer.fixture', 'viewer')];
  const wizardMemberScenario = scenario('fixture.wizard.member', 'fixture.wizard', 'member.fixture', 'member', 'success', evidenceRefs.wizard, 'Complete the three-step wizard.', 'Record created is visible.');
  const wizardStepActions = ['Choose a record type.', 'Enter the record title.', 'Review the synthetic details.'];
  wizardMemberScenario.steps = wizardStepEvidence.map((ref, index) => ({ id: `wizard.step.${index + 1}`, action: wizardStepActions[index], observed: `Wizard step ${index + 1} of 3 displayed.`, evidenceRefs: [ref] }));
  wizardMemberScenario.completionCriteria = wizardStepEvidence.map((ref, index) => ({ id: `wizard.step.${index + 1}.observed`, description: `Wizard step ${index + 1} displayed the expected prompt.`, met: true, observed: `Wizard step ${index + 1} of 3 displayed.`, evidenceRefs: [ref] }));
  const scenarios = [
    wizardMemberScenario,
    scenario('fixture.wizard.viewer', 'fixture.wizard', 'viewer.fixture', 'viewer', 'expected_denial', evidenceRefs.wizard_viewer, 'Attempt the three-step wizard as Viewer.', 'Access denied is visible for the Viewer role.'),
    scenario('fixture.denial.viewer', 'fixture.permission-denial', 'viewer.fixture', 'viewer', 'expected_denial', evidenceRefs.denial, 'Open the admin report as Viewer.', 'Access denied is visible for Viewer.'),
    scenario('fixture.login.member', 'fixture.login-handoff', 'member.fixture', 'member', 'success', evidenceRefs.login, 'Resume from a synthetic sign-in checkpoint.', 'Workspace ready is visible after the handoff.'),
    scenario('fixture.duplicate.member', 'fixture.duplicate-state', 'member.fixture', 'member', 'success', evidenceRefs.duplicate, 'Inspect the duplicate synthetic state.', 'Two fixture rows share the same label.'),
  ];
  const nodes = [
    { id: 'area.settings', kind: 'area', entryAliases: ['/settings'], discoveryState: 'unseen', taskIds: [] },
    { id: 'area.reports', kind: 'area', entryAliases: ['/reports'], discoveryState: 'unseen', taskIds: [] },
    { id: 'capability.reports', kind: 'capability', entryAliases: ['/reports'], discoveryState: 'unseen', taskIds: [] },
    { id: 'scenario.export', kind: 'scenario', entryAliases: ['/reports'], discoveryState: 'unseen', taskIds: [] },
  ];
  const frontierTasks = [
    task('task.deep.export', 'scenario.export', 'verify_scenario', 'Inspect export variations and filtering.', '/reports', 'fixture.async-export'),
    task('task.peer.settings', 'area.settings', 'discover_area', 'Survey Settings capabilities.', '/settings'),
    task('task.peer.reports', 'area.reports', 'discover_area', 'Survey Reports capabilities.', '/reports'),
  ];
  const observationPath = path.join(dataDir, 'acceptance-observation.json');
  // This observation is based on the just-completed synthetic browser inspection; retain its receipt explicitly.
  const sourceReceipt = cli(['summary']).revision;
  writeJson(observationPath, { version: 2, baseRevision: sourceReceipt, features: updates, inventory: { contexts, evidence: Object.entries(evidenceRefs).map(([id, path]) => ({ id: `evidence.${id}`, path, type: 'screenshot', redacted: true })) }, scenarios,
    frontier: { nodes, edges: [
      { from: 'root.app', to: 'area.settings', relation: 'contains' },
      { from: 'root.app', to: 'area.reports', relation: 'contains' },
      { from: 'area.reports', to: 'capability.reports', relation: 'contains' },
      { from: 'capability.reports', to: 'scenario.export', relation: 'scenario' },
    ], tasks: frontierTasks } });
  cli(['apply', observationPath]);

  // Poll the already-open dashboard. No reload command is issued here.
  await browserCall('tab', dashboardTabId);
  let liveSeen = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    dashboardSnapshot = await browserRead('snapshot');
    if (dashboardSnapshot.includes('Create a record with the wizard')) { liveSeen = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(liveSeen, 'New feature was not visible in the already-open dashboard');
  assert.match(dashboardSnapshot, /fixture\.wizard|Create a record with the wizard/);
  await capture('dashboard-live-update.png');
  await browserCall('click', '[data-view="queue"]');
  snapshot = await browserRead('snapshot');
  assert.ok(snapshot.includes('Survey Settings capabilities'));
  assert.ok(snapshot.includes('depth 1'));
  assert.ok(snapshot.includes('queued'));
  await capture('dashboard-live-queue.png');
  await browserCall('click', '[data-view="catalog"]');
  await browserCall('click', '[data-feature="fixture.async-export"]');
  const linkedFeatureSnapshot = await browserRead('snapshot');
  assert.match(linkedFeatureSnapshot, /Inspect export variations and filtering/);
  await capture('dashboard-linked-frontier-feature.png');
  await browserCall('click', '[data-view="catalog"]');
  await browserCall('click', '[data-feature="fixture.wizard"]');
  snapshot = await browserRead('snapshot');
  assert.match(snapshot, /Scenario \/ role/);
  await browserCall('select', '[data-scenario-select="fixture.wizard"]', 'fixture.wizard.viewer');
  snapshot = await browserRead('snapshot');
  assert.match(snapshot, /viewer\s*-/i);
  assert.match(snapshot, /expected_denial/i);
  await capture('dashboard-multirole-viewer.png');
  await browserCall('select', '[data-scenario-select="fixture.wizard"]', 'fixture.wizard.member');
  snapshot = await browserRead('snapshot');
  assert.match(snapshot, /member\s*-/i);
  assert.match(snapshot, /success/i);
  await browserCall('scrollintoview', '#featureDetail [data-image="acceptance-live/wizard-step-3.png"]');
  await browserCall('mouse', 'move', '1120', '700');
  await browserCall('mouse', 'wheel', '700');
  const scrollMetrics = await browserRead('eval', 'JSON.stringify({detail:document.querySelector("#featureDetail .detail-content").scrollTop,detailHeight:document.querySelector("#featureDetail .detail-content").scrollHeight,clientHeight:document.querySelector("#featureDetail .detail-content").clientHeight,window:window.scrollY})');
  console.log('[acceptance] observed scroll metrics:', scrollMetrics);
  const scrollState = JSON.parse(JSON.parse(scrollMetrics));
  assert.ok(scrollState.detail > 0 || scrollState.window > 0, 'Dashboard evidence view should scroll to the selected screenshot.');
  await browserCall('click', '#featureDetail [data-image="acceptance-live/wizard-step-3.png"]');
  snapshot = await browserRead('snapshot');
  assert.match(snapshot, /dialog/i);
  assert.match(snapshot, /Review the synthetic details/);
  await capture('dashboard-live-evidence.png');
  const visibilityHook = "window.__taskIVisibility=[];window.__taskIHeadPolls=[];document.addEventListener('visibilitychange',()=>window.__taskIVisibility.push({hidden:document.hidden,at:Date.now()}));const originalFetch=window.fetch.bind(window);window.fetch=(...args)=>{if(String(args[0]).includes('/api/head'))window.__taskIHeadPolls.push(Date.now());return originalFetch(...args);};";
  await browserCall('eval', visibilityHook);
  await browserCall('tab', 'new');
  const backgroundTab = await tabIdForUrl('about:blank');
  await browserCall('tab', backgroundTab);
  await browserCall('wait', '4500');
  await browserCall('tab', dashboardTabId);
  await browserCall('wait', '1200');
  const visibilityRaw = await browserRead('eval', 'JSON.stringify({events:window.__taskIVisibility,polls:window.__taskIHeadPolls})');
  const visibilityProof = JSON.parse(JSON.parse(visibilityRaw));
  assert.ok(visibilityProof.events.some((event) => event.hidden === true), 'Switching headed tabs must produce a browser hidden event.');
  assert.ok(visibilityProof.events.some((event) => event.hidden === false), 'Returning to the dashboard must produce a browser foreground event.');
  assert.ok(visibilityProof.polls.length >= 2, 'Observed /api/head polls must continue through hidden and foreground tabs.');
  await capture('dashboard-visibility-foreground.png');

  // Finish root via the CLI and compare the durable queue: depth 1 wins over the earlier-enqueued depth 3 task.
  writeJson(path.join(dataDir, 'root-finished.json'), {});
  cli(['task', 'finish', 'app.discover.root', path.join(dataDir, 'root-finished.json')]);
  stopOwnedRun(resumedRun.run.id, 'Root discovery task finished; this acceptance run has no further work.');
  snapshot = await browserRead('snapshot');
  assert.match(snapshot, /dialog/i);
  assert.match(snapshot, /wizard-step-3.png/);
  await capture('dashboard-lightbox-after-receipt.png');
  const knownGoodWorkspace = loadWorkspace(dataDir);
  const changedFeature = { ...knownGoodWorkspace.features.find((item) => item.id === 'fixture.breadth'), summary: 'Synthetic breadth fixture recovered to a new valid receipt.' };
  const brokenReceipt = applyObservation(dataDir, { version: 2, baseRevision: knownGoodWorkspace.revision, features: [changedFeature] });
  const brokenDataDir = path.join(dataDir, 'revisions', brokenReceipt.revision);
  fs.writeFileSync(path.join(brokenDataDir, 'features', 'fixture.breadth.json'), '{ intentionally malformed synthetic fixture record', 'utf8');
  let reconnectErrorSnapshot = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    reconnectErrorSnapshot = await browserRead('snapshot');
    if (/lỗi cập nhật|update failed|HTTP 400/i.test(reconnectErrorSnapshot)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.match(reconnectErrorSnapshot, /lỗi cập nhật|update failed|HTTP 400/i);
  assert.match(reconnectErrorSnapshot, /dialog/i);
  assert.match(reconnectErrorSnapshot, /wizard-step-3.png/);
  await capture('dashboard-reconnect-error.png');
  const recoverySnapshot = structuredClone(knownGoodWorkspace);
  recoverySnapshot.features = recoverySnapshot.features.map((item) => item.id === 'fixture.breadth' ? changedFeature : item);
  const recoveryReceipt = commitRevision(dataDir, brokenReceipt.revision, recoverySnapshot);
  let recoveredSnapshot = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    recoveredSnapshot = await browserRead('snapshot');
    if (!/lỗi cập nhật|update failed|HTTP 400/i.test(recoveredSnapshot) && recoveredSnapshot.includes('Synthetic breadth fixture recovered to a new valid receipt.')) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(recoveredSnapshot.includes('Synthetic breadth fixture recovered to a new valid receipt.'), `Dashboard did not load recovery receipt ${recoveryReceipt.revision}.`);
  assert.match(recoveredSnapshot, /dialog/i);
  assert.match(recoveredSnapshot, /wizard-step-3.png/);
  await capture('dashboard-reconnect-recovered.png');
  console.log('[acceptance] browser visibility/poll evidence:', JSON.stringify({ events: visibilityProof.events, headPolls: visibilityProof.polls, detailScrollY: scrollState.window, brokenRevision: brokenReceipt.revision, recoveredRevision: recoveryReceipt.revision }));
  await browserCall('click', '#closeLightbox');
  for (const [contextId, role, roleButton] of [['member.fixture', 'member', '#roleMember'], ['viewer.fixture', 'viewer', '#roleViewer']]) {
    next = cli(['next', '--json']);
    const contextTaskId = `context.${contextId}.discover.root`;
    assert.equal(next.task.id, contextTaskId);
    const contextScopePath = path.join(dataDir, `${role}-scope.json`);
    writeJson(contextScopePath, { appId: 'acceptance-fixture', contextId, role, tenantAlias: 'synthetic', environment: 'fixture', date: TEST_DATE, allowedActions: ['navigate', 'inspect'] });
    const contextRun = startOwnedRun(['run', 'start', contextScopePath, '--browser', browser, '--session', `fixture.${role}`, '--json']);
    assert.equal(contextRun.run.currentTaskId, contextTaskId);
    await browserCall('tab', fixtureTabId);
    let contextSnapshot = await browserRead('snapshot');
    if (contextSnapshot.includes('Return to workspace')) {
      await browserCall('click', '#goHome');
      contextSnapshot = await browserRead('snapshot');
    }
    assert.match(contextSnapshot, /Workspace overview/);
    await browserCall('click', roleButton);
    const contextFinishedPath = path.join(dataDir, `${role}-root-finished.json`);
    writeJson(contextFinishedPath, {});
    cli(['task', 'finish', contextTaskId, contextFinishedPath]);
    stopOwnedRun(contextRun.run.id, `The ${role} context root task finished.`);
  }
  next = cli(['next', '--json']);
  assert.equal(next.task.id, 'task.peer.settings');
  const settingsRun = startOwnedRun(['run', 'start', scopePath, '--browser', browser, '--session', 'fixture.member', '--json']);
  assert.equal(settingsRun.run.currentTaskId, 'task.peer.settings');
  await browserCall('tab', fixtureTabId);
  await browserCall('click', '#areaSettings');
  assert.match(await browserRead('snapshot'), /Duplicate state observed/);
  writeJson(path.join(dataDir, 'settings-finished.json'), {});
  cli(['task', 'finish', 'task.peer.settings', path.join(dataDir, 'settings-finished.json')]);
  stopOwnedRun(settingsRun.run.id, 'Settings peer task finished.');
  next = cli(['next', '--json']);
  assert.equal(next.task.id, 'task.peer.reports');
  const reportsRun = startOwnedRun(['run', 'start', scopePath, '--browser', browser, '--session', 'fixture.member', '--json']);
  assert.equal(reportsRun.run.currentTaskId, 'task.peer.reports');
  await browserCall('click', '#areaReports');
  assert.match(await browserRead('snapshot'), /Reports/);
  writeJson(path.join(dataDir, 'reports-finished.json'), {});
  cli(['task', 'finish', 'task.peer.reports', path.join(dataDir, 'reports-finished.json')]);
  stopOwnedRun(reportsRun.run.id, 'Reports peer task finished.');
  next = cli(['next', '--json']);
  assert.equal(next.task.id, 'task.deep.export');
  const beforeDeepCheck = currentDataFile('frontier.json');
  assert.ok(beforeDeepCheck.tasks.find((item) => item.id === 'task.deep.export').depth > beforeDeepCheck.tasks.find((item) => item.id === 'task.peer.settings').depth);
  const deepRun = startOwnedRun(['run', 'start', scopePath, '--browser', browser, '--session', 'fixture.member', '--json']);
  assert.equal(deepRun.run.currentTaskId, 'task.deep.export');
  await browserCall('tab', fixtureTabId);
  const deepPage = await browserRead('snapshot');
  if (deepPage.includes('Return to workspace')) await browserCall('click', '#goHome');
  await browserCall('click', '#openReports');
  await browserCall('click', '#prepareExport');
  await browserCall('wait', '--text', 'Download ready');
  await browserCall('network', 'requests', '--clear');
  const downloadPath = path.join(os.tmpdir(), `app-explorer-fixture-${process.pid}.csv`);
  let downloadFailure = '';
  try { await browserCall('download', '#exportDownload', downloadPath); } catch (error) { downloadFailure = error.message; }
  assert.match(downloadFailure, /download command failed|timed out/i, 'A canceled download must remain an explicit blocker');
  const network = await browserRead('network', 'requests');
  assert.match(network, /export\.csv/);
  assert.doesNotMatch(network, /GET[^\n]*export\.csv[^\n]*[45]\d\d/);
  assert.equal(fs.existsSync(downloadPath), false, 'Canceled download must not be recorded as a saved artifact');
  const blockPath = path.join(dataDir, 'export-blocked.json');
  writeJson(blockPath, { blocker: { type: 'browser_download_cancelled', reason: 'agent-browser reported cancellation after GET /export.csv; no local file was saved.', requiredChange: 'Use a supported browser/CLI download path and verify the saved synthetic CSV contents.' } });
  const exportCheckpointPath = path.join(dataDir, 'export-checkpoint.json');
  writeJson(exportCheckpointPath, { phase: 'download-canceled', reason: 'agent-browser canceled after HTTP 200; no local artifact was saved.', resumeAt: 'retry with a supported download path and verify the artifact' });
  cli(['run', 'checkpoint', deepRun.run.id, exportCheckpointPath]);
  cli(['task', 'block', 'task.deep.export', blockPath]);
  ownedRunIds.delete(deepRun.run.id);
  const interruptedExportRun = currentDataFile('runs.json').find((run) => run.id === deepRun.run.id);
  assert.equal(interruptedExportRun.status, 'interrupted', 'Blocked export task must leave its own run interrupted, not active.');
  cli(['check']);
  cli(['export']);
  const finalSummary = cli(['summary']);
  assert.equal(finalSummary.total, 6);
  assert.equal(finalSummary.verified, 4);
  assert.equal(finalSummary.partial, 1);
  assert.equal(finalSummary.discovered, 1);
  const persisted = currentDataFile('frontier.json');
  const deep = persisted.tasks.find((item) => item.id === 'task.deep.export');
  const shallow = persisted.tasks.find((item) => item.id === 'task.peer.settings');
  assert.ok(deep.sequence < shallow.sequence && deep.depth > shallow.depth && deep.status === 'blocked');
  next = cli(['next', '--json']);
  assert.equal(next.task, null);
  assert.equal(next.frontier.state, 'blocked');
  const finalRuns = currentDataFile('runs.json');
  assert.ok(!finalRuns.some((run) => ['running', 'waiting_user', 'waiting_external'].includes(run.status)), 'No owned run may remain active after browser/server cleanup.');
  assert.equal(finalRuns.filter((run) => run.status === 'paused').length, 6, 'The simulated interruption and five completed task runs must be paused.');
  assert.equal(finalRuns.filter((run) => run.status === 'interrupted').length, 1, 'Only the blocked export attempt run must remain interrupted.');
  assert.equal(finalRuns.find((run) => run.id === deepRun.run.id)?.status, 'interrupted');
  await browserCall('tab', dashboardTabId);
  await browserCall('click', '[data-view="queue"]');
  let blockedQueueSnapshot = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    blockedQueueSnapshot = await browserRead('snapshot');
    if (/export|download/i.test(blockedQueueSnapshot) && /blocked|b\u1ecb ch\u1eb7n/i.test(blockedQueueSnapshot)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.match(blockedQueueSnapshot, /export|download/i);
  assert.match(blockedQueueSnapshot, /blocked|b\u1ecb ch\u1eb7n/i);
  await capture('async-download-frontier-task.png');

  const published = ['dashboard-before-work.png','fixture-breadth.png','expected-denial.png','wizard-result.png','wizard-step-1.png','wizard-step-2.png','wizard-step-3.png','wizard-viewer-denial.png','login-handoff-resumed.png','duplicate-state.png','async-export-ready.png','async-download-frontier-task.png','dashboard-live-update.png','dashboard-live-queue.png','dashboard-linked-frontier-feature.png','dashboard-live-evidence.png','dashboard-multirole-viewer.png','dashboard-visibility-foreground.png','dashboard-lightbox-after-receipt.png','dashboard-reconnect-error.png','dashboard-reconnect-recovered.png'];
  for (const name of published) copyEvidence(path.join(evidenceDir, name), name);
  console.log(JSON.stringify({ browserVersion: browserInfo.version, fixtureUrl: `http://127.0.0.1:${fixturePort}`, dashboardUrl: initialDashboard,
    dataset: path.relative(root, dataDir).replaceAll('\\', '/'), finalRevision: finalSummary.revision,
    features: { total: finalSummary.total, verified: finalSummary.verified, partial: finalSummary.partial, discovered: finalSummary.discovered },
    next: { taskId: next.task?.id ?? null, frontierState: next.frontier.state, done: next.frontier.counts.done, blocked: next.frontier.counts.blocked },
    queueOrder: { deep: { id: deep.id, depth: deep.depth, sequence: deep.sequence, status: deep.status }, shallow: { id: shallow.id, depth: shallow.depth, sequence: shallow.sequence, status: shallow.status } },
    browserAcceptance: { headed: true, detailScrollY: scrollState.window, visibilityEvents: visibilityProof.events, headPolls: visibilityProof.polls,
      reconnect: { brokenRevision: brokenReceipt.revision, recoveredRevision: recoveryReceipt.revision } },
    runIds: finalRuns.map((run) => ({ id: run.id, status: run.status, currentTaskId: run.currentTaskId, heartbeatAt: run.heartbeatAt })), published }, null, 2));
} finally {
  for (const id of [...ownedRunIds]) {
    try {
      const current = fs.existsSync(path.join(dataDir, 'CURRENT.json')) ? currentDataFile('runs.json').find((run) => run.id === id) : null;
      if (current && ['running', 'waiting_user', 'waiting_external'].includes(current.status)) {
        const checkpointPath = path.join(dataDir, 'driver-finally-checkpoint.json');
        writeJson(checkpointPath, { phase: 'acceptance-driver-exit', currentTaskId: current.currentTaskId, reason: 'Driver ended before finishing this owned run; inspect before resuming.' });
        cli(['run', 'checkpoint', id, checkpointPath]);
        cli(['run', 'stop', id, 'Acceptance driver exited before finishing; checkpoint preserved for explicit recovery.']);
      }
    } catch (error) { console.error('[acceptance] best-effort run cleanup failed:', id, error.message); }
    ownedRunIds.delete(id);
  }
  if (browserStarted) { try { await browserCall('close'); } catch {} }
  if (appProcess && !appProcess.killed) appProcess.kill();
  if (fixtureListening) await new Promise((resolve) => fixture.close(resolve));
}
