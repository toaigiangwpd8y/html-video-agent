import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export const SCENARIO_OUTCOMES = ['unknown', 'success', 'expected_denial', 'failure'];
export const FRONTIER_STATES = ['unseen', 'scanned', 'blocked', 'excluded'];
export const TASK_KINDS = ['discover_area', 'discover_capability', 'verify_scenario', 'inspect_branch', 'inspect_journey', 'prerequisite'];
export const TASK_STATUSES = ['queued', 'running', 'waiting_user', 'waiting_external', 'blocked', 'done', 'skipped'];
export const ACTIVITY_TYPES = ['task_started', 'capability_discovered', 'evidence_added', 'scenario_observed', 'task_waiting', 'task_finished', 'run_checkpointed', 'run_paused', 'task_checkpointed', 'legacy_state_updated'];
export const RUN_STATUSES = ['running', 'waiting_user', 'waiting_external', 'interrupted', 'paused', 'exhausted_in_scope', 'needs_reconciliation'];
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const array = (value) => Array.isArray(value);

function checkEvidenceRef(ref, dir) {
  assert(text(ref), 'Evidence ref must be a non-empty workspace-relative path');
  const parts = ref.replaceAll('\\', '/').split('/');
  assert(parts.every((part) => part && part !== '.' && part !== '..' && !part.startsWith('.')), `Unsafe evidence path: ${ref}`);
  assert(parts[0].toLowerCase() !== 'evidence', `Evidence ref must be relative to the evidence root and must not repeat the evidence/ prefix: ${ref}`);
  assert(/\.(png|jpe?g|webp|txt|json)$/i.test(ref), `Invalid evidence type: ${ref}`);
  const root = path.resolve(dir, 'evidence');
  const target = path.resolve(root, ...parts);
  assert(target.startsWith(root + path.sep), `Evidence must stay within workspace: ${ref}`);
  let current = root;
  if (fs.existsSync(root)) assert(!fs.lstatSync(root).isSymbolicLink(), 'Evidence directory is a symlink');
  for (const part of parts) {
    current = path.join(current, part);
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), `Evidence symlink not allowed: ${ref}`);
  }
  assert(fs.existsSync(target) && fs.statSync(target).isFile(), `Missing evidence: ${ref}`);
}

function checkRefs(refs, dir, label) {
  assert(array(refs), `${label} must be an array`);
  for (const ref of refs) checkEvidenceRef(ref, dir);
}

export function deriveScenarioStatus(scenario) {
  const verifiedOutcome = ['success', 'expected_denial'].includes(scenario?.outcome);
  const criteriaMet = array(scenario?.completionCriteria) && scenario.completionCriteria.length > 0 &&
    scenario.completionCriteria.every((criterion) => criterion?.met === true && array(criterion.evidenceRefs) && criterion.evidenceRefs.length > 0 &&
      array(scenario.steps) && scenario.steps.some((step) => text(step?.observed) && array(step.evidenceRefs) && step.evidenceRefs.some((ref) => criterion.evidenceRefs.includes(ref))));
  const contextKnown = text(scenario?.testedContext?.role) && text(scenario?.testedContext?.date) &&
    text(scenario?.testedContext?.contextId) && scenario.testedContext.contextId === scenario.contextId;
  if (verifiedOutcome && criteriaMet && contextKnown && array(scenario?.evidenceRefs) && scenario.evidenceRefs.length > 0) return 'verified';
  if (scenario?.outcome === 'unknown' && array(scenario?.steps) && scenario.steps.length === 0) return 'discovered';
  return 'partial';
}

export function validateCoverageQuestion(question, featureId) {
  if (typeof question === 'string') {
    assert(text(question), `Invalid question in ${featureId}`);
    return true;
  }
  assert(question && typeof question === 'object' && !Array.isArray(question) && SAFE_ID.test(question.id || '') && text(question.text) &&
    ['open', 'resolved', 'excluded'].includes(question.state), `Invalid question in ${featureId}`);
  assert(Object.hasOwn(question, 'contextId') && (question.contextId === null || SAFE_ID.test(question.contextId)), `Invalid question context in ${featureId}`);
  assert(array(question.taskIds) && question.taskIds.every((id) => SAFE_ID.test(id)), `Invalid question taskIds in ${featureId}`);
  assert(array(question.evidenceRefs), `Invalid question evidenceRefs in ${featureId}`);
  if (question.state === 'resolved') assert(question.evidenceRefs.length > 0, `Resolved question needs evidence in ${featureId}`);
  if (question.state === 'excluded') assert(text(question.reason), `Excluded question needs a reason in ${featureId}`);
  return true;
}

