import { summary, tasks } from './store.mjs';
import { auditCoverage } from './coverage.mjs';
import { frontierSummary } from './frontier.mjs';
import { deriveRunState, readyUnownedTasks, runHeartbeatThresholdMs } from './runs.mjs';
import { buildFeatureView } from './feature-view.mjs';
import { effectiveHeartbeatAt } from './presence.mjs';

function derivedFor(data) {
  const coverage = data.schemaVersion === 2 ? auditCoverage(data) : undefined;
  return { coverage, summary: summary(data), tasks: tasks(data), featureViews: data.features.map((feature) => buildFeatureView(data, feature.id)) };
}

export function buildExplorerHead(data, currentTime = new Date(), options = {}) {
  const derived = options.derived ?? derivedFor(data);
  const coverage = derived.coverage;
  const runOptions = { contexts: data.contexts, inventory: data.inventory, coverage };
  const activeRuns = data.runs.map((run) => {
    const current = { ...run };
    const heartbeatAt = current.effectiveHeartbeatAt ?? (options.dataDir ? effectiveHeartbeatAt(options.dataDir, current) : current.heartbeatAt);
    const state = deriveRunState(current, data.frontier, currentTime, runOptions);
    return { run: current, state, heartbeatAt };
  }).filter(({ run }) => ['running', 'waiting_user', 'waiting_external'].includes(run.status) || run.status === 'interrupted')
    .map(({ run, state, heartbeatAt }) => ({ id: run.id, status: state.status, storedStatus: run.status,
      currentTaskId: run.currentTaskId, heartbeatAt, stale: state.stale, reason: state.reason,
      stateReason: run.stateReason || null, stopReason: run.stopReason || null }));
  const readiness = data.schemaVersion === 2
    ? frontierSummary(data.frontier, data.contexts, currentTime.toISOString(), data.inventory, { coverage })
    : { state: derived.tasks.length ? 'legacy_work_pending' : 'legacy_no_open_tasks', reason: 'V1 workspace has no canonical V2 frontier; migrate to assess full readiness.', counts: { ready: derived.tasks.length, waiting_user: 0, waiting_external: 0, blocked: 0, interrupted: 0, done: 0, skipped: 0 }, blockedNodes: 0, recoverableTaskIds: [] };
  const readyTasks = data.schemaVersion === 2
    ? readyUnownedTasks(data.frontier, data.contexts, currentTime.toISOString(), data.runs, { ...runOptions, staleAfterMs: runHeartbeatThresholdMs() })
    : derived.tasks;
  const nextTask = readyTasks[0] || null;
  const frontierCounts = { ready: readyTasks.length,
    waiting: readiness.counts.waiting_user + readiness.counts.waiting_external,
    blocked: readiness.counts.blocked + readiness.blockedNodes, done: readiness.counts.done, skipped: readiness.counts.skipped };
  const latest = data.runs.at(-1);
  const latestRun = latest ? (() => {
    const state = deriveRunState(latest, data.frontier, currentTime, runOptions);
    return { id: latest.id, status: state.status, storedStatus: latest.status, currentTaskId: latest.currentTaskId,
      heartbeatAt: latest.effectiveHeartbeatAt ?? (options.dataDir ? effectiveHeartbeatAt(options.dataDir, latest) : latest.heartbeatAt),
      stale: state.stale, reason: state.reason, stateReason: latest.stateReason || null, stopReason: latest.stopReason || null };
  })() : null;
  const displayRun = activeRuns.at(-1) || latestRun;
  if (!nextTask && activeRuns.some((run) => !run.stale && run.status === 'running') && ['ready', 'interrupted'].includes(readiness.state)) {
    readiness.state = 'running';
    readiness.reason = 'Ready work is currently owned by a run with a fresh heartbeat.';
  }
  const diagnostics = options.diagnostics ?? { cursor: null, gap: false };
  return { revision: data.revision, schemaVersion: data.schemaVersion, syncedAt: currentTime.toISOString(),
    summary: derived.summary, coverage: coverage?.counts || null, frontierSummary: readiness, activeRuns, latestRun,
    frontierCounts, displayRunId: displayRun?.id || null, currentTask: displayRun?.currentTaskId || null,
    nextTask: nextTask ? { id: nextTask.id, goal: nextTask.goal, depth: nextTask.depth, status: nextTask.status } : null,
    activityCursor: data.activity.at(-1)?.id ?? null, diagnosticsCursor: diagnostics.cursor, diagnosticsGap: diagnostics.gap };
}

export function buildExplorerState(data, currentTime = new Date(), options = {}) {
  const derived = options.derived ?? derivedFor(data);
  const head = buildExplorerHead(data, currentTime, { ...options, derived });
  return { ...data, featureViews: derived.featureViews, summary: derived.summary, tasks: derived.tasks, ...head };
}
