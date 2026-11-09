import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyObservation as applyObservationRaw, initWorkspace, loadWorkspace, exportDocs } from '../lib/store.mjs';

// These isolated tests construct each write from the current read receipt. Stale-write cases pass their saved receipt explicitly.
function applyObservation(dir, observation, options = {}) {
  const baseRevision = options.expectedRevision ?? observation.baseRevision ?? loadWorkspace(dir).revision;
  return applyObservationRaw(dir, { ...observation, baseRevision }, { ...options, expectedRevision: options.expectedRevision ?? baseRevision });
}
import { commitRevision, migrateWorkspace } from '../lib/revisions.mjs';

function makeWorkspace(t, legacy = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-journey-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (!legacy) {
    initWorkspace(dir, 'Example', 'https://example.test');
    fs.mkdirSync(path.join(dir, 'evidence', 'run-1'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'evidence', 'run-1', 'screen.png'), 'synthetic evidence');
    fs.writeFileSync(path.join(dir, 'evidence', 'run-1', 'after.png'), 'synthetic evidence after');
  }
  return dir;
}
const feature = { id: 'items.create', title: 'Create item', area: 'Items', summary: 'Create an item.', entry: { url: '/items' }, questions: [], nextActions: [] };
const features = [feature,
  { id: 'tasks.filter', title: 'Filter tasks', area: 'Tasks', summary: 'Filter tasks.', entry: { url: '/tasks' }, questions: [], nextActions: [] },
  { id: 'reports.export', title: 'Export report', area: 'Reports', summary: 'Export a report.', entry: { url: '/reports' }, questions: [], nextActions: [] }];
const contexts = { contexts: [
  { id: 'member.demo', role: 'member', tenantAlias: 'demo', environment: 'test' },
  { id: 'reviewer.demo', role: 'reviewer', tenantAlias: 'demo', environment: 'test' },
] };
function verifiedScenario(overrides = {}) {
  return {
    id: 'items.create.member', featureId: 'items.create', contextId: 'member.demo',
    goal: 'Create an item', preconditions: [],
    completionCriteria: [{ id: 'item-visible', description: 'The item appears.', met: true, evidenceRefs: ['run-1/screen.png'] }],
    steps: [{ id: 'submit', action: 'Submit the form.', observed: 'The item appears in the list.', evidenceRefs: ['run-1/screen.png'] }],
    outcome: 'success', evidenceRefs: ['run-1/screen.png'],
    testedContext: { contextId: 'member.demo', role: 'member', date: '2026-10-16' }, lastVerifiedAt: '2026-10-16',
    ...overrides,
  };
}
function branchJourney(overrides = {}) {
  return { id: 'item-flow', title: 'Create and review item', nodes: [
    { id: 'start', type: 'checkpoint', title: 'Ready', preconditions: ['Member session is open.'], outputs: { item: 'alias:output-1' }, beforeEvidenceRefs: ['run-1/screen.png'], afterEvidenceRefs: ['run-1/after.png'] },
    { id: 'create', type: 'scenario', title: 'Create item', featureId: 'items.create', contextId: 'member.demo', completionCriteria: ['The item appears.'], outcome: 'unknown', evidenceRefs: [] },
    { id: 'handoff', type: 'handoff', title: 'Switch reviewer', role: 'reviewer', contextId: 'reviewer.demo' },
    { id: 'done', type: 'checkpoint', title: 'Review result', outcome: 'unknown', evidenceRefs: [] },
  ], edges: [
    { from: 'start', to: 'create', condition: 'Ready to create', outcome: 'unknown' },
    { from: 'create', to: 'handoff', condition: 'Creation succeeds', contextSwitch: { from: 'member.demo', to: 'reviewer.demo', role: 'reviewer' }, outcome: 'unknown' },
    { from: 'create', to: 'done', condition: 'Creation denied', outcome: 'unknown' },
    { from: 'handoff', to: 'done', condition: 'Reviewer confirms item', outcome: 'unknown' },
  ], scenarioRunIds: [], outcome: 'unknown', evidenceRefs: [], ...overrides };
}

