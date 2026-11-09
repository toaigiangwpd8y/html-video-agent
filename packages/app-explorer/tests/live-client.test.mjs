import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeActivity, pollDelay, selectedEvidence, resolveFeatureSelection, selectedScenarioEvidence, displayedRun, heartbeatExpired, visibilityAction, knowledgeRevisionChanged, shouldRefreshKnowledge, mergeLiveHead } from '../public/live-utils.js';

test('only active runs with expired heartbeat are labeled as heartbeat loss', () => {
  assert.equal(heartbeatExpired({ status: 'interrupted', storedStatus: 'interrupted', stale: true }), false);
  assert.equal(heartbeatExpired({ status: 'interrupted', storedStatus: 'running', stale: true }), true);
  assert.equal(heartbeatExpired({ status: 'running', storedStatus: 'running', stale: false }), false);
});

test('activity resync replaces the old timeline with the returned snapshot', () => {
  const previous = [{ id: 'old', message: 'expired' }, { id: 'kept', message: 'also expired' }];
  const snapshot = [{ id: 'kept', message: 'current' }, { id: 'new', message: 'new event' }];
  const result = mergeActivity(previous, snapshot, { replace: true, limit: 60 });
  assert.deepEqual(result, snapshot);
  assert.equal(new Set(result.map(event => event.id)).size, result.length);
});

test('selected evidence resolves by step ID even when two screenshot titles match', () => {
  const feature = { id: 'projects.create', steps: [
    { id: 'dialog-one', title: 'Screenshot', screenshot: 'run-01/one.png' },
    { id: 'dialog-two', title: 'Screenshot', screenshot: 'run-01/two.png' }
  ] };
  assert.deepEqual(selectedEvidence(feature, 'dialog-two'), {
    featureId: 'projects.create', stepId: 'dialog-two', title: 'Screenshot', screenshot: 'run-01/two.png'
  });
  const updated = { ...feature, steps: feature.steps.map(step => step.id === 'dialog-two' ? { ...step, screenshot: 'run-02/two.png' } : step) };
  assert.equal(selectedEvidence(updated, 'dialog-two').screenshot, 'run-02/two.png');
  assert.equal(selectedEvidence({ ...feature, steps: [] }, 'dialog-two'), null);
});

test('hiding reschedules the timer immediately and returning visible refreshes', () => {
  assert.equal(visibilityAction(false, true), 'reschedule');
  assert.equal(visibilityAction(true, false), 'refresh');
  assert.equal(visibilityAction(false, false), null);
});

test('hidden transition schedules no earlier than four polling intervals', () => {
  assert.equal(pollDelay(1000, 0, false), 1000);
  assert.equal(pollDelay(1000, 0, true), 4000);
  assert.equal(pollDelay(1000, 2, true), 4000);
  assert.equal(pollDelay(15000, 2, true), 60000);
});

test('displayed run and task are selected from the same latest active run', () => {
  const activeRuns = [
    { id: 'run-old', status: 'running', currentTaskId: 'task-old' },
    { id: 'run-new', status: 'waiting_user', currentTaskId: 'task-new' }
  ];
  assert.equal(displayedRun(activeRuns, { id: 'run-finished', status: 'done' }).id, 'run-new');
  assert.equal(displayedRun([], { id: 'run-finished', status: 'done' }).id, 'run-finished');
});
const liveSelectionView = {
  selected: { scenarioId: 'create.member', executionId: 'member-1' },
  scenarios: [
    { id: 'create.member', executions: [
      { scenarioId: 'create.member', executionId: 'member-1', role: 'member', steps: [{ id: 'save', evidenceRefs: ['member.png'] }] },
      { scenarioId: 'create.member', executionId: 'member-2', role: 'member', steps: [{ id: 'save', evidenceRefs: ['member-new.png'] }] },
    ] },
    { id: 'create.reviewer', executions: [
      { scenarioId: 'create.reviewer', executionId: 'reviewer-1', role: 'reviewer', steps: [{ id: 'save', evidenceRefs: ['reviewer.png'] }] },
    ] },
  ],
};

test('live selection retains the chosen historical execution when a newer one arrives', () => {
  const next = resolveFeatureSelection(liveSelectionView, { scenarioId: 'create.member', executionId: 'member-1' });
  assert.equal(next.scenarioId, 'create.member');
  assert.equal(next.executionId, 'member-1');
});

test('live evidence identity stays on the chosen execution, role, step, and reference', () => {
  const picked = selectedScenarioEvidence(liveSelectionView, { scenarioId: 'create.member', executionId: 'member-1', stepId: 'save', ref: 'member.png' });
  assert.equal(picked.role, 'member');
  assert.equal(picked.ref, 'member.png');
  assert.equal(selectedScenarioEvidence(liveSelectionView, { scenarioId: 'create.reviewer', executionId: 'reviewer-1', stepId: 'save', ref: 'member.png' }), null);
});

test('same-revision head polls do not request another heavy knowledge snapshot', () => {
  assert.equal(knowledgeRevisionChanged('r000001', 'r000001'), false);
  assert.equal(knowledgeRevisionChanged(null, null), false);
  assert.equal(knowledgeRevisionChanged(undefined, null), true);
  assert.equal(knowledgeRevisionChanged('r000001', 'r000002'), true);
  assert.equal(knowledgeRevisionChanged(null, 'r000001'), true);
});

test('knowledge refresh reloads V1 on each poll while V2 follows immutable revisions', () => {
  const v1 = { schemaVersion: 1, revision: null };
  const v2 = { schemaVersion: 2, revision: 'r000001' };
  assert.equal(shouldRefreshKnowledge(v1, { schemaVersion: 1, revision: null }), true);
  assert.equal(shouldRefreshKnowledge(v2, { schemaVersion: 2, revision: 'r000001' }), false);
  assert.equal(shouldRefreshKnowledge(v2, { schemaVersion: 2, revision: 'r000002' }), true);
});

test('live head fields are merged only into the matching knowledge receipt', () => {
  const state = { revision: 'r000002', nextTask: { id: 'new-task' }, activeRuns: [{ id: 'new-run' }] };
  const head = { revision: 'r000001', nextTask: { id: 'old-task' }, activeRuns: [{ id: 'old-run' }] };
  assert.equal(mergeLiveHead(state, head), false);
  assert.equal(state.revision, 'r000002');
  assert.equal(state.nextTask.id, 'new-task');
  assert.equal(state.activeRuns[0].id, 'new-run');
});
