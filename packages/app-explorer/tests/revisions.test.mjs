import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { applyObservation as applyObservationRaw, getFeature, loadWorkspace } from '../lib/store.mjs';

// These isolated tests construct each write from the current read receipt. Stale-write cases pass their saved receipt explicitly.
function applyObservation(dir, observation, options = {}) {
  const baseRevision = options.expectedRevision ?? observation.baseRevision ?? loadWorkspace(dir).revision;
  return applyObservationRaw(dir, { ...observation, baseRevision }, { ...options, expectedRevision: options.expectedRevision ?? baseRevision });
}
import { commitRevision, migrateWorkspace, resolveRevision } from '../lib/revisions.mjs';

function legacyWorkspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-v1-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'features'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'evidence', 'run-1'), { recursive: true });
  const feature = {
    id: 'items.create', title: 'Create item', area: 'Items', summary: 'Create an item.',
    status: 'partial', entry: { url: '/items', label: 'Items' },
    testedContext: { role: 'member', date: '2026-10-15' }, lastVerifiedAt: null,
    steps: [{ id: 'open', title: 'Open form', action: 'Click New', observed: 'Form appears', screenshot: 'run-1/open.png' }],
    questions: [], nextActions: [{ id: 'submit', goal: 'Submit item', reason: 'Outcome unknown' }],
  };
  fs.writeFileSync(path.join(dir, 'evidence', 'run-1', 'open.png'), 'evidence');
  fs.writeFileSync(path.join(dir, 'features', 'items.create.json'), JSON.stringify(feature));
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({
    app: { name: 'Example', baseUrl: 'https://example.org', description: '', demo: false },
    sourceMetadata: { legacyImport: 'preserve-me' },
    features: [{ id: feature.id, title: feature.title, area: feature.area, status: feature.status, summary: feature.summary, legacyNote: 'keep-this-too' }],
    journeys: [],
  }));
  return { dir, feature };
}

function snapshot(description = 'Example') {
  return {
    app: { name: description, baseUrl: 'https://example.org', description: '', demo: false },
    journeys: [], features: [],
  };
}

test('V1 migration preserves source data and evidence in the first immutable revision', (t) => {
  const { dir, feature } = legacyWorkspace(t);
  const receipt = migrateWorkspace(dir);
  assert.equal(resolveRevision(dir).schemaVersion, 2);
  assert.equal(receipt.revision, resolveRevision(dir).revision);
  assert.ok(fs.existsSync(receipt.catalogPath));
  assert.ok(fs.existsSync(path.join(receipt.featureDir, 'items.create.json')));
  const migratedFeature = JSON.parse(fs.readFileSync(path.join(receipt.featureDir, 'items.create.json')));
  assert.deepEqual(migratedFeature.steps, feature.steps);
  assert.deepEqual(migratedFeature.nextActions, feature.nextActions);
  assert.deepEqual(migratedFeature.scenarioIds, ['items.create.legacy']);
  assert.equal(loadWorkspace(dir).scenarios[0].migrationReview.required, true);
  assert.equal(loadWorkspace(dir).scenarios[0].outcome, 'unknown');
  assert.equal(fs.readFileSync(path.join(dir, 'evidence', 'run-1', 'open.png'), 'utf8'), 'evidence');
  const migratedCatalog = JSON.parse(fs.readFileSync(receipt.catalogPath, 'utf8'));
  assert.deepEqual(migratedCatalog.sourceMetadata, { legacyImport: 'preserve-me' });
  assert.equal(migratedCatalog.features[0].legacyNote, 'keep-this-too');
  assert.ok(fs.existsSync(path.join(dir, 'legacy-v1-backup', 'catalog.json')));
  assert.deepEqual(loadWorkspace(dir).features[0], migratedFeature);
});

