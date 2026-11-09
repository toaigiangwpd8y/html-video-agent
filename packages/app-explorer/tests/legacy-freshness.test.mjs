import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaceReader } from '../lib/workspace-reader.mjs';

function legacyWorkspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-legacy-freshness-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'features'));
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({
    app: { name: 'Synthetic legacy app', baseUrl: 'http://127.0.0.1' },
    journeys: [],
    features: [{ id: 'reports.export', title: 'Export reports', area: 'Reports', status: 'discovered', summary: 'Initial summary', updatedAt: '2026-10-23' }],
  }));
  fs.writeFileSync(path.join(dir, 'features', 'reports.export.json'), JSON.stringify({
    id: 'reports.export', title: 'Export reports', area: 'Reports', status: 'discovered', summary: 'Initial summary',
    entry: { url: '/reports', label: 'Reports' }, testedContext: null, lastVerifiedAt: null, updatedAt: '2026-10-23',
    steps: [], questions: [], nextActions: [],
  }));
  return dir;
}

test('V1 reader reloads a changed feature while keeping its public revision null', (t) => {
  const dir = legacyWorkspace(t);
  const reader = createWorkspaceReader(dir);
  const first = reader.readKnowledge();
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.revision, null);
  assert.equal(first.features[0].summary, 'Initial summary');

  const featureFile = path.join(dir, 'features', 'reports.export.json');
  const changed = JSON.parse(fs.readFileSync(featureFile, 'utf8'));
  changed.summary = 'Committed synthetic observation';
  fs.writeFileSync(featureFile, JSON.stringify(changed));

  const next = reader.readKnowledge();
  assert.equal(next.revision, null);
  assert.equal(next.features[0].summary, 'Committed synthetic observation');
  assert.equal(reader.counters.workspaceLoads, 2);
});
