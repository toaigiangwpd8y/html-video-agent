import { effectiveHeartbeatAt } from './presence.mjs';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitRevision, migrateWorkspace as migrateToV2, resolveRevision } from './revisions.mjs';
import { deriveScenarioStatus, normalizeRun, sanitizeActivityEvent, validateActivityEvent, validateFrontier, validateRun, validateRunOwnership, validateScenario, validateScenarioFrontier, validateJourney, normalizeLegacyJourney, normalizeScenarioHistory, normalizeLegacyActivityEvent, validateGlobalExecutionIds, validateCoverageQuestion, isMeaningfulCheckpoint } from './schema.mjs';
import { enqueue, recomputeDepths, transitionTask } from './frontier.mjs';
import { normalizeQuestions, validateCoverageReferences, auditCoverage } from './coverage.mjs';
import { buildFeatureView, featureViewMarkdown } from './feature-view.mjs';
import { readJsonValue, writeJsonUtf8, sha256 } from './json-io.mjs';
import { readRevisionManifest, verifyRevisionHashes } from './workspace-reader.mjs';

export const STATUSES = ['discovered', 'partial', 'verified', 'blocked'];
export const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEMO_PATH = path.resolve(PACKAGE_DIR, '../examples/demo-knowledge');
const asText = (value) => typeof value === 'string' ? value.trim() : '';

function fail(message) { throw new Error(message); }
function assert(test, message) { if (!test) fail(message); }
export function workspacePath(arg) {
  const configured = arg || process.env.KNOWLEDGE_DIR;
  if (!configured) throw new Error('Choose a workspace with --data <path> or KNOWLEDGE_DIR. Example data is never selected automatically.');
  return path.resolve(configured);
}
export function readJson(file) { return readJsonValue(file); }
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeJsonUtf8(temporary, value);
  fs.renameSync(temporary, file);
}
export function assetPath(dir, relative) {
  assert(typeof relative === 'string' && relative.length > 0, 'Evidence path is missing');
  const segments = relative.replaceAll('\\', '/').split('/');
  assert(segments.every((s) => s && s !== '.' && s !== '..' && !s.startsWith('.')), `Unsafe evidence path: ${relative}`);
  const allowed = /\.(png|jpe?g|webp|txt|json)$/i;
  assert(allowed.test(relative), `Evidence must be PNG/JPG/WebP/TXT/JSON: ${relative}`);
  const root = path.resolve(dir, 'evidence');
  const target = path.resolve(root, ...segments);
  assert(target.startsWith(root + path.sep), `Evidence must stay within workspace: ${relative}`);
  // Reject symlink traversal even for an otherwise valid relative path.
  let current = root;
  if (fs.existsSync(root)) assert(!fs.lstatSync(root).isSymbolicLink(), 'Evidence directory is a symlink');
  for (const segment of segments) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), `Evidence symlink not allowed: ${relative}`);
  }
  return target;
}
export function validateFeature(feature, dir, requireEvidence = true) {
  assert(feature && typeof feature === 'object' && !Array.isArray(feature), 'Feature must be an object');
  assert(SAFE_ID.test(feature.id || ''), `Invalid feature ID: ${feature.id}`);
  assert(asText(feature.title), `Missing title in ${feature.id}`);
  assert(asText(feature.area), `Missing area in ${feature.id}`);
  assert(asText(feature.summary), `Missing summary in ${feature.id}`);
  assert(STATUSES.includes(feature.status), `Invalid status in ${feature.id}`);
  assert(!feature.entry || (typeof feature.entry === 'object' && !Array.isArray(feature.entry)), `Invalid entry in ${feature.id}`);
  assert(Array.isArray(feature.steps), `steps must be an array in ${feature.id}`);
  assert(Array.isArray(feature.nextActions), `nextActions must be an array in ${feature.id}`);
  assert(Array.isArray(feature.questions), `questions must be an array in ${feature.id}`);
  if (feature.research != null) validateFeatureResearch(feature.research, feature.id);
  if (feature.coverageExclusion != null) {
    assert(feature.coverageExclusion && typeof feature.coverageExclusion === 'object' && !Array.isArray(feature.coverageExclusion) &&
      asText(feature.coverageExclusion.reason) && (feature.coverageExclusion.contextId === null || SAFE_ID.test(feature.coverageExclusion.contextId || '')),
      `Invalid coverageExclusion in ${feature.id}`);
  }
  let observedEvidence = false;
  const usedStepIds = new Set();
  feature.steps.forEach((step, index) => {
    assert(step && SAFE_ID.test(step.id || '') && !usedStepIds.has(step.id), `Invalid/duplicate step id in ${feature.id}: ${index}`);
    usedStepIds.add(step.id);
    assert(asText(step.title) && asText(step.action), `Missing step title/action in ${feature.id}`);
    assert(typeof step.observed === 'string', `Missing observed field in ${feature.id}`);
    for (const key of ['screenshot', 'snapshot']) {
      if (step[key]) {
        const filename = assetPath(dir, step[key]);
        if (requireEvidence) assert(fs.existsSync(filename) && fs.statSync(filename).isFile(), `Missing evidence: ${step[key]}`);
        if (asText(step.observed)) observedEvidence = true;
      }
    }
  });
  const usedTasks = new Set();
  feature.nextActions.forEach((task) => {
    assert(task && SAFE_ID.test(task.id || '') && !usedTasks.has(task.id), `Invalid/duplicate next action ID in ${feature.id}`);
    usedTasks.add(task.id);
    assert(asText(task.goal) && asText(task.reason), `Incomplete next action in ${feature.id}`);
  });
  feature.questions.forEach((question) => validateCoverageQuestion(question, feature.id));
  if (feature.status === 'verified') {
    const hasScenarioEvidence = Array.isArray(feature.scenarioIds) && feature.scenarioIds.length > 0;
    if (!hasScenarioEvidence) {
      assert(observedEvidence, `Verified feature needs observed evidence: ${feature.id}`);
      assert(asText(feature.testedContext?.role) && asText(feature.testedContext?.date), `Verified feature needs testedContext.role/date: ${feature.id}`);
    }
  }
  return true;
}

