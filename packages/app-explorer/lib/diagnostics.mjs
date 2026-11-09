import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SAFE_ID } from './schema.mjs';
import { withWorkspaceLock } from './revisions.mjs';

// Public low-cardinality enums: caller prose and arbitrary values are intentionally excluded.
export const DIAGNOSTIC_OPERATIONS = Object.freeze([
  'browser_inspect', 'workspace_read', 'workspace_write', 'knowledge_commit', 'run_start',
  'run_checkpoint', 'run_pause', 'task_checkpoint', 'diagnostic_write', 'presence_renew', 'presence_recover',
]);
export const DIAGNOSTIC_PHASES = Object.freeze(['start', 'finish', 'error', 'recovery']);
export const DIAGNOSTIC_STATUSES = Object.freeze(['started', 'succeeded', 'failed', 'paused', 'waiting', 'recovered', 'interrupted']);
export const DIAGNOSTIC_RECOVERY = Object.freeze(['none', 'retry', 'resume', 'reauthenticate', 'manual_review', 'resync', 'unknown']);
const FIELDS = new Set(['id', 'runId', 'taskId', 'timestamp', 'operation', 'operationId', 'phase', 'status', 'durationMs', 'exitCode', 'errorCode', 'recovery']);
const fail = (message) => { throw new Error(message); };
const runtimeDir = (dir) => path.join(path.resolve(dir), 'runtime');
const logPath = (dir) => path.join(runtimeDir(dir), 'diagnostics.jsonl');
const generationPath = (dir) => path.join(runtimeDir(dir), 'diagnostics.generation');

function sanitizeDiagnostic(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) fail('Diagnostic event must be an object.');
  for (const key of Object.keys(event)) if (!FIELDS.has(key)) fail(`Unexpected diagnostic field: ${key}`);
  for (const key of ['id', 'runId']) if (typeof event[key] !== 'string' || !SAFE_ID.test(event[key])) fail(`Invalid diagnostic ${key}.`);
  if (event.taskId != null && (typeof event.taskId !== 'string' || !SAFE_ID.test(event.taskId))) fail('Invalid diagnostic taskId.');
  if (event.operationId != null && (typeof event.operationId !== 'string' || !SAFE_ID.test(event.operationId))) fail('Invalid diagnostic operationId.');
  if (typeof event.timestamp !== 'string' || !Number.isFinite(Date.parse(event.timestamp))) fail('Invalid diagnostic timestamp.');
  if (!DIAGNOSTIC_OPERATIONS.includes(event.operation)) fail('Invalid diagnostic operation.');
  if (!DIAGNOSTIC_PHASES.includes(event.phase)) fail('Invalid diagnostic phase.');
  if (!DIAGNOSTIC_STATUSES.includes(event.status)) fail('Invalid diagnostic status.');
  if (event.durationMs != null && (!Number.isSafeInteger(event.durationMs) || event.durationMs < 0)) fail('Invalid diagnostic durationMs.');
  if (event.exitCode != null && (!Number.isInteger(event.exitCode) || event.exitCode < -255 || event.exitCode > 255)) fail('Invalid diagnostic exitCode.');
  if (event.errorCode != null && (typeof event.errorCode !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(event.errorCode))) fail('Invalid diagnostic errorCode.');
  if (event.recovery != null && !DIAGNOSTIC_RECOVERY.includes(event.recovery)) fail('Invalid diagnostic recovery.');
  return Object.fromEntries([...FIELDS].filter((key) => event[key] != null).map((key) => [key, event[key]]));
}
function generation(dir, create = false) {
  const file = generationPath(dir);
  if (fs.existsSync(file)) {
    const value = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9-]{36}$/i.test(value)) return value;
  }
  if (!create) return null;
  fs.mkdirSync(runtimeDir(dir), { recursive: true });
  const value = randomUUID();
  fs.writeFileSync(file, `${value}\n`, 'utf8');
  return value;
}
function repairTail(file) {
  if (!fs.existsSync(file)) return;
  let bytes = fs.readFileSync(file);
  if (!bytes.length) return;
  if (bytes.at(-1) !== 10) {
    fs.truncateSync(file, bytes.lastIndexOf(10) + 1);
    bytes = fs.readFileSync(file);
    if (!bytes.length) return;
  }
  const text = bytes.toString('utf8');
  const rows = text.split('\n').filter(Boolean);
  if (!rows.length) return;
  try { sanitizeDiagnostic(JSON.parse(rows.at(-1))); }
  catch {
    const lastNewline = bytes.lastIndexOf(10, bytes.length - 2);
    fs.truncateSync(file, lastNewline + 1);
  }
}
function scan(dir, { createGeneration = false } = {}) {
  const gen = generation(dir, createGeneration);
  const file = logPath(dir);
  if (!fs.existsSync(file)) return { gen, events: [], gap: false };
  const bytes = fs.readFileSync(file);
  const completeLength = bytes.length && bytes.at(-1) !== 10 ? bytes.lastIndexOf(10) + 1 : bytes.length;
  let gap = completeLength !== bytes.length;
  const events = [];
  const seenIds = new Set();
  if (completeLength) {
    for (const line of bytes.subarray(0, completeLength).toString('utf8').split('\n').filter(Boolean)) {
      try {
        const event = sanitizeDiagnostic(JSON.parse(line));
        if (seenIds.has(event.id)) { gap = true; continue; }
        seenIds.add(event.id);
        events.push(event);
      }
      catch { /* Malformed rows are skipped and reported as a gap; raw bytes stay private. */ }
    }
    const rowCount = bytes.subarray(0, completeLength).toString('utf8').split('\n').filter(Boolean).length;
    if (rowCount !== events.length) return { gen, events, gap: true };
  }
  return { gen, events, gap };
}
function cursorFor(gen, offset) { return gen ? `${gen}:${offset}` : null; }
function parseCursor(cursor, gen, length) {
  if (cursor == null) return { offset: 0, valid: true };
  if (typeof cursor !== 'string') return { offset: 0, valid: false };
  const match = /^([a-f0-9-]{36}):(0|[1-9]\d*)$/i.exec(cursor);
  if (!match || match[1] !== gen || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) > length) return { offset: 0, valid: false };
  return { offset: Number(match[2]), valid: true };
}

