import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(packageDir, 'index.mjs');
const cli = path.join(packageDir, 'cli.mjs');

test('package import is workspace-neutral and exports reusable CLI and live readers', async () => {
  const unrelated = fs.mkdtempSync(path.join(os.tmpdir(), 'app-explorer-unrelated-'));
  const beforeArgv = [...process.argv];
  const beforeExitCode = process.exitCode;
  const originalWrite = process.stdout.write;
  const originalError = process.stderr.write;
  const originalExit = process.exit;
  const originalReadFile = fs.readFileSync;
  let output = '';
  let demoReads = 0;
  let exitCalls = 0;
  process.stdout.write = function (chunk, ...args) { output += String(chunk); return true; };
  process.stderr.write = function (chunk, ...args) { output += String(chunk); return true; };
  process.exit = function (...args) { exitCalls++; throw new Error(`unexpected process.exit(${args.join(',')})`); };
  fs.readFileSync = function (file, ...args) {
    if (String(file).startsWith(path.join(packageDir, 'examples', 'demo-knowledge'))) demoReads++;
    return originalReadFile.call(this, file, ...args);
  };
  try {
    process.chdir(unrelated);
    const api = await import(`${pathToFileURL(entry).href}?neutral=${Date.now()}`);
    assert.equal(typeof api.runKnowledgeCli, 'function');
    assert.equal(typeof api.createWorkspaceReader, 'function');
    assert.equal(typeof api.buildExplorerHead, 'function');
    assert.equal(typeof api.buildExplorerState, 'function');
    assert.deepEqual(process.argv, beforeArgv);
    assert.equal(process.exitCode, beforeExitCode);
    assert.equal(output, '');
    assert.equal(demoReads, 0);
    assert.equal(exitCalls, 0);
    let setupOutput = '';
    let cliStdout = '';
    let cliStderr = '';
    const fixture = path.join(unrelated, 'knowledge');
    await api.runKnowledgeCli(['init', '--data', fixture, '--name', 'Neutral', '--url', 'https://example.test'], {
      cwd: unrelated, stdout: (text) => { setupOutput += text; }, stderr: (text) => { cliStderr += text; },
    });
    assert.match(setupOutput, /Created workspace/);
    assert.equal(cliStderr, '');
    const importStdout = output;
    const importStderr = output;
    assert.equal(await api.runKnowledgeCli(['summary', '--data', fixture], {
      cwd: unrelated, stdout: (text) => { cliStdout += text; }, stderr: (text) => { cliStderr += text; },
    }), 0);
    assert.equal(importStdout, '');
    assert.equal(importStderr, '');
    assert.match(cliStdout, /"schemaVersion"/);
  } finally {
    process.chdir(packageDir);
    process.stdout.write = originalWrite;
    process.stderr.write = originalError;
    process.exit = originalExit;
    fs.readFileSync = originalReadFile;
    fs.rmSync(unrelated, { recursive: true, force: true });
  }
});

test('CLI subprocess keeps help and explicit-data protection status codes', () => {
  const help = spawnSync(process.execPath, [cli, 'help'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /App Explorer CLI/);
  assert.match(help.stdout, /Node\.js >=22\.18\.0/);
  const protectedWrite = spawnSync(process.execPath, [cli, 'init', '--name', 'Unsafe', '--url', 'https://example.test'], { cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, KNOWLEDGE_DIR: '' } });
  assert.equal(protectedWrite.status, 1);
  assert.match(protectedWrite.stderr, /requires --data or KNOWLEDGE_DIR/);
});
