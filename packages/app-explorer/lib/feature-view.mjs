import { auditCoverage } from './coverage.mjs';

const terminalTasks = new Set(['done', 'skipped']);
const byLatest = (items) => items.at(-1) || null;
const contextFor = (contexts, id) => contexts.find((context) => context.id === id) || null;
const coverageCache = new WeakMap();
function coverageAudits(data) {
  if (coverageCache.has(data)) return coverageCache.get(data);
  const ids = new Set([...(data.scenarios || data.inventory?.scenarios || []).map((item) => item.contextId), ...(data.frontier?.tasks || []).map((item) => item.contextId), ...(data.features || []).flatMap((feature) => [...(feature.questions || []).map((item) => typeof item === 'string' ? null : item.contextId), feature.coverageExclusion?.contextId])].filter(Boolean));
  const contexts = new Map([...ids].map((id) => [id, auditCoverage(data, { contextIds: [id] })]));
  const result = { contexts, all: auditCoverage(data) }; coverageCache.set(data, result); return result;
}
function executionView(scenario, execution, contexts) {
  const testedContext = execution?.testedContext || scenario.testedContext || null;
  const contextId = testedContext?.contextId || scenario.contextId || null;
  const context = contextFor(contexts, contextId);
  const role = testedContext?.role || context?.role || null;
  const date = testedContext?.date || scenario.lastVerifiedAt || null;
  const completionCriteria = execution?.completionCriteria || scenario.completionCriteria || [];
  const steps = execution?.steps || scenario.steps || [];
  const outcome = execution?.migrationReview ? 'unknown' : (execution?.outcome || scenario.outcome || 'unknown');
  const evidenceRefs = execution?.evidenceRefs || scenario.evidenceRefs || [];
  const supported = ['success', 'expected_denial'].includes(outcome) && Boolean(role && date && evidenceRefs.length && completionCriteria.length && completionCriteria.every((criterion) => criterion.met === true && criterion.evidenceRefs?.length && steps.some((step) => step.evidenceRefs?.some((ref) => criterion.evidenceRefs.includes(ref)))));
  return {
    scenarioId: scenario.id, executionId: execution?.executionId || null,
    outcome, role, date, contextId, contextLabel: context?.label || contextId,
    migrationReview: Boolean(execution?.migrationReview), supported,
    testedContext, completionCriteria, steps, evidenceRefs,
  };
}

