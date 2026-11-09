import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

function countIo() {
  const counters = { reads: 0, writes: 0, directoryReads: 0, renames: 0, bytesRead: 0, bytesWritten: 0 };
  const originals = {};
  const wrap = (name, fn) => {
    originals[name] = fs[name];
    fs[name] = function (...args) { return fn.call(this, originals[name], ...args); };
  };
  wrap('readFileSync', (original, file, ...args) => {
    const value = original.call(fs, file, ...args);
    counters.reads++;
    counters.bytesRead += Buffer.isBuffer(value) ? value.length : Buffer.byteLength(String(value));
    return value;
  });
  wrap('writeFileSync', (original, file, value, ...args) => {
    counters.writes++;
    counters.bytesWritten += Buffer.isBuffer(value) ? value.length : Buffer.byteLength(String(value));
    return original.call(fs, file, value, ...args);
  });
  wrap('readdirSync', (original, ...args) => { counters.directoryReads++; return original.call(fs, ...args); });
  wrap('renameSync', (original, ...args) => { counters.renames++; return original.call(fs, ...args); });
  return { counters, stop() { for (const [name, method] of Object.entries(originals)) fs[name] = method; } };
}

export async function measureIo(action) {
  const io = countIo();
  const started = performance.now();
  try {
    const value = await action();
    const durationMs = performance.now() - started;
    return { value, durationMs, operations: { reads: io.counters.reads + io.counters.directoryReads, fileReads: io.counters.reads,
      directoryReads: io.counters.directoryReads, writes: io.counters.writes, renames: io.counters.renames },
      bytes: { read: io.counters.bytesRead, written: io.counters.bytesWritten } };
  } finally { io.stop(); }
}

function scenario(featureId, contextId, ordinal) {
  return { id: `${featureId}.scenario-${String(ordinal).padStart(3, '0')}`, featureId, contextId,
    goal: `Synthetic scenario ${ordinal}`, preconditions: [], completionCriteria: [], steps: [], outcome: 'unknown', evidenceRefs: [] };
}

