import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { withAssetStorageLock } from '../src/harness/asset-storage-lock.js';

test('asset storage lock recovers a confirmed dead local owner and preserves ownerless crash state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asset-storage-lock-'));
  try {
    const lockRoot = resolve(root, '.video/asset-storage');
    await mkdir(lockRoot, { recursive: true });
    const lockPath = join(lockRoot, '.revision.lock');
    const orphanedOwnerTemp = `${lockPath}.tmp-crashed-before-publish`;
    await writeFile(orphanedOwnerTemp, '{"pid":', 'utf8');
    await withAssetStorageLock(root, async () => {});
    assert.equal(await readFile(orphanedOwnerTemp, 'utf8'), '{"pid":', 'a crash before atomic publication leaves an inert temporary file, not a blocking ownerless lock');
    await rm(orphanedOwnerTemp);
    const currentHostname = (await import('node:os') as any).hostname();
    await writeFile(lockPath, JSON.stringify({ pid: 2147483647, hostname: currentHostname, token: 'dead-owner' }), 'utf8');
    let ran = false;
    await withAssetStorageLock(root, async () => { ran = true; });
    assert.equal(ran, true);
    assert.equal(await readFile(join(lockRoot, '.revision.lock'), 'utf8').then(() => true, () => false), false);

    const incomplete = '{"pid":';
    await writeFile(lockPath, incomplete, 'utf8');
    await assert.rejects(() => withAssetStorageLock(root, async () => {}, 1000), /unreadable|manual recovery/i);
    assert.equal(await readFile(lockPath, 'utf8'), incomplete, 'an interrupted owner publication stays fenced and is never stolen by age');
  } finally { await rm(root, { recursive: true, force: true }); }
});
