import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaceReader } from '../lib/workspace-reader.mjs';
import { initWorkspace, loadWorkspace, applyObservation } from '../lib/store.mjs';
import { createServer } from '../server.mjs';
import { countReadyUnowned, selectNextUnowned, readyUnownedTasks } from '../lib/runs.mjs';
import { recordDiagnostic } from '../lib/diagnostics.mjs';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-reader-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initWorkspace(dir, 'Reader fixture', 'http://127.0.0.1');
  return dir;
}

async function listen(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return 'http://127.0.0.1:' + server.address().port;
}

test('reader loads and validates a receipt once for repeated same-revision reads', (t) => {
  const dir = workspace(t);
  let loads = 0;
  const reader = createWorkspaceReader(dir, { loadWorkspace: (root) => { loads++; return loadWorkspace(root); } });
  const first = reader.readKnowledge();
  const second = reader.readKnowledge();
  assert.equal(loads, 1);
  assert.equal(first.revision, second.revision);
});

test('reader invalidates cached knowledge when CURRENT advances and errors for a corrupt revision', (t) => {
  const dir = workspace(t);
  let loads = 0;
  const reader = createWorkspaceReader(dir, { loadWorkspace: (root) => { loads++; return loadWorkspace(root); } });
  const initial = reader.readKnowledge();
  const feature = { id: 'reports.export', title: 'Export reports', area: 'Reports', summary: 'Download report data.', status: 'discovered', steps: [], questions: [], nextActions: [] };
  applyObservation(dir, { version: 2, baseRevision: initial.revision, features: [feature] }, { expectedRevision: initial.revision });
  const current = JSON.parse(fs.readFileSync(path.join(dir, 'CURRENT.json'), 'utf8'));
  const revisionDir = path.join(dir, 'revisions', current.revision);
  fs.writeFileSync(path.join(revisionDir, 'features', 'reports.export.json'), '{broken', 'utf8');
  assert.throws(() => reader.readKnowledge(), /JSON|Unexpected|parse/i);
  assert.equal(reader.lastGood.revision, initial.revision);
  assert.equal(loads, 2);
});

test('head carries volatile state and old state/activity APIs remain available', async (t) => {
  const dir = workspace(t);
  const base = await listen(t, createServer({ dataDir: dir, staticDir: path.resolve('public') }));
  const head = await fetch(base + '/api/head');
  assert.equal(head.status, 200);
  const payload = await head.json();
  assert.ok(payload.revision);
  assert.ok(payload.syncedAt);
  assert.ok(payload.activityCursor !== undefined);
  assert.ok(payload.diagnosticsCursor !== undefined);
  const state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.revision, payload.revision);
  assert.ok(state.featureViews);
  const activity = await (await fetch(base + '/api/activity')).json();
  assert.equal(activity.revision, payload.revision);
});

test('ready count and selection share context, dependency, due-time, and ownership rules', () => {
  const contexts = [{ id: 'ctx.member' }];
  const tasks = [
    { id: 'dependency-done', status: 'done', contextId: null, dependencies: [], depth: 0, sequence: 0 },
    { id: 'plain', status: 'queued', contextId: null, dependencies: [], depth: 0, sequence: 1 },
    { id: 'member', status: 'queued', contextId: 'ctx.member', dependencies: ['dependency-done'], depth: 1, sequence: 2 },
    { id: 'wrong-context', status: 'queued', contextId: 'ctx.reviewer', dependencies: [], depth: 0, sequence: 0 },
    { id: 'not-due', status: 'waiting_external', contextId: null, dependencies: [], blocker: { nextCheckAt: '2026-10-17T00:00:00Z' }, depth: 0, sequence: 3 },
    { id: 'owned', status: 'running', contextId: null, dependencies: [], depth: 0, sequence: 4 },
  ];
  const frontier = { tasks };
  const runs = [{ id: 'run.owner', status: 'running', currentTaskId: 'owned', heartbeatAt: '2026-10-16T00:00:00Z' }];
  const now = '2026-10-16T12:00:00Z';
  const options = { staleAfterMs: 120000 };
  assert.deepEqual(readyUnownedTasks(frontier, contexts, now, runs, options).map(task => task.id), ['plain', 'member']);
  assert.equal(countReadyUnowned(frontier, contexts, now, runs, options), 2);
  assert.equal(selectNextUnowned(frontier, contexts, now, runs, options).id, 'plain');
});