export function validateScenario(scenario, dir) {
  assert(scenario && typeof scenario === 'object' && !Array.isArray(scenario), 'Scenario must be an object');
  assert(SAFE_ID.test(scenario.id || ''), `Invalid scenario ID: ${scenario.id}`);
  assert(SAFE_ID.test(scenario.featureId || ''), `Invalid feature ID in scenario ${scenario.id}`);
  assert(SAFE_ID.test(scenario.contextId || ''), `Invalid context ID in scenario ${scenario.id}`);
  assert(text(scenario.goal), `Missing goal in scenario ${scenario.id}`);
  assert(array(scenario.preconditions) && scenario.preconditions.every(text), `Invalid preconditions in scenario ${scenario.id}`);
  assert(array(scenario.completionCriteria), `completionCriteria must be an array in scenario ${scenario.id}`);
  const criterionIds = new Set();
  for (const criterion of scenario.completionCriteria) {
    assert(criterion && SAFE_ID.test(criterion.id || '') && !criterionIds.has(criterion.id), `Invalid/duplicate completion criterion in ${scenario.id}`);
    criterionIds.add(criterion.id);
    assert(text(criterion.description) && typeof criterion.met === 'boolean', `Invalid completion criterion in ${scenario.id}`);
    const criterionEvidence = criterion.evidenceRefs || [];
    checkRefs(criterionEvidence, dir, `completion criterion evidenceRefs in ${scenario.id}`);
    if (criterion.met) assert(criterionEvidence.length > 0, `Met completion criterion needs evidence in ${scenario.id}`);
  }
  assert(array(scenario.steps), `steps must be an array in scenario ${scenario.id}`);
  const stepIds = new Set();
  for (const step of scenario.steps) {
    assert(step && SAFE_ID.test(step.id || '') && !stepIds.has(step.id), `Invalid/duplicate step in scenario ${scenario.id}`);
    stepIds.add(step.id);
    assert(text(step.action) && text(step.observed), `Missing action/observed in scenario ${scenario.id}`);
    checkRefs(step.evidenceRefs || [], dir, `step evidenceRefs in ${scenario.id}`);
  }
  for (const criterion of scenario.completionCriteria) if (criterion.met) {
    const linkedObservation = scenario.steps.some((step) => text(step.observed) && step.evidenceRefs?.some((ref) => criterion.evidenceRefs?.includes(ref)));
    assert(linkedObservation, `Met criterion ${criterion.id} needs an observed step linked to its evidence: ${scenario.id}`);
  }
  assert(SCENARIO_OUTCOMES.includes(scenario.outcome), `Invalid outcome in scenario ${scenario.id}`);
  checkRefs(scenario.evidenceRefs, dir, `evidenceRefs in ${scenario.id}`);
  assert(array(scenario.history || []), `history must be an array in scenario ${scenario.id}`);
  const executionIds = new Set();
  for (const execution of scenario.history || []) {
    assert(execution && typeof execution === 'object' && SAFE_ID.test(execution.executionId || '') && execution.scenarioId === scenario.id && !executionIds.has(execution.executionId), `Invalid/duplicate execution history ID in scenario ${scenario.id}`);
    executionIds.add(execution.executionId);
  }
  if (['success', 'expected_denial'].includes(scenario.outcome)) {
    assert(deriveScenarioStatus(scenario) === 'verified', `Verified scenario needs completion criteria, evidence, and tested context: ${scenario.id}`);
  }
  if (scenario.testedContext != null) {
    assert(typeof scenario.testedContext === 'object' && !Array.isArray(scenario.testedContext), `Invalid testedContext in ${scenario.id}`);
    assert(scenario.testedContext.contextId === scenario.contextId, `testedContext.contextId must match scenario.contextId: ${scenario.id}`);
    if (scenario.outcome !== 'unknown') assert(text(scenario.testedContext.role) && text(scenario.testedContext.date), `Verified scenario needs testedContext.role/date: ${scenario.id}`);
  }
  if (scenario.lastVerifiedAt != null) assert(text(scenario.lastVerifiedAt), `Invalid lastVerifiedAt in ${scenario.id}`);
  return true;
}