test('V1 ordered journeys migrate every feature into stable ordered nodes and edges', (t) => {
  const dir = makeWorkspace(t, true);
  fs.mkdirSync(path.join(dir, 'features'), { recursive: true });
  for (const f of features) fs.writeFileSync(path.join(dir, 'features', `${f.id}.json`), JSON.stringify({ ...f, steps: [], status: 'discovered' }));
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ app: { name: 'Example', baseUrl: 'https://example.test' }, features: features.map((f) => ({ id: f.id })), journeys: [{ id: 'legacy-flow', title: 'Legacy flow', featureIds: features.map((f) => f.id) }] }));
  migrateWorkspace(dir);
  const data = loadWorkspace(dir);
  const migrated = data.journeys[0];
  assert.deepEqual(migrated.nodes.map((node) => node.featureId), features.map((f) => f.id));
  assert.deepEqual(migrated.nodes.map((node) => node.id), ['legacy-flow.step-1', 'legacy-flow.step-2', 'legacy-flow.step-3']);
  assert.deepEqual(migrated.edges.map(({ from, to }) => [from, to]), [['legacy-flow.step-1','legacy-flow.step-2'], ['legacy-flow.step-2','legacy-flow.step-3']]);
  assert.ok(migrated.edges.every((edge) => edge.outcome === 'unknown'));
  assert.deepEqual(migrated.scenarioRunIds, []);
  assert.equal(data.scenarios[0].history[0].executionId, 'items.create.legacy.execution-1');
});

test('journey run references resolve to execution history IDs and preserve an independently verified feature', (t) => {
  const dir = makeWorkspace(t);
  applyObservation(dir, { version: 2, features: [feature], inventory: contexts, scenarios: [verifiedScenario()] });
  const loaded = loadWorkspace(dir);
  const scenario = loaded.scenarios[0];
  const execution = scenario.history[0];
  assert.ok(execution.executionId);
  assert.notEqual(execution.executionId, scenario.id);
  assert.equal(loaded.features[0].status, 'verified');
  const goodJourney = branchJourney({
    scenarioRunIds: [execution.executionId],
    nodes: branchJourney().nodes.map((node) => node.id === 'create' ? { ...node, scenarioRunId: execution.executionId } : node),
  });
  applyObservation(dir, { version: 2, journeys: [goodJourney] });
  const saved = loadWorkspace(dir);
  assert.equal(saved.journeys[0].outcome, 'unknown');
  assert.equal(saved.features[0].status, 'verified');
  assert.throws(() => applyObservation(dir, { version: 2, journeys: [branchJourney({ scenarioRunIds: [scenario.id] })] }), /Unknown\/duplicate journey scenario execution/);
});

test('legacy history without execution IDs receives deterministic IDs and retains role context', (t) => {
  const dir = makeWorkspace(t);
  applyObservation(dir, { version: 2, features: [feature], inventory: contexts, scenarios: [verifiedScenario()] });
  const data = loadWorkspace(dir);
  const inventoryPath = path.join(data.dataDir, 'inventory.json');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  delete inventory.scenarios[0].history[0].executionId;
  delete inventory.scenarios[0].history[0].scenarioId;
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));
  const first = loadWorkspace(dir).scenarios[0].history[0];
  const second = loadWorkspace(dir).scenarios[0].history[0];
  assert.equal(first.executionId, 'items.create.member.execution-1');
  assert.equal(second.executionId, first.executionId);
  assert.equal(first.scenarioId, 'items.create.member');
  assert.equal(first.testedContext.role, 'member');
});

test('journey success and expected denial require own observed completion evidence and tested context', (t) => {
  const dir = makeWorkspace(t);
  for (const outcome of ['success', 'expected_denial']) {
    assert.throws(() => applyObservation(dir, { version: 2, features: [feature], inventory: contexts,
      journeys: [branchJourney({ outcome, completionCriteria: ['Item appears.'], evidenceRefs: [], testedContext: null })] }), /completed journey.*criteria.*evidence.*testedContext/i);
  }
  const criteria = [{ id: 'result-observed', description: 'The item appears.', met: true, observed: 'The item appears in the list.', evidenceRefs: ['run-1/screen.png'] }];
  assert.throws(() => applyObservation(dir, { version: 2, features: [feature], inventory: contexts,
    journeys: [branchJourney({ outcome: 'success', completionCriteria: criteria, evidenceRefs: [], testedContext: { contextId: 'member.demo', role: 'member', date: '2026-10-16' } })] }), /journey completion evidence/i);
  assert.throws(() => applyObservation(dir, { version: 2, features: [feature], inventory: contexts,
    journeys: [branchJourney({ outcome: 'success', completionCriteria: [{ ...criteria[0], evidenceRefs: [] }], evidenceRefs: ['run-1/screen.png'], testedContext: { contextId: 'member.demo', role: 'member', date: '2026-10-16' } })] }), /completion criterion.*evidence/i);
});