function validateFeatureResearch(research, featureId) {
  const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
  assert(research && typeof research === 'object' && !Array.isArray(research), `Invalid research metadata in ${featureId}`);
  assert(Array.isArray(research.sourceCandidates) && Array.isArray(research.controls), `Research metadata needs sourceCandidates and controls in ${featureId}`);
  const candidateIds = new Set();
  for (const candidate of research.sourceCandidates) {
    assert(candidate && typeof candidate === 'object' && !Array.isArray(candidate) && SAFE_ID.test(candidate.id || '') && !candidateIds.has(candidate.id), `Invalid/duplicate source candidate in ${featureId}`);
    candidateIds.add(candidate.id);
    assert(SAFE_ID.test(candidate.sourceAlias || ''), `Source candidate ${candidate.id} needs an explicit sourceAlias`);
    assert(nonempty(candidate.relativePath), `Source candidate ${candidate.id} needs relativePath`);
    const pathParts = candidate.relativePath.replaceAll('\\', '/').split('/');
    assert(!path.isAbsolute(candidate.relativePath) && !/^[a-z]:/i.test(candidate.relativePath) && pathParts.every((part) => part && part !== '.' && part !== '..' && !part.startsWith('.')), `Unsafe source candidate relativePath in ${candidate.id}`);
    assert(candidate.status === 'candidate' && nonempty(candidate.note), `Source candidate ${candidate.id} must remain a noted candidate`);
    if (candidate.lineStart != null) assert(Number.isInteger(candidate.lineStart) && candidate.lineStart > 0, `Invalid lineStart in source candidate ${candidate.id}`);
    if (candidate.lineEnd != null) assert(Number.isInteger(candidate.lineEnd) && candidate.lineEnd > 0 && (candidate.lineStart == null || candidate.lineEnd >= candidate.lineStart), `Invalid lineEnd in source candidate ${candidate.id}`);
  }
  const controlIds = new Set();
  for (const control of research.controls) {
    assert(control && typeof control === 'object' && !Array.isArray(control) && SAFE_ID.test(control.id || '') && !controlIds.has(control.id), `Invalid/duplicate research control in ${featureId}`);
    controlIds.add(control.id);
    assert(nonempty(control.label) && SAFE_ID.test(control.contextId || ''), `Invalid label/context in research control ${control.id}`);
    assert(['tested', 'not_tested', 'blocked'].includes(control.status), `Invalid status in research control ${control.id}`);
    for (const key of ['scenarioId', 'questionId']) if (control[key] != null) assert(SAFE_ID.test(control[key]), `Invalid ${key} in research control ${control.id}`);
    assert(Array.isArray(control.evidenceRefs) && control.evidenceRefs.every(nonempty), `Invalid evidenceRefs in research control ${control.id}`);
    if (control.status === 'tested') assert(nonempty(control.scenarioId) && control.evidenceRefs.length > 0, `Tested control ${control.id} needs an observed scenario and evidence`);
    else assert(nonempty(control.questionId), `Untested or blocked control ${control.id} needs an open question`);
  }
}
export function loadWorkspace(dir) {
  const resolved = resolveRevision(dir);
  const dataDir = resolved.dataDir;
  const index = readJson(path.join(dataDir, 'catalog.json'));
  assert(index && index.app && Array.isArray(index.features) && Array.isArray(index.journeys), 'Invalid catalog.json');
  const journeys = index.journeys.map(normalizeLegacyJourney);
  const features = index.features.map((entry) => {
    assert(SAFE_ID.test(entry.id || ''), 'Invalid index feature id');
    const feature = readJson(path.join(dataDir, 'features', `${entry.id}.json`));
    validateFeature(feature, dir);
    assert(feature.id === entry.id, 'Index/feature ID mismatch');
    if (resolved.schemaVersion === 2) feature.questions = normalizeQuestions(feature);
    return feature;
  });
  const extras = Object.fromEntries(['inventory', 'frontier', 'runs', 'activity'].map((key) => {
    const file = path.join(dataDir, `${key}.json`);
    return [key, fs.existsSync(file) ? readJson(file) : {}];
  }));
  if (!Array.isArray(extras.runs)) extras.runs = [];
  if (!Array.isArray(extras.activity)) extras.activity = [];
  extras.activity = extras.activity.map(normalizeLegacyActivityEvent);
  if (Array.isArray(extras.runs)) extras.runs = extras.runs.map((run) => {
    const normalized = normalizeRun(run);
    Object.defineProperty(normalized, 'effectiveHeartbeatAt', { value: effectiveHeartbeatAt(dir, normalized), enumerable: false });
    return normalized;
  });
  const scenarios = (extras.inventory.scenarios || []).map(normalizeScenarioHistory);
  extras.inventory.scenarios = scenarios;
  if (resolved.schemaVersion === 2) {
    for (const scenario of scenarios) validateScenario(scenario, dir);
    validateGlobalExecutionIds(scenarios);
    const featureIds = new Set(features.map((feature) => feature.id));
    for (const scenario of scenarios) assert(featureIds.has(scenario.featureId), `Unknown feature in scenario ${scenario.id}: ${scenario.featureId}`);
    for (const journey of journeys) validateJourney(journey, { featureIds: [...featureIds], executionIds: scenarios.flatMap((item) => (item.history || []).map((execution) => execution.executionId)), contextIds: (extras.inventory.contexts || []).map((item) => item.id), dir });
    validateFrontier(extras.frontier, extras.inventory.contexts || []);
    validateScenarioFrontier(scenarios, extras.frontier, extras.inventory.contexts || []);
    if (Array.isArray(extras.runs)) {
      for (const run of extras.runs) validateRun(run);
      validateRunOwnership(extras.runs, extras.frontier || {});
    }
    if (Array.isArray(extras.activity)) for (const event of extras.activity) validateActivityEvent(event, dir);
    validateCoverageReferences({ features, frontier: extras.frontier, contexts: extras.inventory.contexts || [], scenarios: extras.inventory.scenarios || [] }, dir);
  }
  return { app: index.app, journeys, features, catalog: index,
    ...extras, scenarios, contexts: extras.inventory.contexts || [],
    evidence: extras.inventory.evidence || [], schemaVersion: resolved.schemaVersion, revision: resolved.revision, dataDir };
}
export function getFeature(dir, id) {
  const resolved = resolveRevision(dir);
  const catalogPath = path.join(resolved.dataDir, 'catalog.json');
  const index = readJson(catalogPath);
  assert(index && Array.isArray(index.features), 'Invalid catalog.json');
  assert(SAFE_ID.test(id || ''), `Invalid feature ID: ${id}`);
  assert(index.features.some((entry) => entry.id === id), `Unknown feature: ${id}`);
  const feature = readJson(path.join(resolved.dataDir, 'features', `${id}.json`));
  if (resolved.schemaVersion === 2) feature.questions = normalizeQuestions(feature);
  validateFeature(feature, dir);
  assert(feature.id === id, 'Index/feature ID mismatch');
  const result = { receipt: { schemaVersion: resolved.schemaVersion, revision: resolved.revision,
    catalogPath, featureDir: path.join(resolved.dataDir, 'features') }, feature };
  if (resolved.schemaVersion !== 2) return result;

  // Keep targeted reads targeted: a caller resuming one capability should not
  // need to validate or load every feature record in the inventory.
  const inventoryPath = path.join(resolved.dataDir, 'inventory.json');
  const frontierPath = path.join(resolved.dataDir, 'frontier.json');
  const inventory = fs.existsSync(inventoryPath) ? readJson(inventoryPath) : {};
  const frontier = fs.existsSync(frontierPath) ? readJson(frontierPath) : {};
  validateCoverageReferences({ features: [feature], frontier, contexts: inventory.contexts || [], scenarios: inventory.scenarios || [] }, dir);
  const scenarios = (inventory.scenarios || []).filter((scenario) => scenario.featureId === id);
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  const openTasks = (frontier.tasks || []).filter((task) =>
    !['done', 'skipped'].includes(task.status) &&
    (task.featureId === id || task.nodeId === id || scenarioIds.has(task.scenarioId)));
  const contextIds = new Set([
    ...scenarios.map((scenario) => scenario.contextId),
    ...openTasks.map((task) => task.contextId),
  ].filter(Boolean));
  return { ...result, scenarios, contexts: (inventory.contexts || []).filter((context) => contextIds.has(context.id)), openTasks };
}
export function summary(data) {
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const item of data.features) counts[item.status]++;
  return { total: data.features.length, ...counts,
    tasks: tasks(data).length,
    journeys: data.journeys.length,
    ...(data.schemaVersion === 2 ? { coverage: auditCoverage(data).counts } : {}) };
}
export function tasks(data) {
  if (data.schemaVersion === 2) {
    const byId = new Map(data.features.map((feature) => [feature.id, feature]));
    const scenarioFeatures = new Map((data.scenarios || []).map((scenario) => [scenario.id, scenario.featureId]));
    const nodeById = new Map((data.frontier?.nodes || []).map((node) => [node.id, node]));
    const contextById = new Map((data.contexts || data.inventory?.contexts || []).map((context) => [context.id, context]));
    return (data.frontier?.tasks || []).filter((task) => !['done', 'skipped'].includes(task.status))
      .sort((a, b) => a.depth - b.depth || a.sequence - b.sequence)
      .map((task) => {
        const featureId = task.featureId || scenarioFeatures.get(task.scenarioId) || null;
        const feature = featureId ? byId.get(featureId) : null;
        const context = task.contextId ? contextById.get(task.contextId) : null;
        return { ...task, featureId, featureTitle: feature?.title || '', area: feature?.area || nodeById.get(task.nodeId)?.kind || '',
          contextRole: context?.role || '', entryPath: task.entry?.url || '',
          reason: task.blocker?.reason || task.stopReason || task.kind + ' \u00b7 depth ' + task.depth + ' \u00b7 sequence ' + task.sequence };
      });
  }
  const rank = { blocked: 3, partial: 0, discovered: 1, verified: 2 };
  return data.features.flatMap(feature => feature.nextActions.map(task => ({
    ...task, featureId: feature.id, featureTitle: feature.title,
    area: feature.area, status: feature.status,
    entryPath: task.entryPath || feature.entry?.url || '',
  }))).sort((a,b) => rank[a.status] - rank[b.status] || a.featureTitle.localeCompare(b.featureTitle));
}
export function initWorkspace(dir, name, url) {
  if (fs.existsSync(path.join(dir, 'catalog.json')) || fs.existsSync(path.join(dir, 'CURRENT.json'))) fail(`Workspace already exists: ${dir}. Choose a new --data directory.`);
  assert(asText(name), 'Missing --name');
  assert(/^https?:\/\//i.test(url || ''), 'URL must start with http:// or https://');
  fs.mkdirSync(path.join(dir, 'features'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
  atomicJson(path.join(dir, 'catalog.json'), {
    app: { name, baseUrl: url, description: '', demo: false }, features: [], journeys: []
  });
  migrateToV2(dir);
  return dir;
}
function upsertById(oldItems, updates, label) {
  assert(Array.isArray(updates), `${label} must be an array`);
  const items = new Map(oldItems.map((item) => [item.id, item]));
  const seen = new Set();
  for (const item of updates) {
    assert(item && SAFE_ID.test(item.id || '') && !seen.has(item.id), `Invalid/duplicate ${label} ID: ${item?.id}`);
    seen.add(item.id);
    items.set(item.id, item);
  }
  return [...items.values()];
}

function executionSnapshot(scenario, executionIdFactory) {
  const { history, ...execution } = scenario;
  const executionId = executionIdFactory ? executionIdFactory(scenario.id) : scenario.id + '.execution-' + randomUUID().replaceAll('-', '');
  return { ...structuredClone(execution), scenarioId: scenario.id, executionId };
}

function mergeFrontier(oldFrontier, observation) {
  const incoming = observation.frontier || {};
  let nodes = upsertById(oldFrontier.nodes || [], incoming.nodes || [], 'frontier node');
  const oldNodes = new Map((oldFrontier.nodes || []).map((node) => [node.id, node]));
  nodes = nodes.map((node) => {
    const previous = oldNodes.get(node.id);
    return previous ? { ...previous, ...node,
      entryAliases: [...new Set([...(previous.entryAliases || []), ...(node.entryAliases || [])])],
      taskIds: [...new Set([...(previous.taskIds || []), ...(node.taskIds || [])])],
    } : node;
  });
  let edges = oldFrontier.edges || [];
  if (incoming.edges) {
    const keyed = (edge) => `${edge.from}->${edge.to}:${edge.relation}`;
    const map = new Map(edges.map((edge) => [keyed(edge), edge]));
    for (const edge of incoming.edges) map.set(keyed(edge), edge);
    edges = [...map.values()];
  }
  for (const transition of observation.frontierTransitions || []) {
    const node = nodes.find((item) => item.id === transition.nodeId);
    assert(node, `Unknown frontier transition node: ${transition.nodeId}`);
    const { nodeId, ...changes } = transition;
    nodes = nodes.map((item) => item.id === nodeId ? { ...item, ...changes } : item);
  }
  let frontier = { ...oldFrontier, ...incoming, nodes, edges, tasks: (oldFrontier.tasks || []).map((task) => ({ ...task })) };
  const seen = new Set();
  for (const proposed of incoming.tasks || []) {
    assert(proposed && SAFE_ID.test(proposed.id || '') && !seen.has(proposed.id), `Invalid/duplicate frontier task ID: ${proposed?.id}`);
    seen.add(proposed.id);
    const previous = frontier.tasks.find((task) => task.id === proposed.id);
    if (!previous) {
      frontier = enqueue(frontier, proposed);
      continue;
    }
    const changes = { ...proposed, sequence: previous.sequence };
    if (previous.status !== 'queued' && proposed.status === 'queued') {
      frontier = transitionTask(frontier, proposed.id, { ...changes, continuation: true });
    } else {
      frontier.tasks = frontier.tasks.map((task) => task.id === proposed.id ? { ...task, ...changes } : task);
    }
  }
  const taskIds = new Set(frontier.tasks.map((task) => task.id));
  frontier.nodes = frontier.nodes.map((node) => ({ ...node, taskIds: [...new Set(node.taskIds.filter((id) => taskIds.has(id))) ] }));
  return recomputeDepths(frontier);
}

function mergeRecords(oldItems, updates, label) {
  const items = Array.isArray(oldItems) ? oldItems : [];
  return upsertById(items, updates || [], label);
}

function applyObservationV2(dir, old, observation, options) {
  const files = new Map(old.features.map((feature) => [feature.id, feature]));
  const featureUpdates = observation.features || [];
  assert(Array.isArray(featureUpdates), 'V2 features must be an array');
  for (const metadata of featureUpdates) {
    assert(metadata && SAFE_ID.test(metadata.id || ''), `Invalid feature metadata ID: ${metadata?.id}`);
    const previous = files.get(metadata.id) || { ...metadata, steps: [], questions: [], nextActions: [], status: 'discovered' };
    files.set(metadata.id, { ...previous, ...metadata,
      steps: metadata.steps || previous.steps || [], questions: normalizeQuestions({ id: metadata.id, questions: metadata.questions || previous.questions || [] }),
      nextActions: metadata.nextActions || previous.nextActions || [] });
  }

  const inventory = { ...old.inventory };
  for (const key of ['contexts', 'evidence', 'tasks']) {
    if (observation.inventory?.[key]) inventory[key] = mergeRecords(inventory[key], observation.inventory[key], `inventory ${key}`);
  }
  let scenarios = old.scenarios.map((scenario) => structuredClone(scenario));
  const scenarioMap = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const scenarioUpdates = observation.scenarios || [];
  assert(Array.isArray(scenarioUpdates), 'V2 scenarios must be an array');
  const seenScenarios = new Set();
  for (const proposed of scenarioUpdates) {
    validateScenario(proposed, dir);
    assert(!seenScenarios.has(proposed.id), `Duplicate scenario in observation: ${proposed.id}`);
    seenScenarios.add(proposed.id);
    assert(files.has(proposed.featureId) || featureUpdates.some((f) => f.id === proposed.featureId), `Unknown feature in scenario ${proposed.id}: ${proposed.featureId}`);
    const previous = scenarioMap.get(proposed.id);
    const history = previous ? [...(previous.history || []), executionSnapshot(proposed, options.executionIdFactory)] : [executionSnapshot(proposed, options.executionIdFactory)];
    scenarioMap.set(proposed.id, { ...proposed, history });
  }
  scenarios = [...scenarioMap.values()];
  validateGlobalExecutionIds(scenarios);

  let frontier = mergeFrontier(old.frontier || {}, observation);
  const oldContextIds = new Set((old.inventory.contexts || []).map((context) => context.id));
  for (const context of observation.inventory?.contexts || []) if (!oldContextIds.has(context.id)) {
    const nodeId = `root.${context.id}`;
    if (frontier.tasks.some((task) => task.contextId === context.id && task.nodeId === nodeId && !['done', 'skipped'].includes(task.status))) continue;
    frontier = enqueue(frontier, {
      id: `context.${context.id}.discover.root`, key: `${context.id}.root.discover`, nodeId, nodeKind: 'root', contextId: context.id,
      kind: 'discover_area', parentTaskId: null, depth: 0, status: 'queued', dependencies: [],
      goal: `Discover application areas in the authorized ${context.role} context.`,
      completionCriteria: ['Record visible application areas and any access blockers.'], entry: { url: old.app.baseUrl },
      checkpoint: null, blocker: null, attempts: 0, lastProgressAt: null,
    });
  }
  validateFrontier(frontier, inventory.contexts || []);
  validateScenarioFrontier(scenarios, frontier, inventory.contexts || []);
  for (const scenario of scenarios) assert(files.has(scenario.featureId), `Unknown feature in scenario ${scenario.id}: ${scenario.featureId}`);

  const taskByScenario = new Map();
  for (const task of frontier.tasks) if (task.scenarioId && !['done', 'skipped'].includes(task.status)) {
    taskByScenario.set(task.scenarioId, [...(taskByScenario.get(task.scenarioId) || []), task.id]);
  }
  const scenariosByFeature = new Map();
  for (const scenario of scenarios) scenariosByFeature.set(scenario.featureId, [...(scenariosByFeature.get(scenario.featureId) || []), scenario]);
  for (const [featureId, feature] of files) {
    const related = scenariosByFeature.get(featureId) || [];
    const counts = { total: related.length, discovered: 0, partial: 0, verified: 0, blocked: 0 };
    for (const scenario of related) {
      const scenarioStatus = deriveScenarioStatus(scenario);
      const scenarioBlocked = scenarioStatus === 'discovered' && frontier.tasks.some((task) => task.scenarioId === scenario.id && task.status === 'blocked');
      counts[scenarioBlocked ? 'blocked' : scenarioStatus]++;
    }
    const directlyLinked = frontier.tasks.filter((task) => (task.featureId === featureId || task.nodeId === featureId) && !['done', 'skipped'].includes(task.status)).map((task) => task.id);
    const openTasks = [...new Set([...related.flatMap((scenario) => taskByScenario.get(scenario.id) || []), ...directlyLinked])];
    const derivedStatus = counts.verified ? 'verified' : counts.partial ? 'partial' : counts.blocked ? 'blocked' : 'discovered';
    const status = related.length ? derivedStatus : feature.status === 'verified' ? 'discovered' : feature.status;
    const updated = { ...feature, status, scenarioIds: related.map((scenario) => scenario.id), scenarioCounts: counts, openTasks };
    validateFeature(updated, dir);
    files.set(featureId, updated);
  }

  const runs = mergeRecords(old.runs || [], observation.runs || [], 'run').map(normalizeRun);
  for (const run of runs) validateRun(run);
  validateRunOwnership(runs, frontier);
  const existingEventIds = new Set((Array.isArray(old.activity) ? old.activity : []).map((event) => event.id));
  const incomingEventIds = new Set();
  const safeIncomingEvents = (observation.events || []).map(sanitizeActivityEvent);
  for (const event of safeIncomingEvents) if (event.type === 'run_checkpointed' && event.checkpointRecorded === true) {
    const run = (observation.runs || []).find((item) => item.id === event.runId);
    assert(run && isMeaningfulCheckpoint(run.checkpoint), 'run_checkpointed requires a non-empty checkpoint in the same revision');
  }
  const events = safeIncomingEvents.filter((event) => {
    if (existingEventIds.has(event.id) || incomingEventIds.has(event.id)) return false;
    incomingEventIds.add(event.id);
    return true;
  });
  const activity = [...(Array.isArray(old.activity) ? old.activity : []), ...events];
  let journeys = old.journeys;
  if (observation.journeys) {
    assert(Array.isArray(observation.journeys), 'journeys must be an array');
    const map = new Map(journeys.map((journey) => [journey.id, journey]));
    for (const rawJourney of observation.journeys) {
      const journey = normalizeLegacyJourney(rawJourney);
      validateJourney(journey, { featureIds: [...files.keys()], executionIds: scenarios.flatMap((item) => (item.history || []).map((execution) => execution.executionId)), contextIds: (inventory.contexts || []).map((item) => item.id), dir });
      map.set(journey.id, journey);
    }
    journeys = [...map.values()];
  }
  const app = observation.app ? { ...old.app, ...observation.app } : old.app;
  assert(asText(app.name) && asText(app.baseUrl), 'App name and URL required');
  inventory.scenarios = scenarios;
  validateCoverageReferences({ features: [...files.values()], frontier, contexts: inventory.contexts || [], scenarios }, dir);
  if (options.expectedRevision != null && observation.baseRevision != null) assert(options.expectedRevision === observation.baseRevision, 'expectedRevision conflicts with observation.baseRevision');
  const expectedRevision = options.expectedRevision ?? observation.baseRevision;
  assert(typeof expectedRevision === 'string' && /^r\d{6,}$/.test(expectedRevision), 'V2 apply requires expectedRevision or observation.baseRevision from the source receipt');
  assert(expectedRevision === old.revision, `Revision conflict: expected ${expectedRevision}, found ${old.revision}`);
  const snapshot = { app, journeys, features: [...files.values()], catalog: old.catalog, inventory, frontier, runs, activity };
  const receipt = commitRevision(dir, expectedRevision, snapshot, {
    prepareData: (revision, candidate) => ({ ...candidate, activity: candidate.activity.map((event) => incomingEventIds.has(event.id) && !existingEventIds.has(event.id) ? { ...event, revision } : event) }),
    beforeCurrent: options.beforeCurrent,
    crashAt: options.crashAt,
  });
  return { ...receipt, upserted: featureUpdates.length + scenarioUpdates.length,
    ...summary({ features: [...files.values()], journeys }) };
}

export function applyObservation(dir, observation, options = {}) {
  assert(observation && typeof observation === 'object' && !Array.isArray(observation), 'Observation must be object');
  const old = loadWorkspace(dir);
  assert(old.schemaVersion === 2, 'V1 workspace must be explicitly migrated before writing');
  if (observation.version === 2) return applyObservationV2(dir, old, observation, options);
  fail('V2 workspace requires version: 2 observations; add the V2 envelope and use ID-based scenario/frontier upserts.');
}

export function migrateWorkspace(dir) { return migrateToV2(dir); }
function mdEscape(input) { return String(input || '').replaceAll('|', '\\|').replaceAll('\n', ' '); }
export function exportDocs(dir, { force = false, check = false } = {}) {
  const data = loadWorkspace(dir);
  const docsRoot = path.join(dir, 'docs');
  if (!check) fs.mkdirSync(path.join(docsRoot, 'features'), {recursive: true});
  const exportStats = { changed: 0, skipped: 0 };
  const lines = [`# ${data.app.name}`, '', data.app.description || 'Application exploration knowledge base', '',
    `**Application:** ${data.app.baseUrl}`, '',
    `**Coverage:** ${summary(data).verified} verified / ${data.features.length} discovered features (not total app coverage).`, '',
    '## Features', '', '| Area | Feature | Status |', '| --- | --- | --- |'];
  for (const f of data.features) {
    lines.push(`| ${mdEscape(f.area)} | [${mdEscape(f.title)}](features/${f.id}.md) | ${f.status} |`);
    const detail = featureViewMarkdown(buildFeatureView(data, f.id));
    const output = path.join(docsRoot, 'features', `${f.id}.md`);
    if (!check && (force || !fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== detail)) {
      fs.writeFileSync(output, detail, 'utf8');
      exportStats.changed++;
    } else exportStats.skipped++;
  }
  if (data.journeys.length) {
    lines.push('', '## Journeys', '');
    for (const journey of data.journeys) {
      lines.push('### ' + journey.title, '', '**Outcome:** ' + (journey.outcome || 'unknown'), '');
      if (journey.testedContext) lines.push('**Tested context:** ' + journey.testedContext.role + ' - ' + journey.testedContext.contextId + ' - ' + journey.testedContext.date, '');
      if (journey.completionCriteria?.length) lines.push('**Completion criteria:**', '', ...journey.completionCriteria.map((c) => '- ' + (typeof c === 'string' ? c : c.description + (c.observed ? ' - observed: ' + c.observed : ''))), '');
      const linkedExecutionIds = new Set([...journey.scenarioRunIds, ...journey.nodes.map((node) => node.scenarioRunId).filter(Boolean)]);
      const linkedExecutions = data.scenarios.flatMap((definition) => (definition.history || []).map((execution) => ({ ...execution, definition }))).filter((execution) => linkedExecutionIds.has(execution.executionId));
      if (linkedExecutions.length) { lines.push('**Linked scenario executions:**', ''); for (const execution of linkedExecutions) { lines.push('- Execution ' + execution.executionId + ': ' + (execution.outcome || 'unknown') + ' - scenario ' + execution.definition.id); if (execution.testedContext) lines.push('  - Context: ' + execution.testedContext.role + ' - ' + execution.testedContext.contextId + ' - ' + execution.testedContext.date); for (const ref of execution.evidenceRefs || []) lines.push('  - Execution evidence: [' + ref + '](../evidence/' + ref + ')'); } lines.push(''); }

      if (journey.evidenceRefs?.length) lines.push('**Journey evidence:**', '', ...journey.evidenceRefs.map((ref) => '- [' + ref + '](../evidence/' + ref + ')'), '');
      const nodes = new Map(journey.nodes.map((node) => [node.id, node]));
      lines.push('**Walkthrough:**', '');
      for (const node of journey.nodes) {
        lines.push('- **' + node.title + '** (' + node.type + ')' + (node.contextId ? ' - context ' + node.contextId : '') + (node.role ? ' - role ' + node.role : '') + (node.outcome ? ' - outcome ' + node.outcome : ''));
        if (node.action) lines.push('  - Action: ' + node.action);
        if (node.preconditions?.length) lines.push('  - Preconditions: ' + node.preconditions.join('; '));
        if (node.expectedResult) lines.push('  - Expected result: ' + node.expectedResult);
        if (node.observed) lines.push('  - Observed result: ' + node.observed);
        if (node.completionCriteria?.length) lines.push('  - Completion: ' + node.completionCriteria.join('; '));
        if (node.outputs && Object.keys(node.outputs).length) lines.push('  - Outputs (aliases): ' + Object.entries(node.outputs).map(([key, value]) => key + '=' + value).join(', '));
        if (node.blocker?.reason) lines.push('  - Blocker: ' + node.blocker.reason);
        for (const ref of node.beforeEvidenceRefs || []) lines.push('  - Before: [' + ref + '](../evidence/' + ref + ')');
        for (const ref of node.evidenceRefs || []) lines.push('  - Evidence: [' + ref + '](../evidence/' + ref + ')');
        for (const ref of node.afterEvidenceRefs || []) lines.push('  - After: [' + ref + '](../evidence/' + ref + ')');
        const branches = journey.edges.filter((edge) => edge.from === node.id);
        if (branches.length) for (const edge of branches) lines.push('  - Branch [' + edge.condition + '] -> **' + nodes.get(edge.to).title + '**' + ((edge.outcome || 'unknown') === 'unknown' ? ' - unknown / not observed' : ' - ' + edge.outcome) + (edge.contextSwitch ? ' - handoff ' + edge.contextSwitch.from + ' -> ' + edge.contextSwitch.to + ' (' + edge.contextSwitch.role + ')' : ''));
        else lines.push('  - No outgoing branch recorded (unknown / end of walkthrough).');
      }
      lines.push('');
    }
  }
  const readme = path.join(docsRoot, 'README.md');
  const readmeContent = lines.join('\n') + '\n';
  if (!check && (force || !fs.existsSync(readme) || fs.readFileSync(readme, 'utf8') !== readmeContent)) {
    fs.writeFileSync(readme, readmeContent, 'utf8');
    exportStats.changed++;
  } else exportStats.skipped++;
  let checkedLinks = 0;
  if (check) {
    for (const file of [readme, ...data.features.map((f) => path.join(docsRoot, 'features', `${f.id}.md`))]) {
      if (!fs.existsSync(file)) fail(`Missing generated Markdown file: ${path.relative(docsRoot, file)}`);
      const content = fs.readFileSync(file, 'utf8');
      for (const [, href] of content.matchAll(/\]\(([^)]+)\)/g)) {
        if (/^[a-z]+:\/\//i.test(href)) continue;
        const target = path.resolve(path.dirname(file), decodeURIComponent(href.split('#')[0]));
        if (!fs.existsSync(target)) fail(`Missing generated Markdown link target: ${href}`);
        checkedLinks++;
      }
    }
  }
  return { readmePath: readme, ...exportStats, checkedLinks };
}
export function checkWorkspace(dir) {
  const data = loadWorkspace(dir);
  const resolved = resolveRevision(dir);
  if (resolved.schemaVersion === 2) {
    const manifest = readRevisionManifest(resolved.dataDir, resolved.revision);
    if (manifest) {
      verifyRevisionHashes(resolved.dataDir, manifest);
      const indexed = manifest.derivedIndexes?.coverage;
      if (!indexed || indexed.revision !== resolved.revision || sha256(indexed.value) !== sha256(auditCoverage(data))) {
        fail(`Derived coverage index mismatch for revision ${resolved.revision}`);
      }
      for (const file of ['catalog.json', 'inventory.json', 'frontier.json']) {
        if (indexed.sourceHashes?.[file] !== manifest.files[file]) fail(`Derived coverage index source mismatch: ${file}`);
      }
    }
  }
  const known = new Set(data.features.map(f => f.id));
  const ids = new Set();
  for (const f of data.features) {
    if (ids.has(f.id)) fail(`Duplicate feature: ${f.id}`);
    ids.add(f.id);
  }
  for (const j of data.journeys) validateJourney(j, { featureIds: [...known], executionIds: data.scenarios.flatMap((item) => (item.history || []).map((execution) => execution.executionId)), contextIds: data.contexts.map((item) => item.id), dir });
  return summary(data);
}
