import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadWorkspace, SAFE_ID, validateFeature } from './store.mjs';
import { migrateLegacyKnowledge, validateActivityEvent, validateFrontier, validateRun, validateRunOwnership, validateScenario, validateScenarioFrontier, validateJourney, validateGlobalExecutionIds } from './schema.mjs';
import { readJsonValue, writeJsonUtf8 } from './json-io.mjs';
import { auditCoverage } from './coverage.mjs';
import { VALIDATION_VERSION, revisionFiles } from './workspace-reader.mjs';
import { sha256 } from './json-io.mjs';

const SCHEMA_VERSION = 2;
const FILES = ['inventory.json', 'frontier.json', 'runs.json', 'activity.json'];
const fail = (message) => { throw new Error(message); };

function readJson(file) { return readJsonValue(file); }
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${randomUUID()}`;
  writeJsonUtf8(temporary, value);
  fs.renameSync(temporary, file);
}
function currentPath(dir) { return path.join(dir, 'CURRENT.json'); }
function revisionName(number) { return `r${String(number).padStart(6, '0')}`; }
function lockPath(dir) { return path.join(dir, '.revision.lock'); }
function recoveryLockPath(dir) { return path.join(dir, '.revision.recovery.lock'); }

export function resolveRevision(dir) {
  const pointer = currentPath(dir);
  if (!fs.existsSync(pointer)) {
    if (fs.existsSync(path.join(dir, 'catalog.json'))) {
      return { schemaVersion: 1, revision: null, dataDir: path.resolve(dir) };
    }
    fail(`Workspace has no CURRENT.json or V1 catalog.json: ${dir}`);
  }
  let current;
  try { current = readJson(pointer); } catch (error) { fail(`Invalid CURRENT.json: ${error.message}`); }
  if (current?.schemaVersion !== SCHEMA_VERSION || !/^r\d{6,}$/.test(current.revision || '')) {
    fail('Invalid CURRENT.json schemaVersion or revision');
  }
  const dataDir = path.resolve(dir, 'revisions', current.revision);
  if (!dataDir.startsWith(path.resolve(dir, 'revisions') + path.sep) || !fs.existsSync(path.join(dataDir, 'catalog.json'))) {
    fail(`CURRENT.json points to an incomplete revision: ${current.revision}`);
  }
  return { schemaVersion: current.schemaVersion, revision: current.revision, dataDir };
}

function ownerStatus(owner) {
  if (!owner || typeof owner.pid !== 'number' || !Number.isInteger(owner.pid) || owner.pid < 1 || typeof owner.hostname !== 'string') return 'unknown';
  if (owner.hostname !== os.hostname()) return 'unknown';
  try { process.kill(owner.pid, 0); return 'alive'; }
  catch (error) { return error.code === 'ESRCH' ? 'dead' : 'unknown'; }
}

function readLock(lock) {
  const raw = fs.readFileSync(lock);
  return { raw: raw.toString('utf8'), owner: JSON.parse(raw.toString('utf8')) };
}

function createExclusiveLock(file, payload, description) {
  const token = randomUUID();
  // Publish complete owner metadata atomically. open('wx') followed by write lets a competing
  // synchronous reader mistake the brief empty-file interval for a crashed owner.
  const temporary = `${file}.tmp-${token}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ ...payload, token }), { flag: 'wx' });
    try { fs.linkSync(temporary, file); }
    catch (error) {
      if (error.code === 'EEXIST') return null;
      throw error;
    }
  } finally { try { fs.unlinkSync(temporary); } catch {} }
  const release = () => {
    let current;
    try { current = readLock(file).owner; }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (current.token !== token) fail(`${description} ownership changed; manual recovery required: ${file}`);
    fs.unlinkSync(file);
  };
  return { token, release };
}

function recoverStaleLock(dir, observed) {
  const guard = createExclusiveLock(recoveryLockPath(dir), {
    pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(),
  }, 'Revision recovery lock');
  if (!guard) return false;
  try {
    let latest;
    try { latest = readLock(lockPath(dir)); }
    catch (error) {
      if (error.code === 'ENOENT') return true;
      fail(`Workspace revision lock is unreadable; manual recovery required: ${lockPath(dir)}`);
    }
    if (latest.raw !== observed.raw) return false;
    const status = ownerStatus(latest.owner);
    if (status !== 'dead') fail(`Workspace revision lock owner is ${status}; manual recovery required: ${lockPath(dir)}`);
    fs.unlinkSync(lockPath(dir));
    return true;
  } finally { guard.release(); }
}