test('migration repairs an interrupted partial legacy backup before committing', (t) => {
  const { dir, feature } = legacyWorkspace(t);
  fs.mkdirSync(path.join(dir, 'legacy-v1-backup'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'legacy-v1-backup', 'catalog.json'), '{partial');
  const receipt = migrateWorkspace(dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'legacy-v1-backup', 'catalog.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'legacy-v1-backup', 'features', 'items.create.json'), 'utf8')), feature);
  assert.ok(fs.existsSync(receipt.catalogPath));
});

test('a writer cannot commit against a stale revision', (t) => {
  const { dir } = legacyWorkspace(t);
  const receipt = migrateWorkspace(dir);
  const initial = loadWorkspace(dir);
  const next = { ...snapshot(initial.app.name), app: initial.app };
  commitRevision(dir, receipt.revision, next);
  assert.throws(() => commitRevision(dir, receipt.revision, next), /revision conflict/i);
});

test('a crash before CURRENT replacement leaves the old revision visible', (t) => {
  const { dir } = legacyWorkspace(t);
  const first = migrateWorkspace(dir);
  assert.throws(() => commitRevision(dir, first.revision, snapshot('new'), { crashAt: 'before-current' }), /simulated crash/i);
  assert.equal(resolveRevision(dir).revision, first.revision);
  assert.equal(loadWorkspace(dir).app.name, 'Example');
  assert.ok(fs.existsSync(path.join(dir, '.revision.lock')));
  assert.ok(fs.existsSync(path.join(dir, 'revisions', 'r000002', 'catalog.json')));
});

test('a fault after the presence fence leaves old CURRENT and retired ownership fenced', (t) => {
  const { dir } = legacyWorkspace(t);
  const first = migrateWorkspace(dir);
  let fenceRan = false;
  assert.throws(() => commitRevision(dir, first.revision, snapshot('new'), {
    crashAt: 'after-before-current', beforeCurrent: () => { fenceRan = true; },
  }), /simulated crash/i);
  assert.equal(fenceRan, true);
  assert.equal(resolveRevision(dir).revision, first.revision);
});

test('revisions hard-link unchanged files and preserve prior revision bytes', (t) => {
  const { dir } = legacyWorkspace(t);
  const first = migrateWorkspace(dir);
  const previous = resolveRevision(dir);
  const oldCatalog = fs.readFileSync(first.catalogPath);
  const data = loadWorkspace(dir);
  const changed = { ...data.features[0], summary: 'Changed summary.' };
  applyObservation(dir, { version: 2, baseRevision: first.revision, features: [changed] });
  const second = resolveRevision(dir);
  const receiptManifest = JSON.parse(fs.readFileSync(path.join(second.dataDir, 'manifest.json'), 'utf8'));
  assert.ok(receiptManifest.validation.linked.includes('runs.json'));
  assert.deepEqual(fs.readFileSync(first.catalogPath), oldCatalog);
  assert.equal(fs.statSync(path.join(previous.dataDir, 'runs.json')).ino,
    fs.statSync(path.join(second.dataDir, 'runs.json')).ino);
  assert.notEqual(fs.statSync(path.join(previous.dataDir, 'features', 'items.create.json')).ino,
    fs.statSync(path.join(second.dataDir, 'features', 'items.create.json')).ino);
});

test('copy-on-write safely copies identical files when hard links are unsupported', (t) => {
  const { dir } = legacyWorkspace(t);
  const first = migrateWorkspace(dir);
  const previous = resolveRevision(dir);
  const next = loadWorkspace(dir);
  assert.doesNotThrow(() => commitRevision(dir, first.revision, next, {
    linkFile: () => { const error = new Error('unsupported'); error.code = 'EPERM'; throw error; },
  }));
  const current = resolveRevision(dir);
  const before = path.join(previous.dataDir, 'runs.json');
  const after = path.join(current.dataDir, 'runs.json');
  assert.deepEqual(fs.readFileSync(before), fs.readFileSync(after));
  assert.notEqual(fs.statSync(before).ino, fs.statSync(after).ino);
});

test('revision manifest hashes files and exhaustive check detects tampering', async (t) => {
  const { dir } = legacyWorkspace(t);
  const first = migrateWorkspace(dir);
  const current = resolveRevision(dir);
  const manifest = JSON.parse(fs.readFileSync(path.join(current.dataDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.revision, first.revision);
  assert.equal(manifest.validationVersion, 1);
  assert.ok(manifest.validation.validated > 0);
  assert.ok(manifest.files['catalog.json']);
  assert.ok(manifest.derivedIndexes.coverage);
  const { checkWorkspace } = await import('../lib/store.mjs');
  fs.appendFileSync(first.catalogPath, ' ');
  assert.throws(() => checkWorkspace(dir), /hash|manifest|tamper/i);
  fs.truncateSync(first.catalogPath, fs.statSync(first.catalogPath).size - 1);
  const manifestFile = path.join(current.dataDir, 'manifest.json');
  const changedManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  changedManifest.derivedIndexes.coverage.value = { state: 'clear', counts: { features: 0, questions: 0, gaps: 0 }, gaps: [], scope: { contextIds: null, allContexts: true } };
  fs.writeFileSync(manifestFile, JSON.stringify(changedManifest), 'utf8');
  assert.throws(() => checkWorkspace(dir), /derived coverage index mismatch/i);
});

test('a crash after CURRENT replacement leaves the complete new revision visible', (t) => {
  const { dir } = legacyWorkspace(t);
  const first = migrateWorkspace(dir);
  assert.throws(() => commitRevision(dir, first.revision, snapshot('New app'), { crashAt: 'after-current' }), /simulated crash/i);
  const current = resolveRevision(dir);
  assert.notEqual(current.revision, first.revision);
  assert.equal(loadWorkspace(dir).app.name, 'New app');
  assert.ok(fs.existsSync(path.join(current.dataDir, 'inventory.json')));
  assert.ok(fs.existsSync(path.join(dir, '.revision.lock')));
});

test('an abandoned staging directory never becomes visible to readers', (t) => {
  const { dir } = legacyWorkspace(t);
  const receipt = migrateWorkspace(dir);
  const staging = path.join(dir, 'revisions', '.staging-abandoned');
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'catalog.json'), JSON.stringify(snapshot('Half written')));
  assert.equal(resolveRevision(dir).revision, receipt.revision);
  assert.equal(loadWorkspace(dir).app.name, 'Example');
});

test('commit refuses to publish a revision that references missing evidence', (t) => {
  const { dir } = legacyWorkspace(t);
  const first = migrateWorkspace(dir);
  const invalid = loadWorkspace(dir);
  invalid.features[0].steps[0].screenshot = 'run-1/missing.png';
  assert.throws(() => commitRevision(dir, first.revision, invalid), /Missing evidence/);
  assert.equal(resolveRevision(dir).revision, first.revision);
});

test('commit refuses duplicate feature IDs before moving CURRENT', (t) => {
  const { dir } = legacyWorkspace(t);
  const first = migrateWorkspace(dir);
  const invalid = loadWorkspace(dir);
  invalid.features.push({ ...invalid.features[0] });
  assert.throws(() => commitRevision(dir, first.revision, invalid), /duplicate feature/i);
  assert.equal(resolveRevision(dir).revision, first.revision);
});

test('lock recovery removes a dead local owner but refuses an unknown owner', (t) => {
  const { dir } = legacyWorkspace(t);
  migrateWorkspace(dir);
  const lockPath = path.join(dir, '.revision.lock');
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, hostname: os.hostname() }));
  const valid = snapshot('Recovered');
  assert.doesNotThrow(() => commitRevision(dir, resolveRevision(dir).revision, valid));
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 7, hostname: 'unknown-host-for-test' }));
  assert.throws(() => commitRevision(dir, resolveRevision(dir).revision, snapshot('Nope')), /lock.*owner|recover/i);
});