export function validateJourney(journey, { featureIds = [], executionIds = [], contextIds = [], dir } = {}) {
  assert(journey && typeof journey === 'object' && !Array.isArray(journey), 'Journey must be an object');
  assert(SAFE_ID.test(journey.id || '') && text(journey.title), 'Invalid journey: ' + (journey?.id || ''));
  assert(array(journey.nodes) && array(journey.edges) && array(journey.scenarioRunIds), 'Journey ' + journey.id + ' needs nodes, edges, and scenarioRunIds');
  const nodes = new Map();
  for (const node of journey.nodes) {
    assert(node && SAFE_ID.test(node.id || '') && !nodes.has(node.id), 'Invalid/duplicate journey node in ' + journey.id);
    assert(['scenario', 'checkpoint', 'handoff', 'blocker'].includes(node.type), 'Invalid journey node type in ' + journey.id + ': ' + node.type);
    assert(text(node.title), 'Journey node ' + node.id + ' needs a title');
    nodes.set(node.id, node);
    for (const field of ['preconditions', 'completionCriteria']) {
      if (node[field] != null) assert(array(node[field]) && node[field].every(text), 'Invalid ' + field + ' in journey node ' + node.id);
    }
    for (const field of ['action', 'expectedResult', 'observed']) {
      if (node[field] != null) assert(text(node[field]), 'Invalid ' + field + ' in journey node ' + node.id);
    }
    if (node.outputs != null) {
      assert(node.outputs && typeof node.outputs === 'object' && !Array.isArray(node.outputs), 'Invalid outputs in journey node ' + node.id);
      for (const [key, alias] of Object.entries(node.outputs)) {
        assert(SAFE_ID.test(key) && typeof alias === 'string' && /^alias:output-[1-9][0-9]*$/.test(alias), 'Journey outputs require generated alias: alias:output-N in ' + node.id);
      }
    }
    if (node.featureId != null) assert(featureIds.includes(node.featureId), 'Unknown journey feature: ' + node.featureId);
    if (node.scenarioRunId != null) assert(executionIds.includes(node.scenarioRunId), 'Unknown journey scenario execution: ' + node.scenarioRunId);
    if (node.contextId != null) assert(contextIds.includes(node.contextId), 'Unknown journey context: ' + node.contextId);
    if (node.type === 'handoff') assert(text(node.role) && text(node.contextId), 'Journey handoff ' + node.id + ' needs role and contextId');
    if (node.outcome != null) assert(['unknown', 'success', 'expected_denial', 'failure'].includes(node.outcome), 'Invalid journey node outcome in ' + node.id);
    for (const field of ['evidenceRefs', 'beforeEvidenceRefs', 'afterEvidenceRefs']) {
      if (node[field] != null && dir) checkRefs(node[field], dir, 'journey ' + field + ' in ' + node.id);
    }
    if (node.type === 'blocker' || node.blocker != null) assert(text(node.blocker?.reason), 'Journey blocker ' + node.id + ' needs a precise reason');
  }
  const edgeKeys = new Set();
  for (const edge of journey.edges) {
    assert(edge && nodes.has(edge.from) && nodes.has(edge.to), 'Unknown journey node reference in ' + journey.id + ': ' + edge?.from + ' -> ' + edge?.to);
    assert(text(edge.condition), 'Journey edge ' + edge.from + ' -> ' + edge.to + ' needs a condition');
    const key = edge.from + '->' + edge.to + ':' + edge.condition;
    assert(!edgeKeys.has(key), 'Duplicate journey edge in ' + journey.id + ': ' + key);
    edgeKeys.add(key);
    if (edge.outcome != null) assert(['unknown', 'success', 'expected_denial', 'failure'].includes(edge.outcome), 'Invalid journey edge outcome in ' + journey.id);
    if (edge.contextSwitch != null) {
      const change = edge.contextSwitch;
      assert(change && typeof change === 'object' && contextIds.includes(change.from) && contextIds.includes(change.to) && text(change.role), 'Invalid journey context switch in ' + journey.id);
    }
  }
  const seenRuns = new Set();
  for (const id of journey.scenarioRunIds) {
    assert(SAFE_ID.test(id) && !seenRuns.has(id) && executionIds.includes(id), 'Unknown/duplicate journey scenario execution: ' + id);
    seenRuns.add(id);
  }
  const outcome = journey.outcome || 'unknown';
  assert(['unknown', 'success', 'expected_denial', 'failure', 'blocked'].includes(outcome), 'Invalid journey outcome in ' + journey.id);
  if (journey.evidenceRefs != null && dir) checkRefs(journey.evidenceRefs, dir, 'journey evidenceRefs in ' + journey.id);
  if (journey.completionCriteria != null) {
    assert(array(journey.completionCriteria), 'Invalid journey completion criteria in ' + journey.id);
    for (const criterion of journey.completionCriteria) {
      if (typeof criterion === 'string') continue;
      assert(criterion && SAFE_ID.test(criterion.id || '') && text(criterion.description) && typeof criterion.met === 'boolean' && text(criterion.observed) && array(criterion.evidenceRefs), 'Invalid journey completion criterion in ' + journey.id);
      if (dir) checkRefs(criterion.evidenceRefs, dir, 'journey completion criterion evidence in ' + journey.id);
      if (criterion.met) assert(criterion.evidenceRefs.length > 0, 'Journey completion criterion needs evidence in ' + journey.id);
    }
  }
  if (['success', 'expected_denial'].includes(outcome)) {
    const completed = array(journey.completionCriteria) && journey.completionCriteria.length > 0 && journey.completionCriteria.every((criterion) => criterion && typeof criterion === 'object' && criterion.met === true && text(criterion.observed) && array(criterion.evidenceRefs) && criterion.evidenceRefs.length > 0);
    assert(completed, 'Completed journey ' + journey.id + ' needs completion criteria, evidence, and testedContext role/date/contextId');
    const journeyEvidence = journey.evidenceRefs || [];
    assert(journey.completionCriteria.every((criterion) => criterion.evidenceRefs.every((ref) => journeyEvidence.includes(ref))), 'Journey completion evidence must be linked from journey evidenceRefs: ' + journey.id);
    assert(journey.testedContext && text(journey.testedContext.role) && text(journey.testedContext.date) && text(journey.testedContext.contextId) && contextIds.includes(journey.testedContext.contextId), 'Completed journey ' + journey.id + ' needs completion criteria, evidence, and testedContext role/date/contextId');
  }
  if (outcome === 'blocked') assert(text(journey.blocker?.reason), 'Blocked journey ' + journey.id + ' needs a precise blocker reason');
  if (journey.testedContext != null) {
    assert(typeof journey.testedContext === 'object' && text(journey.testedContext.contextId) && contextIds.includes(journey.testedContext.contextId), 'Invalid journey testedContext in ' + journey.id);
    assert(text(journey.testedContext.role) && text(journey.testedContext.date), 'Journey testedContext needs role/date in ' + journey.id);
  }
  return true;
}

