export function mergeActivity(previous, events, { replace = false, limit = 60 } = {}) {
  const merged = replace ? events : [...previous, ...events];
  return merged.slice(-limit);
}

export function selectedEvidence(feature, stepId) {
  const step = feature?.steps?.find(item => item.id === stepId && item.screenshot);
  return step ? { featureId: feature.id, stepId: step.id, title: step.title, screenshot: step.screenshot } : null;
}

export function selectedDiscoveryEvidence(view, identity) {
  const step = view?.discoverySteps?.find(item => item.id === identity?.stepId && item.screenshot === identity?.ref);
  return step ? { featureId: view.feature.id, stepId: step.id, ref: step.screenshot, title: step.title } : null;
}

export function pollDelay(intervalMs, failures, hidden) {
  const backoff = Math.min(intervalMs * (2 ** Math.max(0, failures - 1)), 60000);
  return hidden ? Math.max(backoff, intervalMs * 4) : backoff;
}

export function heartbeatExpired(run) {
  return Boolean(run?.stale && ['running', 'waiting_user', 'waiting_external'].includes(run.storedStatus ?? run.status));
}

export function displayedRun(activeRuns, latestRun) {
  return activeRuns.at(-1) || latestRun || null;
}

export function visibilityAction(wasHidden, isHidden) {
  if (wasHidden && !isHidden) return 'refresh';
  if (isHidden) return 'reschedule';
  return null;
}
export function resolveFeatureSelection(view, selection = {}) {
  const scenarioId = selection.scenarioId || view?.selected?.scenarioId;
  const scenario = view?.scenarios?.find((item) => item.id === scenarioId);
  const execution = scenario?.executions?.find((item) => item.executionId === selection.executionId);
  if (execution) return { scenarioId: scenario.id, executionId: execution.executionId };
  const fallbackScenario = scenario || view?.scenarios?.[0] || null;
  return { scenarioId: fallbackScenario?.id || null, executionId: fallbackScenario?.currentExecutionId || fallbackScenario?.executions?.at(-1)?.executionId || null };
}

export function selectedScenarioEvidence(view, identity) {
  const scenario = view?.scenarios?.find((item) => item.id === identity?.scenarioId);
  const execution = scenario?.executions?.find((item) => item.executionId === identity?.executionId);
  if (!execution) return null;
  const step = (execution.steps || []).find((item) => item.id === identity.stepId && (item.evidenceRefs || []).includes(identity.ref));
  return step ? { scenarioId: scenario.id, executionId: execution.executionId, role: execution.role, stepId: step.id, ref: identity.ref, title: step.action } : null;
}

export function knowledgeRevisionChanged(previousRevision, nextRevision) {
  return previousRevision === undefined || previousRevision !== nextRevision;
}

export function shouldRefreshKnowledge(state, head) {
  return !state || state.schemaVersion !== head?.schemaVersion || head?.schemaVersion === 1 || knowledgeRevisionChanged(state.revision, head?.revision);
}

export function mergeLiveHead(state, head) {
  if (!state || state.revision !== head?.revision) return false;
  for (const key of ['syncedAt', 'summary', 'coverage', 'frontierSummary', 'activeRuns', 'latestRun', 'frontierCounts', 'displayRunId', 'currentTask', 'nextTask', 'activityCursor', 'diagnosticsCursor', 'diagnosticsGap']) {
    if (Object.hasOwn(head, key)) state[key] = head[key];
  }
  return true;
}
