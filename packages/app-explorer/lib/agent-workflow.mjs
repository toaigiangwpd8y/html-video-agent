import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveRevision } from './revisions.mjs';
import { readJsonObject, readJsonValue, ensureEvidenceDirectory, sha256 } from './json-io.mjs';
import { deriveRunState, selectNextUnowned } from './runs.mjs';
import { auditCoverage } from './coverage.mjs';
import { compatibilityLeaseId, effectiveHeartbeatAt } from './presence.mjs';
import { readIndexedCoverage } from './workspace-reader.mjs';

const readMaybe = (file, fallback = {}) => {
  if (!fs.existsSync(file)) return fallback;
  const value = readJsonValue(file);
  if (!value || typeof value !== 'object') throw new Error(`Expected a JSON object or array in ${file}.`);
  return value;
};

export function getWorkPacket(dir, { contextId, runId } = {}) {
  const resolved = resolveRevision(dir);
  const index = readJsonObject(path.join(resolved.dataDir, 'catalog.json'));
  const inventory = readMaybe(path.join(resolved.dataDir, 'inventory.json'));
  const frontier = readMaybe(path.join(resolved.dataDir, 'frontier.json'));
  const runsData = readMaybe(path.join(resolved.dataDir, 'runs.json'), []);
  const runs = Array.isArray(runsData) ? runsData : [];
  const contexts = inventory.contexts || [];
  const run = runId ? runs.find((item) => item.id === runId) : null;
  if (runId && !run) throw new Error(`Unknown run: ${runId}`);
  if (contextId && run?.scope?.contextId && contextId !== run.scope.contextId) throw new Error(`Context ${contextId} does not match run scope ${run.scope.contextId}.`);
  const scopedContextId = contextId || run?.scope?.contextId || null;
  const scopedContexts = scopedContextId ? contexts.filter((context) => context.id === scopedContextId) : contexts;
  if (scopedContextId && !scopedContexts.length) throw new Error(`Unknown context: ${scopedContextId}`);
  const task = run?.currentTaskId
    ? (frontier.tasks || []).find((item) => item.id === run.currentTaskId) || null
    : selectNextUnowned(frontier, scopedContexts, new Date().toISOString(), runs, { contexts, inventory });
  const targetRun = run || (task ? runs.find((item) => item.currentTaskId === task.id) : null);
  const scenario = task?.scenarioId ? (inventory.scenarios || []).find((item) => item.id === task.scenarioId) || null : null;
  const candidateFeatureId = task?.featureId || scenario?.featureId || null;
  const featureId = candidateFeatureId || (task?.nodeId && index.features.some((item) => item.id === task.nodeId) ? task.nodeId : null);
  const featureEntry = index.features.find((item) => item.id === featureId);
  const feature = featureEntry ? readJsonObject(path.join(resolved.dataDir, 'features', `${featureId}.json`)) : null;
  const linkedContextId = task?.contextId || scenario?.contextId || scopedContextId;
  const context = linkedContextId ? contexts.find((item) => item.id === linkedContextId) || null : null;
  const linkedScenarios = feature ? (inventory.scenarios || []).filter((item) => item.featureId === feature.id) : (scenario ? [scenario] : []);
  const linkedContextIds = new Set([context?.id, ...linkedScenarios.map((item) => item.contextId)].filter(Boolean));
  const linked = { feature, scenario, context, task, scenarios: linkedScenarios,
    contexts: contexts.filter((item) => linkedContextIds.has(item.id)) };
  const summary = { app: index.app, total: index.features.length, featureId: feature?.id || null, featureTitle: feature?.title || null,
    status: feature?.status || null, taskCount: (frontier.tasks || []).length, remainingTasks: (frontier.tasks || []).filter((item) => !['done', 'skipped'].includes(item.status)).length };
  const coverage = readIndexedCoverage(resolved.dataDir, resolved.revision) || auditCoverage({
    features: index.features.map((entry) => entry.id === featureId ? feature : readJsonObject(path.join(resolved.dataDir, 'features', `${entry.id}.json`))),
    frontier, contexts, scenarios: inventory.scenarios || [], inventory,
  });
  const next = task ? { ...task, context } : null;
  const activeRun = targetRun ? (() => {
    const leaseId = targetRun.leaseId || compatibilityLeaseId(targetRun.id);
    const heartbeatAt = effectiveHeartbeatAt(dir, { ...targetRun, leaseId });
    const liveness = deriveRunState({ ...targetRun, effectiveHeartbeatAt: heartbeatAt }, frontier, new Date(), { contexts, inventory, coverage });
    return { ...targetRun, storedStatus: targetRun.status, status: liveness.status, stale: liveness.stale,
      livenessReason: liveness.reason, effectiveHeartbeatAt: heartbeatAt, leaseId };
  })() : null;
  return { receipt: { schemaVersion: resolved.schemaVersion, revision: resolved.revision, workspaceRoot: path.resolve(dir), catalogPath: path.join(resolved.dataDir, 'catalog.json'), featureDir: path.join(resolved.dataDir, 'features') }, summary,
    next, linked, coverage, activeRun };
}