export function validateFrontier(frontier, contexts = []) {
  assert(frontier && typeof frontier === 'object' && !Array.isArray(frontier), 'Frontier must be an object');
  const nodes = frontier.nodes || [];
  const edges = frontier.edges || [];
  const tasks = frontier.tasks || [];
  assert(array(nodes) && array(edges) && array(tasks), 'Frontier nodes, edges, and tasks must be arrays');
  const contextList = Array.isArray(contexts) ? contexts : contexts?.contexts || [];
  const contextIds = new Set(contextList.map((context) => context.id));
  const nodeIds = new Set();
  for (const node of nodes) {
    assert(node && SAFE_ID.test(node.id || '') && !nodeIds.has(node.id), `Invalid/duplicate frontier node: ${node?.id}`);
    nodeIds.add(node.id);
    assert(text(node.kind), `Missing frontier node kind: ${node.id}`);
    assert(FRONTIER_STATES.includes(node.discoveryState), `Invalid discoveryState in ${node.id}`);
    assert(array(node.entryAliases) && array(node.taskIds), `Invalid aliases/taskIds in ${node.id}`);
    if (node.contextId) assert(!contextIds.size || contextIds.has(node.contextId), `Unknown context ${node.contextId} in frontier node ${node.id}`);
  }
  const taskIds = new Set();
  for (const task of tasks) {
    assert(task && SAFE_ID.test(task.id || '') && !taskIds.has(task.id), `Invalid/duplicate frontier task: ${task?.id}`);
    taskIds.add(task.id);
    assert(SAFE_ID.test(task.key || task.id), `Invalid task key: ${task.id}`);
    assert(TASK_KINDS.includes(task.kind) && TASK_STATUSES.includes(task.status), `Invalid task kind/status: ${task.id}`);
    assert(text(task.goal) && array(task.dependencies) && Number.isInteger(task.depth) && task.depth >= 0 && Number.isInteger(task.sequence) && task.sequence >= 0 &&
      array(task.completionCriteria) && task.completionCriteria.every(text) && task.entry && typeof task.entry === 'object' && !Array.isArray(task.entry) &&
      Number.isInteger(task.attempts) && task.attempts >= 0 && (task.lastProgressAt == null || text(task.lastProgressAt)), `Incomplete task scheduling fields: ${task.id}`);
    assert(SAFE_ID.test(task.nodeId || '') && nodeIds.has(task.nodeId), `Unknown node for task ${task.id}`);
    assert(task.contextId == null || contextIds.has(task.contextId), `Unknown context for task ${task.id}`);
    if (task.status === 'blocked') assert(text(task.blocker?.type) && text(task.blocker?.reason) && text(task.blocker?.requiredChange), `Blocked task ${task.id} needs blocker.requiredChange`);
    if (task.status === 'waiting_external') assert(text(task.blocker?.reason) && text(task.blocker?.condition) && text(task.blocker?.nextCheckAt), `Waiting external task ${task.id} needs a condition and nextCheckAt`);
    if (task.status === 'skipped') assert(text(task.skipReason) && text(task.excludedScope), `Skipped task ${task.id} needs a reason and excluded scope`);
    if (task.parentTaskId) assert(SAFE_ID.test(task.parentTaskId), `Invalid parentTaskId in ${task.id}`);
  }
  for (const node of nodes) for (const taskId of node.taskIds) {
    assert(taskIds.has(taskId), `Unknown task ${taskId} in frontier node ${node.id}`);
    assert(tasks.find((task) => task.id === taskId)?.nodeId === node.id, `Task ${taskId} does not point back to frontier node ${node.id}`);
  }
  for (const task of tasks) assert(nodes.find((node) => node.id === task.nodeId)?.taskIds.includes(task.id), `Task ${task.id} is missing from frontier node ${task.nodeId}`);
  for (const task of tasks) {
    for (const dependencyId of task.dependencies) assert(taskIds.has(dependencyId), `Unknown task dependency ${dependencyId} in ${task.id}`);
    if (task.parentTaskId) assert(taskIds.has(task.parentTaskId), `Unknown parent task ${task.parentTaskId} in ${task.id}`);
  }
  for (const edge of edges) {
    assert(edge && nodeIds.has(edge.from) && nodeIds.has(edge.to) && text(edge.relation), 'Invalid frontier edge');
  }
  return true;
}

