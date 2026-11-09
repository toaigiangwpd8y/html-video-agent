import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { applyObservation, loadWorkspace } from './store.mjs';
import { frontierSummary, selectNext, selectReadyTasks, transitionTask } from './frontier.mjs';
import { normalizeRun, sanitizeActivityEvent, SAFE_ID, isMeaningfulCheckpoint, validateFrontier, validateRun, validateRunOwnership } from './schema.mjs';
import { auditCoverage, scopeCoverage } from './coverage.mjs';
import { compatibilityLeaseId, newLeaseId, readPresence, readPresenceRecord, retirePresenceUnderLock, writePresenceUnderLock } from './presence.mjs';
import { createHash } from 'node:crypto';
import { ensureEvidenceDirectory, sha256 } from './json-io.mjs';
import { getWorkPacket } from './agent-workflow.mjs';
import { resolveRevision, withWorkspaceLock } from './revisions.mjs';
import { readRevisionManifest, VALIDATION_VERSION } from './workspace-reader.mjs';
import fs from 'node:fs';

const defaultStaleAfterMs = 120_000;

function loadHeartbeatOwnership(dir, { onRead } = {}) {
  const resolved = resolveRevision(dir);
  if (resolved.schemaVersion !== 2) return loadWorkspace(dir);
  const manifest = readRevisionManifest(resolved.dataDir, resolved.revision);
  if (!manifest) return loadWorkspace(dir);
  if (manifest.validationVersion !== VALIDATION_VERSION || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error(`Invalid heartbeat ownership manifest for ${resolved.revision}.`);
  }
  const fixedFiles = ['catalog.json', 'inventory.json', 'frontier.json', 'runs.json', 'activity.json'];
  const featureFiles = fs.existsSync(path.join(resolved.dataDir, 'features'))
    ? fs.readdirSync(path.join(resolved.dataDir, 'features')).filter((name) => name.endsWith('.json')).sort().map((name) => `features/${name}`) : [];
  const expectedFiles = [...fixedFiles, ...featureFiles].sort();
  const manifestFiles = Object.keys(manifest.files).sort();
  if (manifestFiles.join(String.fromCharCode(0)) !== expectedFiles.join(String.fromCharCode(0))) throw new Error('Heartbeat ownership manifest file inventory mismatch.');
  const rows = {};
  for (const relative of fixedFiles) {
    const file = path.join(resolved.dataDir, relative);
    onRead?.({ kind: 'metadata', relative });
    const bytes = fs.readFileSync(file);
    if (sha256(bytes) !== manifest.files[relative]) throw new Error(`Heartbeat metadata hash mismatch: ${relative}`);
    const json = bytes.toString('utf8');
    rows[relative.slice(0, -5)] = JSON.parse(json.charCodeAt(0) === 0xFEFF ? json.slice(1) : json);
  }
  if (!Array.isArray(rows.runs) || !rows.inventory || !Array.isArray(rows.inventory.contexts || []) || !rows.frontier || !Array.isArray(rows.catalog?.features)) {
    throw new Error('Invalid heartbeat ownership metadata.');
  }
  const catalogFeatureFiles = rows.catalog.features.map((feature) => `features/${feature.id}.json`).sort();
  if (catalogFeatureFiles.join(String.fromCharCode(0)) !== featureFiles.join(String.fromCharCode(0))) {
    throw new Error('Heartbeat catalog feature inventory mismatch.');
  }
  validateFrontier(rows.frontier, rows.inventory.contexts || []);
  rows.runs = rows.runs.map(normalizeRun);
  for (const run of rows.runs) validateRun(run);
  validateRunOwnership(rows.runs, rows.frontier);
  return { ...rows, schemaVersion: resolved.schemaVersion, revision: resolved.revision, dataDir: resolved.dataDir };
}

export function runHeartbeatThresholdMs(value = process.env.APP_EXPLORER_RUN_STALE_MS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : defaultStaleAfterMs;
}