export async function benchmarkWorkspace({ repoDir, outputDir, features, scenariosPerFeature, samples }) {
  if (!repoDir || !outputDir) throw new Error('repoDir and outputDir are required');
  for (const [key, value] of Object.entries({ features, scenariosPerFeature, samples })) {
    if (!Number.isInteger(value) || value < (key === 'features' ? 1 : 0)) throw new Error(`${key} must be an integer in range`);
  }
  const absoluteRepo = path.resolve(repoDir);
  const absoluteOutput = path.resolve(outputDir);
  if (fs.existsSync(absoluteOutput)) throw new Error(`outputDir already exists: ${absoluteOutput}`);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  const importModule = async (relative) => import(pathToFileURL(path.join(absoluteRepo, relative)).href);
  const store = await importModule('lib/store.mjs');
  const runs = await importModule('lib/runs.mjs');
  let presenceModule = null;
  try { presenceModule = await importModule('lib/presence.mjs'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  const serverModule = await importModule('server.mjs');
  fs.mkdirSync(absoluteOutput, { recursive: true });
  store.initWorkspace(absoluteOutput, 'Synthetic benchmark', 'https://synthetic.invalid');
  const contextId = 'context.synthetic';
  const featureRows = Array.from({ length: features }, (_, index) => {
    const suffix = String(index + 1).padStart(5, '0');
    return { id: `feature.${suffix}`, title: `Synthetic feature ${index + 1}`, area: 'Synthetic', summary: `Synthetic benchmark feature ${index + 1}.`,
      status: 'discovered', entry: { url: `/synthetic/${index + 1}` }, steps: [], questions: [], nextActions: [] };
  });
  const scenarios = featureRows.flatMap((feature) => Array.from({ length: scenariosPerFeature }, (_, index) => scenario(feature.id, contextId, index + 1)));
  let workspace = store.loadWorkspace(absoluteOutput);
  const taskRows = scenarios.map((item, index) => ({ id: `${item.id}.task`, key: `${item.id}.task`, nodeId: item.featureId, featureId: item.featureId, scenarioId: item.id, contextId, kind: 'verify_scenario', status: 'queued', dependencies: [], goal: `Inspect ${item.goal}`, depth: 1, sequence: index, completionCriteria: ['Record synthetic scenario outcome'], entry: {}, attempts: 0, lastProgressAt: null }));
  store.applyObservation(absoluteOutput, { version: 2, baseRevision: workspace.revision, features: featureRows,
    inventory: { contexts: [{ id: contextId, role: 'synthetic', tenantAlias: 'synthetic', environment: 'benchmark', date: '2026-10-16' }] }, scenarios,
    frontier: { nodes: featureRows.map((feature) => ({ id: feature.id, kind: 'capability', discoveryState: 'scanned', entryAliases: [feature.entry.url], taskIds: [] })), tasks: taskRows } });

  const records = (name, result) => ({ samples: result, rawTimingsMs: result.map((item) => item.durationMs),
    operationCounts: result.map((item) => item.operations), bytes: result.map((item) => item.bytes),
    revisions: result.map((item) => ({ before: item.revisionBefore ?? null, after: item.revisionAfter ?? null })) });
  const measurements = {};
  const workRead = [];
  for (let index = 0; index < samples; index++) {
    const result = await measureIo(() => {
      const data = store.loadWorkspace(absoluteOutput);
      const detail = store.getFeature(absoluteOutput, featureRows[index % featureRows.length].id);
      return { loaded: data.features.length, targeted: detail.feature.id, revision: data.revision };
    });
    workRead.push({ ...result, revisionBefore: result.value.revision, revisionAfter: result.value.revision });
  }
  measurements.workRead = records('workRead', workRead);

  const scope = { role: 'synthetic', date: '2026-10-16', contextId };
  const startedRun = runs.startRun(absoluteOutput, scope, null, { id: 'run.benchmark', now: '2026-10-16T00:00:00.000Z' });
  const heartbeat = [];
  for (let index = 0; index < samples; index++) {
    const before = store.loadWorkspace(absoluteOutput).revision;
    const result = await measureIo(() => runs.heartbeatRun(absoluteOutput, startedRun.run.id,
      { leaseId: startedRun.run.leaseId, taskId: startedRun.run.currentTaskId, now: new Date(Date.parse('2026-10-16T00:00:00.000Z') + (index + 1) * 1000), expectedRevision: before }));
    heartbeat.push({ ...result, revisionBefore: before, revisionAfter: result.value.revision || result.value.receipt?.revision || store.loadWorkspace(absoluteOutput).revision });
  }
  measurements.heartbeat = records('heartbeat', heartbeat);
  if (typeof presenceModule?.readPresence === 'function') {
    const presenceRead = [];
    for (let index = 0; index < samples; index++) {
      presenceRead.push(await measureIo(() => presenceModule.readPresence(absoluteOutput, startedRun.run)));
    }
    measurements.presenceRead = records('presenceRead', presenceRead);
  }

  const apply = [];
  for (let index = 0; index < samples; index++) {
    const before = store.loadWorkspace(absoluteOutput).revision;
    const feature = { ...featureRows[index % featureRows.length], summary: `Synthetic benchmark update ${index + 1}.` };
    const result = await measureIo(() => store.applyObservation(absoluteOutput,
      { version: 2, baseRevision: before, features: [feature] }, { expectedRevision: before }));
    apply.push({ ...result, revisionBefore: before, revisionAfter: result.value.revision });
  }
  measurements.apply = records('apply', apply);

  const app = serverModule.createServer({ dataDir: absoluteOutput, staticDir: path.join(absoluteRepo, 'public') });
  await new Promise((resolve, reject) => { app.once('error', reject); app.listen(0, '127.0.0.1', resolve); });
  const address = app.address();
  let coldPoll;
  const warmPoll = [];
  try {
    coldPoll = await measureIo(async () => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/state`);
      if (!response.ok) throw new Error(`Cold HTTP poll failed: ${response.status}`);
      return response.json();
    });
    coldPoll.revisionBefore = coldPoll.value.revision;
    coldPoll.revisionAfter = coldPoll.value.revision;
    for (let index = 0; index < samples; index++) {
      warmPoll.push(await measureIo(async () => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/state`);
        if (!response.ok) throw new Error(`Warm HTTP poll failed: ${response.status}`);
        return response.json();
      }));
      const revision = warmPoll.at(-1).value.revision;
      warmPoll.at(-1).revisionBefore = revision;
      warmPoll.at(-1).revisionAfter = revision;
    }
  } finally { await new Promise((resolve) => app.close(resolve)); }
  measurements.httpPollCold = records('httpPollCold', [coldPoll]);
  measurements.httpPollWarm = records('httpPollWarm', warmPoll);
  measurements.httpPoll = records('httpPoll', warmPoll);

  const exports = [];
  for (let index = 0; index < samples; index++) {
    const before = store.loadWorkspace(absoluteOutput).revision;
    const result = await measureIo(() => store.exportDocs(absoluteOutput));
    exports.push({ ...result, revisionBefore: before, revisionAfter: store.loadWorkspace(absoluteOutput).revision });
  }
  measurements.export = records('export', exports);

  measurements.presence = typeof presenceModule?.readPresence === 'function'
    ? { available: true, method: 'readPresence', note: 'Dedicated runtime presence reads are measured separately from knowledge bundle reads.' }
    : { available: false, note: 'Dedicated presence-read API unavailable in this repository revision; legacy read-bundle fallback is represented by workRead. No zero-time or zero-operation claim is made.' };
  const final = store.loadWorkspace(absoluteOutput);
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), repoDir: absoluteRepo,
    parameters: { features, scenariosPerFeature, samples }, dataset: { features: final.features.length, scenarios: final.scenarios.length,
      contexts: final.contexts.length, journeys: final.journeys.length }, environment: { node: process.version, platform: process.platform,
      architecture: process.arch, osRelease: os.release(), cpus: os.cpus().length }, measurements, finalRevision: final.revision,
    outputDir: absoluteOutput };
}

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    const key = argv[i].slice(2);
    if (!['repo-dir', 'output-dir', 'features', 'scenarios-per-feature', 'samples'].includes(key)) throw new Error(`Unknown option: --${key}`);
    values[key] = argv[++i];
    if (!values[key] || values[key].startsWith('--')) throw new Error(`Missing value for --${key}`);
  }
  const required = ['repo-dir', 'output-dir', 'features', 'scenarios-per-feature', 'samples'];
  for (const key of required) if (!(key in values)) throw new Error(`Required option: --${key}`);
  return { repoDir: path.resolve(values['repo-dir']), outputDir: path.resolve(values['output-dir']),
    features: Number(values.features), scenariosPerFeature: Number(values['scenarios-per-feature']), samples: Number(values.samples) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = await benchmarkWorkspace(parseArgs(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