export function validateScenarioFrontier(scenarios, frontier, contexts = []) {
  const tasks = frontier?.tasks || [];
  const contextList = Array.isArray(contexts) ? contexts : contexts?.contexts || [];
  const contextIds = new Set(contextList.map((context) => context.id));
  for (const scenario of scenarios) {
    assert(contextIds.has(scenario.contextId), `Unknown context ${scenario.contextId} in scenario ${scenario.id}`);
    if (!['discovered', 'partial'].includes(deriveScenarioStatus(scenario))) continue;
    const hasOpenTask = tasks.some((task) => task.scenarioId === scenario.id && !['done', 'skipped'].includes(task.status));
    const excluded = tasks.some((task) => task.scenarioId === scenario.id && task.status === 'skipped' && text(task.excludedScope));
    assert(hasOpenTask || excluded, `Partial scenario ${scenario.id} needs an open frontier task or an explicit exclusion`);
  }
  return true;
}

export function validateRunOwnership(runs, frontier) {
  const tasks = new Map((frontier?.tasks || []).map((task) => [task.id, task]));
  const owners = new Map();
  for (const run of runs || []) {
    if (!run.currentTaskId || !['running', 'waiting_user', 'waiting_external'].includes(run.status)) continue;
    const task = tasks.get(run.currentTaskId);
    assert(task, `Active run ${run.id} points to missing task ${run.currentTaskId}`);
    assert(task.status === 'running', `Active run ${run.id} owns task ${task.id} in ${task.status} state`);
    assert(!owners.has(task.id), `Task ${task.id} is owned by multiple active runs: ${owners.get(task.id)}, ${run.id}`);
    owners.set(task.id, run.id);
  }
  return true;
}