test('outputs only accept generated ordinal aliases and blocked records require reasons', (t) => {
  const dir = makeWorkspace(t);
  for (const alias of ['someone-name', '5551234567', 'a5f3bd91c0']) assert.throws(() => applyObservation(dir, { version: 2, features: [feature], inventory: contexts, journeys: [branchJourney({ nodes: branchJourney().nodes.map((node) => node.id === 'start' ? { ...node, outputs: { item: alias } } : node) })] }), /generated alias: alias:output-N/i);
  for (const blocked of [branchJourney({ outcome: 'blocked' }), branchJourney({ nodes: branchJourney().nodes.map((node) => node.id === 'done' ? { ...node, type: 'blocker' } : node) })]) assert.throws(() => applyObservation(dir, { version: 2, features: [feature], inventory: contexts, journeys: [blocked] }), /blocker.*reason/i);
});

test('V2 feature Markdown exports scenario execution context, evidence, unknowns, and open work', (t) => {
  const dir = makeWorkspace(t);
  const reviewedFeature = {
    ...feature,
    questions: [{ id: 'reviewer-access-question', text: 'Can a reviewer create an item?', state: 'open', contextId: 'reviewer.demo', taskIds: ['items.create.reviewer.verify'], evidenceRefs: [] }],
  };
  const memberScenario = verifiedScenario();
  const reviewerScenario = {
    ...verifiedScenario({ id: 'items.create.reviewer', contextId: 'reviewer.demo', goal: 'Check reviewer create access', testedContext: null, lastVerifiedAt: null, outcome: 'unknown', evidenceRefs: [],
      completionCriteria: [{ id: 'reviewer-result', description: 'The reviewer can create an item.', met: false, observed: 'Not checked.', evidenceRefs: [] }],
      steps: [{ id: 'check-access', action: 'Open the create action.', observed: 'Unknown', evidenceRefs: [] }] }),
  };
  const verifyTask = { id: 'items.create.reviewer.verify', key: 'reviewer.demo.items.create.reviewer.verify', nodeId: 'items.create.reviewer', featureId: 'items.create', scenarioId: 'items.create.reviewer', contextId: 'reviewer.demo', kind: 'verify_scenario', parentTaskId: null, depth: 1, sequence: 1, status: 'queued', dependencies: [], goal: 'Check reviewer create access.', completionCriteria: ['Record whether the action is available.'], entry: { url: '/items' }, checkpoint: null, blocker: null, attempts: 0, lastProgressAt: null };
  applyObservation(dir, { version: 2, features: [reviewedFeature], inventory: contexts, scenarios: [memberScenario, reviewerScenario], frontier: {
    nodes: [{ id: 'items.create.reviewer', kind: 'capability', contextId: 'reviewer.demo', entryAliases: [], discoveryState: 'scanned', taskIds: [verifyTask.id] }], edges: [], tasks: [verifyTask],
  } });
  const execution = loadWorkspace(dir).scenarios.find((item) => item.id === memberScenario.id).history[0];
  exportDocs(dir);
  const markdown = fs.readFileSync(path.join(dir, 'docs', 'features', 'items.create.md'), 'utf8');

  assert.ok(markdown.includes('## Scenario: Create an item'));
  assert.ok(markdown.includes('**Context:** member / member.demo'));
  assert.ok(markdown.includes('**Outcome:** success'));
  assert.ok(markdown.includes('**Tested role/date:** member / 2026-10-16'));
  assert.ok(markdown.includes('**Completion criteria:**'));
  assert.ok(markdown.includes('- Met: The item appears.'));
  assert.ok(markdown.includes('  - Evidence: [run-1/screen.png](../../evidence/run-1/screen.png)'));
  assert.ok(markdown.includes('### Execution ' + execution.executionId));
  assert.ok(markdown.includes('[run-1/screen.png](../../evidence/run-1/screen.png)'));
  assert.ok(markdown.includes('## Unknown scenarios'));
  assert.ok(markdown.includes('- items.create.reviewer: outcome or evidence remains unknown.'));
  assert.ok(markdown.includes('## Questions'));
  assert.ok(markdown.includes('Can a reviewer create an item? (open; context: reviewer.demo)'));
  assert.ok(markdown.includes('## Open work'));
  assert.ok(markdown.includes('**Check reviewer create access.** - queued'));
  assert.doesNotMatch(markdown, /Legacy status:|Last verified: Not verified/i);
});

