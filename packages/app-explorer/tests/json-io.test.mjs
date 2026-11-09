import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonObject, writeJsonUtf8, ensureEvidenceDirectory } from '../lib/json-io.mjs';

test('JSON IO writes UTF-8 without BOM and accepts a BOM on read', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-io-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'draft.json');
  writeJsonUtf8(file, { title: 'café' });
  assert.equal(fs.readFileSync(file)[0], 0x7b);
  fs.writeFileSync(file, `\uFEFF${JSON.stringify({ title: 'café' })}`, 'utf8');
  assert.deepEqual(readJsonObject(file), { title: 'café' });
});

test('JSON IO rejects malformed and nonobject documents and creates evidence directories', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-io-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'bad.json');
  assert.throws(() => readJsonObject(path.join(dir, 'missing', 'file.json')), /Expected valid JSON/);
  fs.writeFileSync(file, '[');
  assert.throws(() => readJsonObject(file), /valid JSON/);
  fs.writeFileSync(file, '[]');
  assert.throws(() => readJsonObject(file), /JSON object/);
  const evidence = ensureEvidenceDirectory(dir, 'run.one');
  assert.equal(fs.statSync(evidence).isDirectory(), true);
  assert.throws(() => ensureEvidenceDirectory(dir, '../bad'), /stable run ID/);
});