function isoNow(value) { return value instanceof Date ? value.toISOString() : value || new Date().toISOString(); }
function eventId() { return `event.${randomUUID()}`; }
function taskEvent(run, type, message, now, taskId = run.currentTaskId) {
  return sanitizeActivityEvent({ id: eventId(), runId: run.id, ...(taskId ? { taskId } : {}), type, timestamp: now, message });
}
function readinessForFrontier(frontier, contexts, inventory, now, coverage) {
  const contextIds = new Set(contexts.map((context) => context.id));
  const inScope = (item) => item.contextId == null || contextIds.has(item.contextId);
  const scopedNodes = (frontier?.nodes || []).filter(inScope);
  const nodeIds = new Set(scopedNodes.map((node) => node.id));
  const scopedFrontier = {
    ...frontier,
    nodes: scopedNodes,
    edges: (frontier?.edges || []).filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)),
    tasks: (frontier?.tasks || []).filter(inScope),
  };
  const scopedInventory = { ...inventory, nodes: (inventory?.nodes || []).filter(inScope) };
  const scopedCoverage = scopeCoverage(coverage, contexts.map((context) => context.id));
  const readiness = frontierSummary(scopedFrontier, contexts, now, scopedInventory, { coverage: scopedCoverage });
  if (readiness.state === 'waiting_user' || readiness.state === 'waiting_external' || readiness.state === 'exhausted_in_scope' || readiness.state === 'interrupted' || readiness.state === 'needs_reconciliation') {
    return { status: readiness.state, reason: readiness.reason };
  }
  if (readiness.state === 'blocked') {
    const blockedTask = scopedFrontier.tasks.find((task) => task.status === 'blocked');
    const reason = blockedTask ? `Task ${blockedTask.id} is blocked: ${blockedTask.blocker?.reason || 'required change is unresolved'}` : readiness.reason;
    return { status: 'interrupted', reason };
  }
  if (readiness.state === 'inventory_incomplete') {
    return { status: 'interrupted', reason: `${readiness.unseenNodes} unseen inventory node(s) need a discovery task before this run can proceed.` };
  }
  return { status: 'running', reason: readiness.reason };
}

function commit(dir, observation, snapshotRevision, options = {}) {
  return applyObservation(dir, { version: 2, ...observation }, { expectedRevision: options.expectedRevision ?? snapshotRevision, beforeCurrent: options.beforeCurrent });
}

export function liveOwnedTaskIds(runs, frontier, now = new Date(), options = {}) {
  const owned = new Set();
  for (const run of runs || []) {
    if (!run.currentTaskId || !['running', 'waiting_user', 'waiting_external'].includes(run.status)) continue;
    const task = (frontier?.tasks || []).find((item) => item.id === run.currentTaskId);
    if (task?.status === 'running' && !deriveRunState(run, frontier, now, options).stale) owned.add(task.id);
  }
  return owned;
}

export function readyUnownedTasks(frontier, contexts, now, runs, options = {}) {
  const owned = liveOwnedTaskIds(runs, frontier, now, options);
  return selectReadyTasks(frontier, contexts, now, { excludedIds: owned });
}

export function selectNextUnowned(frontier, contexts, now, runs, options = {}) {
  return readyUnownedTasks(frontier, contexts, now, runs, options)[0] || null;
}