test('external wait due-time changes live readiness without changing the knowledge receipt', async (t) => {
  const dir = workspace(t);
  const clock = { value: new Date('2026-10-16T12:00:00Z') };
  const server = createServer({ dataDir: dir, staticDir: path.resolve('public'), now: () => clock.value });
  const base = await listen(t, server);
  const before = await (await fetch(base + '/api/head')).json();
  const knowledge = loadWorkspace(dir);
  const first = structuredClone(knowledge.frontier.tasks[0]);
  first.status = 'waiting_external';
  first.blocker = { reason: 'Fixture wait', condition: 'Fixture clock reaches the scheduled check', nextCheckAt: '2026-10-16T12:01:00Z' };
  applyObservation(dir, { version: 2, baseRevision: knowledge.revision, frontier: { tasks: [first] } }, { expectedRevision: knowledge.revision });
  const waiting = await (await fetch(base + '/api/head')).json();
  assert.equal(waiting.frontierCounts.ready, 0);
  assert.equal(waiting.frontierSummary.state, 'waiting_external');
  clock.value = new Date('2026-10-16T12:02:00Z');
  const due = await (await fetch(base + '/api/head')).json();
  assert.equal(due.revision, waiting.revision);
  assert.equal(due.frontierCounts.ready, 1);
  assert.equal(due.frontierSummary.state, 'ready');
  assert.notEqual(before.revision, waiting.revision);
});


test('head diagnostics tail metadata does not restart paginated feed resync', async (t) => {
  const dir = workspace(t);
  for (let index = 1; index <= 5; index++) {
    await recordDiagnostic(dir, {
      id: 'diag.head-' + index, runId: 'run.head', timestamp: '2026-10-17T00:00:00Z',
      operation: 'workspace_read', phase: 'finish', status: 'succeeded',
    });
  }
  const file = path.join(dir, 'runtime', 'diagnostics.jsonl');
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  fs.appendFileSync(file, lines[1] + '\n{"private":"must-not-leak"}\n', 'utf8');
  const base = await listen(t, createServer({ dataDir: dir, staticDir: path.resolve('public') }));

  const head = await (await fetch(base + '/api/head')).json();
  assert.equal(head.diagnosticsGap, true);
  assert.equal(Object.hasOwn(head, 'diagnosticsResync'), false);
  assert.equal(JSON.stringify(head).includes('must-not-leak'), false);
  const first = await (await fetch(base + '/api/diagnostics?limit=2')).json();
  assert.equal(first.resync, true);
  assert.deepEqual(first.events.map((item) => item.id), ['diag.head-1', 'diag.head-2']);
  const afterFirst = await (await fetch(base + '/api/head')).json();
  assert.equal(afterFirst.diagnosticsCursor, head.diagnosticsCursor);
  assert.equal(afterFirst.diagnosticsGap, true);

  const second = await (await fetch(base + '/api/diagnostics?after=' + encodeURIComponent(first.cursor) + '&limit=2')).json();
  assert.equal(second.resync, false);
  assert.deepEqual(second.events.map((item) => item.id), ['diag.head-3', 'diag.head-4']);
  const afterSecond = await (await fetch(base + '/api/head')).json();
  assert.equal(afterSecond.diagnosticsCursor, head.diagnosticsCursor);
  const third = await (await fetch(base + '/api/diagnostics?after=' + encodeURIComponent(second.cursor) + '&limit=2')).json();
  assert.equal(third.resync, false);
  assert.deepEqual(third.events.map((item) => item.id), ['diag.head-5']);
  assert.equal(third.hasMore, false);
});
