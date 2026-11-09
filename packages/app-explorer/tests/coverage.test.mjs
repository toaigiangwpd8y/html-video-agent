import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizeQuestions, auditCoverage, reconcileCoverage } from '../lib/coverage.mjs';
import { initWorkspace, loadWorkspace } from '../lib/store.mjs';
import { applyObservation } from '../lib/store.mjs';
import { frontierSummary } from '../lib/frontier.mjs';

function workspace(t, features = [], frontier = { nodes: [], edges: [], tasks: [] }, contexts = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-coverage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initWorkspace(dir, 'Example', 'https://example.org');
  let data = loadWorkspace(dir);
  applyObservation(dir, { version: 2, baseRevision: data.revision, features, inventory: { contexts }, frontier });
  return dir;
}

const feature = (id, status, questions = [], extra = {}) => ({ id, title: id, area: 'A', summary: id,
  status, entry: {}, steps: [], nextActions: [], questions, ...extra });

test('legacy questions get deterministic IDs and structured records preserve unknown fields', () => {
  const input = feature('items.create', 'discovered', [' Complete the form? ', { id: 'known.q', text: 'What happens?', state: 'open', custom: { keep: true } }]);
  const normalized = normalizeQuestions(input);
  assert.match(normalized[0].id, /^q\.[a-f0-9]{24}$/);
  assert.equal(normalized[0].text, ' Complete the form? ');
  assert.equal(normalized[0].state, 'open');
  assert.deepEqual(normalized[1].custom, { keep: true });
  assert.deepEqual(normalizeQuestions(input), normalized);
});

test('verified feature with an unlinked question and discovered feature without work are audit gaps', () => {
  const audit = auditCoverage({ features: [
    feature('items.create', 'verified', ['Can it be edited?'], { scenarioIds: ['create.member'] }),
    feature('reports.list', 'discovered'),
  ], scenarios: [{ id: 'create.member', featureId: 'items.create', contextId: 'member.demo' }], contexts: [{ id: 'member.demo' }], frontier: { nodes: [], edges: [], tasks: [] } });
  assert.equal(audit.state, 'needs_reconciliation');
  assert.equal(audit.counts.gaps, 2);
  assert.ok(audit.gaps.some((gap) => gap.featureId === 'items.create' && gap.questionId));
  assert.ok(audit.gaps.some((gap) => gap.featureId === 'reports.list' && !gap.questionId));
});

test('terminal work does not resolve an open question; explicit exclusions close discovery gaps', () => {
  const openQuestion = { id: 'q.edit', text: 'Can it be edited?', state: 'open', contextId: null, taskIds: ['old.task'], evidenceRefs: [] };
  const frontier = { nodes: [], edges: [], tasks: [{ id: 'old.task', status: 'done', featureId: 'items.create' }] };
  const audit = auditCoverage({ features: [feature('items.create', 'discovered', [openQuestion])], frontier, contexts: [], scenarios: [] });
  assert.ok(audit.gaps.some((gap) => gap.questionId === 'q.edit'));
  assert.equal(auditCoverage({ features: [feature('reports.list', 'discovered', [], { coverageExclusion: { reason: 'Not available in app scope.', contextId: null } })], frontier: { nodes: [], edges: [], tasks: [] } }).counts.gaps, 0);
  const scenario = { id: 'reports.list.member', featureId: 'reports.list', contextId: 'member.demo' };
  const skipped = { id: 'skip', status: 'skipped', scenarioId: scenario.id, contextId: scenario.contextId, skipReason: 'Excluded from this role.', excludedScope: 'member context' };
  assert.equal(auditCoverage({ features: [feature('reports.list', 'partial')], scenarios: [scenario], contexts: [{ id: 'member.demo' }], frontier: { nodes: [], edges: [], tasks: [skipped] } }).counts.gaps, 0);
  assert.ok(auditCoverage({ features: [feature('reports.list', 'partial')], scenarios: [scenario], contexts: [{ id: 'member.demo' }], frontier: { nodes: [], edges: [], tasks: [{ ...skipped, contextId: 'admin.demo' }] } }).gaps.some((gap) => gap.contextId === 'member.demo'));
});

