import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyObservation, exportDocs, initWorkspace, loadWorkspace } from '../lib/store.mjs';
import { sha256, writeJsonUtf8 } from '../lib/json-io.mjs';

function addFeature(dir) {
  const baseRevision = loadWorkspace(dir).revision;
  applyObservation(dir, { version: 2, baseRevision, features: [{ id: 'projects.create', title: 'Create project', area: 'Projects', summary: 'Create a project.', status: 'partial', entry: {}, steps: [], questions: [], nextActions: [] }] });
}

test('incremental export skips byte-identical scenario-first Markdown and force rewrites it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-incremental-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initWorkspace(dir, 'Export fixture', 'https://example.test');
  addFeature(dir);
  const first = exportDocs(dir);
  assert.equal(first.changed, 2);
  assert.equal(first.skipped, 0);
  const detail = path.join(dir, 'docs', 'features', 'projects.create.md');
  const before = fs.statSync(detail).mtimeMs;
  const second = exportDocs(dir);
  assert.equal(second.changed, 0);
  assert.equal(second.skipped, 2);
  assert.equal(fs.statSync(detail).mtimeMs, before);
  const forced = exportDocs(dir, { force: true });
  assert.equal(forced.changed, 2);
  assert.equal(forced.skipped, 0);
});

test('export check validates generated feature links without writing files', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initWorkspace(dir, 'Export fixture', 'https://example.test');
  addFeature(dir);
  exportDocs(dir);
  const result = exportDocs(dir, { check: true });
  assert.equal(result.checkedLinks, 1);
  assert.equal(result.changed, 0);
  fs.rmSync(path.join(dir, 'docs', 'features', 'projects.create.md'));
  assert.throws(() => exportDocs(dir, { check: true }), /missing generated markdown link target/i);
});

test('V2 export derives verification from current scenario fields when history is empty', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-v2-current-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initWorkspace(dir, 'Export fixture', 'https://example.test');
  const baseRevision = loadWorkspace(dir).revision;
  fs.mkdirSync(path.join(dir, 'evidence', 'synthetic'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', 'synthetic', 'result.png'), 'synthetic evidence');
  applyObservation(dir, {
    version: 2,
    baseRevision,
    features: [{ id: 'projects.create', title: 'Create project', area: 'Projects', summary: 'Create a project.', status: 'discovered', entry: {}, questions: [], nextActions: [] }],
    inventory: { contexts: [{ id: 'member.demo', role: 'member', tenantAlias: 'demo', environment: 'test', date: '2026-10-16' }] },
    scenarios: [{
      id: 'projects.create.member', featureId: 'projects.create', contextId: 'member.demo',
      preconditions: [], goal: 'Create a project', outcome: 'success', evidenceRefs: ['synthetic/result.png'],
      testedContext: { contextId: 'member.demo', role: 'member', date: '2026-10-16' }, lastVerifiedAt: '2026-10-16',
      completionCriteria: [{ id: 'visible', description: 'Project appears', met: true, evidenceRefs: ['synthetic/result.png'] }],
      steps: [{ id: 'submit', action: 'Submit project', observed: 'Project appears', evidenceRefs: ['synthetic/result.png'] }],
    }],
  });
  const current = JSON.parse(fs.readFileSync(path.join(dir, 'CURRENT.json'), 'utf8'));
  const revisionDir = path.join(dir, 'revisions', current.revision);
  const inventoryPath = path.join(revisionDir, 'inventory.json');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  delete inventory.scenarios[0].history;
  writeJsonUtf8(inventoryPath, inventory);
  const manifestPath = path.join(revisionDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files['inventory.json'] = sha256(fs.readFileSync(inventoryPath));
  manifest.derivedIndexes.coverage.sourceHashes['inventory.json'] = manifest.files['inventory.json'];
  writeJsonUtf8(manifestPath, manifest);
  exportDocs(dir);
  const markdown = fs.readFileSync(path.join(dir, 'docs', 'features', 'projects.create.md'), 'utf8');
  assert.match(markdown, /Scenario verification:\*\* verified/);
  assert.match(markdown, /verified in this scenario\/context/);
  assert.match(markdown, /Outcome:\*\* success/);
  assert.match(markdown, /Execution not yet recorded/);
});

test('failed export check does not create a missing docs tree', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-check-missing-tree-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initWorkspace(dir, 'Export fixture', 'https://example.test');
  addFeature(dir);
  const docs = path.join(dir, 'docs');
  fs.rmSync(docs, { recursive: true, force: true });
  assert.equal(fs.existsSync(docs), false);
  assert.throws(() => exportDocs(dir, { check: true }), /missing generated markdown file/i);
  assert.equal(fs.existsSync(docs), false);
});
