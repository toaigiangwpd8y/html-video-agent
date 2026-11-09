import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeatureView, featureViewMarkdown } from '../lib/feature-view.mjs';

const screenshot = (id, title, ref) => ({
  id, title, action: `Open ${title}`, observed: `${title} is visible`, screenshot: ref,
});
const discoverySteps = [
  screenshot('open-list', 'Project list', 'discovery/list.png'),
  screenshot('open-detail', 'Project detail', 'discovery/detail.png'),
];

function featureData({ steps = discoverySteps, scenarios = [] } = {}) {
  return {
    schemaVersion: 2,
    app: { name: 'Synthetic test app', baseUrl: 'http://127.0.0.1:4999' },
    features: [{ id: 'projects.list', title: 'Project list', area: 'Projects', summary: 'Browse projects.', status: 'discovered', entry: {}, steps, questions: [] }],
    scenarios,
    contexts: [],
    frontier: { tasks: [] },
  };
}

test('V2 discovery screenshots remain visible when the feature has no scenarios', () => {
  const view = buildFeatureView(featureData(), 'projects.list');

  assert.deepEqual(view.discoverySteps, discoverySteps);
  assert.equal(view.discoverySteps.length, 2);
  assert.deepEqual(view.scenarios, []);
  assert.equal(view.selected, null);
  assert.deepEqual(view.verification.verifiedScenarioIds, []);
  assert.deepEqual(view.verification.unknownScenarioIds, []);
  assert.match(featureViewMarkdown(view), /## Discovery observations/);
  assert.match(featureViewMarkdown(view), /\.\.\/\.\.\/evidence\/discovery\/list\.png/);
});

test('discovery screenshots and snapshots use raw encoded Markdown destinations', () => {
  const steps = [{
    ...screenshot('open-list', 'Project list', 'discovery/list screen.png'),
    snapshot: 'discovery/detail snapshot.json',
  }];
  const markdown = featureViewMarkdown(buildFeatureView(featureData({ steps }), 'projects.list'));

  assert.match(markdown, /^!\[Discovery evidence for Project list\]\(\.\.\/\.\.\/evidence\/discovery\/list%20screen\.png\)$/m);
  assert.match(markdown, /^\[Read discovery snapshot\]\(\.\.\/\.\.\/evidence\/discovery\/detail%20snapshot\.json\)$/m);
  assert.doesNotMatch(markdown, /!\[[^\]]*\]\(\[[^\]]+\]\([^\n]+\)\)/);
  assert.doesNotMatch(markdown, /^\[[^\]]+\]\(\[[^\]]+\]\([^\n]+\)\)$/m);
});

test('discovery evidence stays distinct from scenario evidence and duplicate refs add no verification claim', () => {
  const scenario = {
    id: 'projects.list.admin', featureId: 'projects.list', contextId: 'admin', goal: 'List projects',
    steps: [{ id: 'load-list', action: 'Load list', observed: 'List appears', evidenceRefs: ['discovery/list.png'] }],
    outcome: 'unknown', evidenceRefs: [], history: [],
  };
  const view = buildFeatureView(featureData({ scenarios: [scenario] }), 'projects.list', { scenarioId: scenario.id });
  const markdown = featureViewMarkdown(view);

  assert.deepEqual(view.discoverySteps, discoverySteps);
  assert.equal(view.selected.scenarioId, scenario.id);
  assert.equal(view.selected.outcome, 'unknown');
  assert.deepEqual(view.verification.verifiedScenarioIds, []);
  assert.deepEqual(view.verification.unknownScenarioIds, [scenario.id]);
  assert.match(markdown, /## Discovery observations/);
  assert.match(markdown, /## Scenario: List projects/);
  assert.match(markdown, /## Discovery observations[\s\S]*## Scenario: List projects/);
});
