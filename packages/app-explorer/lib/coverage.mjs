import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { enqueue } from './frontier.mjs';
import { SAFE_ID } from './schema.mjs';

const terminal = new Set(['done', 'skipped']);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

export function normalizeQuestions(feature) {
  return (feature?.questions || []).map((question) => {
    if (typeof question !== 'string') return { ...question };
    const id = `q.${createHash('sha256').update(`${feature.id}\0${question}`, 'utf8').digest('hex').slice(0, 24)}`;
    return { id, text: question, state: 'open', contextId: null, taskIds: [], evidenceRefs: [] };
  });
}

function taskBelongsToFeature(task, feature, scenariosById) {
  const scenarioFeatureId = task.scenarioId ? scenariosById.get(task.scenarioId) : null;
  if (task.featureId != null && task.featureId !== feature.id) return false;
  if (task.scenarioId != null && scenarioFeatureId !== feature.id) return false;
  return task.featureId === feature.id || scenarioFeatureId === feature.id || (task.featureId == null && task.scenarioId == null && task.nodeId === feature.id);
}

function validateQuestion(feature, question, { taskIds, taskById, scenariosById, contextIds, dir }) {
  if (!question || typeof question !== 'object' || !SAFE_ID.test(question.id || '') || !nonempty(question.text) || !['open', 'resolved', 'excluded'].includes(question.state)) {
    throw new Error(`Invalid question in ${feature.id}`);
  }
  if (question.contextId != null && (!SAFE_ID.test(question.contextId) || !contextIds.has(question.contextId))) throw new Error(`Unknown context ${question.contextId} in question ${question.id}`);
  if (!Array.isArray(question.taskIds) || question.taskIds.some((id) => !SAFE_ID.test(id) || !taskIds.has(id))) throw new Error(`Unknown task reference in question ${question.id}`);
  for (const id of question.taskIds) {
    const task = taskById.get(id);
    if (!taskBelongsToFeature(task, feature, scenariosById)) throw new Error(`Task ${id} is not linked to feature ${feature.id} for question ${question.id}`);
    if (question.contextId == null ? task.contextId != null : task.contextId != null && task.contextId !== question.contextId) {
      throw new Error(`Task ${id} is not linked to question context ${question.contextId}`);
    }
  }
  if (!Array.isArray(question.evidenceRefs)) throw new Error(`Invalid evidenceRefs in question ${question.id}`);
  for (const ref of question.evidenceRefs) {
    if (!nonempty(ref)) throw new Error(`Invalid evidence ref in question ${question.id}`);
    const segments = ref.replaceAll('\\', '/').split('/');
    if (segments.some((part) => !part || part === '.' || part === '..' || part.startsWith('.')) || !/\.(png|jpe?g|webp|txt|json)$/i.test(ref)) throw new Error(`Invalid evidence path: ${ref}`);
    const root = path.resolve(dir, 'evidence');
    const target = path.resolve(root, ...segments);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`Missing evidence: ${ref}`);
    let current = root;
    if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw new Error('Evidence directory is a symlink');
    for (const segment of segments) { current = path.join(current, segment); if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Evidence symlink not allowed: ${ref}`); }
  }
  if (question.state === 'resolved' && !question.evidenceRefs.length) throw new Error(`Resolved question ${question.id} needs linked evidence`);
  if (question.state === 'excluded' && !nonempty(question.reason)) throw new Error(`Excluded question ${question.id} needs a reason`);
}

export function validateCoverageReferences(data, dir) {
  const frontierTasks = data.frontier?.tasks || [];
  const taskIds = new Set(frontierTasks.map((task) => task.id));
  const taskById = new Map(frontierTasks.map((task) => [task.id, task]));
  const scenariosById = new Map((data.scenarios || data.inventory?.scenarios || []).map((scenario) => [scenario.id, scenario.featureId]));
  const contextIds = new Set((data.contexts || data.inventory?.contexts || []).map((context) => context.id));
  const scenarios = new Map((data.scenarios || data.inventory?.scenarios || []).map((scenario) => [scenario.id, scenario]));
  for (const feature of data.features || []) {
    if (feature.coverageExclusion != null && feature.coverageExclusion.contextId != null && !contextIds.has(feature.coverageExclusion.contextId)) {
      throw new Error(`Unknown context ${feature.coverageExclusion.contextId} in feature exclusion ${feature.id}`);
    }
    for (const question of normalizeQuestions(feature)) validateQuestion(feature, question, { taskIds, taskById, scenariosById, contextIds, dir });
    if (feature.research != null) {
      const questions = new Map(normalizeQuestions(feature).map((question) => [question.id, question]));
      for (const control of feature.research.controls || []) {
        if (!contextIds.has(control.contextId)) throw new Error(`Unknown context ${control.contextId} in research control ${control.id}`);
        if (control.status === 'tested') {
          const scenario = scenarios.get(control.scenarioId);
          if (!scenario || scenario.featureId !== feature.id || scenario.contextId !== control.contextId) throw new Error(`Research control ${control.id} must link a scenario in its feature and context`);
          const linkedEvidence = new Set([...(scenario.evidenceRefs || []), ...(scenario.steps || []).flatMap((step) => step.evidenceRefs || []), ...(scenario.history || []).flatMap((run) => [...(run.evidenceRefs || []), ...(run.steps || []).flatMap((step) => step.evidenceRefs || [])])]);
          if (!control.evidenceRefs.length || control.evidenceRefs.some((ref) => !linkedEvidence.has(ref))) throw new Error(`Research control ${control.id} evidence must be linked to its observed scenario`);
        } else {
          const question = questions.get(control.questionId);
          if (!question || question.state !== 'open' || (question.contextId != null && question.contextId !== control.contextId)) throw new Error(`Research control ${control.id} must link an open question in its context`);
          const hasOpenTask = question.taskIds.some((id) => taskById.has(id) && !['done', 'skipped'].includes(taskById.get(id).status));
          if (!hasOpenTask) throw new Error(`Research control ${control.id} needs an open follow-up task through question ${question.id}`);
        }
      }
    }
  }
  return true;
}

function featureTask(task, feature, scenariosById) {
  return taskBelongsToFeature(task, feature, scenariosById);
}

function taskInContext(task, contextId) {
  return task.contextId == null || (contextId != null && task.contextId === contextId);
}

function questionHasWork(question, tasks, feature, scenarios) {
  const scenariosById = new Map(scenarios.map((scenario) => [scenario.id, scenario.featureId]));
  return question.taskIds.some((id) => tasks.some((task) => task.id === id && !terminal.has(task.status) &&
    taskBelongsToFeature(task, feature, scenariosById) &&
    (question.contextId == null ? task.contextId == null : task.contextId == null || task.contextId === question.contextId)));
}

function featureScopes(feature, relatedScenarios, relatedTasks) {
  const contexts = new Set([
    ...relatedScenarios.map((scenario) => scenario.contextId),
    ...relatedTasks.map((task) => task.contextId),
    ...normalizeQuestions(feature).map((question) => question.contextId),
    feature.coverageExclusion?.contextId,
  ].filter((contextId) => contextId != null));
  return contexts.size ? [...contexts] : [null];
}

function featureExcludedIn(feature, scenarios, tasks, contextId) {
  const exclusion = feature.coverageExclusion;
  if (exclusion && nonempty(exclusion.reason) && (exclusion.contextId == null || exclusion.contextId === contextId)) return true;
  return scenarios.some((scenario) => scenario.featureId === feature.id && scenario.contextId === contextId && tasks.some((task) =>
    task.scenarioId === scenario.id && task.contextId === contextId && task.status === 'skipped' && nonempty(task.skipReason) && nonempty(task.excludedScope)));
}

/**
 * Optional contextIds limits output to the explicitly requested contexts.
 * Without it, feature gaps use only contexts associated with that feature's
 * questions, scenarios, or tasks; unassociated features get one app-scope gap.
 * Null-context questions remain app-scope. Inventory contexts are never
 * expanded into a feature-by-role cross product.
 */
export function auditCoverage(data, { contextIds } = {}) {
  const tasks = data.frontier?.tasks || [];
  const scenarios = data.scenarios || data.inventory?.scenarios || [];
  const scoped = contextIds != null;
  const gaps = [];
  for (const feature of data.features || []) {
    const relatedScenarios = scenarios.filter((scenario) => scenario.featureId === feature.id);
    const scenariosById = new Map(scenarios.map((scenario) => [scenario.id, scenario.featureId]));
    const relatedTasks = tasks.filter((task) => featureTask(task, feature, scenariosById));
    const questions = normalizeQuestions(feature);
    const associatedScopes = featureScopes(feature, relatedScenarios, relatedTasks);
    for (const question of questions) {
      if (question.state !== 'open') continue;
      if (scoped && question.contextId != null && !contextIds.includes(question.contextId)) continue;
      const contextId = question.contextId;
      if (!questionHasWork(question, tasks, feature, scenarios)) gaps.push({
        id: `coverage.${feature.id}.${question.id}.${contextId || 'app'}`, featureId: feature.id, questionId: question.id,
        contextId, reason: 'Open question has no nonterminal linked task in this context.',
      });
    }
    const targetScopes = scoped ? associatedScopes.filter((id) => id == null || contextIds.includes(id)) : associatedScopes;
    if (['discovered', 'partial'].includes(feature.status)) for (const contextId of targetScopes) {
      const hasWork = relatedTasks.some((task) => !terminal.has(task.status) && taskInContext(task, contextId));
      if (!hasWork && !featureExcludedIn(feature, relatedScenarios, tasks, contextId)) gaps.push({
        id: `coverage.${feature.id}.followup.${contextId || 'app'}`, featureId: feature.id, questionId: null, contextId,
        reason: 'Discovered or partial feature has no nonterminal follow-up task or explicit exclusion in this context.',
      });
    }
  }
  const questionCount = (data.features || []).reduce((sum, feature) => sum + normalizeQuestions(feature).length, 0);
  const counts = { features: (data.features || []).length, questions: questionCount, gaps: gaps.length };
  return { state: gaps.length ? 'needs_reconciliation' : 'clear', counts, gaps,
    scope: { contextIds: scoped ? [...new Set(contextIds)] : null, allContexts: !scoped } };
}

export function scopeCoverage(coverage, contextIds) {
  if (!coverage) return null;
  const requested = [...new Set(contextIds || [])];
  const audited = coverage.scope?.contextIds;
  if (Array.isArray(audited) && requested.some((id) => !audited.includes(id))) {
    const gaps = [...(coverage.gaps || []), { id: 'coverage.audit-scope-incomplete', featureId: null, questionId: null, contextId: null,
      reason: 'Coverage audit does not include every requested run context.' }];
    return { ...coverage, state: 'needs_reconciliation', counts: { ...coverage.counts, gaps: gaps.length }, gaps,
      scope: { contextIds: requested, allContexts: false } };
  }
  const selected = new Set(requested);
  const gaps = (coverage.gaps || []).filter((gap) => gap.contextId == null || selected.has(gap.contextId));
  return { ...coverage, state: gaps.length ? 'needs_reconciliation' : 'clear', counts: { ...coverage.counts, gaps: gaps.length }, gaps,
    scope: { contextIds: requested, allContexts: false } };
}

export async function reconcileCoverage(dir, { contextId, expectedRevision } = {}) {
  if (!SAFE_ID.test(contextId || '')) throw new Error('coverage reconcile requires an explicit existing contextId.');
  if (typeof expectedRevision !== 'string' || !/^r\d{6,}$/.test(expectedRevision)) throw new Error('coverage reconcile requires --expected-revision.');
  // Load lazily so store can share the validator without a static import cycle.
  const { loadWorkspace, applyObservation } = await import('./store.mjs');
    const data = loadWorkspace(dir);
    if (data.revision !== expectedRevision) throw new Error(`Revision conflict: expected ${expectedRevision}, found ${data.revision}`);
    const context = data.contexts.find((item) => item.id === contextId);
    if (!context) throw new Error(`Unknown context: ${contextId}`);
    let frontier = structuredClone(data.frontier || { nodes: [], edges: [], tasks: [] });
    const features = [];
    const taskIds = [];
    for (const feature of data.features) {
      const questions = normalizeQuestions(feature);
      let changed = false;
      const scenarios = (data.scenarios || []).filter((scenario) => scenario.featureId === feature.id);
      const scenariosById = new Map((data.scenarios || []).map((scenario) => [scenario.id, scenario.featureId]));
      const relatedTasks = () => frontier.tasks.filter((task) => featureTask(task, feature, scenariosById));
      const createTask = (question) => {
        const taskContextId = question?.contextId || contextId;
        const suffix = question ? question.id : 'followup';
        const baseKey = `${feature.id}.coverage.${suffix}.${taskContextId}`;
        let key = baseKey;
        const existing = frontier.tasks.filter((task) => task.key === baseKey || task.key.startsWith(`${baseKey}.reopen-`));
        const active = existing.find((task) => !terminal.has(task.status));
        if (active) return active.id;
        if (existing.length) {
          let generation = 2;
          while (existing.some((task) => task.key === `${baseKey}.reopen-${generation}`)) generation++;
          key = `${baseKey}.reopen-${generation}`;
        }
        const id = `coverage.${createHash('sha256').update(`${key}\0${taskContextId}`, 'utf8').digest('hex').slice(0, 20)}`;
        const nodeId = `coverage.${feature.id}`;
        const rootId = `root.${taskContextId}`;
        if (frontier.nodes.some((node) => node.id === rootId) && !frontier.edges.some((edge) => edge.from === rootId && edge.to === nodeId)) {
          frontier.edges.push({ from: rootId, to: nodeId, relation: 'coverage-followup' });
        }
        frontier = enqueue(frontier, { id, key, nodeId, nodeKind: 'capability', featureId: feature.id,
          kind: question ? 'verify_scenario' : 'discover_capability', status: 'queued', contextId: taskContextId, dependencies: [], parentTaskId: null,
          goal: question ? `Investigate: ${question.text}` : `Continue discovery of ${feature.title}.`,
          completionCriteria: ['Record the observed result, evidence, and any remaining branches.'], entry: { ...(feature.entry || {}) },
          checkpoint: null, blocker: null, attempts: 0, lastProgressAt: null });
        const found = frontier.tasks.find((task) => task.key === key);
        return found.id;
      };
      for (const question of questions) if (question.state === 'open' && (question.contextId == null || question.contextId === contextId) &&
        !questionHasWork(question, frontier.tasks, feature, scenarios)) {
        const id = createTask(question);
        question.taskIds = [...new Set([...question.taskIds, id])];
        question.contextId ||= contextId;
        taskIds.push(id);
        changed = true;
      }
      const currentTasks = relatedTasks();
      const scopes = featureScopes(feature, scenarios, currentTasks);
      const featureInSelectedScope = scopes.includes(null) || scopes.includes(contextId);
      const hasWork = currentTasks.some((task) => !terminal.has(task.status) && taskInContext(task, contextId));
      const hasQuestionWork = questions.some((question) => question.state === 'open' &&
        (question.contextId == null || question.contextId === contextId) && questionHasWork(question, frontier.tasks, feature, scenarios));
      if (['discovered', 'partial'].includes(feature.status) && featureInSelectedScope && !hasWork && !hasQuestionWork &&
        !featureExcludedIn(feature, scenarios, frontier.tasks, contextId)) {
        const id = createTask(null);
        taskIds.push(id);
        changed = true;
      }
      if (changed || feature.questions.some((question) => typeof question === 'string')) features.push({ ...feature, questions });
    }
    if (!features.length && !taskIds.length) return { receipt: { revision: data.revision }, taskIds: [] };
    const observation = { version: 2, baseRevision: expectedRevision, features, frontier: { nodes: frontier.nodes, edges: frontier.edges, tasks: frontier.tasks } };
    return { receipt: applyObservation(dir, observation, { expectedRevision }), taskIds };
}
