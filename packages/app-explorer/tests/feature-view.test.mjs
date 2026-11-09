import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeatureView } from '../lib/feature-view.mjs';

const contexts = [
  { id: 'member.demo', role: 'member', date: '2026-10-16' },
  { id: 'reviewer.demo', role: 'reviewer', date: '2026-10-16' },
];
const execution = (scenarioId, executionId, overrides = {}) => ({
  scenarioId, executionId, outcome: 'success', evidenceRefs: ['run/screen.png'],
  testedContext: { contextId: scenarioId.endsWith('reviewer') ? 'reviewer.demo' : 'member.demo', role: scenarioId.endsWith('reviewer') ? 'reviewer' : 'member', date: '2026-10-16' },
  completionCriteria: [{ id: 'visible', description: 'Result is visible', met: true, observed: 'Result appears', evidenceRefs: ['run/screen.png'] }],
  steps: [{ id: 'submit', action: 'Submit', observed: 'Result appears', evidenceRefs: ['run/screen.png'] }],
  ...overrides,
});
const scenario = (id, contextId, history, overrides = {}) => ({
  id, featureId: 'records.create', contextId, goal: 'Create record', preconditions: [],
  completionCriteria: [], steps: [], outcome: 'unknown', evidenceRefs: [], history, ...overrides,
});
function data(overrides = {}) {
  return {
    schemaVersion: 2,
    app: { name: 'Example', baseUrl: 'http://127.0.0.1:4999' },
    features: [{ id: 'records.create', title: 'Create record', area: 'Records', summary: 'Create a record.', entry: { url: '/records' }, status: 'discovered', steps: [], nextActions: [], questions: [] }],
    scenarios: [
      scenario('records.create.member', 'member.demo', [execution('records.create.member', 'exec-member')]),
      scenario('records.create.reviewer', 'reviewer.demo', [execution('records.create.reviewer', 'exec-reviewer')]),
    ],
    contexts,
    frontier: { tasks: [] },
    ...overrides,
  };
}

test('V2 scenarios display their own role and date without legacy feature verification fields', () => {
  const view = buildFeatureView(data(), 'records.create');
  assert.equal(view.selected.executionId, 'exec-reviewer');
  assert.equal(view.selected.role, 'reviewer');
  assert.equal(view.selected.date, '2026-10-16');
  assert.deepEqual(view.scenarios.map((item) => item.role), ['member', 'reviewer']);
  assert.equal(view.verification.state, 'verified');
  assert.deepEqual(view.verification.verifiedScenarioIds, ['records.create.member', 'records.create.reviewer']);
});

test('verification is scoped when one scenario succeeds and another branch remains unknown', () => {
  const input = data({ scenarios: [
    scenario('records.create.member', 'member.demo', [execution('records.create.member', 'exec-success')]),
    scenario('records.create.reviewer', 'reviewer.demo', [execution('records.create.reviewer', 'exec-unknown', { outcome: 'unknown', evidenceRefs: [], testedContext: null, completionCriteria: [], steps: [] })]),
  ] });
  const view = buildFeatureView(input, 'records.create');
  assert.equal(view.verification.state, 'partially_verified');
  assert.deepEqual(view.verification.unknownScenarioIds, ['records.create.reviewer']);
  assert.equal(view.selected.executionId, 'exec-unknown');
});

test('expected denial is a supported verified outcome with its actual execution context', () => {
  const input = data({ scenarios: [scenario('records.create.reviewer', 'reviewer.demo', [execution('records.create.reviewer', 'exec-denied', { outcome: 'expected_denial' })])] });
  const view = buildFeatureView(input, 'records.create');
  assert.equal(view.verification.state, 'verified');
  assert.equal(view.selected.outcome, 'expected_denial');
  assert.equal(view.selected.role, 'reviewer');
});

