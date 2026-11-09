import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { heartbeatRun } from './runs.mjs';
import { loadWorkspace } from './store.mjs';
import { readPresenceRecord } from './presence.mjs';

const DEFAULT_STALE_MS = 120_000;
const MAX_FUTURE_SKEW_MS = 1_000;

export function staleThresholdMs(value = process.env.APP_EXPLORER_RUN_STALE_MS) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1_000 ? number : DEFAULT_STALE_MS;
}

export function intervalForStaleThreshold(staleAfterMs) {
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 1_000) throw new Error('Run stale threshold must be at least 1000ms.');
  return Math.max(100, Math.floor(staleAfterMs / 3));
}

export function pulseIsLive(pulsePath, { now = Date.now(), staleAfterMs = DEFAULT_STALE_MS } = {}) {
  try {
    const stat = fs.statSync(pulsePath);
    if (!stat.isFile()) return false;
    const age = now - stat.mtimeMs;
    return Number.isFinite(age) && age >= -MAX_FUTURE_SKEW_MS && age <= staleAfterMs;
  } catch { return false; }
}

function diagnostic(type, fields = {}) {
  return JSON.stringify({ component: 'presence-companion', type, ...fields });
}

function writeDiagnostic(stream, type, fields) {
  stream.write(`${diagnostic(type, fields)}\n`);
}

export async function runPresenceCompanion({ dataDir, runId, leaseId, pulsePath, staleAfterMs = staleThresholdMs(), intervalMs = intervalForStaleThreshold(staleAfterMs), signal, stdout = process.stdout, stderr = process.stderr }) {
  if (!dataDir || !runId || !leaseId || !pulsePath) throw new Error('data, run, lease, and pulse are required.');
  const resolvedPulse = path.resolve(pulsePath);
  const owned = { active: true };
  let timer;
  let signalHandler;
  const stop = () => { owned.active = false; clearTimeout(timer); };
  signalHandler = stop;
  signal?.addEventListener('abort', signalHandler, { once: true });
  writeDiagnostic(stdout, 'started', { runId, intervalMs, staleAfterMs });
  try {
    while (owned.active) {
      const liveNow = () => !signal?.aborted && pulseIsLive(resolvedPulse, { staleAfterMs });
      if (signal?.aborted) {
        writeDiagnostic(stdout, 'stopped', { runId, reason: 'requested' });
        return { stopped: true, reason: 'requested' };
      }
      if (!liveNow()) {
        writeDiagnostic(stderr, 'stopped', { runId, reason: 'worker_pulse_missing_or_stale' });
        return { stopped: true, reason: 'worker_pulse_missing_or_stale' };
      }
      try {
        const result = await heartbeatRun(dataDir, runId, {
          leaseId,
          beforePresenceWrite: () => {
            if (!liveNow()) throw new Error('Worker liveness signal expired before presence write.');
            return true;
          },
        });
        writeDiagnostic(stdout, 'heartbeat', { runId, presenceVersion: result.presenceVersion, heartbeatAt: result.heartbeatAt });
      } catch (error) {
        const run = loadWorkspace(dataDir).runs.find((item) => item.id === runId);
        const presence = readPresenceRecord(dataDir, runId);
        const reason = signal?.aborted ? 'requested' : presence?.retired ? 'lease_retired' : !run || !['running', 'waiting_user', 'waiting_external'].includes(run.status) ? 'run_inactive' : !liveNow() ? 'worker_pulse_missing_or_stale' : 'heartbeat_rejected';
        writeDiagnostic(stderr, 'stopped', { runId, reason });
        return { stopped: true, reason };
      }
      if (!owned.active) break;
      await new Promise((resolve) => {
        const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
        timer = setTimeout(finish, intervalMs);
        signal?.addEventListener('abort', finish, { once: true });
      });
    }
    writeDiagnostic(stdout, 'stopped', { runId, reason: 'requested' });
    return { stopped: true, reason: 'requested' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', signalHandler);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || args[key.slice(2)] !== undefined) throw new Error('Arguments must use unique --name value pairs.');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}.`);
    args[key.slice(2)] = value;
    index += 1;
  }
  const allowed = new Set(['data', 'run', 'lease', 'pulse', 'stale-ms', 'interval-ms']);
  if (Object.keys(args).some((key) => !allowed.has(key))) throw new Error('Unsupported companion option.');
  if (!args.data || !args.run || !args.lease || !args.pulse) throw new Error('Required: --data DIR --run ID --lease ID --pulse FILE.');
  const safeId = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
  if (!safeId.test(args.run) || !safeId.test(args.lease)) throw new Error('Run and lease must be stable IDs.');
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try { args = parseArgs(argv); }
  catch { process.stderr.write(`${diagnostic('error', { code: 'invalid_arguments' })}\n`); return 2; }
  const staleAfterMs = args['stale-ms'] === undefined ? staleThresholdMs() : Number(args['stale-ms']);
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 1_000) {
    process.stderr.write(`${diagnostic('error', { code: 'invalid_stale_threshold' })}\n`);
    return 2;
  }
  const intervalMs = args['interval-ms'] === undefined ? intervalForStaleThreshold(staleAfterMs) : Number(args['interval-ms']);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 50 || intervalMs >= staleAfterMs) {
    process.stderr.write(`${diagnostic('error', { code: 'invalid_interval' })}\n`);
    return 2;
  }
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await runPresenceCompanion({ dataDir: path.resolve(args.data), runId: args.run, leaseId: args.lease, pulsePath: args.pulse, staleAfterMs, intervalMs, signal: abort.signal });
    return 0;
  } catch {
    process.stderr.write(`${diagnostic('error', { runId: args.run, code: 'companion_failed' })}\n`);
    return 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();