export async function recordDiagnostic(dir, event) {
  const safe = sanitizeDiagnostic(event);
  return withWorkspaceLock(dir, () => {
    const state = scan(dir, { createGeneration: true });
    const existingIndex = state.events.findIndex((item) => item.id === safe.id);
    if (existingIndex >= 0) return { cursor: cursorFor(state.gen, existingIndex + 1), duplicate: true };
    fs.mkdirSync(runtimeDir(dir), { recursive: true });
    const file = logPath(dir);
    repairTail(file);
    fs.appendFileSync(file, `${JSON.stringify(safe)}\n`, 'utf8');
    return { cursor: cursorFor(state.gen, state.events.length + 1), duplicate: false };
  });
}



function diagnosticsSignature(dir) {
  return [generationPath(dir), logPath(dir)].map((file) => {
    try {
      const stat = fs.statSync(file, { bigint: true });
      return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
    } catch (error) {
      if (error.code === 'ENOENT') return 'missing';
      throw error;
    }
  }).join('|');
}

function diagnosticsPage(state, { after = null, limit = 100 } = {}) {
  const count = Number.isInteger(limit) ? Math.max(1, Math.min(500, limit)) : 100;
  const parsed = parseCursor(after, state.gen, state.events.length);
  const resync = !parsed.valid || (state.gap && after == null);
  const start = resync ? 0 : parsed.offset;
  const events = state.events.slice(start, start + count);
  const deliveredOffset = start + events.length;
  return { events, cursor: cursorFor(state.gen, deliveredOffset), hasMore: deliveredOffset < state.events.length, resync, gap: state.gap };
}

// Reuse a validated scan while both runtime files are unchanged. Head metadata
// describes the current tail and gap; it is not a paginated page or resync request.
export function createDiagnosticsReader(dir) {
  let cached = null;
  const counters = { scans: 0, cacheHits: 0 };
  const readState = () => {
    const before = diagnosticsSignature(dir);
    if (cached?.signature === before) {
      counters.cacheHits++;
      return cached.state;
    }
    const state = scan(dir);
    counters.scans++;
    const after = diagnosticsSignature(dir);
    cached = before === after ? { signature: after, state } : null;
    return state;
  };
  return {
    get counters() { return { ...counters }; },
    read(options) { return diagnosticsPage(readState(), options); },
    head() {
      const state = readState();
      return { cursor: cursorFor(state.gen, state.events.length), gap: state.gap };
    },
  };
}


export function readDiagnostics(dir, options = {}) {
  return diagnosticsPage(scan(dir), options);
}