test('V2 scenario current fields can verify without inventing an execution history', () => {
  const current = scenario('records.create.member', 'member.demo', [], {
    outcome: 'success',
    testedContext: { contextId: 'member.demo', role: 'member', date: '2026-10-16' },
    lastVerifiedAt: '2026-10-16',
    evidenceRefs: ['run/screen.png'],
    completionCriteria: [{ id: 'visible', description: 'Result is visible', met: true, evidenceRefs: ['run/screen.png'] }],
    steps: [{ id: 'submit', action: 'Submit', observed: 'Result appears', evidenceRefs: ['run/screen.png'] }],
  });
  const view = buildFeatureView(data({ scenarios: [current] }), 'records.create');
  assert.equal(view.verification.state, 'verified');
  assert.deepEqual(view.verification.verifiedScenarioIds, [current.id]);
  assert.deepEqual(view.verification.unknownScenarioIds, []);
  assert.equal(view.selected.outcome, 'success');
  assert.equal(view.selected.supported, true);
  assert.equal(view.selected.executionId, null);
  assert.deepEqual(view.scenarios[0].executions, []);
});

test('migrationReview executions stay unknown even if legacy fields imply success', () => {
  const input = data({ scenarios: [scenario('records.create.member', 'member.demo', [execution('records.create.member', 'exec-migrated', { outcome: 'success', migrationReview: true })])] });
  const view = buildFeatureView(input, 'records.create');
  assert.equal(view.verification.state, 'unknown');
  assert.equal(view.selected.outcome, 'unknown');
});

test('historical execution selection remains stable after a newer execution is added', () => {
  const input = data();
  const historical = buildFeatureView(input, 'records.create', { scenarioId: 'records.create.member', executionId: 'exec-member' });
  input.scenarios[0].history.push(execution('records.create.member', 'exec-member-new', { testedContext: { contextId: 'member.demo', role: 'member', date: '2026-10-17' } }));
  const refreshed = buildFeatureView(input, 'records.create', { scenarioId: historical.selected.scenarioId, executionId: historical.selected.executionId });
  assert.equal(refreshed.selected.executionId, 'exec-member');
  assert.equal(refreshed.selected.date, '2026-10-16');
});

test('V1 fallback reads legacy walkthrough and verification fields', () => {
  const input = data({ schemaVersion: 1, scenarios: [], contexts: [], features: [{
    id: 'records.create', title: 'Create record', area: 'Records', summary: 'Create a record.', status: 'verified',
    testedContext: { role: 'member', date: '2026-10-16' }, lastVerifiedAt: '2026-10-16',
    steps: [{ id: 'submit', title: 'Submit', action: 'Submit form', observed: 'Record appears', screenshot: 'run/screen.png' }],
    questions: ['Can a member create?'], nextActions: [],
  }] });
  const view = buildFeatureView(input, 'records.create');
  assert.equal(view.legacy, true);
  assert.equal(view.verification.state, 'verified');
  assert.equal(view.selected.role, 'member');
  assert.equal(view.scenarios.length, 0);
  assert.deepEqual(view.discoverySteps, input.features[0].steps);
  assert.equal(view.legacySteps[0].screenshot, 'run/screen.png');
});

test('structured questions and open work remain records in the projection', () => {
  const input = data({
    features: [{ ...data().features[0], questions: [{ id: 'q.one', text: 'Which roles?', state: 'open', contextId: 'reviewer.demo', taskIds: ['task.review'], evidenceRefs: [] }] }],
    frontier: { tasks: [
      { id: 'task.review', featureId: 'records.create', scenarioId: 'records.create.reviewer', contextId: 'reviewer.demo', status: 'queued', kind: 'verify_scenario', goal: 'Check reviewer', depth: 1, sequence: 1 },
      { id: 'task.done', featureId: 'records.create', scenarioId: 'records.create.reviewer', contextId: 'reviewer.demo', status: 'done', kind: 'verify_scenario', goal: 'Already closed', depth: 1, sequence: 0 },
    ] },
  });
  const view = buildFeatureView(input, 'records.create', { scenarioId: 'records.create.reviewer' });
  assert.deepEqual(view.questions[0], input.features[0].questions[0]);
  assert.equal(view.openTasks.length, 1);
  assert.equal(view.openTasks[0].goal, 'Check reviewer');
});