export function validateRun(run) {
  assert(run && SAFE_ID.test(run.id || ''), `Invalid run ID: ${run?.id}`);
  assert(RUN_STATUSES.includes(run.status), `Invalid run status: ${run.id}`);
  assert(run.scope && typeof run.scope === 'object' && !Array.isArray(run.scope), `Run ${run.id} needs a scope object`);
  const allowedScopeKeys = new Set(['appId', 'contextId', 'role', 'tenantAlias', 'environment', 'date', 'allowedActions']);
  for (const [key, value] of Object.entries(run.scope)) {
    assert(allowedScopeKeys.has(key), `Unsupported run scope field ${key} in ${run.id}`);
    assert(!/(?:password|passwd|token|secret|credential|auth|cookie|profile|state|session|key)/i.test(key), `Sensitive run scope field ${key} is not allowed in ${run.id}`);
    if (key === 'allowedActions') assert(Array.isArray(value) && value.length <= 50 && value.every((item) => typeof item === 'string'), `Invalid allowedActions in run ${run.id}`);
    else assert(typeof value === 'string' && value.length > 0 && value.length <= 200, `Invalid run scope value for ${key} in ${run.id}`);
    if (key === 'appId' || key === 'contextId') assert(SAFE_ID.test(value), `Invalid run scope ID for ${key} in ${run.id}`);
    const values = key === 'allowedActions' ? value : [value];
    assert(values.every((item) => !/(?:password|passwd|token|secret|credential|auth(?:entication|orization)?|cookie|profile|session|bearer)\s*[:=]/i.test(item)), `Sensitive run scope value is not allowed in ${run.id}`);
  }
  assert(text(run.startedAt) && text(run.heartbeatAt), `Run ${run.id} needs startedAt and heartbeatAt`);
  if (run.leaseId != null) assert(SAFE_ID.test(run.leaseId), `Invalid leaseId in run ${run.id}`);
  if (run.currentTaskId != null) assert(SAFE_ID.test(run.currentTaskId), `Invalid currentTaskId in run ${run.id}`);
  if (run.browserSessionAlias != null) assert(text(run.browserSessionAlias), `Invalid browserSessionAlias in run ${run.id}`);
  if (run.capabilities != null) assert(run.capabilities && typeof run.capabilities === 'object' && !Array.isArray(run.capabilities) && Object.entries(run.capabilities).every(([key, value]) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(key) && typeof value === 'boolean'), `Invalid capabilities in run ${run.id}`);
  if (run.browserVersion != null) assert(text(run.browserVersion), `Invalid browserVersion in run ${run.id}`);
  if (run.stopReason != null) assert(text(run.stopReason), `Invalid stopReason in run ${run.id}`);
  if (run.stateReason != null) assert(text(run.stateReason), `Invalid stateReason in run ${run.id}`);
  return true;
}

const LEGACY_RUN_STATUS = Object.freeze({ blocked: 'interrupted', completed: 'exhausted_in_scope', stopped: 'paused' });
export function normalizeRun(run) {
  if (!run) return run;
  const normalized = LEGACY_RUN_STATUS[run.status] ? { ...run, status: LEGACY_RUN_STATUS[run.status] } : { ...run };
  if (!normalized.leaseId) Object.defineProperty(normalized, 'leaseId', { value: `lease.legacy.${createHash('sha256').update(String(run.id)).digest('hex').slice(0, 24)}`, enumerable: false });
  if (Array.isArray(normalized.capabilities)) normalized.capabilities = Object.fromEntries(normalized.capabilities.map((name) => [name, true]));
  return normalized;
}