export function countReadyUnowned(frontier, contexts, now, runs, options = {}) {
  return readyUnownedTasks(frontier, contexts, now, runs, options).length;
}
export function startRun(dir, scope, browserInfo = null, options = {}) {
  const data = loadWorkspace(dir);
  const now = isoNow(options.now);
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('Run scope must be a JSON object.');
  const safeScope = Object.fromEntries(['appId', 'contextId', 'role', 'tenantAlias', 'environment', 'date', 'allowedActions']
    .filter((key) => scope[key] != null)
    .map((key) => [key, key === 'allowedActions' && Array.isArray(scope[key])
      ? scope[key].filter((item) => typeof item === 'string').slice(0, 50).map((item) => sanitizeActivityEvent({ message: item }).message)
      : sanitizeActivityEvent({ message: String(scope[key]).slice(0, 200) }).message]));
  if (options.browserSessionAlias && !SAFE_ID.test(options.browserSessionAlias)) throw new Error('Browser session alias must be a stable ID without credentials.');
  const context = safeScope.contextId ? data.contexts.find((item) => item.id === safeScope.contextId) : null;
  if (safeScope.contextId && !context) throw new Error(`Unknown run context: ${safeScope.contextId}`);
  const scopedContexts = context ? [context] : data.contexts;
  const nextInScope = selectNext(data.frontier, scopedContexts, now);
  const ready = selectNextUnowned(data.frontier, scopedContexts, now, data.runs, { contexts: data.contexts, inventory: data.inventory });
  const id = options.id || `run.${randomUUID()}`;
  const readiness = ready ? { status: 'running', reason: null } : nextInScope
    ? { status: 'interrupted', reason: `Ready task ${nextInScope.id} is already owned by a fresh run.` }
    : readinessForFrontier(data.frontier, scopedContexts, data.inventory, now, auditCoverage(data));
  const run = {
    id, scope: safeScope, status: readiness.status, stateReason: readiness.reason, currentTaskId: ready?.id || null,
    browserSessionAlias: options.browserSessionAlias || null,
    startedAt: now, heartbeatAt: now, leaseId: newLeaseId(), checkpoint: null, stopReason: null,
    browserVersion: browserInfo?.version ?? null, capabilities: browserInfo?.capabilities ?? null,
  };
  const events = [];
  let frontier = data.frontier;
  if (ready) {
    const updated = transitionTask(frontier, ready.id, {
      status: 'running', attempts: ready.attempts + 1, lastProgressAt: now,
    }).tasks.find((task) => task.id === ready.id);
    frontier = { ...frontier, tasks: frontier.tasks.map((task) => task.id === ready.id ? updated : task) };
    events.push(taskEvent(run, 'task_started', `Started task ${ready.id}.`, now));
  }
  const receipt = commit(dir, { frontier: { tasks: frontier.tasks.filter((task) => task.id === ready?.id) }, runs: [run], events }, data.revision, options);
  return { run, receipt, work: getWorkPacket(dir, { runId: id }) };
}