test('export links execution context, outcome, and evidence, and labels unobserved branches', (t) => {
  const dir = makeWorkspace(t);
  const scenario = verifiedScenario({ id: 'items.create.reviewer', contextId: 'reviewer.demo', testedContext: { contextId: 'reviewer.demo', role: 'reviewer', date: '2026-10-16' } });
  applyObservation(dir, { version: 2, features: [feature], inventory: contexts, scenarios: [scenario] });
  const execution = loadWorkspace(dir).scenarios[0].history[0];
  const criteria = [{ id: 'item-visible', description: 'The item appears.', met: true, observed: 'The reviewer sees the item.', evidenceRefs: ['run-1/screen.png'] }];
  const linkedJourney = branchJourney({
    scenarioRunIds: [execution.executionId], outcome: 'success', completionCriteria: criteria,
    evidenceRefs: ['run-1/screen.png'], testedContext: { contextId: 'reviewer.demo', role: 'reviewer', date: '2026-10-16' },
    nodes: branchJourney().nodes.map((node) => node.id === 'create' ? { ...node, scenarioRunId: execution.executionId } : node),
  });
  applyObservation(dir, { version: 2, journeys: [linkedJourney] });
  exportDocs(dir);
  const docs = fs.readFileSync(path.join(dir, 'docs', 'README.md'), 'utf8');
  assert.ok(docs.includes('**Tested context:** reviewer - reviewer.demo - 2026-10-16'));
  assert.match(docs, /Execution items\.create\.reviewer\.execution-[a-f0-9]+: success/);
  assert.match(docs, /Execution evidence: \[run-1\/screen\.png\]/);
  assert.match(docs, /Branch \[Creation denied\] -> .*unknown \/ not observed/);
  assert.match(docs, /Before:/);
  assert.match(docs, /After:/);
});

test('execution IDs must be unique across all scenario histories', (t) => {
  const dir = makeWorkspace(t);
  applyObservation(dir, { version: 2, features: [feature], inventory: contexts, scenarios: [
    verifiedScenario(),
    verifiedScenario({ id: 'items.create.reviewer', contextId: 'reviewer.demo', testedContext: { contextId: 'reviewer.demo', role: 'reviewer', date: '2026-10-16' } }),
  ] });
  const data = loadWorkspace(dir);
  const inventoryPath = path.join(data.dataDir, 'inventory.json');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  inventory.scenarios[1].history[0].executionId = inventory.scenarios[0].history[0].executionId;
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2));
  assert.throws(() => loadWorkspace(dir), /duplicate execution ID across scenario histories/i);
});


test('apply rejects execution ID collisions introduced while merging candidate histories atomically', (t) => {
  const dir = makeWorkspace(t);
  const before = loadWorkspace(dir).revision;
  const ids = ['shared-execution-id', 'shared-execution-id'];
  const executionIdFactory = () => ids.shift();
  assert.throws(() => applyObservation(dir, { version: 2, features: [feature], inventory: contexts, scenarios: [
    verifiedScenario({ id: 'alpha' }),
    verifiedScenario({ id: 'alpha.execution-x' }),
  ] }, { executionIdFactory }), /duplicate execution ID across scenario histories/i);
  assert.equal(loadWorkspace(dir).revision, before);
  assert.deepEqual(loadWorkspace(dir).scenarios, []);
});

test('commitRevision rejects duplicate execution IDs in a staged candidate before moving CURRENT', (t) => {
  const dir = makeWorkspace(t);
  applyObservation(dir, { version: 2, features: [feature], inventory: contexts, scenarios: [verifiedScenario()] });
  const data = loadWorkspace(dir);
  const before = data.revision;
  const duplicateScenario = { ...structuredClone(data.scenarios[0]), id: 'items.create.reviewer', history: data.scenarios[0].history.map((execution) => ({ ...execution, scenarioId: 'items.create.reviewer' })) };
  const candidate = { ...data, inventory: { ...data.inventory, scenarios: [...data.scenarios, duplicateScenario] } };
  assert.throws(() => commitRevision(dir, before, candidate), /duplicate execution ID across scenario histories/i);
  assert.equal(loadWorkspace(dir).revision, before);
  assert.equal(fs.readdirSync(path.join(dir, 'revisions')).some((name) => name.startsWith('.staging-')), false);
});