/** Build the scenario-first display/export model for one feature. */
export function buildFeatureView(data, featureId, { scenarioId, executionId } = {}) {
  const feature = data.features.find((item) => item.id === featureId);
  if (!feature) throw new Error(`Unknown feature: ${featureId}`);
  const contexts = data.contexts || data.inventory?.contexts || [];
  const relatedScenarios = (data.scenarios || data.inventory?.scenarios || []).filter((item) => item.featureId === featureId);
  const scenarios = relatedScenarios.map((scenario) => {
    const history = (scenario.history || []).map((execution) => executionView(scenario, execution, contexts));
    const current = history.at(-1) || executionView(scenario, null, contexts);
    return {
      id: scenario.id, featureId: scenario.featureId, contextId: scenario.contextId,
      goal: scenario.goal, preconditions: scenario.preconditions || [],
      completionCriteria: current.completionCriteria, steps: current.steps,
      outcome: current.outcome, role: current.role || contextFor(contexts, scenario.contextId)?.role || null,
      date: current.date, evidenceRefs: current.evidenceRefs, supported: current.supported,
      executions: history, currentExecutionId: history.at(-1)?.executionId || null,
    };
  });
  const allExecutions = scenarios.flatMap((scenario) => scenario.executions);
  let selectedScenario = scenarios.find((item) => item.id === scenarioId) || null;
  let selectedExecution = executionId ? allExecutions.find((item) => item.executionId === executionId) : null;
  if (selectedExecution) selectedScenario = scenarios.find((item) => item.id === selectedExecution.scenarioId) || selectedScenario;
  if (!selectedScenario && scenarios.length) selectedScenario = scenarios.reduce((latest, item) => item.executions.length >= (latest?.executions.length || 0) ? item : latest, null);
  if (!selectedExecution && selectedScenario) selectedExecution = byLatest(selectedScenario.executions) || executionView(relatedScenarios.find((item) => item.id === selectedScenario.id), null, contexts);
  const verification = data.schemaVersion === 2 ? (() => {
    const isSupported = (item) => item.executions.at(-1)?.supported ?? item.supported;
    const verifiedScenarioIds = scenarios.filter(isSupported).map((item) => item.id);
    const unknownScenarioIds = scenarios.filter((item) => item.outcome === 'unknown' || !isSupported(item)).map((item) => item.id);
    return { state: verifiedScenarioIds.length ? (unknownScenarioIds.length ? 'partially_verified' : 'verified') : scenarios.length ? 'unknown' : 'unverified', verifiedScenarioIds, unknownScenarioIds };
  })() : { state: feature.status === 'verified' ? 'verified' : 'unverified', verifiedScenarioIds: [], unknownScenarioIds: [] };
  const selectedContextId = selectedExecution?.contextId || selectedScenario?.contextId || null;
  const questions = data.schemaVersion === 2 ? feature.questions || [] : feature.questions || [];
  const taskBelongs = (task) => task.featureId === featureId || task.nodeId === featureId || relatedScenarios.some((item) => item.id === task.scenarioId);
  const featureTasks = data.schemaVersion === 2 ? (data.frontier?.tasks || []).filter(taskBelongs) : [];
  const openTasks = data.schemaVersion === 2 ? featureTasks.filter((task) => !terminalTasks.has(task.status)) : feature.nextActions || [];
  const contextsInScope = [...new Set([...relatedScenarios.map((item) => item.contextId), ...featureTasks.map((item) => item.contextId), ...(feature.questions || []).map((item) => typeof item === 'string' ? null : item.contextId), feature.coverageExclusion?.contextId].filter(Boolean))];
  const exclusions = data.schemaVersion === 2 ? [
    ...(feature.coverageExclusion ? [{ kind: 'feature', reason: feature.coverageExclusion.reason, contextId: feature.coverageExclusion.contextId }] : []),
    ...featureTasks.filter((task) => task.status === 'skipped' && task.skipReason && task.excludedScope).map((task) => ({ kind: 'scenario', reason: task.skipReason, excludedScope: task.excludedScope, contextId: task.contextId, scenarioId: task.scenarioId || null })),
  ] : [];
  const audits = data.schemaVersion === 2 ? coverageAudits(data) : null;
  const coverageByContext = data.schemaVersion === 2 ? Object.fromEntries(contextsInScope.map((id) => { const audit = audits.contexts.get(id) || audits.all; return [id, { state: audit.state, gaps: audit.gaps.filter((gap) => gap.featureId === featureId), exclusions: exclusions.filter((item) => item.contextId == null || item.contextId === id) }]; })) : {};
  const coverage = data.schemaVersion === 2 ? (selectedContextId ? audits.contexts.get(selectedContextId) || audits.all : audits.all) : null;
  const featureGaps = coverage?.gaps.filter((gap) => gap.featureId === featureId) || [];
  const applicableExclusion = exclusions.find((item) => item.contextId == null || item.contextId === selectedContextId) || null;
  return {
    feature: { id: feature.id, title: feature.title, area: feature.area, summary: feature.summary, entry: feature.entry || {}, research: feature.research || { sourceCandidates: [], controls: [] } },
    legacy: data.schemaVersion !== 2,
    discoverySteps: feature.steps || [],
    legacySteps: data.schemaVersion === 2 ? [] : feature.steps || [],
    legacyVerification: data.schemaVersion === 2 ? null : { status: feature.status, role: feature.testedContext?.role || null, date: feature.testedContext?.date || feature.lastVerifiedAt || null },
    scenarios, selected: data.schemaVersion === 2 ? (selectedExecution ? { ...selectedExecution } : null) : { scenarioId: null, executionId: null, outcome: feature.status === 'verified' ? 'success' : 'unknown', role: feature.testedContext?.role || null, date: feature.testedContext?.date || feature.lastVerifiedAt || null, contextId: null, completionCriteria: [], steps: feature.steps || [], evidenceRefs: (feature.steps || []).flatMap((step) => step.screenshot ? [step.screenshot] : step.snapshot ? [step.snapshot] : []) },
    questions, openTasks, coverage: coverage ? { state: coverage.state, gaps: featureGaps, exclusion: applicableExclusion, exclusions } : null, coverageByContext,
    verification,
  };
}

