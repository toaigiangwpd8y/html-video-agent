const terminal = new Set(['done', 'skipped']);
const readyStatuses = new Set(['queued', 'waiting_external']);
const text = (value) => typeof value === 'string' && value.trim().length > 0;

function cloneFrontier(frontier) {
  return {
    ...frontier,
    nodes: (frontier?.nodes || []).map((item) => ({ ...item, entryAliases: [...(item.entryAliases || [])], taskIds: [...(item.taskIds || [])] })),
    edges: (frontier?.edges || []).map((item) => ({ ...item })),
    tasks: (frontier?.tasks || []).map((item) => ({ ...item, dependencies: [...(item.dependencies || [])] })),
  };
}

function addAlias(node, entry) {
  const aliases = [entry?.url, ...(entry?.aliases || [])].filter(text);
  node.entryAliases = [...new Set([...(node.entryAliases || []), ...aliases])];
}

function nodeKindFor(task) {
  if (task.nodeKind) return task.nodeKind;
  return ({ discover_area: 'area', discover_capability: 'capability', verify_scenario: 'scenario',
    inspect_branch: 'branch', inspect_journey: 'journey', prerequisite: 'prerequisite' })[task.kind] || 'unknown';
}

function shortestNodeDepths(frontier) {
  const distances = new Map();
  const queue = [];
  for (const node of frontier.nodes) if (node.kind === 'root') {
    distances.set(node.id, 0);
    queue.push(node.id);
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const from = queue[cursor];
    const depth = distances.get(from) + 1;
    for (const edge of frontier.edges) if (edge.from === from && !distances.has(edge.to)) {
      distances.set(edge.to, depth);
      queue.push(edge.to);
    }
  }
  return distances;
}

function updateKnownDepths(frontier) {
  const depths = shortestNodeDepths(frontier);
  frontier.tasks = frontier.tasks.map((task) => {
    const depth = depths.get(task.nodeId);
    return depth !== undefined && !terminal.has(task.status) ? { ...task, depth } : task;
  });
  return frontier;
}

export function recomputeDepths(frontier) {
  return updateKnownDepths(cloneFrontier(frontier || {}));
}

function nextSequence(frontier) {
  return frontier.tasks.reduce((max, task) => Math.max(max, Number.isInteger(task.sequence) ? task.sequence : -1), -1) + 1;
}

/** Add a task by semantic key. Repeated discoveries merge navigation aliases. */
export function enqueue(frontier, task) {
  if (!task || !text(task.id) || !text(task.key) || !text(task.nodeId)) throw new Error('Task id, key, and nodeId are required');
  const next = cloneFrontier(frontier || {});
  const duplicate = next.tasks.find((item) => item.key === task.key);
  if (duplicate) {
    const existingNode = next.nodes.find((node) => node.id === duplicate.nodeId);
    if (existingNode) addAlias(existingNode, task.entry);
    return updateKnownDepths(next);
  }
  let target = next.nodes.find((node) => node.id === task.nodeId);
  if (!target) {
    target = { id: task.nodeId, kind: nodeKindFor(task), entryAliases: [], discoveryState: 'unseen', taskIds: [] };
    next.nodes.push(target);
  }
  addAlias(target, task.entry);
  if (next.tasks.some((item) => item.id === task.id)) throw new Error(`Duplicate task ID: ${task.id}`);
  const { nodeKind, ...record } = task;
  next.tasks.push({ ...record, status: task.status || 'queued', sequence: nextSequence(next),
    dependencies: [...(task.dependencies || [])], depth: Number.isInteger(task.depth) ? task.depth : 0,
    completionCriteria: [...(task.completionCriteria || [])], entry: { ...(task.entry || {}) },
    attempts: Number.isInteger(task.attempts) ? task.attempts : 0,
    lastProgressAt: task.lastProgressAt ?? null });
  target.taskIds = [...new Set([...target.taskIds, task.id])];
  return updateKnownDepths(next);
}

function dependenciesDone(task, tasksById) {
  return task.dependencies.every((id) => tasksById.get(id)?.status === 'done');
}

function contextAvailable(task, contexts) {
  if (!task.contextId) return true;
  return (contexts || []).some((context) => context.id === task.contextId);
}

function externalWaitDue(task, now) {
  if (task.status !== 'waiting_external') return true;
  const due = Date.parse(task.blocker?.nextCheckAt || '');
  const current = Date.parse(now);
  return Number.isFinite(due) && Number.isFinite(current) && due <= current;
}

function isReadyTask(task, tasksById, contexts, now, excludedIds) {
  return !excludedIds?.has(task.id) && readyStatuses.has(task.status) && contextAvailable(task, contexts) &&
    dependenciesDone(task, tasksById) && externalWaitDue(task, now);
}

/** Enumerate ready tasks in scheduler order with one shared readiness predicate. */
export function selectReadyTasks(frontier, contexts = [], now = new Date().toISOString(), { excludedIds = null } = {}) {
  const tasks = frontier?.tasks || [];
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  return tasks.filter((task) => isReadyTask(task, tasksById, contexts, now, excludedIds))
    .sort((a, b) => a.depth - b.depth || a.sequence - b.sequence || a.id.localeCompare(b.id));
}

/** Purely select the shallowest ready task, FIFO by durable enqueue sequence. */
export function selectNext(frontier, contexts = [], now = new Date().toISOString()) {
  return selectReadyTasks(frontier, contexts, now)[0] || null;
}

