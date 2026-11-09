import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SAFE_ID } from './schema.mjs';

export function readJsonValue(file) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error(`Expected valid JSON in ${file}: ${error.message}`); }
  return value;
}

export function readJsonObject(file) {
  const value = readJsonValue(file);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected a JSON object in ${file}.`);
  return value;
}

export function writeJsonUtf8(file, value) {
  if (!value || typeof value !== 'object') throw new Error('JSON output must be an object or array.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  return file;
}

export function ensureEvidenceDirectory(dir, runId) {
  if (!SAFE_ID.test(runId || '')) throw new Error('Evidence directory requires a stable run ID.');
  const root = path.resolve(dir, 'evidence');
  const target = path.resolve(root, runId);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Evidence directory must stay within workspace.');
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw new Error('Evidence directory cannot be a symlink.');
  fs.mkdirSync(target, { recursive: true });
  if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Run evidence directory cannot be a symlink.');
  return target;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function sha256(value) {
  const bytes = typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array
    ? value : JSON.stringify(stableValue(value));
  return createHash('sha256').update(bytes).digest('hex');
}