const md = (value) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const mdCode = (value) => {
  const text = String(value ?? '');
  const runs = [...text.matchAll(/`+/g)].map((match) => match[0].length);
  const delimiter = '`'.repeat(Math.max(1, ...runs) + 1);
  const pad = /^\s|\s$/.test(text) || text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${delimiter}${pad}${text}${pad}${delimiter}`;
};
const evidenceUrl = (ref) => `../../evidence/${ref.split('/').map(encodeURIComponent).join('/')}`;
const evidenceLink = (ref) => `[${md(ref)}](${evidenceUrl(ref)})`;
/** Render Markdown from the same projection used by the dashboard. */
export function featureViewMarkdown(view) {
  const lines = [`# ${md(view.feature.title)}`, '', `**Area:** ${md(view.feature.area)}`, '', md(view.feature.summary), '', '**Scenario verification:** ' + view.verification.state, ''];
  if (view.legacy) {
    lines.push(`**Legacy status:** ${view.legacyVerification.status}`, `**Tested role/date:** ${view.legacyVerification.role || 'Unknown'} / ${view.legacyVerification.date || 'Unknown'}`, '', '## Walkthrough', '');
    for (const step of view.legacySteps) {
      lines.push(`### ${md(step.title)}`, '', `**Action:** ${md(step.action)}`, '', `**Observed:** ${md(step.observed || 'Unknown')}`, '');
      if (step.screenshot) lines.push(`![Evidence for ${md(step.title)}](${evidenceUrl(step.screenshot)})`, '');
      if (step.snapshot) lines.push(`[Read snapshot](${evidenceUrl(step.snapshot)})`, '');
    }
  } else {
    if (view.discoverySteps.length) {
      lines.push('## Discovery observations', '');
      for (const step of view.discoverySteps) {
        lines.push(`### ${md(step.title)}`, '', `**Action:** ${md(step.action)}`, '', `**Observed:** ${md(step.observed || 'Unknown')}`, '');
        if (step.screenshot) lines.push(`![Discovery evidence for ${md(step.title)}](${evidenceUrl(step.screenshot)})`, '');
        if (step.snapshot) lines.push(`[Read discovery snapshot](${evidenceUrl(step.snapshot)})`, '');
      }
    }
    for (const scenario of view.scenarios) {
      lines.push(`## Scenario: ${md(scenario.goal)}`, '', `**Scenario ID:** ${scenario.id}`, `**Context:** ${scenario.role || 'Unknown'} / ${scenario.contextId}`, '');
      for (const run of scenario.executions.length ? scenario.executions : [scenario]) {
        lines.push(`### Execution ${run.executionId || 'not yet recorded'}`, '', `**Outcome:** ${run.outcome}${run.supported ? ' (verified in this scenario/context)' : ' (not verified)'}`, `**Tested role/date:** ${run.role || 'Unknown'} / ${run.date || 'Unknown'}`, '');
        if (run.completionCriteria?.length) { lines.push('**Completion criteria:**', ''); for (const criterion of run.completionCriteria) { lines.push(`- ${criterion.met ? 'Met' : 'Open'}: ${md(criterion.description)}${criterion.observed ? ` - ${md(criterion.observed)}` : ''}`); for (const ref of criterion.evidenceRefs || []) lines.push(`  - Evidence: ${evidenceLink(ref)}`); } lines.push(''); }
        for (const step of run.steps || []) {
          lines.push(`- **${md(step.action)}** - ${md(step.observed || 'Unknown')}`);
          for (const ref of step.evidenceRefs || []) lines.push(`  - Evidence: ${evidenceLink(ref)}`);
        }
        if ((run.steps || []).length) lines.push('');
        for (const ref of run.evidenceRefs || []) lines.push(`- Execution evidence: ${evidenceLink(ref)}`);
        if (run.evidenceRefs?.length) lines.push('');
      }
    }
  }
  if (view.verification.unknownScenarioIds.length) lines.push('## Unknown scenarios', '', ...view.verification.unknownScenarioIds.map((id) => `- ${id}: outcome or evidence remains unknown.`), '');
  if (view.coverage?.exclusions.length) lines.push('## Explicit exclusions', '', ...view.coverage.exclusions.map((item) => `- ${md(item.reason)} (context: ${item.contextId ?? 'app-wide'}${item.excludedScope ? `; scope: ${item.excludedScope}` : ''})`), '');
  if (view.questions.length) { lines.push('## Questions', ''); for (const question of view.questions) { lines.push(`- ${md(typeof question === 'string' ? question : question.text)}${typeof question === 'object' ? ` (${question.state}; context: ${question.contextId ?? 'app-wide'})` : ''}`); if (typeof question === 'object') for (const ref of question.evidenceRefs || []) lines.push(`  - Evidence: ${evidenceLink(ref)}`); } lines.push(''); }
  if (view.openTasks.length) lines.push('## Open work', '', ...view.openTasks.map((task) => `- **${md(task.goal)}** - ${md(task.status || task.reason || 'open')}`), '');
  if (view.coverage?.gaps.length) lines.push('## Coverage unknowns', '', ...view.coverage.gaps.map((gap) => `- ${gap.reason}${gap.contextId ? ` (context: ${gap.contextId})` : ''}`), '');
  if (view.feature.research?.sourceCandidates?.length) {
    lines.push('## Source candidates', '');
    for (const candidate of view.feature.research.sourceCandidates) {
      const sourceRef = `${candidate.sourceAlias}:${candidate.relativePath}${candidate.lineStart ? `:${candidate.lineStart}${candidate.lineEnd && candidate.lineEnd !== candidate.lineStart ? `-${candidate.lineEnd}` : ''}` : ''}`;
      lines.push(`- **${md(candidate.id)}** — candidate only: ${mdCode(sourceRef)} — ${md(candidate.note)}`);
    }
    lines.push('');
  }
  if (view.feature.research?.controls?.length) {
    lines.push('## Control inventory', '');
    for (const control of view.feature.research.controls) {
      lines.push(`- **${md(control.label)}** — ${control.status} (context: ${md(control.contextId)})${control.scenarioId ? `; scenario: ${md(control.scenarioId)}` : ''}${control.questionId ? `; question: ${md(control.questionId)}` : ''}`);
      for (const ref of control.evidenceRefs || []) lines.push(`  - Evidence: ${evidenceLink(ref)}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
