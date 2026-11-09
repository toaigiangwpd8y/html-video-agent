import { auditCoverage } from './coverage.mjs';
import { buildFeatureView } from './feature-view.mjs';

/** Derive research summaries from the same feature, scenario, and coverage records used elsewhere. */
export function buildResearchProjection(data, { featureId, contextId } = {}) {
  const features = data.features || [];
  const selected = featureId == null ? features : features.filter((feature) => feature.id === featureId);
  if (featureId != null && !selected.length) throw new Error(`Unknown feature: ${featureId}`);
  const contexts = data.contexts || data.inventory?.contexts || [];
  if (contextId != null && !contexts.some((context) => context.id === contextId)) throw new Error(`Unknown context: ${contextId}`);
  const selectedIds = new Set(selected.map((feature) => feature.id));
  const scenarios = (data.scenarios || data.inventory?.scenarios || []).filter((scenario) => selectedIds.has(scenario.featureId) && (contextId == null || scenario.contextId === contextId));
  const transitions = scenarios.flatMap((scenario) => (scenario.steps || []).filter((step) => typeof step.action === 'string' && step.action.trim() && typeof step.observed === 'string' && step.observed.trim()).map((step) => ({
    featureId: scenario.featureId, scenarioId: scenario.id, contextId: scenario.contextId,
    stepId: step.id, action: step.action, observed: step.observed, evidenceRefs: step.evidenceRefs || [],
  })));
  const stateSummaries = scenarios.map((scenario) => ({
    featureId: scenario.featureId, scenarioId: scenario.id, contextId: scenario.contextId,
    observedResults: (scenario.steps || []).filter((step) => typeof step.observed === 'string' && step.observed.trim()).map((step) => ({ stepId: step.id, value: step.observed, evidenceRefs: step.evidenceRefs || [] })),
  }));
  const sourceCandidates = selected.flatMap((feature) => (feature.research?.sourceCandidates || []).map((candidate) => ({ featureId: feature.id, ...candidate })));
  const controls = selected.flatMap((feature) => (feature.research?.controls || []).filter((control) => contextId == null || control.contextId === contextId).map((control) => ({ featureId: feature.id, ...control })));
  const views = selected.map((feature) => buildFeatureView(data, feature.id)).filter((view) => contextId == null || view.scenarios.some((scenario) => scenario.contextId === contextId));
  const scenarioFeatureIds = new Map((data.scenarios || data.inventory?.scenarios || []).map((scenario) => [scenario.id, scenario.featureId]));
  const openTasks = (data.frontier?.tasks || []).filter((task) => {
    const ownerFeatureId = task.featureId || scenarioFeatureIds.get(task.scenarioId);
    return selectedIds.has(ownerFeatureId) && !['done', 'skipped'].includes(task.status) && (contextId == null || task.contextId == null || task.contextId === contextId);
  });
  const coverage = contextId == null ? auditCoverage(data) : auditCoverage(data, { contextIds: [contextId] });
  const gaps = coverage.gaps.filter((gap) => selectedIds.has(gap.featureId) && (contextId == null || gap.contextId == null || gap.contextId === contextId));
  for (const control of controls) if (control.status !== 'tested') gaps.push({
    id: `coverage.${control.featureId}.control.${control.id}`, featureId: control.featureId,
    questionId: control.questionId || null, contextId: control.contextId,
    reason: control.status === 'blocked' ? 'Control is blocked; its linked question remains open.' : 'Control has not been tested; its linked question remains open.',
  });
  return {
    featureIds: selected.map((feature) => feature.id),
    observedStateSummaries: stateSummaries,
    observedTransitions: transitions,
    sourceCandidates,
    controls,
    remainingWork: openTasks,
    coverage: { state: gaps.length ? 'needs_reconciliation' : 'clear', gaps },
    scenarios: views.flatMap((view) => view.scenarios).filter((scenario) => contextId == null || scenario.contextId === contextId),
    verification: views.map((view) => ({ featureId: view.feature.id, ...view.verification })),
  };
}