test('a writer aborts if its lock is replaced and never releases another owner lock', (t) => {
  const { dir } = legacyWorkspace(t);
  const first = migrateWorkspace(dir);
  const replacement = { pid: process.pid, hostname: os.hostname(), token: 'replacement-owner' };
  assert.throws(() => commitRevision(dir, first.revision, snapshot('Must not commit'), {
    beforeCurrent: () => fs.writeFileSync(path.join(dir, '.revision.lock'), JSON.stringify(replacement)),
  }), /lock ownership changed/i);
  assert.equal(resolveRevision(dir).revision, first.revision);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.revision.lock'), 'utf8')), replacement);
});

test('contending stale-lock recoverers serialize and only one writer commits', async (t) => {
  const { dir } = legacyWorkspace(t);
  const first = migrateWorkspace(dir);
  const dataPath = path.join(dir, 'contender-data.json');
  const scriptPath = path.join(dir, 'contender.mjs');
  const gatePath = path.join(dir, 'contender-started');
  fs.writeFileSync(dataPath, JSON.stringify(snapshot('Contended')));
  fs.writeFileSync(scriptPath, `
    import fs from 'node:fs';
    import { commitRevision } from ${JSON.stringify(pathToFileURL(path.resolve('lib/revisions.mjs')).href)};
    process.stdout.write('ready\\n');
    while (!fs.existsSync(process.argv[5])) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    try { commitRevision(process.argv[2], process.argv[3], JSON.parse(fs.readFileSync(process.argv[4], 'utf8'))); process.exitCode = 0; }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  `);
  fs.writeFileSync(path.join(dir, '.revision.lock'), JSON.stringify({ pid: 2147483647, hostname: os.hostname(), token: 'dead-owner' }));

  const run = () => {
    let signalReady;
    const ready = new Promise((resolve) => { signalReady = resolve; });
    const done = new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, dir, first.revision, dataPath, gatePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.includes('ready')) signalReady(); });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    return { ready, done };
  };
  const children = [run(), run()];
  await Promise.all(children.map((child) => child.ready));
  fs.writeFileSync(gatePath, 'go');
  const results = await Promise.all(children.map((child) => child.done));
  t.diagnostic(`Concurrent writer outcomes: ${JSON.stringify(results)}`);
  assert.equal(results.filter((result) => result.code === 0).length, 1);
  assert.equal(resolveRevision(dir).revision, 'r000002');
  const loser = results.find((result) => result.code !== 0);
  assert.ok(loser, `Expected one losing writer: ${JSON.stringify(results)}`);
  assert.match(loser.stderr, /^(Revision conflict:|Workspace revision lock owner is alive;|Could not acquire revision lock:)/,
    `Unexpected losing writer result (exit ${loser.code}): ${JSON.stringify(results)}`);
  assert.equal(fs.existsSync(path.join(dir, '.revision.lock')), false);
  assert.equal(fs.existsSync(path.join(dir, '.revision.recovery.lock')), false);
});