const allowedTransitions = {
  queued: new Set(['running', 'blocked', 'waiting_user', 'waiting_external', 'done', 'skipped']),
  running: new Set(['queued', 'blocked', 'waiting_user', 'waiting_external', 'done']),
  blocked: new Set(['queued']), waiting_user: new Set(['queued']), waiting_external: new Set(['queued', 'running']),
  done: new Set(), skipped: new Set(),
};

/** Return a copied frontier with one lifecycle transition applied. */
export function transitionTask(frontier, id, transition = {}) {
  const next = cloneFrontier(frontier || {});
  const index = next.tasks.findIndex((task) => task.id === id);
  if (index < 0) throw new Error(`Unknown task: ${id}`);
  const current = next.tasks[index];
  const { continuation, ...changes } = transition;
  if (changes.id != null && changes.id !== current.id) throw new Error('Task ID cannot change during a transition');
  if (changes.nodeId != null && changes.nodeId !== current.nodeId) throw new Error('Task node cannot change during a transition');
  if (changes.key != null && changes.key !== current.key) throw new Error('Task key cannot change during a transition');
  if (changes.status && changes.status !== current.status && !allowedTransitions[current.status]?.has(changes.status)) {
    throw new Error(`Invalid task transition: ${current.status} -> ${changes.status}`);
  }
  const resumed = current.status !== 'queued' && changes.status === 'queued';
  next.tasks[index] = { ...current, ...changes, ...(continuation || resumed ? { sequence: nextSequence(next) } : {}) };
  return next;
}

function taskWaitState(task, tasksById, contexts, now, visited = new Set()) {
  if (visited.has(task.id)) return 'blocked';
  if (task.status === 'done') return null;
  if (task.status === 'blocked' || task.status === 'skipped') return 'blocked';
  if (task.status === 'waiting_user') return 'waiting_user';
  if (task.status === 'running') return 'interrupted';
  if (task.contextId && !contextAvailable(task, contexts)) return 'waiting_user';
  const nextVisited = new Set([...visited, task.id]);
  for (const dependencyId of task.dependencies || []) {
    const dependency = tasksById.get(dependencyId);
    if (!dependency) return 'blocked';
    const waitState = taskWaitState(dependency, tasksById, contexts, now, nextVisited);
    if (waitState) return waitState;
  }
  if (task.status === 'waiting_external') return externalWaitDue(task, now) ? null : 'waiting_external';
  if (task.status === 'queued') return null;
  return null;
}

export function frontierSummary(frontier, contexts = [], now = new Date().toISOString(), inventory = {}, options = {}) {
  const tasks = frontier?.tasks || [];
  const nodes = frontier?.nodes || [];
  const counts = Object.fromEntries(['queued', 'running', 'waiting_user', 'waiting_external', 'blocked', 'done', 'skipped'].map((status) =>
    [status, tasks.filter((task) => task.status === status).length]));
  const unassignedNodes = nodes.filter((node) => node.discoveryState === 'unseen' &&
    !node.taskIds.some((id) => tasks.some((task) => task.id === id && !terminal.has(task.status))));
  const unseenInventory = (inventory.nodes || []).filter((node) => node.discoveryState === 'unseen' &&
    !tasks.some((task) => task.nodeId === node.id && !terminal.has(task.status)));
  const blockedNodes = nodes.filter((node) => node.discoveryState === 'blocked').length;
  const selected = selectNext(frontier, contexts, now);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const waitStates = tasks.filter((task) => !terminal.has(task.status))
    .map((task) => taskWaitState(task, tasksById, contexts, now)).filter(Boolean);
  let state;
  let reason;
  if (selected) [state, reason] = ['ready', 'A task is selectable under the current context, dependency, and time rules.'];
  else if (waitStates.includes('interrupted')) [state, reason] = ['interrupted', 'A task was running at the last checkpoint and needs explicit recovery.'];
  else if (waitStates.includes('waiting_user')) [state, reason] = ['waiting_user', 'A task needs a recorded context, user input, or authorization.'];
  else if (waitStates.includes('waiting_external')) [state, reason] = ['waiting_external', 'External work remains pending until its next check time.'];
  else if (waitStates.includes('blocked') || blockedNodes) [state, reason] = ['blocked', 'A task dependency or frontier node remains blocked.'];
  else if (unassignedNodes.length || unseenInventory.length) [state, reason] = ['inventory_incomplete', 'Unseen inventory still needs a discovery task.'];
  else if (tasks.every((task) => terminal.has(task.status)) && options.coverage?.counts?.gaps > 0) [state, reason] = ['needs_reconciliation', 'Recorded coverage gaps need explicit follow-up or exclusion.'];
  else if (tasks.every((task) => terminal.has(task.status)) && !options.coverage) [state, reason] = ['needs_reconciliation', 'Coverage is unassessed; run a coverage audit before declaring exhaustion.'];
  else if (tasks.every((task) => terminal.has(task.status))) [state, reason] = ['exhausted_in_scope', 'No remaining task, unseen inventory, or recorded coverage gap is in scope.'];
  else [state, reason] = ['blocked', 'Frontier work is not selectable under its current dependencies or context.'];
  return { state, reason, counts, unseenNodes: unassignedNodes.length + unseenInventory.length,
    totalNodes: nodes.length, blockedNodes, totalTasks: tasks.length,
    recoverableTaskIds: tasks.filter((task) => task.status === 'running').map((task) => task.id),
    coverage: options.coverage?.counts || null };
}