function pathKey(value) {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function assertPacketWorkspace(packet, workspaceDir) {
  const receipt = packet?.receipt;
  if (!receipt?.revision || !packet?.linked) throw new Error('Draft requires a work packet with a revision receipt.');
  if (typeof workspaceDir !== 'string' || !workspaceDir.trim() || !path.isAbsolute(workspaceDir)) {
    throw new Error('Draft requires an explicit absolute workspace directory.');
  }
  if (typeof receipt.workspaceRoot !== 'string' || !receipt.workspaceRoot.trim() || !path.isAbsolute(receipt.workspaceRoot)) {
    throw new Error('Work packet receipt must contain an explicit absolute workspace root.');
  }
  let selectedRoot;
  let receiptRoot;
  try {
    selectedRoot = fs.realpathSync(workspaceDir);
    receiptRoot = fs.realpathSync(receipt.workspaceRoot);
  } catch {
    throw new Error('Work packet and selected workspace roots must resolve to existing directories.');
  }
  if (pathKey(selectedRoot) !== pathKey(receiptRoot)) {
    throw new Error('Work packet workspace root does not match the selected --data workspace.');
  }
  for (const field of ['catalogPath', 'featureDir']) {
    const value = receipt[field];
    if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) {
      throw new Error(`Work packet receipt must contain an absolute ${field}.`);
    }
    let resolvedValue;
    try { resolvedValue = fs.realpathSync(value); }
    catch { throw new Error(`Work packet receipt ${field} must resolve to an existing path.`); }
    const relative = path.relative(receiptRoot, resolvedValue);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Work packet receipt has an ambiguous ${field} outside its workspace root.`);
    }
  }
  return selectedRoot;
}

export function createDraft(packet, { workspaceDir = packet?.receipt?.workspaceRoot, runId = packet?.activeRun?.id } = {}) {
  const workspaceRoot = assertPacketWorkspace(packet, workspaceDir);
  if (runId) ensureEvidenceDirectory(workspaceRoot, runId);
  const feature = packet.linked.feature;
  const scenario = packet.linked.scenario;
  const linkedScenarios = packet.linked.scenarios || (scenario ? [scenario] : []);
  const task = packet.linked.task;
  const hashes = {
    packet: sha256({ revision: packet.receipt.revision, next: packet.next?.id || null, linked: packet.linked }),
    ...(feature ? { feature: sha256(feature) } : {}), ...(scenario ? { scenario: sha256(scenario) } : {}), ...(task ? { task: sha256(task) } : {}),
  };
  return { version: 2, baseRevision: packet.receipt.revision,
    ...(feature ? { features: [structuredClone(feature)] } : {}),
    ...(scenario ? { scenarios: [structuredClone(scenario)] } : {}),
    ...(scenario ? { selectedScenarioIds: [scenario.id] } : {}),
    ...(task ? { selectedTaskIds: [task.id] } : {}),
    source: { revision: packet.receipt.revision, hashes, linkedScenarios: linkedScenarios.map((item) => structuredClone(item)) },
    inventory: { ...(packet.linked.context ? { contexts: [structuredClone(packet.linked.context)] } : {}) },
    frontier: { tasks: task ? [structuredClone(task)] : [] },
    evidenceDirectory: runId ? path.join('evidence', runId) : null };
}