test('feature exclusion alone establishes its scope; null exclusion is app-wide', () => {
  const memberOnly = feature('reports.list', 'discovered', [], {
    coverageExclusion: { reason: 'Not available to members.', contextId: 'member.demo' },
  });
  const memberAudit = auditCoverage({ features: [memberOnly], contexts: [{ id: 'member.demo' }], scenarios: [],
    frontier: { nodes: [], edges: [], tasks: [] } });
  assert.equal(memberAudit.counts.gaps, 0);
  const allScopes = auditCoverage({ features: [memberOnly], contexts: [{ id: 'member.demo' }, { id: 'admin.demo' }], scenarios: [],
    frontier: { nodes: [], edges: [], tasks: [] } });
  assert.equal(allScopes.counts.gaps, 0);
  assert.equal(auditCoverage({ features: [memberOnly], contexts: [{ id: 'member.demo' }], scenarios: [],
    frontier: { nodes: [], edges: [], tasks: [] } }, { contextIds: ['member.demo'] }).counts.gaps, 0);
  const appWide = feature('settings.list', 'partial', [], {
    coverageExclusion: { reason: 'Unavailable in this application.', contextId: null },
  });
  assert.equal(auditCoverage({ features: [appWide], contexts: [{ id: 'member.demo' }, { id: 'admin.demo' }], scenarios: [],
    frontier: { nodes: [], edges: [], tasks: [] } }).counts.gaps, 0);
});

test('scoped feature exclusions and unrelated linked tasks leave the other scope open', () => {
  const contexts = [{ id: 'member.demo' }, { id: 'admin.demo' }];
  const featureRecord = feature('items.create', 'partial', [
    { id: 'q.member', text: 'Member path?', state: 'open', contextId: 'member.demo', taskIds: [], evidenceRefs: [] },
    { id: 'q.admin', text: 'Admin path?', state: 'open', contextId: 'admin.demo', taskIds: ['other.task'], evidenceRefs: [] },
  ], { coverageExclusion: { reason: 'Not in member scope.', contextId: 'member.demo' } });
  const audit = auditCoverage({ features: [featureRecord], contexts, scenarios: [], frontier: { nodes: [], edges: [], tasks: [
    { id: 'other.task', status: 'queued', contextId: 'admin.demo', featureId: 'reports.list' },
  ] } });
  assert.ok(audit.gaps.some((gap) => gap.contextId === 'member.demo'));
  assert.ok(audit.gaps.some((gap) => gap.questionId === 'q.admin'));
  const scenarios = [
    { id: 'items.member', featureId: 'items.create', contextId: 'member.demo' },
    { id: 'items.admin', featureId: 'items.create', contextId: 'admin.demo' },
  ];
  const skipMember = { id: 'skip.member', status: 'skipped', scenarioId: 'items.member', contextId: 'member.demo',
    skipReason: 'Out of scope for member.', excludedScope: 'member-only path' };
  const scenarioAudit = auditCoverage({ features: [feature('items.create', 'partial')], scenarios, contexts,
    frontier: { nodes: [], edges: [], tasks: [skipMember] } });
  assert.ok(!scenarioAudit.gaps.some((gap) => gap.contextId === 'member.demo'));
  assert.ok(scenarioAudit.gaps.some((gap) => gap.contextId === 'admin.demo'));
  const featureOnly = feature('reports.list', 'partial', [{ id: 'q.excluded', text: 'Other area?', state: 'excluded', reason: 'Outside this path.', contextId: 'admin.demo', taskIds: [], evidenceRefs: [] }],
    { coverageExclusion: { reason: 'Excluded for member.', contextId: 'member.demo' } });
  assert.ok(auditCoverage({ features: [featureOnly], contexts, scenarios: [], frontier: { nodes: [], edges: [], tasks: [] } }).gaps.some((gap) => gap.contextId === 'admin.demo'));
  const unassociated = auditCoverage({ features: [feature('settings.list', 'discovered')], contexts, scenarios: [], frontier: { nodes: [], edges: [], tasks: [] } });
  assert.deepEqual(unassociated.gaps.map((gap) => gap.contextId), [null]);
  const scopedAudit = auditCoverage({ features: [featureRecord], contexts, scenarios: [], frontier: { nodes: [], edges: [], tasks: [] } }, { contextIds: ['member.demo'] });
  assert.ok(!scopedAudit.gaps.some((gap) => gap.contextId === 'admin.demo'));
});