function acquireLock(dir) {
  const lock = lockPath(dir);
  fs.mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    const acquired = createExclusiveLock(lock, {
      pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(),
    }, 'Revision lock');
    if (acquired) return acquired;
    let observed;
    try { observed = readLock(lock); } catch { fail(`Workspace revision lock is unreadable; manual recovery required: ${lock}`); }
    const status = ownerStatus(observed.owner);
    if (status === 'alive') fail(`Workspace revision lock owner is alive; retry later: ${lock}`);
    if (status !== 'dead') fail(`Workspace revision lock owner is ${status}; manual recovery required: ${lock}`);
    recoverStaleLock(dir, observed);
  }
  fail(`Could not acquire revision lock: ${lock}`);
}

function assertOwnLock(dir, lock) {
  let owner;
  try { owner = readLock(lockPath(dir)).owner; }
  catch { fail(`Revision lock ownership was lost; manual recovery required: ${lockPath(dir)}`); }
  if (owner.token !== lock.token) fail(`Revision lock ownership changed; manual recovery required: ${lockPath(dir)}`);
}

function nextRevision(dir) {
  const revisions = path.join(dir, 'revisions');
  let max = 0;
  if (fs.existsSync(revisions)) {
    for (const name of fs.readdirSync(revisions)) {
      const match = /^r(\d{6,})$/.exec(name);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return revisionName(max + 1);
}

function writeRevisionFile(file, value, priorFile, options = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (priorFile && fs.existsSync(priorFile) && fs.readFileSync(priorFile).equals(bytes)) {
    try {
      (options.linkFile || fs.linkSync)(priorFile, file);
      return 'linked';
    } catch (error) {
      if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK'].includes(error.code)) throw error;
      fs.copyFileSync(priorFile, file);
      return 'copied';
    }
  }
  fs.writeFileSync(file, bytes);
  return 'written';
}

function writeRevision(staging, data, workspaceDir, revision, previousDir, options = {}) {
  if (!data || typeof data !== 'object' || !data.app || !Array.isArray(data.features) || !Array.isArray(data.journeys)) {
    fail('Revision data requires app, features, and journeys');
  }
  const oldEntries = new Map((data.catalog?.features || []).map((item) => [item.id, item]));
  const catalog = {
    ...(data.catalog || {}),
    app: data.app,
    journeys: data.journeys,
    features: data.features.map((feature) => ({ ...(oldEntries.get(feature.id) || {}),
      id: feature.id, title: feature.title, area: feature.area,
      status: feature.status, summary: feature.summary, updatedAt: feature.updatedAt || '',
    })).sort((a, b) => a.area.localeCompare(b.area) || a.title.localeCompare(b.title)),
  };
  if (!catalog.app.name || !catalog.app.baseUrl) fail('App name and URL required');
  fs.mkdirSync(path.join(staging, 'features'), { recursive: true });
  const fileChanges = { changed: [], linked: [], copied: [] };
  const put = (relative, value) => {
    const result = writeRevisionFile(path.join(staging, relative), value, previousDir && path.join(previousDir, relative), options);
    if (result === 'linked') fileChanges.linked.push(relative);
    else if (result === 'copied') fileChanges.copied.push(relative);
    else fileChanges.changed.push(relative);
  };
  const seenFeatureIds = new Set();
  for (const feature of data.features) {
    validateFeature(feature, workspaceDir);
    if (seenFeatureIds.has(feature.id)) fail(`Duplicate feature ID in revision: ${feature.id}`);
    seenFeatureIds.add(feature.id);
    put(path.posix.join('features', `${feature.id}.json`), feature);
  }
  put('catalog.json', catalog);
  for (const file of FILES) {
    const key = file.slice(0, -5);
    put(file, data[key] ?? {});
  }
  const scenarios = data.inventory?.scenarios || [];
  for (const scenario of scenarios) validateScenario(scenario, workspaceDir);
  validateGlobalExecutionIds(scenarios);
  for (const journey of data.journeys) validateJourney(journey, { featureIds: data.features.map((item) => item.id), executionIds: scenarios.flatMap((item) => (item.history || []).map((execution) => execution.executionId)), contextIds: (data.inventory?.contexts || []).map((item) => item.id), dir: workspaceDir });
  validateFrontier(data.frontier || {}, data.inventory?.contexts || []);
  validateScenarioFrontier(scenarios, data.frontier || {}, data.inventory?.contexts || []);
  if (Array.isArray(data.runs)) {
    for (const run of data.runs) validateRun(run);
    validateRunOwnership(data.runs, data.frontier || {});
  }
  if (Array.isArray(data.activity)) for (const event of data.activity) validateActivityEvent(event, workspaceDir);
  // Read the staged representation back before it can become the committed pointer.
  const reread = readJson(path.join(staging, 'catalog.json'));
  if (reread.features.length !== data.features.length) fail('Staged catalog validation failed');
  for (const entry of reread.features) {
    const feature = readJson(path.join(staging, 'features', `${entry.id}.json`));
    if (feature.id !== entry.id) fail(`Staged feature mismatch: ${entry.id}`);
    validateFeature(feature, workspaceDir);
  }
  const fileHashes = Object.fromEntries(revisionFiles(staging).map((relative) =>
    [relative, sha256(fs.readFileSync(path.join(staging, relative)))]));
  const coverage = auditCoverage({ features: data.features, frontier: data.frontier || {}, contexts: data.inventory?.contexts || [], scenarios, inventory: data.inventory || {} });
  writeJsonUtf8(path.join(staging, 'manifest.json'), {
    version: 1, revision, validationVersion: VALIDATION_VERSION, files: fileHashes,
    validation: { validated: fileHashes ? Object.keys(fileHashes).length : 0, changed: fileChanges.changed, linked: fileChanges.linked, copied: fileChanges.copied },
    derivedIndexes: { coverage: { revision, sourceHashes: Object.fromEntries(['catalog.json', 'inventory.json', 'frontier.json'].map((file) => [file, fileHashes[file]])), value: coverage } },
  });
  return { validated: Object.keys(fileHashes).length, changed: fileChanges.changed,
    linked: fileChanges.linked, copied: fileChanges.copied };
}

/**
 * Commit a knowledge revision. options.beforeCurrent runs under .revision.lock after staging
 * validation and immediately before CURRENT replacement; use it for effective-presence fences.
 */
export function commitRevision(dir, expectedRevision, data, options = {}) {
  const root = path.resolve(dir);
  const lock = acquireLock(root);
  let staging;
  let interrupted = false;
  try {
    const actual = resolveRevision(root).revision;
    if (actual !== expectedRevision) fail(`Revision conflict: expected ${expectedRevision ?? '(none)'}, found ${actual ?? '(none)'}`);
    const revision = nextRevision(root);
    const revisions = path.join(root, 'revisions');
    fs.mkdirSync(revisions, { recursive: true });
    staging = path.join(revisions, `.staging-${randomUUID()}`);
    fs.mkdirSync(staging);
    const candidate = options.prepareData ? options.prepareData(revision, data) : data;
    const previousDir = actual ? path.join(root, 'revisions', actual) : null;
    const validation = writeRevision(staging, candidate, root, revision, previousDir, options);
    const destination = path.join(revisions, revision);
    fs.renameSync(staging, destination);
    staging = undefined;
    if (options.crashAt === 'before-current') {
      interrupted = true;
      fail('Simulated crash before CURRENT replacement');
    }
    options.beforeCurrent?.();
    if (options.crashAt === 'after-before-current') {
      interrupted = true;
      fail('Simulated crash after beforeCurrent guard and before CURRENT replacement');
    }
    assertOwnLock(root, lock);
    atomicJson(currentPath(root), { schemaVersion: SCHEMA_VERSION, revision });
    const receipt = { schemaVersion: SCHEMA_VERSION, revision,
      catalogPath: path.join(destination, 'catalog.json'), featureDir: path.join(destination, 'features'), validation };
    if (options.crashAt === 'after-current') {
      interrupted = true;
      fail('Simulated crash after CURRENT replacement');
    }
    return receipt;
  } finally {
    if (!interrupted) {
      if (staging && fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      lock.release();
    }
  }
}

export function migrateWorkspace(dir) {
  const root = path.resolve(dir);
  const current = resolveRevision(root);
  if (current.schemaVersion === SCHEMA_VERSION) {
    return { schemaVersion: current.schemaVersion, revision: current.revision,
      catalogPath: path.join(current.dataDir, 'catalog.json'), featureDir: path.join(current.dataDir, 'features') };
  }
  const data = migrateLegacyKnowledge(loadWorkspace(root));
  ensureLegacyBackup(root);
  return commitRevision(root, null, data);
}

function sameTree(source, copy) {
  if (!fs.existsSync(source) || !fs.existsSync(copy)) return false;
  const sourceStat = fs.statSync(source);
  const copyStat = fs.statSync(copy);
  if (sourceStat.isDirectory() !== copyStat.isDirectory()) return false;
  if (!sourceStat.isDirectory()) return fs.readFileSync(source).equals(fs.readFileSync(copy));
  const left = fs.readdirSync(source).sort();
  const right = fs.readdirSync(copy).sort();
  return left.length === right.length && left.every((name, index) => name === right[index] && sameTree(path.join(source, name), path.join(copy, name)));
}

function ensureLegacyBackup(root) {
  const backup = path.join(root, 'legacy-v1-backup');
  const sourceCatalog = path.join(root, 'catalog.json');
  const sourceFeatures = path.join(root, 'features');
  if (sameTree(sourceCatalog, path.join(backup, 'catalog.json')) && sameTree(sourceFeatures, path.join(backup, 'features'))) return;

  const staging = path.join(root, `.legacy-v1-backup-staging-${randomUUID()}`);
  try {
    fs.mkdirSync(staging);
    fs.copyFileSync(sourceCatalog, path.join(staging, 'catalog.json'));
    fs.cpSync(sourceFeatures, path.join(staging, 'features'), { recursive: true });
    if (!sameTree(sourceCatalog, path.join(staging, 'catalog.json')) || !sameTree(sourceFeatures, path.join(staging, 'features'))) {
      fail('Legacy V1 backup verification failed');
    }
    if (fs.existsSync(backup)) {
      fs.renameSync(backup, path.join(root, `.legacy-v1-backup-incomplete-${randomUUID()}`));
    }
    fs.renameSync(staging, backup);
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  }
}

const workspaceLockQueues = new Map();

async function acquireLockAsync(dir, timeoutMs = 30_000) {
  const started = Date.now();
  let unreadableSince = null;
  const lock = lockPath(dir);
  fs.mkdirSync(dir, { recursive: true });
  for (;;) {
    const acquired = createExclusiveLock(lock, {
      pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(),
    }, 'Revision lock');
    if (acquired) return acquired;
    let observed;
    try { observed = readLock(lock); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      if (error instanceof SyntaxError) {
        // A competing process can see the exclusive file between open('wx') and its JSON write.
        // Allow a short initialization window; persistent malformed contents remain fenced.
        unreadableSince ??= Date.now();
        if (Date.now() - unreadableSince < 500) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          continue;
        }
      }
      fail(`Workspace revision lock is unreadable; manual recovery required: ${lock}`);
    }
    unreadableSince = null;
    if (ownerStatus(observed.owner) === 'dead') {
      const recovered = recoverStaleLock(dir, observed);
      if (!recovered) {
        const remaining = timeoutMs - (Date.now() - started);
        if (remaining <= 0) fail(`Timed out waiting for workspace revision lock: ${lock}`);
        await new Promise((resolve) => setTimeout(resolve, Math.min(20, remaining)));
      }
      continue;
    }
    if (Date.now() - started >= timeoutMs) fail(`Timed out waiting for workspace revision lock: ${lock}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Run a sync or async callback under the same fence as knowledge commits; returns its result as a Promise.
 * timeoutMs bounds filesystem lock acquisition only; time queued behind another same-process callback is excluded.
 * Waits up to 30 seconds for live or unknown owners, recovering only confirmed dead local owners.
 * Do not call commitRevision from inside the callback: the lock is nonreentrant.
 */
export async function withWorkspaceLock(dir, callback, { timeoutMs = 30_000 } = {}) {
  if (typeof callback !== 'function') throw new TypeError('Workspace lock callback must be a function.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new TypeError('Workspace lock timeoutMs must be a non-negative finite number.');
  const root = path.resolve(dir);
  const previous = workspaceLockQueues.get(root) || Promise.resolve();
  let releaseQueue;
  const queued = new Promise((resolve) => { releaseQueue = resolve; });
  const queueTail = previous.then(() => queued);
  workspaceLockQueues.set(root, queueTail);
  await previous;
  let lock;
  try {
    lock = await acquireLockAsync(root, timeoutMs);
    return await callback();
  } finally {
    try { lock?.release(); }
    finally {
      releaseQueue();
      if (workspaceLockQueues.get(root) === queueTail) workspaceLockQueues.delete(root);
    }
  }
}
