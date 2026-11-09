import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveScenarioStatus, validateFrontier, validateScenario, validateScenarioFrontier } from '../lib/schema.mjs';
import { applyObservation as applyObservationRaw, initWorkspace, loadWorkspace } from '../lib/store.mjs';

// These isolated tests construct each write from the current read receipt. Stale-write cases pass their saved receipt explicitly.
function applyObservation(dir, observation, options = {}) {
  const baseRevision = options.expectedRevision ?? observation.baseRevision ?? loadWorkspace(dir).revision;
  return applyObservationRaw(dir, { ...observation, baseRevision }, { ...options, expectedRevision: options.expectedRevision ?? baseRevision });
}
import { migrateWorkspace } from '../lib/revisions.mjs';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-schema-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initWorkspace(dir, 'Example', 'https://example.org');
  fs.mkdirSync(path.join(dir, 'evidence', 'run-1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', 'run-1', 'result.png'), 'evidence');
  return dir;
}

function scenario(overrides = {}) {
  return {
    id: 'create-item.member', featureId: 'items.create', contextId: 'member.demo',
    goal: 'Create an item', preconditions: [],
    completionCriteria: [{ id: 'item-visible', description: 'The new item appears in the list.', met: true, evidenceRefs: ['run-1/result.png'] }],
    steps: [{ id: 'submit', action: 'Submit the item form.', observed: 'The new item appears in the list.', evidenceRefs: ['run-1/result.png'] }],
    outcome: 'success', evidenceRefs: ['run-1/result.png'],
    testedContext: { role: 'member', date: '2026-10-16', contextId: 'member.demo' }, lastVerifiedAt: '2026-10-16',
    ...overrides,
  };
}

test('a dialog observation cannot satisfy a create goal completion criterion', (t) => {
  const dir = workspace(t);
  const dialogOnly = scenario({
    steps: [{ id: 'open', action: 'Open create dialog.', observed: 'The create dialog appears.', evidenceRefs: ['run-1/result.png'] }],
    completionCriteria: [{ id: 'item-visible', description: 'The new item appears in the list.', met: false, evidenceRefs: [] }],
    outcome: 'unknown', lastVerifiedAt: null,
  });
  assert.equal(validateScenario(dialogOnly, dir), true);
  assert.equal(deriveScenarioStatus(dialogOnly), 'partial');
});

test('verified scenarios require criteria, evidence, and tested context', (t) => {
  const dir = workspace(t);
  for (const broken of [
    scenario({ completionCriteria: [] }),
    scenario({ evidenceRefs: [] }),
    scenario({ testedContext: { role: 'member' } }),
  ]) assert.throws(() => validateScenario(broken, dir), /verified scenario/i);
});

test('rejects duplicated evidence-root prefixes even when the nested target exists', (t) => {
  const dir = workspace(t);
  fs.mkdirSync(path.join(dir, 'evidence', 'evidence', 'run-1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', 'evidence', 'run-1', 'result.png'), 'synthetic nested target');
  const duplicatedRef = 'evidence/run-1/result.png';
  assert.throws(() => validateScenario(scenario({
    completionCriteria: [{ id: 'item-visible', description: 'The new item appears in the list.', met: true, evidenceRefs: [duplicatedRef] }],
    steps: [{ id: 'submit', action: 'Submit the item form.', observed: 'The new item appears in the list.', evidenceRefs: [duplicatedRef] }],
    evidenceRefs: [duplicatedRef],
  }), dir), /evidence ref.*evidence root|repeat.*evidence/i);
});

test('verified scenario requires observed steps linked to every met criterion', (t) => {
  const dir = workspace(t);
  assert.throws(() => validateScenario(scenario({ steps: [] }), dir), /met criterion.*observed step.*evidence/i);
  fs.writeFileSync(path.join(dir, 'evidence', 'run-1', 'dialog.png'), 'dialog evidence');
  assert.throws(() => validateScenario(scenario({ steps: [{ id: 'other', action: 'Open dialog', observed: 'Dialog shown', evidenceRefs: ['run-1/dialog.png'] }] }), dir), /met criterion.*observed step.*evidence/i);
  assert.throws(() => validateScenario(scenario({ completionCriteria: [
    { id: 'visible', description: 'Item appears.', met: true, evidenceRefs: ['run-1/result.png'] },
    { id: 'details', description: 'Details are correct.', met: false, evidenceRefs: [] },
  ] }), dir), /verified scenario/i);
});

test('expected denial is a valid verified scenario outcome', (t) => {
  const dir = workspace(t);
  assert.equal(validateScenario(scenario({ outcome: 'expected_denial' }), dir), true);
});