test('coverage gaps only affect closure after ready, waiting, and blocked work precedence', () => {
  const base = { features: [feature('items.create', 'discovered', ['Unanswered?'])], frontier: { nodes: [{ id: 'root', kind: 'root', entryAliases: [], taskIds: ['ready'], discoveryState: 'scanned' }], edges: [], tasks: [
    { id: 'ready', key: 'ready', nodeId: 'root', kind: 'discover_area', status: 'queued', depth: 0, sequence: 0, dependencies: [], goal: 'Inspect', completionCriteria: [], entry: {}, attempts: 0, lastProgressAt: null },
  ] }, contexts: [], scenarios: [] };
  assert.equal(frontierSummary(base.frontier, [], '2026-10-16T00:00:00Z', {}, { coverage: auditCoverage(base) }).state, 'ready');
  assert.equal(frontierSummary({ nodes: [], edges: [], tasks: [] }, [], '2026-10-16T00:00:00Z', {}, { coverage: auditCoverage(base) }).state, 'needs_reconciliation');
  assert.equal(frontierSummary({ nodes: [], edges: [], tasks: [] }, [], '2026-10-16T00:00:00Z').state, 'needs_reconciliation');
  const blocked = { nodes: [], edges: [], tasks: [{ ...base.frontier.tasks[0], status: 'blocked', blocker: { type: 'access', reason: 'No access', requiredChange: 'Authorize role' } }] };
  assert.equal(frontierSummary(blocked, [], '2026-10-16T00:00:00Z', {}, { coverage: auditCoverage(base) }).state, 'blocked');
  const waiting = { nodes: [], edges: [], tasks: [{ ...base.frontier.tasks[0], status: 'waiting_user' }] };
  assert.equal(frontierSummary(waiting, [], '2026-10-16T00:00:00Z', {}, { coverage: auditCoverage(base) }).state, 'waiting_user');
});

test('reconcile creates deterministic linked tasks in an explicit existing context and is CAS guarded/idempotent', async (t) => {
  const context = { id: 'member.demo', role: 'Member', tenantAlias: 'demo', environment: 'test', date: '2026-10-16' };
  const dir = workspace(t, [feature('items.create', 'discovered', ['Can it be edited?'])], undefined, [context]);
  const before = loadWorkspace(dir);
  const result = await reconcileCoverage(dir, { contextId: context.id, expectedRevision: before.revision });
  assert.equal(result.taskIds.length, 1);
  const after = loadWorkspace(dir);
  assert.equal(after.features[0].questions[0].state, 'open');
  assert.deepEqual(after.features[0].questions[0].taskIds, result.taskIds);
  const followup = after.frontier.tasks.find((task) => task.id === result.taskIds[0]);
  assert.equal(followup.contextId, context.id);
  assert.equal(followup.depth, 1);
  assert.deepEqual((await reconcileCoverage(dir, { contextId: context.id, expectedRevision: after.revision })).taskIds, []);
  await assert.rejects(() => reconcileCoverage(dir, { contextId: context.id, expectedRevision: before.revision }), /Revision conflict/);
  const task = after.frontier.tasks.find((item) => item.id === result.taskIds[0]);
  const terminal = { ...task, status: 'done' };
  const terminalNode = after.frontier.nodes.find((node) => node.id === terminal.nodeId);
  applyObservation(dir, { version: 2, baseRevision: after.revision, frontier: { tasks: [terminal], nodes: [terminalNode] } }, { expectedRevision: after.revision });
  const afterTerminal = loadWorkspace(dir);
  assert.equal(auditCoverage(afterTerminal).gaps.some((gap) => gap.questionId), true);
  const reopened = await reconcileCoverage(dir, { contextId: context.id, expectedRevision: afterTerminal.revision });
  assert.equal(reopened.taskIds.length, 1);
  assert.notEqual(reopened.taskIds[0], task.id);
});

test('reconcile processes only questions eligible in the selected context', async (t) => {
  const contexts = [
    { id: 'member.demo', role: 'Member', tenantAlias: 'demo', environment: 'test', date: '2026-10-16' },
    { id: 'admin.demo', role: 'Admin', tenantAlias: 'demo', environment: 'test', date: '2026-10-16' },
  ];
  const questions = contexts.map((context) => ({ id: `q.${context.id.replace('.', '-')}`, text: `${context.role} path?`, state: 'open', contextId: context.id, taskIds: [], evidenceRefs: [] }));
  const dir = workspace(t, [feature('items.create', 'discovered', questions)], undefined, contexts);
  const before = loadWorkspace(dir);
  const member = await reconcileCoverage(dir, { contextId: 'member.demo', expectedRevision: before.revision });
  assert.equal(member.taskIds.length, 1);
  const afterMember = loadWorkspace(dir);
  assert.deepEqual(afterMember.features[0].questions.map((question) => question.taskIds.length), [1, 0]);
  assert.ok(auditCoverage(afterMember).gaps.some((gap) => gap.contextId === 'admin.demo'));
  const admin = await reconcileCoverage(dir, { contextId: 'admin.demo', expectedRevision: afterMember.revision });
  assert.equal(admin.taskIds.length, 1);
  assert.notEqual(admin.taskIds[0], member.taskIds[0]);
});

