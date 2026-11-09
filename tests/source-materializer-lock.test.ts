import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withAssetStorageLock } from '../src/harness/asset-storage-lock.js';
import { materializeNormalizedSourceAsset } from '../src/sources/source-materializer.js';

test('normalized-source materialization rereads assets manifest after waiting for shared transaction lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'source-materializer-lock-'));
  try {
    const sourceRoot = join(root, '.video/sources');
    const sourceDir = join(sourceRoot, 'src-a');
    await mkdir(join(sourceDir, 'assets'), { recursive: true });
    await writeFile(join(sourceRoot, 'index.json'), JSON.stringify({ version: '1', sources: [{ id: 'src-a', kind: 'image', path: 'src-a/source.json' }] }));
    await writeFile(join(sourceDir, 'source.json'), JSON.stringify({ id: 'src-a', kind: 'image', assets: [{ id: 'image-a', path: 'assets/source.png', type: 'image/png' }] }));
    await writeFile(join(sourceDir, 'assets/source.png'), new Uint8Array([1, 2, 3]));
    await mkdir(join(root, 'assets'), { recursive: true });
    const manifestPath = join(root, 'assets/manifest.json');
    await writeFile(manifestPath, JSON.stringify({ version: '1', assets: [] }));

    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const explorerWrite = withAssetStorageLock(root, async () => {
      entered();
      await held;
      await writeFile(manifestPath, JSON.stringify({ version: '1', assets: [{ id: 'explorer-image', publicPath: '/assets/explorer/image.png' }] }));
    });
    await ready;
    const sourceWrite = materializeNormalizedSourceAsset(root, 'src-a', 'image-a', 'scene-1', 'source_document');
    release();
    await explorerWrite;
    await sourceWrite;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.deepEqual(manifest.assets.map((item: { id: string }) => item.id).sort(), ['explorer-image', 'source-src-a-image-a']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
