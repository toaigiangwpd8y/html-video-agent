import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {handleExplorerCli} from '../src/app-explorer/cli.js';
import {registerApp, resolveAppWorkspace} from '../src/app-explorer/registry.js';
import {runKnowledgeCli} from '../packages/app-explorer/index.mjs';

async function withRoot(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'app-explorer-cli-'));
  try { await fn(root); } finally { await rm(root, {recursive: true, force: true}); }
}

test('apps add/list and source add keep source paths out of public list metadata', async () => withRoot(async (root) => {
  const out: unknown[] = []; const print = (value: unknown) => out.push(value);
  assert.equal(await handleExplorerCli(root, ['apps', 'add', '--id', 'app-a', '--name', 'App A', '--url', 'https://a.example'], print), 0);
  const source = join(root, 'source');
  const {mkdir} = await import('node:fs/promises'); await mkdir(source);
  assert.equal(await handleExplorerCli(root, ['apps', 'source', 'add', '--app', 'app-a', '--alias', 'code', '--path', source], print), 0);
  assert.deepEqual(out.at(-1), {ok: true, appId: 'app-a', alias: 'code'});
  assert.equal(await handleExplorerCli(root, ['apps', 'add', '--id', 'app-a', '--name', 'App A', '--url', 'https://a.example'], print), 0);
  assert.deepEqual(out.at(-1), {ok: true, appId: 'app-a'});
  assert.equal(await handleExplorerCli(root, ['apps', 'list'], print), 0);
  const listing = out.at(-1) as {apps: Array<Record<string, unknown>>};
  assert.equal(listing.apps[0].id, 'app-a');
  assert.equal(JSON.stringify(listing).includes(source), false);
}));

test('forwards existing knowledge commands, --data and all flags without demo fallback', async () => withRoot(async (root) => {
  const data = join(root, 'custom-data'); await runKnowledgeCli(['init', '--data', data, '--name', 'Custom', '--url', 'https://custom.example'], {cwd: root});
  const out: unknown[] = []; const print = (value: unknown) => out.push(value);
  assert.equal(await handleExplorerCli(root, ['summary', '--data', data, '--json'], print), 0);
  assert.equal(JSON.parse(String(out.at(-1))).app.name, 'Custom');
  assert.equal(await handleExplorerCli(root, ['summary', '--json'], print), 1);
  assert.match(String(out.at(-1)), /--app|--data/i);
  assert.equal(await handleExplorerCli(root, ['--help'], print), 0);
  assert.match(String(out.at(-1)), /App Explorer CLI/);
}));


test('compiled explore CLI resolves its package runtime when launched from another cwd with an absolute dataset', async () => withRoot(async (host) => {
  const data = join(host, 'dataset');
  const caller = join(host, 'elsewhere');
  const {mkdir} = await import('node:fs/promises'); await mkdir(caller);
  await runKnowledgeCli(['init', '--data', data, '--name', 'Remote cwd', '--url', 'https://remote.example'], {cwd: host, stdout: () => {}});
  const executable = resolve(process.cwd(), 'dist/src/cli.js');
  const result = await new Promise<{code: number; stdout: string; stderr: string}>((done) => {
    execFile(process.execPath, [executable, 'explore', 'summary', '--data', data, '--json'], {cwd: caller}, (error: any, stdout: string, stderr: string) => {
      done({code: error?.code ?? 0, stdout, stderr});
    });
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).app.name, 'Remote cwd');
}));