export function advanceRun(dir, runId, payload, options = {}) {
  if (!options.requestId || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(options.requestId)) throw new Error('Run advance requires a stable requestId.');
  if (!options.leaseId) throw new Error('Run advance requires a lease ID.');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Run advance payload must be an object.');
  const observation = payload.version === 2 ? payload : payload.observation || {};
  const prepared = payload.version === 2 || payload.observation?.version === 2;
  if (prepared && !observation.baseRevision && !options.expectedRevision) throw new Error('Prepared V2 observation requires baseRevision or matching --expected-revision.');
  if (options.expectedRevision && observation.baseRevision && observation.baseRevision !== options.expectedRevision) throw new Error('expectedRevision conflicts with observation.baseRevision');
  const expectedRevision = options.expectedRevision ?? observation.baseRevision;
  const requestId = options.requestId;
  const payloadHash = sha256(payload);
  const eventIdForRequest = `event.advance.${sha256(requestId).slice(0, 32)}`;
  const initial = loadWorkspace(dir);
  const run = initial.runs.find((item) => item.id === runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);
  if ((run.leaseId || compatibilityLeaseId(runId)) !== options.leaseId) throw new Error('Run advance lease does not match current ownership.');
  const prior = initial.activity.find((event) => event.requestId === requestId);
  if (prior) {
    if (prior.payloadHash !== payloadHash || prior.runId !== runId) throw new Error('Run advance requestId was already used with a different payload.');
    const revisionDir = path.join(dir, 'revisions', prior.revision);
    const receipt = { schemaVersion: 2, revision: prior.revision, catalogPath: path.join(revisionDir, 'catalog.json'), featureDir: path.join(revisionDir, 'features') };
    const run = initial.runs.find((item) => item.id === runId);
    return { receipt, run, work: getWorkPacket(dir, { runId }) , duplicate: true };
  }
  if (!['running', 'waiting_user', 'waiting_external'].includes(run.status) || !run.currentTaskId) throw new Error(`Run ${runId} does not own an active task.`);
  const sourceRevision = expectedRevision ?? initial.revision;
  if (sourceRevision !== initial.revision) throw new Error(`Revision conflict: expected ${sourceRevision}, found ${initial.revision}`);
  const taskId = payload.taskId || run.currentTaskId;
  if (taskId !== run.currentTaskId) throw new Error('Run advance task does not match current ownership.');
  const currentTask = initial.frontier.tasks.find((item) => item.id === taskId);
  if (!currentTask || currentTask.status !== 'running') throw new Error(`Run ${runId} no longer owns a running task.`);
  if (prepared && observation.version !== 2) throw new Error('Run advance observation must be a V2 envelope.');
  const now = isoNow(options.now);
  const observedTask = observation.frontier?.tasks?.find((item) => item.id === taskId);
  const resultCheckpoint = payload.checkpoint ?? observation.checkpoint ?? observedTask?.checkpoint ?? currentTask.checkpoint;
  const finished = transitionTask(initial.frontier, taskId, { status: 'done', ...(resultCheckpoint != null ? { checkpoint: resultCheckpoint } : {}), lastProgressAt: now }).tasks.find((item) => item.id === taskId);
  const proposedTasks = new Map(initial.frontier.tasks.map((item) => [item.id, item]));
  for (const item of observation.frontier?.tasks || []) if (item.id !== taskId) proposedTasks.set(item.id, { ...proposedTasks.get(item.id), ...item });
  proposedTasks.set(taskId, finished);
  const proposedFrontier = { ...initial.frontier, tasks: [...proposedTasks.values()] };
  const contextIds = run.scope?.contextId ? [run.scope.contextId] : initial.contexts.map((item) => item.id);
  const scopedContexts = initial.contexts.filter((item) => contextIds.includes(item.id));
  const next = selectNextUnowned(proposedFrontier, scopedContexts, now, initial.runs.filter((item) => item.id !== runId), { contexts: initial.contexts, inventory: initial.inventory });
  const timestamp = now;
  let nextFrontier = proposedFrontier;
  let nextTask = null;
  if (next) {
    nextTask = transitionTask(nextFrontier, next.id, { status: 'running', attempts: next.attempts + 1, lastProgressAt: now }).tasks.find((item) => item.id === next.id);
    nextFrontier = { ...nextFrontier, tasks: nextFrontier.tasks.map((item) => item.id === next.id ? nextTask : item) };
  }
  const coverage = auditCoverage(initial);
  const readiness = readinessForFrontier(nextFrontier, scopedContexts, initial.inventory, now, scopeCoverage(coverage, contextIds));
  const runUpdate = normalizeRun({ ...run, leaseId: run.leaseId, currentTaskId: nextTask?.id || null,
    status: nextTask ? 'running' : readiness.status, stateReason: nextTask ? null : readiness.reason,
    checkpoint: payload.checkpoint ?? run.checkpoint });
  const runEvents = [taskEvent(runUpdate, 'task_finished', `Finished task ${taskId}.`, timestamp, taskId),
    ...(nextTask ? [taskEvent(runUpdate, 'task_started', `Started task ${nextTask.id}.`, timestamp, nextTask.id)] : [])];
  runEvents[0].id = eventIdForRequest;
  runEvents[0].requestId = requestId;
  runEvents[0].payloadHash = payloadHash;
  const mergedObservation = { ...observation, version: 2, baseRevision: sourceRevision,
    runs: [...(observation.runs || []).filter((item) => item.id !== runId), runUpdate],
    events: [...(observation.events || []), ...runEvents],
    frontier: { ...(observation.frontier || {}), tasks: [...(observation.frontier?.tasks || []).filter((item) => ![taskId, nextTask?.id].includes(item.id)), finished, ...(nextTask ? [nextTask] : [])] } };
  if (options.runId && options.runId !== runId) throw new Error('Run advance runId mismatch.');
  ensureEvidenceDirectory(dir, runId);
  const committed = applyObservation(dir, mergedObservation, { expectedRevision: sourceRevision, crashAt: options.crashAt, beforeCurrent: () => {
    const presence = readPresence(dir, run);
    if (!nextTask || !['running', 'waiting_user', 'waiting_external'].includes(runUpdate.status)) retirePresenceUnderLock(dir, run, timestamp);
    else if (presence) writePresenceUnderLock(dir, { ...presence, taskId: nextTask.id });
  } });
  const receipt = { schemaVersion: committed.schemaVersion, revision: committed.revision, catalogPath: committed.catalogPath, featureDir: committed.featureDir };
  return { receipt, run: runUpdate, work: getWorkPacket(dir, { runId }), duplicate: false };
}