export function sanitizeActivityEvent(event) {
  const taskPhrase = event?.taskId ? ` for task ${event.taskId}` : '';
  const evidenceCount = Array.isArray(event?.evidenceRefs) ? event.evidenceRefs.length : 0;
  const activityMessages = {
    task_started: `Task${taskPhrase} started.`,
    capability_discovered: `Capability discovery recorded${taskPhrase}.`,
    evidence_added: `Evidence added${taskPhrase}${evidenceCount ? ` (${evidenceCount} linked evidence ${evidenceCount === 1 ? 'file' : 'files'})` : ''}.`,
    scenario_observed: `Scenario observation recorded${taskPhrase}.`,
    task_waiting: `Task${taskPhrase} is waiting.`,
    task_finished: `Task${taskPhrase} finished.`,
    run_checkpointed: `Run checkpoint saved${taskPhrase}.`,
    run_paused: 'Run paused.',
    task_checkpointed: `Task checkpoint saved${taskPhrase}.`,
    legacy_state_updated: 'Legacy lifecycle state updated; checkpoint details are unknown.',
  };
  let message = activityMessages[event?.type] || String(event?.message ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
    .replace(/\b(password|passwd|token|secret|authorization|api[_-]?key)\b\s*([=:]\s*|\s+)([^\s,;]+)/gi, (_match, key) => `${key}=[redacted]`)
    .replace(/\bbearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(--(?:password|token|secret|api-key)\s+)\S+/gi, '$1[redacted]')
    .slice(0, 500);
  const safe = {
    id: event?.id,
    runId: event?.runId,
    ...(event?.taskId != null ? { taskId: event.taskId } : {}),
    type: event?.type,
    timestamp: event?.timestamp,
    ...(event?.revision != null ? { revision: event.revision } : {}),
    ...(event?.checkpointRecorded === true ? { checkpointRecorded: true } : {}),
    ...(event?.requestId != null ? { requestId: event.requestId } : {}),
    ...(event?.payloadHash != null ? { payloadHash: event.payloadHash } : {}),
    message,
    ...(Array.isArray(event?.evidenceRefs) ? { evidenceRefs: event.evidenceRefs } : {}),
  };
  return safe;
}

export function normalizeLegacyActivityEvent(event) {
  if (event?.type === 'run_checkpointed' && event.checkpointRecorded !== true) {
    return { ...event, type: 'legacy_state_updated', message: 'Legacy lifecycle state updated; checkpoint details are unknown.' };
  }
  return event;
}

export function isMeaningfulCheckpoint(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export function validateActivityEvent(event, dir) {
  assert(event && SAFE_ID.test(event.id || ''), `Invalid activity event ID: ${event?.id}`);
  assert(SAFE_ID.test(event.runId || ''), `Invalid runId in activity event ${event.id}`);
  assert(ACTIVITY_TYPES.includes(event.type), `Invalid activity event type: ${event.type}`);
  assert(text(event.timestamp) && text(event.revision) && text(event.message), `Incomplete activity event ${event.id}`);
  assert(!/(password|passwd|token|secret|authorization|api[_-]?key)\s*[=:]\s*(?!\[redacted\])/i.test(event.message) && !/\bbearer\s+(?!\[redacted\])\S+/i.test(event.message), `Activity event message must be sanitized: ${event.id}`);
  assert(Object.keys(event).every((key) => ['id', 'runId', 'taskId', 'type', 'timestamp', 'revision', 'message', 'evidenceRefs', 'checkpointRecorded', 'requestId', 'payloadHash'].includes(key)), `Unexpected activity metadata in ${event.id}`);
  if (event.checkpointRecorded != null) assert(event.checkpointRecorded === true, `Invalid checkpoint marker in activity event ${event.id}`);
  if (event.requestId != null) assert(SAFE_ID.test(event.requestId), `Invalid requestId in activity event ${event.id}`);
  if (event.payloadHash != null) assert(/^[a-f0-9]{64}$/.test(event.payloadHash), `Invalid payloadHash in activity event ${event.id}`);
  if (event.taskId != null) assert(SAFE_ID.test(event.taskId), `Invalid taskId in activity event ${event.id}`);
  if (event.evidenceRefs != null) checkRefs(event.evidenceRefs, dir, `activity evidenceRefs in ${event.id}`);
  return true;
}

export function normalizeScenarioHistory(scenario) {
  const history = (scenario.history || []).map((execution, index) => ({ ...execution, executionId: execution.executionId || (scenario.id + '.execution-' + (index + 1)), scenarioId: execution.scenarioId || scenario.id }));
  return { ...scenario, history };
}

export function normalizeLegacyJourney(journey) {
  if (Array.isArray(journey.nodes)) return journey;
  const nodes = (journey.featureIds || []).map((featureId, index) => ({ id: journey.id + '.step-' + (index + 1), type: 'scenario', title: featureId, featureId, outcome: 'unknown', preconditions: [], completionCriteria: [], evidenceRefs: [] }));
  const edges = nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id, condition: 'Continue to next step', outcome: 'unknown' }));
  return { id: journey.id, title: journey.title, description: journey.description || '', nodes, edges, scenarioRunIds: [], outcome: 'unknown', evidenceRefs: [] };
}