test('host explore commands use registered app workspaces from the maintained workflow', async () => withRoot(async (host) => {
  const executable = resolve(process.cwd(), 'dist/src/cli.js');
  const run = (args: string[]) => new Promise<{code: number; stdout: string; stderr: string}>((done) => {
    execFile(process.execPath, [executable, 'explore', ...args], {cwd: host}, (error: any, stdout: string, stderr: string) => {
      done({code: error?.code ?? 0, stdout, stderr});
    });
  });
  const registered = await run(['apps', 'add', '--id', 'workflow-app', '--name', 'Workflow App', '--url', 'https://workflow.example']);
  assert.equal(registered.code, 0, registered.stderr);
  const workspace = join(host, 'workspaces', 'workflow-app');
  await cp(resolve('packages/app-explorer/examples/demo-knowledge'), workspace, {recursive: true});
  const migrated = await run(['migrate', '--app', 'workflow-app']);
  assert.equal(migrated.code, 0, migrated.stderr);
  const summaryResult = await run(['summary', '--json', '--app', 'workflow-app']);
  assert.equal(summaryResult.code, 0, summaryResult.stderr);
  assert.equal(JSON.parse(summaryResult.stdout).app.name, 'TaskFlow Demo');
  const nextResult = await run(['next', '--json', '--app', 'workflow-app']);
  assert.equal(nextResult.code, 0, nextResult.stderr);
  assert.ok(JSON.parse(nextResult.stdout));
  const featureResult = await run(['feature', 'get', 'tasks.filter', '--json', '--app', 'workflow-app']);
  assert.equal(featureResult.code, 0, featureResult.stderr);
  assert.equal(JSON.parse(featureResult.stdout).feature.id, 'tasks.filter');
  const scopeFile = join(host, 'scope.json');
  await writeFile(scopeFile, JSON.stringify({appId: 'workflow-app', contextId: null}), 'utf8');
  const startedResult = await run(['run', 'start', scopeFile, '--browser', 'agent-browser', '--session', 'synthetic-session', '--json', '--app', 'workflow-app']);
  assert.equal(startedResult.code, 0, startedResult.stderr);
  const started = JSON.parse(startedResult.stdout);
  const workResult = await run(['work', '--run', started.run.id, '--json', '--app', 'workflow-app']);
  assert.equal(workResult.code, 0, workResult.stderr);
  const packetFile = join(host, 'work.json');
  const draftFile = join(host, 'observation.json');
  await writeFile(packetFile, workResult.stdout, 'utf8');
  const draftResult = await run(['draft', '--packet', packetFile, '--output', draftFile, '--app', 'workflow-app']);
  assert.equal(draftResult.code, 0, draftResult.stderr);
  assert.ok(JSON.parse(await readFile(draftFile, 'utf8')));
  const stoppedResult = await run(['run', 'stop', started.run.id, 'End synthetic workflow test', '--app', 'workflow-app']);
  assert.equal(stoppedResult.code, 0, stoppedResult.stderr);
}));
test('rejects demo mutation without an explicit app or dataset and leaves CURRENT untouched', async () => withRoot(async (root) => {
  const demo = join(root, 'synthetic-demo');
  await cp(resolve('packages/app-explorer/examples/demo-knowledge'), demo, {recursive: true});
  const current = join(demo, 'CURRENT.json');
  const before = await readFile(current, 'utf8').catch(() => null);
  const previous = process.env.KNOWLEDGE_DIR;
  process.env.KNOWLEDGE_DIR = demo;
  try {
    const out: unknown[] = []; const print = (value: unknown) => out.push(value);
    assert.equal(await handleExplorerCli(root, ['migrate', '--allow-demo-write'], print), 1);
    assert.match(String(out.at(-1)), /--app|--data/i);
    assert.equal(await readFile(current, 'utf8').catch(() => null), before);
  } finally {
    if (previous === undefined) delete process.env.KNOWLEDGE_DIR;
    else process.env.KNOWLEDGE_DIR = previous;
  }
}));

test('rejects ambiguous --app/--data and preserves next context rejection without writes', async () => withRoot(async (root) => {
  await registerApp(root, {id: 'app-a', name: 'App A', url: 'https://a.example'});
  const data = await resolveAppWorkspace(root, 'app-a');
  await runKnowledgeCli(['init', '--data', data, '--name', 'App A', '--url', 'https://a.example'], {cwd: root});
  const current = join(data, 'CURRENT.json'); const before = await readFile(current, 'utf8');
  const out: unknown[] = []; const print = (value: unknown) => out.push(value);
  assert.equal(await handleExplorerCli(root, ['summary', '--app', 'app-a', '--data', data], print), 1);
  assert.match(String(out.at(-1)), /both|ambiguous/i);
  assert.equal(await handleExplorerCli(root, ['next', '--app', 'app-a', '--context', 'ctx-a'], print), 1);
  assert.match(String(out.at(-1)), /next does not support --context/i);
  assert.equal(await readFile(current, 'utf8'), before);
}));

test('app forwarding supports work context and rejects unknown options through the core CLI', async () => withRoot(async (root) => {
  await registerApp(root, {id: 'app-a', name: 'App A', url: 'https://a.example'});
  const data = await resolveAppWorkspace(root, 'app-a'); await runKnowledgeCli(['init', '--data', data, '--name', 'App A', '--url', 'https://a.example'], {cwd: root});
  await runKnowledgeCli(['migrate', '--data', data], {cwd: root});
  const contextFile = join(root, 'context.json');
  await writeFile(contextFile, JSON.stringify({version: 2, baseRevision: 'r000001', inventory: {contexts: [{id: 'ctx-a', role: 'member', tenantAlias: 'synthetic', environment: 'test', date: '2026-10-17'}]}}), 'utf8');
  await runKnowledgeCli(['apply', 'context.json', '--data', data], {cwd: root});
  const out: unknown[] = []; const print = (value: unknown) => out.push(value);
  assert.equal(await handleExplorerCli(root, ['work', '--app', 'app-a', '--json'], print), 0);
  assert.equal(await handleExplorerCli(root, ['work', '--app', 'app-a', '--context', 'ctx-a', '--json'], print), 0);
  assert.equal(await handleExplorerCli(root, ['task', 'start', '--invented', '--app', 'app-a'], print), 1);
  assert.match(String(out.at(-1)), /Usage: task start/i);
}));