test('invalid task or context question references reject without changing CURRENT', (t) => {
  const dir = workspace(t, [feature('items.create', 'discovered')]);
  const before = loadWorkspace(dir);
  const currentFile = path.join(dir, 'CURRENT.json');
  const current = fs.readFileSync(currentFile, 'utf8');
  for (const question of [
    { id: 'q.bad-task', text: 'Question?', state: 'open', contextId: null, taskIds: ['missing.task'], evidenceRefs: [] },
    { id: 'q.bad-context', text: 'Question?', state: 'open', contextId: 'missing.context', taskIds: [], evidenceRefs: [] },
  ]) {
    assert.throws(() => applyObservation(dir, { version: 2, baseRevision: before.revision,
      features: [feature('items.create', 'discovered', [question])] }, { expectedRevision: before.revision }));
    assert.equal(fs.readFileSync(currentFile, 'utf8'), current);
  }
  for (const coverageExclusion of [
    'untyped exclusion',
    { reason: 'Out of scope', contextId: 'missing.context' },
  ]) {
    assert.throws(() => applyObservation(dir, { version: 2, baseRevision: before.revision,
      features: [feature('items.create', 'discovered', [], { coverageExclusion })] }, { expectedRevision: before.revision }));
    assert.equal(fs.readFileSync(currentFile, 'utf8'), current);
  }
  assert.throws(() => applyObservation(dir, { version: 2, baseRevision: before.revision,
    features: [feature('items.create', 'discovered', [{ id: 'q.no-evidence', text: 'Resolved?', state: 'resolved', contextId: null, taskIds: [], evidenceRefs: [] }])] }, { expectedRevision: before.revision }), /evidence/);
  assert.equal(fs.readFileSync(currentFile, 'utf8'), current);
  const unrelated = { id: 'other.task', key: 'other.task', nodeId: 'reports.list', featureId: 'reports.list', kind: 'discover_capability',
    status: 'queued', depth: 0, sequence: 0, dependencies: [], goal: 'Inspect reports', completionCriteria: [], entry: {}, attempts: 0, lastProgressAt: null };
  assert.throws(() => applyObservation(dir, { version: 2, baseRevision: before.revision,
    features: [feature('reports.list', 'discovered'), feature('items.create', 'discovered', [{ id: 'q.bad-link', text: 'Linked?', state: 'open', contextId: null, taskIds: [unrelated.id], evidenceRefs: [] }])],
    frontier: { nodes: [{ id: 'reports.list', kind: 'capability', entryAliases: [], taskIds: [unrelated.id], discoveryState: 'scanned' }], tasks: [unrelated] },
  }, { expectedRevision: before.revision }), /not linked to feature/);
  assert.equal(fs.readFileSync(currentFile, 'utf8'), current);
});

test('coverage audit CLI is read-only and reconcile CLI requires an explicit context and revision', (t) => {
  const context = { id: 'member.demo', role: 'Member', tenantAlias: 'demo', environment: 'test', date: '2026-10-16' };
  const dir = workspace(t, [feature('items.create', 'discovered', ['Can it be edited?'])], undefined, [context]);
  const cli = path.resolve('tools/knowledge.mjs');
  const currentFile = path.join(dir, 'CURRENT.json');
  const before = fs.readFileSync(currentFile, 'utf8');
  const audit = spawnSync(process.execPath, [cli, 'coverage', 'audit', '--json', '--data', dir], { encoding: 'utf8' });
  assert.equal(audit.status, 0, audit.stderr);
  assert.equal(JSON.parse(audit.stdout).counts.gaps, 2);
  assert.equal(fs.readFileSync(currentFile, 'utf8'), before);
  const revision = JSON.parse(before).revision;
  const reconcile = spawnSync(process.execPath, [cli, 'coverage', 'reconcile', '--context', context.id, '--expected-revision', revision, '--data', dir], { encoding: 'utf8' });
  assert.equal(reconcile.status, 0, reconcile.stderr);
  assert.equal(JSON.parse(reconcile.stdout).taskIds.length, 1);
});
