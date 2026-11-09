import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyObservation, initWorkspace, loadWorkspace } from '../lib/store.mjs';

test('revision receipt reports changed and reused immutable files', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-performance-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initWorkspace(dir, 'Storage fixture', 'https://example.test');
  const base = loadWorkspace(dir);
  const first = applyObservation(dir, { version: 2, baseRevision: base.revision,
    features: [{ id: 'items.create', title: 'Create item', area: 'Items', summary: 'Create an item.', status: 'partial', entry: {}, steps: [], questions: [], nextActions: [] }] });
  const before = loadWorkspace(dir);
  const second = applyObservation(dir, { version: 2, baseRevision: before.revision,
    features: [{ ...before.features[0], summary: 'Create an item in the list.' }] });
  assert.ok(first.validation.changed.includes('features/items.create.json'));
  assert.ok(second.validation.changed.includes('features/items.create.json'));
  assert.ok(second.validation.linked.includes('runs.json'));
  assert.ok(second.validation.validated > second.validation.changed.length);
});