test('frontier rejects incomplete partial tasks and blocked tasks without a required change', () => {
  assert.throws(() => validateScenarioFrontier([scenario({ outcome: 'unknown', testedContext: null, lastVerifiedAt: null })], { tasks: [] }, [{ id: 'member.demo' }]), /partial.*task/i);
  const blocked = { id: 'wait', key: 'wait', nodeId: 'wait-node', kind: 'prerequisite', status: 'blocked', goal: 'Wait for access', depth: 0, sequence: 0, dependencies: [], completionCriteria: [], entry: {}, attempts: 0, lastProgressAt: null, blocker: { type: 'permission', reason: 'Need access' } };
  const blockedFrontier = { nodes: [{ id: 'wait-node', kind: 'area', discoveryState: 'blocked', entryAliases: [], taskIds: ['wait'] }], edges: [], tasks: [blocked] };
  assert.throws(() => validateFrontier(blockedFrontier, []), /requiredChange/i);
  const skipped = { id: 'skip', key: 'skip', nodeId: 'skip-node', kind: 'inspect_branch', status: 'skipped', goal: 'Skip branch', depth: 0, sequence: 0, dependencies: [], completionCriteria: [], entry: {}, attempts: 0, lastProgressAt: null, excludedScope: 'current test tenant' };
  const skippedFrontier = { nodes: [{ id: 'skip-node', kind: 'branch', discoveryState: 'excluded', entryAliases: [], taskIds: ['skip'] }], edges: [], tasks: [skipped] };
  assert.throws(() => validateFrontier(skippedFrontier, []), /reason and excluded scope/i);
});

test('frontier dependency and parent references must resolve in the same graph', () => {
  const task = { id: 'task-a', key: 'task-a', nodeId: 'node-a', kind: 'discover_area', status: 'queued', goal: 'Inspect area', depth: 0, sequence: 0, dependencies: [], completionCriteria: [], entry: {}, attempts: 0, lastProgressAt: null };
  const frontierFor = (changes) => ({ nodes: [{ id: 'node-a', kind: 'area', discoveryState: 'unseen', entryAliases: [], taskIds: ['task-a'] }], edges: [], tasks: [{ ...task, ...changes }] });
  assert.throws(() => validateFrontier(frontierFor({ dependencies: ['missing-task'] }), []), /Unknown task dependency/i);
  assert.throws(() => validateFrontier(frontierFor({ parentTaskId: 'missing-parent' }), []), /Unknown parent task/i);
});

test('frontier rejects scoped tasks when no context is present', () => {
  const task = { id: 'admin-task', key: 'admin-task', nodeId: 'admin-area', contextId: 'admin.demo', kind: 'discover_area', status: 'queued',
    goal: 'Inspect the admin area', depth: 0, sequence: 0, dependencies: [], completionCriteria: [], entry: {}, attempts: 0, lastProgressAt: null };
  const frontier = { nodes: [{ id: 'admin-area', kind: 'area', discoveryState: 'unseen', entryAliases: [], taskIds: ['admin-task'] }], edges: [], tasks: [task] };
  assert.throws(() => validateFrontier(frontier, []), /Unknown context for task admin-task/i);
  assert.equal(validateFrontier({ nodes: [{ id: 'root', kind: 'root', discoveryState: 'unseen', entryAliases: [], taskIds: ['root-task'] }], edges: [], tasks: [
    { ...task, id: 'root-task', key: 'root-task', nodeId: 'root', contextId: null },
  ] }, []), true);
});

test('V2 feature metadata includes open feature-level tasks without a scenario ID', (t) => {
  const dir = workspace(t);
  const feature = { id: 'items.create', title: 'Create item', area: 'Items', summary: 'Create an item.', entry: { url: '/items', label: 'Items' }, questions: [], nextActions: [] };
  applyObservation(dir, { version: 2, features: [feature],
    frontier: {
      nodes: [{ id: 'items', kind: 'area', discoveryState: 'scanned', entryAliases: ['/items'], taskIds: ['items.create.discover'] }],
      tasks: [{ id: 'items.create.discover', key: 'items.create.discover', nodeId: 'items', featureId: 'items.create', kind: 'discover_capability', parentTaskId: null, depth: 1, sequence: 1, status: 'queued', dependencies: [], goal: 'Find create branches', completionCriteria: ['Inspect available create options.'], entry: { url: '/items' }, checkpoint: null, blocker: null, attempts: 0, lastProgressAt: null }],
    } });
  assert.deepEqual(loadWorkspace(dir).features[0].openTasks, ['items.create.discover']);
});

test('V2 workspace rejects legacy-shaped feature replacement writes with migration guidance', (t) => {
  const dir = workspace(t);
  const legacyFeature = { id: 'items.create', title: 'Create item', area: 'Items', summary: 'Create an item.', status: 'verified', entry: { url: '/items' }, testedContext: { role: 'member', date: '2026-10-16' }, lastVerifiedAt: '2026-10-16', steps: [], questions: [], nextActions: [] };
  assert.throws(() => applyObservation(dir, { features: [legacyFeature] }), /V2 workspace requires version: 2/i);
});

