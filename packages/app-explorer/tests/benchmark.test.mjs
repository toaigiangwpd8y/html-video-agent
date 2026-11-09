import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { benchmarkWorkspace } from '../tools/benchmark.mjs';

test('benchmarkWorkspace records paired workload samples, counters, and honest presence availability', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-benchmark-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const originalIoMethods = Object.fromEntries(['readFileSync', 'writeFileSync', 'readdirSync', 'renameSync'].map((name) => [name, fs[name]]));
  const result = await benchmarkWorkspace({ repoDir: path.resolve('.'), outputDir: path.join(temp, 'dataset'), features: 3, scenariosPerFeature: 2, samples: 2 });
  assert.deepEqual(result.parameters, { features: 3, scenariosPerFeature: 2, samples: 2 });
  assert.equal(result.dataset.features, 3);
  assert.equal(result.dataset.scenarios, 6);
  for (const name of ['workRead', 'heartbeat', 'apply', 'httpPoll', 'export']) {
    assert.equal(result.measurements[name].samples.length, 2, `${name} raw samples`);
    assert.ok(result.measurements[name].operationCounts.every((counts) => counts.reads > 0));
    assert.ok(result.measurements[name].rawTimingsMs.every((value) => value >= 0));
  }
  assert.equal(result.measurements.httpPollCold.samples.length, 1, 'cold initial validation is reported separately');
  assert.equal(result.measurements.httpPollWarm.samples.length, 2, 'warm polls use the same explicit sample count');
  assert.ok(result.measurements.workRead.revisions.every(({ before, after }) => before && before === after), 'read-only samples retain their observed revision');
  assert.equal(result.measurements.presence.available, true);
  assert.equal(result.measurements.presence.method, 'readPresence');
  assert.equal(result.measurements.presenceRead.samples.length, 2);
  assert.deepEqual(result.measurements.presenceRead.operationCounts, [
    { reads: 1, fileReads: 1, directoryReads: 0, writes: 0, renames: 0 },
    { reads: 1, fileReads: 1, directoryReads: 0, writes: 0, renames: 0 },
  ], 'each presence sample counts only its own single record read');
  const presenceBytes = fs.statSync(path.join(temp, 'dataset', 'runtime', 'presence', 'run.benchmark.json')).size;
  assert.deepEqual(result.measurements.presenceRead.bytes, [
    { read: presenceBytes, written: 0 },
    { read: presenceBytes, written: 0 },
  ], 'each presence sample counts exactly the bytes in the one record read');
  assert.deepEqual(Object.fromEntries(Object.keys(originalIoMethods).map((name) => [name, fs[name]])), originalIoMethods,
    'benchmark restores each original fs method identity after all samples');
  assert.ok(result.environment.node);
  assert.ok(result.finalRevision);
});

test('measureIo restores original fs methods after a measured action throws', async () => {
  const originalIoMethods = Object.fromEntries(['readFileSync', 'writeFileSync', 'readdirSync', 'renameSync'].map((name) => [name, fs[name]]));
  const { measureIo } = await import('../tools/benchmark.mjs');
  await assert.rejects(measureIo(() => { throw new Error('synthetic measured failure'); }), /synthetic measured failure/);
  assert.deepEqual(Object.fromEntries(Object.keys(originalIoMethods).map((name) => [name, fs[name]])), originalIoMethods,
    'failed measurement also restores each original fs method identity');
});
