import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildResearchProjection } from '../lib/research-view.mjs';
import { buildFeatureView, featureViewMarkdown } from '../lib/feature-view.mjs';
import { applyObservation, initWorkspace, loadWorkspace, validateFeature } from '../lib/store.mjs';
import { validateCoverageReferences } from '../lib/coverage.mjs';

const feature = (research) => ({
  id: 'records.create', title: 'Create record', area: 'Records', summary: 'Create a record.', status: 'partial',
  steps: [], nextActions: [], questions: [{ id: 'q.save', text: 'Does save persist?', state: 'open', contextId: 'member.demo', taskIds: ['task.save'], evidenceRefs: [] }],
  ...(research === undefined ? {} : { research }),
});
const openTask = { id: 'task.save', featureId: 'records.create', scenarioId: 'records.create.member', contextId: 'member.demo', status: 'queued', goal: 'Confirm saved record persists.' };
const scenario = {
  id: 'records.create.member', featureId: 'records.create', contextId: 'member.demo', goal: 'Create record',
  preconditions: [], completionCriteria: [], steps: [
    { id: 'open', action: 'Open create dialog', observed: 'Create dialog is visible', evidenceRefs: ['run/dialog.png'] },
    { id: 'submit', action: 'Submit valid record', observed: 'Success toast appears', evidenceRefs: ['run/toast.png'] },
  ], outcome: 'unknown', evidenceRefs: [],
};
function data(research) {
  return { schemaVersion: 2, revision: 'r000001', features: [feature(research)], scenarios: [scenario], contexts: [{ id: 'member.demo', role: 'Member' }],
    frontier: { tasks: [openTask] } };
}

test('requires an explicit registered-source alias for source file/line candidates', () => {
  const invalid = feature({ sourceCandidates: [{ id: 'src.save', relativePath: 'src/save.ts', lineStart: 10, status: 'candidate', note: 'Possible save handler.' }], controls: [] });
  assert.throws(() => validateFeature(invalid, '.', false), /sourceAlias/i);
  const valid = feature({ sourceCandidates: [{ id: 'src.save', sourceAlias: 'app-code', relativePath: 'src/save.ts', lineStart: 10, lineEnd: 14, status: 'candidate', note: 'Possible save handler.' }], controls: [] });
  assert.equal(validateFeature(valid, '.', false), true);
});

test('source candidates stay candidates and cannot upgrade scenario or feature verification', () => {
  const before = buildResearchProjection(data());
  const projection = buildResearchProjection(data({ sourceCandidates: [{ id: 'src.save', sourceAlias: 'app-code', relativePath: 'src/save.ts', status: 'candidate', note: 'Possible persistence handler.' }], controls: [] }));
  assert.equal(projection.sourceCandidates[0].status, 'candidate');
  assert.equal(projection.scenarios[0].outcome, 'unknown');
  assert.deepEqual(projection.verification, before.verification);
});

test('untested and blocked controls require open follow-up and preserve coverage gaps', () => {
  const controls = [
    { id: 'save-button', label: 'Save button', contextId: 'member.demo', status: 'not_tested', questionId: 'q.save', evidenceRefs: [] },
    { id: 'bulk-save', label: 'Bulk save', contextId: 'member.demo', status: 'blocked', questionId: 'q.save', evidenceRefs: [] },
  ];
  const input = data({ sourceCandidates: [], controls });
  assert.equal(validateCoverageReferences(input, '.'), true);
  const projection = buildResearchProjection(input, { featureId: 'records.create', contextId: 'member.demo' });
  assert.deepEqual(projection.controls.map(({ status }) => status), ['not_tested', 'blocked']);
  assert.equal(projection.coverage.state, 'needs_reconciliation');
  assert.ok(projection.coverage.gaps.some(({ questionId }) => questionId === 'q.save'));
});

test('observed steps produce only their own transitions, without inferred edges', () => {
  const projection = buildResearchProjection(data());
  assert.equal(projection.observedTransitions.length, 2);
  assert.deepEqual(projection.observedTransitions.map(({ action, observed }) => [action, observed]), [
    ['Open create dialog', 'Create dialog is visible'], ['Submit valid record', 'Success toast appears'],
  ]);
  assert.ok(projection.observedTransitions.every((transition) => !Object.hasOwn(transition, 'from') && !Object.hasOwn(transition, 'to')));
});

test('existing feature read-model and Markdown export carry research provenance', () => {
  const input = data({ sourceCandidates: [{ id: 'src.save', sourceAlias: 'app-code', relativePath: 'src/save.ts', lineStart: 10, status: 'candidate', note: 'Possible save handler.' }], controls: [] });
  const view = buildFeatureView(input, 'records.create');
  assert.equal(view.feature.research.sourceCandidates[0].status, 'candidate');
  const markdown = featureViewMarkdown(view);
  assert.match(markdown, /Source candidates/);
  assert.match(markdown, /candidate only/);
  assert.match(markdown, /app-code:src\/save\.ts:10/);
});

test('Markdown source references contain hostile backtick filenames inside a longer code span', () => {
  const input = data({ sourceCandidates: [{ id: 'src.save', sourceAlias: 'app-code', relativePath: 'src/``evil`x.ts', status: 'candidate', note: 'Candidate path.' }], controls: [] });
  const markdown = featureViewMarkdown(buildFeatureView(input, 'records.create'));
  assert.match(markdown, /```app-code:src\/``evil`x\.ts```/);
});

test('malformed research references reject the whole feature write before revision advances', (t) => {
  const unsafe = feature({ sourceCandidates: [{ id: 'src.save', sourceAlias: 'app-code', relativePath: '../secret.ts', status: 'candidate', note: 'Bad path.' }], controls: [] });
  assert.throws(() => validateFeature(unsafe, '.', false), /relativePath|unsafe|source/i);
  const missingAlias = feature({ sourceCandidates: [{ id: 'src.save', relativePath: 'src/save.ts', status: 'candidate', note: 'Missing alias.' }], controls: [] });
  assert.throws(() => validateFeature(missingAlias, '.', false), /sourceAlias/i);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-research-atomic-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  initWorkspace(dir, 'Example', 'https://example.org');
  const before = loadWorkspace(dir).revision;
  assert.throws(() => applyObservation(dir, {version: 2, baseRevision: before, features: [unsafe]}, {expectedRevision: before}), /relativePath|unsafe|source/i);
  assert.equal(loadWorkspace(dir).revision, before);
  assert.equal(loadWorkspace(dir).features.length, 0);
});

test('legacy V1 and V2 features without research metadata remain valid', () => {
  const legacy = { id: 'records.create', title: 'Create record', area: 'Records', summary: 'Create a record.', status: 'partial', steps: [], nextActions: [], questions: [], scenarioIds: [] };
  assert.equal(validateFeature(legacy, '.', false), true);
  assert.equal(validateFeature(feature(), '.', false), true);
});