export function checkpointRun(dir, runId, checkpoint, options = {}) {
  if (!isMeaningfulCheckpoint(checkpoint)) throw new Error('Run checkpoint requires a non-empty checkpoint.');
  const data = loadWorkspace(dir);
  const current = data.runs.find((item) => item.id === runId);
  if (!current) throw new Error(`Unknown run: ${runId}`);
  if (['paused', 'exhausted_in_scope'].includes(current.status)) throw new Error(`Run in ${current.status} status cannot be checkpointed.`);
  const now = isoNow(options.now);
  const run = normalizeRun({ ...current, leaseId: current.leaseId, checkpoint: structuredClone(checkpoint) });
  const event = { ...taskEvent(run, 'run_checkpointed', 'Run checkpoint saved.', now), checkpointRecorded: true };
  const receipt = commit(dir, { runs: [run], events: [{ ...event, ...(options.eventId ? { id: options.eventId } : {}) }] }, data.revision, options);
  return { run, receipt };
}

export async function heartbeatRun(dir, runId, options = {}) {
  const leaseId = options.leaseId;
  if (!leaseId) throw new Error('Run heartbeat requires a lease ID.');
  return withWorkspaceLock(dir, () => {
    const data = loadHeartbeatOwnership(dir, { onRead: options.onHeartbeatRead });
    const current = data.runs.find((item) => item.id === runId);
    if (!current) throw new Error(`Unknown run: ${runId}`);
    if ((current.leaseId || compatibilityLeaseId(runId)) !== leaseId) throw new Error('Heartbeat lease does not match current run ownership.');
    if (!['running', 'waiting_user', 'waiting_external'].includes(current.status)) throw new Error(`Run in ${current.status} status cannot heartbeat.`);
    if (options.taskId != null && options.taskId !== current.currentTaskId) throw new Error('Heartbeat task does not match current run ownership.');
    const rawPresence = readPresenceRecord(dir, runId);
    if (rawPresence && rawPresence.leaseId !== leaseId) throw new Error('Heartbeat lease does not match current presence ownership.');
    const prior = readPresence(dir, current);
    if (prior?.retired) throw new Error('Retired heartbeat lease cannot be revived.');
    const heartbeatAt = isoNow(options.now);
    if (options.beforePresenceWrite && options.beforePresenceWrite() !== true) throw new Error('Worker liveness signal is not live before presence write.');
    const presenceVersion = (prior?.presenceVersion || 0) + 1;
    writePresenceUnderLock(dir, { runId, leaseId, taskId: current.currentTaskId || null, heartbeatAt, presenceVersion });
    return { revision: data.revision, presenceVersion, heartbeatAt };
  });
}