export function migrateLegacyKnowledge(data) {
  const scenarios = [];
  const contexts = [];
  const features = data.features.map((feature) => {
    const contextId = `legacy.${feature.id}`;
    const oldContext = feature.testedContext || {};
    if (!contexts.some((context) => context.id === contextId)) contexts.push({ id: contextId, role: oldContext.role || 'unknown', tenantAlias: 'legacy', environment: 'legacy', date: oldContext.date || null, needsReview: true });
    const scenarioId = `${feature.id}.legacy`;
    const steps = (feature.steps || []).map((step) => ({ id: step.id, action: step.action, observed: step.observed, evidenceRefs: [step.screenshot, step.snapshot].filter(Boolean) }));
    const evidenceRefs = [...new Set(steps.flatMap((step) => step.evidenceRefs))];
    scenarios.push({ id: scenarioId, featureId: feature.id, contextId, preconditions: [], goal: feature.summary,
      completionCriteria: [], steps, outcome: 'unknown', evidenceRefs, testedContext: null, lastVerifiedAt: null,
      history: [{ executionId: scenarioId + '.execution-1', scenarioId, outcome: 'unknown', evidenceRefs, migrationReview: true }],
      migrationReview: { required: true, reason: 'Legacy steps do not identify a verified outcome or completion criteria.' } });
    const wasVerified = feature.status === 'verified';
    return { ...feature, status: wasVerified ? 'partial' : feature.status,
      ...(wasVerified ? { legacyStatus: 'verified', legacyVerificationClaim: {
        status: feature.status, lastVerifiedAt: feature.lastVerifiedAt || null,
        testedContext: feature.testedContext || null,
      } } : {}), scenarioIds: [...new Set([...(feature.scenarioIds || []), scenarioId])] };
  });
  const nodes = scenarios.map((scenario) => {
    const feature = features.find((item) => item.id === scenario.featureId);
    return { id: feature.id, kind: 'feature', contextId: scenario.contextId,
      entryAliases: feature.entry?.url ? [feature.entry.url] : [], discoveryState: 'scanned',
      scannedAt: feature.lastVerifiedAt || null, taskIds: [`${scenario.id}.review`] };
  });
  const tasks = scenarios.map((scenario, index) => ({ id: `${scenario.id}.review`, key: `${scenario.id}.review`,
    nodeId: scenario.featureId, featureId: scenario.featureId, scenarioId: scenario.id, contextId: scenario.contextId,
    kind: 'verify_scenario', parentTaskId: null, depth: 0, sequence: index,
    status: 'queued', dependencies: [], goal: `Review legacy evidence for ${scenario.goal}`,
    completionCriteria: ['Confirm the scenario outcome and explicit completion criteria.'], entry: featureEntry(features, scenario.featureId),
    checkpoint: null, blocker: null, attempts: 0, lastProgressAt: null }));
  let frontier = { ...(data.frontier || {}), nodes: [...(data.frontier?.nodes || []), ...nodes], edges: data.frontier?.edges || [], tasks: [...(data.frontier?.tasks || []), ...tasks] };
  if (features.length === 0 && frontier.tasks.length === 0 && frontier.nodes.length === 0) {
    const rootId = 'root.app';
    const taskId = 'app.discover.root';
    frontier = {
      ...frontier,
      nodes: [{ id: rootId, kind: 'root', entryAliases: [data.app?.baseUrl].filter(Boolean), discoveryState: 'unseen', taskIds: [taskId] }],
      tasks: [{ id: taskId, key: 'default.root.discover', nodeId: rootId, kind: 'discover_area', parentTaskId: null,
        depth: 0, sequence: 0, status: 'queued', dependencies: [], goal: 'Discover the application areas available in the authorized context.',
        completionCriteria: ['Record the visible application areas and any access blockers.'], entry: { url: data.app?.baseUrl || '' },
        checkpoint: null, blocker: null, attempts: 0, lastProgressAt: null }],
    };
  }
  const journeys = (data.journeys || []).map(normalizeLegacyJourney);
  return { ...data, journeys, features,
    inventory: { ...(data.inventory || {}), contexts: [...(data.inventory?.contexts || []), ...contexts], scenarios: [...(data.inventory?.scenarios || []), ...scenarios] },
    frontier };
}

function featureEntry(features, featureId) { return features.find((feature) => feature.id === featureId)?.entry || {}; }

export function validateGlobalExecutionIds(scenarios) {
  const executionIds = new Set();
  for (const scenario of scenarios || []) for (const execution of scenario.history || []) {
    assert(!executionIds.has(execution.executionId), `Invalid/duplicate execution ID across scenario histories: ${execution.executionId}`);
    executionIds.add(execution.executionId);
  }
  return true;
}