test('applyObservation commits a whole V2 revision and returns a revision receipt', (t) => {
  const { dir } = legacyWorkspace(t);
  migrateWorkspace(dir);
  const current = loadWorkspace(dir);
  const updated = { ...current.features[0], summary: 'Updated.' };
  const receipt = applyObservation(dir, { version: 2, features: [updated] });
  assert.ok(receipt.revision);
  assert.ok(receipt.catalogPath);
  assert.equal(loadWorkspace(dir).features[0].summary, 'Updated.');
});

test('feature get reads only the requested feature from one resolved revision', (t) => {
  const { dir, feature } = legacyWorkspace(t);
  const receipt = migrateWorkspace(dir);
  const expectedFeature = loadWorkspace(dir).features[0];
  const catalog = JSON.parse(fs.readFileSync(receipt.catalogPath, 'utf8'));
  catalog.features.push({ id: 'unrelated.feature', title: 'Broken unrelated feature', area: 'Other', status: 'partial', summary: 'Invalid JSON should not block this lookup.' });
  fs.writeFileSync(receipt.catalogPath, JSON.stringify(catalog));
  fs.writeFileSync(path.join(receipt.featureDir, 'unrelated.feature.json'), '{invalid json');
  const result = getFeature(dir, feature.id);
  assert.deepEqual(result.feature, expectedFeature);
  assert.equal(result.receipt.revision, receipt.revision);
});