test('scenario upserts preserve other contexts and append execution history', (t) => {
  const dir = workspace(t);
  const feature = { id: 'items.create', title: 'Create item', area: 'Items', summary: 'Create an item.', entry: { url: '/items', label: 'Items' }, questions: [], nextActions: [] };
  applyObservation(dir, { version: 2, features: [feature], scenarios: [scenario({ id: 'items.create.member', contextId: 'member.demo' }), scenario({ id: 'items.create.admin', contextId: 'admin.demo', testedContext: { role: 'admin', date: '2026-10-16', contextId: 'admin.demo' } })],
    inventory: { contexts: [{ id: 'member.demo', role: 'member', tenantAlias: 'demo', environment: 'test' }, { id: 'admin.demo', role: 'admin', tenantAlias: 'demo', environment: 'test' }] },
    runs: [{ id: 'run-1', scope: { appId: 'example' }, status: 'completed', currentTaskId: null, startedAt: '2026-10-16T10:00:00Z', heartbeatAt: '2026-10-16T10:01:00Z', checkpoint: null, stopReason: null, capabilities: [] }],
    events: [{ id: 'event-1', runId: 'run-1', type: 'scenario_observed', timestamp: '2026-10-16T10:01:00Z', message: 'Observed item in list.' }] });
  applyObservation(dir, { version: 2,
    scenarios: [scenario({ id: 'items.create.member', outcome: 'failure', lastVerifiedAt: null, steps: [{ id: 'submit-again', action: 'Submit again.', observed: 'Validation error appears.', evidenceRefs: ['run-1/result.png'] }] })],
    frontier: { nodes: [{ id: 'items.create', kind: 'feature', contextId: 'member.demo', entryAliases: ['/items'], discoveryState: 'scanned', taskIds: ['items.create.member.verify'] }], tasks: [{ id: 'items.create.member.verify', key: 'items.create.member.verify', nodeId: 'items.create', featureId: 'items.create', scenarioId: 'items.create.member', contextId: 'member.demo', kind: 'verify_scenario', parentTaskId: null, depth: 0, sequence: 1, status: 'queued', dependencies: [], goal: 'Investigate failed create result', completionCriteria: ['Determine whether validation failure is expected.'], entry: { url: '/items' }, checkpoint: null, blocker: null, attempts: 1, lastProgressAt: '2026-10-16' }] } });
  const data = loadWorkspace(dir);
  assert.deepEqual(data.scenarios.map((item) => item.id), ['items.create.member', 'items.create.admin']);
  assert.equal(data.scenarios[1].testedContext.role, 'admin');
  assert.equal(data.scenarios[0].history.length, 2);
  assert.equal(data.scenarios[0].outcome, 'failure');
  assert.equal(data.runs[0].status, 'exhausted_in_scope');
  assert.equal(data.activity[0].revision, 'r000002');
  assert.equal(data.features[0].status, 'verified');
  assert.equal(data.features[0].scenarioCounts.partial, 1);
  assert.equal(data.features[0].openTasks[0], 'items.create.member.verify');
});

test('V1 migration retains legacy walkthroughs and flags outcomes for review', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-v1-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'features'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'evidence', 'old-run'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', 'old-run', 'open.png'), 'old evidence');
  const feature = { id: 'items.create', title: 'Create item', area: 'Items', summary: 'Create an item.', status: 'verified', entry: { url: '/items' }, testedContext: { role: 'member', date: '2026-10-15' }, lastVerifiedAt: '2026-10-15', steps: [{ id: 'open', title: 'Open', action: 'Open form', observed: 'Form appears', screenshot: 'old-run/open.png' }], questions: [], nextActions: [{ id: 'submit', goal: 'Submit item', reason: 'Outcome unknown' }] };
  fs.writeFileSync(path.join(dir, 'features', 'items.create.json'), JSON.stringify(feature));
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ app: { name: 'Example', baseUrl: 'https://example.org' }, features: [{ id: feature.id }], journeys: [] }));
  migrateWorkspace(dir);
  const data = loadWorkspace(dir);
  assert.deepEqual(data.features[0].steps, feature.steps);
  assert.deepEqual(data.features[0].nextActions, feature.nextActions);
  assert.equal(data.scenarios[0].outcome, 'unknown');
  assert.equal(data.scenarios[0].migrationReview.required, true);
  assert.equal(data.features[0].status, 'partial');
  assert.deepEqual(data.features[0].legacyVerificationClaim, { status: 'verified', lastVerifiedAt: '2026-10-15', testedContext: { role: 'member', date: '2026-10-15' } });
});
