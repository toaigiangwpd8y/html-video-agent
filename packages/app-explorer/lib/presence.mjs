import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { withWorkspaceLock } from './revisions.mjs';

const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const isoNow = (value) => value instanceof Date ? value.toISOString() : value || new Date().toISOString();
const presencePath = (dir, runId) => path.join(dir, 'runtime', 'presence', `${runId}.json`);

export function compatibilityLeaseId(runId) {
  const digest = createHash('sha256').update(String(runId)).digest('hex').slice(0, 24);
  return `lease.legacy.${digest}`;
}

export function newLeaseId() { return `lease.${randomUUID()}`; }

export function readPresenceRecord(dir, runId) {
  const file = presencePath(dir, runId);
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const allowed = new Set(['runId', 'leaseId', 'taskId', 'heartbeatAt', 'presenceVersion', 'retired', 'retiredAt']);
    if (Object.keys(value || {}).some((key) => !allowed.has(key)) || value?.runId !== runId || !SAFE_ID.test(value.leaseId || '') ||
      (value.taskId != null && !SAFE_ID.test(value.taskId)) || typeof value.heartbeatAt !== 'string' || !Number.isFinite(Date.parse(value.heartbeatAt)) ||
      !Number.isSafeInteger(value.presenceVersion) || value.presenceVersion < 1 || (value.retired != null && value.retired !== true)) return null;
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return null;
  }
}

export function readPresence(dir, run) {
  if (!run || typeof run.id !== 'string') return null;
  const presence = readPresenceRecord(dir, run.id);
  const leaseId = run.leaseId || compatibilityLeaseId(run.id);
  return presence?.leaseId === leaseId ? presence : null;
}

export function effectiveHeartbeatAt(dir, run) {
  const presence = readPresence(dir, run);
  if (presence?.retired) return null;
  if (presence && (presence.taskId ?? null) !== (run.currentTaskId ?? null)) return run?.heartbeatAt || null;
  return presence?.heartbeatAt || run?.heartbeatAt || null;
}

export function writePresenceUnderLock(dir, row) {
  fs.mkdirSync(path.dirname(presencePath(dir, row.runId)), { recursive: true });
  const file = presencePath(dir, row.runId);
  const temporary = `${file}.tmp-${randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(row, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

export async function writePresence(dir, { runId, leaseId, taskId = null, heartbeatAt }) {
  if (!SAFE_ID.test(runId || '') || !SAFE_ID.test(leaseId || '') || (taskId != null && !SAFE_ID.test(taskId)) || typeof heartbeatAt !== 'string' || !Number.isFinite(Date.parse(heartbeatAt))) {
    throw new Error('Invalid presence identity or heartbeat.');
  }
  return withWorkspaceLock(dir, () => {
    const prior = readPresenceRecord(dir, runId);
    if (prior?.retired) throw new Error('Retired heartbeat lease cannot be revived.');
    if (prior && prior.leaseId !== leaseId) throw new Error('Presence lease does not match current ownership.');
    const presenceVersion = Number.isSafeInteger(prior?.presenceVersion) ? prior.presenceVersion + 1 : 1;
    const row = { runId, leaseId, taskId, heartbeatAt: isoNow(heartbeatAt), presenceVersion };
    writePresenceUnderLock(dir, row);
    return row;
  });
}

export function retirePresenceUnderLock(dir, run, retiredAt = new Date().toISOString()) {
  const leaseId = run.leaseId || compatibilityLeaseId(run.id);
  const current = readPresenceRecord(dir, run.id);
  if (current && current.leaseId !== leaseId) return null;
  const row = { runId: run.id, leaseId, taskId: run.currentTaskId || current?.taskId || null,
    heartbeatAt: current?.heartbeatAt || run.heartbeatAt, presenceVersion: (current?.presenceVersion || 0) + 1,
    retired: true, retiredAt: isoNow(retiredAt) };
  writePresenceUnderLock(dir, row);
  return row;
}