export function stopRun(dir, runId, reason, options = {}) {
  const data = loadWorkspace(dir);
  const current = data.runs.find((item) => item.id === runId);
  if (!current) throw new Error(`Unknown run: ${runId}`);
  if (!String(reason || '').trim()) throw new Error('Run stop requires a reason.');
  const now = isoNow(options.now);
  const safeReason = sanitizeActivityEvent({ message: reason }).message;
  const run = normalizeRun({ ...current, leaseId: current.leaseId, status: 'paused', stopReason: safeReason.slice(0, 500) });
  const event = taskEvent(run, 'run_paused', 'Run paused.', now);
  const receipt = commit(dir, { runs: [run], events: [event] }, data.revision, { ...options, beforeCurrent: () => { options.beforeCurrent?.(); retirePresenceUnderLock(dir, current, now); } });
  return { run, receipt };
}

export function recordActivity(dir, event, options = {}) {
  const safe = sanitizeActivityEvent(event);
  if (safe.type === 'run_checkpointed' && safe.checkpointRecorded === true) throw new Error('run_checkpointed requires a checkpoint transition.');
  const data = loadWorkspace(dir);
  if (data.activity.some((existing) => existing.id === safe.id)) return { duplicate: true, revision: data.revision };
  if (!data.runs.some((run) => run.id === safe.runId)) throw new Error(`Unknown run: ${safe.runId}`);
  const receipt = commit(dir, { events: [safe] }, data.revision, options);
  return { duplicate: false, receipt };
}

export function fenceStaleRunRecovery(dir, runIds, now = new Date(), options = {}) {
  const data = loadWorkspace(dir);
  const timestamp = now instanceof Date ? now.toISOString() : now;
  const nowMs = Date.parse(timestamp);
  for (const runId of runIds) {
    const run = data.runs.find((item) => item.id === runId);
    if (!run || !['running', 'waiting_user', 'waiting_external'].includes(run.status)) continue;
    if (!deriveRunState(run, data.frontier, timestamp, options).stale) throw new Error(`Recovery conflict: run ${runId} presence renewed before ownership transfer.`);
  }
  for (const runId of runIds) {
    const run = data.runs.find((item) => item.id === runId);
    if (run) retirePresenceUnderLock(dir, run, new Date(nowMs).toISOString());
  }
}

export function deriveRunState(run, frontier, now = new Date(), options = {}) {
  const current = normalizeRun(run);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const heartbeatAt = Object.hasOwn(run, 'effectiveHeartbeatAt') ? run.effectiveHeartbeatAt : current.heartbeatAt;
  const heartbeatMs = Date.parse(heartbeatAt);
  const staleAfterMs = runHeartbeatThresholdMs(options.staleAfterMs);
  const stale = !Number.isFinite(heartbeatMs) || !Number.isFinite(nowMs) || nowMs - heartbeatMs > staleAfterMs;
  const ownedTask = (frontier?.tasks || []).find((task) => task.id === current.currentTaskId && task.status === 'running');
  if (current.status === 'paused' || current.status === 'exhausted_in_scope') {
    return { status: current.status, stale, reason: current.stopReason || null, recoverableTaskIds: [] };
  }
  if (current.status === 'interrupted') {
    return { status: 'interrupted', stale, reason: current.stateReason || 'Run is interrupted and needs explicit review.', recoverableTaskIds: ownedTask ? [ownedTask.id] : [] };
  }
  if (stale && ['running', 'waiting_user', 'waiting_external'].includes(current.status)) {
    return { status: 'interrupted', stale: true, reason: 'Run heartbeat is stale; inspect its checkpoint before resuming.', recoverableTaskIds: ownedTask ? [ownedTask.id] : [] };
  }
  const statusContext = current.scope?.contextId ? (options.contexts || []).filter((context) => context.id === current.scope.contextId) : options.contexts || [];
  const readiness = readinessForFrontier(frontier || {}, statusContext, options.inventory || {}, new Date(nowMs).toISOString(), options.coverage);
  if (ownedTask && !stale) return { status: 'running', stale: false, reason: null, recoverableTaskIds: [] };
  if (current.status === 'waiting_user' || current.status === 'waiting_external') {
    return { status: current.status, stale: false, reason: current.stateReason || readiness.reason, recoverableTaskIds: [] };
  }
  return { status: readiness.status, stale: false, reason: current.stateReason || readiness.reason, recoverableTaskIds: [] };
}
