import assert from 'node:assert/strict';
import {cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {registerApp, resolveAppWorkspace, registerSourceAlias, resolveSourceAlias, listApps} from '../src/app-explorer/registry.js';
import {getAppWork, getRegisteredAppDerivedProjection, readApp} from '../src/app-explorer/service.js';
import {loadWorkspace} from '../packages/app-explorer/index.mjs';
import {handleExplorerCli} from '../src/app-explorer/cli.js';

async function withRoot(fn: (root: string, parent: string) => Promise<void>) {
  const parent = await mkdtemp(join(tmpdir(), 'app-explorer-registry-'));
  const root = join(parent, 'host');
  await mkdir(root);
  try { await fn(root, parent); } finally { await rm(parent, {recursive: true, force: true}); }
}

test('registers distinct app IDs into isolated fixed workspaces', async () => withRoot(async (root) => {
  await registerApp(root, {id: 'app-a', name: 'App A', url: 'https://a.example'});
  await registerApp(root, {id: 'app-b', name: 'App B', url: 'https://b.example'});
  const a = await resolveAppWorkspace(root, 'app-a');
  const b = await resolveAppWorkspace(root, 'app-b');
  assert.notEqual(a, b);
  assert.equal(a, resolve(root, 'workspaces/app-a'));
  assert.equal(b, resolve(root, 'workspaces/app-b'));
}));

test('app URLs reject embedded username and password before registry persistence', async () => withRoot(async (root) => {
  await assert.rejects(() => registerApp(root, {id: 'app-a', name: 'App A', url: 'https://private:secret@example.test'}), /username or password/i);
  assert.equal(await readFile(join(root, '.app-explorer/registry.json'), 'utf8').then(() => true, () => false), false);
  assert.equal(JSON.stringify(await listApps(root)).includes('secret'), false);
}));

test('research source aliases are resolved host-side and private roots never enter projections', async () => withRoot(async (root, parent) => {
  await registerApp(root, {id: 'app-a', name: 'App A', url: 'https://a.example'});
  const sourceRoot = join(parent, 'supplied-source'); await mkdir(sourceRoot);
  await registerSourceAlias(root, 'app-a', {alias: 'app-code', path: sourceRoot});
  const data = loadWorkspace(resolve('packages/app-explorer/examples/demo-knowledge'));
  data.features[0].research = {sourceCandidates: [
    {id: 'handler', sourceAlias: 'app-code', relativePath: 'src/save.ts', status: 'candidate', note: 'Possible save handler.'},
    {id: 'handler-again', sourceAlias: 'app-code', relativePath: 'src/other.ts', status: 'candidate', note: 'Another candidate.'},
  ], controls: []};
  const reader: any = {derivedBuilds: 0};
  const projection = await getRegisteredAppDerivedProjection(root, 'app-a', reader, data as any);
  assert.equal(projection.research.sourceCandidates[0].sourceAlias, 'app-code');
  assert.equal(projection.research.sourceCandidates[0].status, 'candidate');
  assert.equal(JSON.stringify(projection).includes(sourceRoot), false);
  const cachedValidation = reader.sourceAliasValidation;
  assert.deepEqual(cachedValidation.aliases, ['app-code']);
  await getRegisteredAppDerivedProjection(root, 'app-a', reader, data as any);
  assert.strictEqual(reader.sourceAliasValidation, cachedValidation, 'same app/revision/registry reuses successful alias validation');
  const nextLegacyKnowledge = {...data};
  await getRegisteredAppDerivedProjection(root, 'app-a', reader, nextLegacyKnowledge as any);
  assert.notStrictEqual(reader.sourceAliasValidation, cachedValidation, 'new V1 knowledge object invalidates validation cache');
  const otherSourceRoot = join(parent, 'other-source'); await mkdir(otherSourceRoot);
  await registerSourceAlias(root, 'app-a', {alias: 'app-other', path: otherSourceRoot});
  const revisedValidation = reader.sourceAliasValidation;
  await getRegisteredAppDerivedProjection(root, 'app-a', reader, data as any);
  assert.notStrictEqual(reader.sourceAliasValidation, revisedValidation, 'registry identity change invalidates validation cache');
  data.features[0].research.sourceCandidates[0].sourceAlias = 'unknown-source';
  await assert.rejects(() => getRegisteredAppDerivedProjection(root, 'app-a', {derivedBuilds: 0} as any, data as any), /Unknown source alias/i);
}));

test('registered-app writes reject unknown research aliases before the knowledge CLI runs', async () => withRoot(async (root) => {
  await registerApp(root, {id: 'app-a', name: 'App A', url: 'https://a.example'});
  const observation = join(root, 'candidate.json');
  await writeFile(observation, JSON.stringify({version: 2, features: [{research: {sourceCandidates: [{id: 'code.ref', sourceAlias: 'missing-root', relativePath: 'src/file.ts', status: 'candidate', note: 'Candidate.'}], controls: []}}]}), 'utf8');
  let output = '';
  const code = await handleExplorerCli(root, ['apply', observation, '--app', 'app-a'], (value) => { output += String(value); });
  assert.equal(code, 1);
  assert.match(output, /unknown source alias/i);
  assert.equal(await readFile(join(root, 'workspaces/app-a/CURRENT.json'), 'utf8').then(() => true, () => false), false);
}));

test('rejects malformed IDs and conflicting registrations without changing CURRENT', async () => withRoot(async (root) => {
  await assert.rejects(() => resolveAppWorkspace(root, '../escape'), /app|invalid/i);
  await assert.rejects(() => registerApp(root, {id: 'Bad ID', name: 'Bad', url: 'https://bad.example'}), /app|invalid/i);
  await registerApp(root, {id: 'app-a', name: 'App A', url: 'https://a.example'});
  const current = join(await resolveAppWorkspace(root, 'app-a'), 'CURRENT.json');
  await writeFile(current, '{"revision":"r000001"}\n', 'utf8');
  const before = await readFile(current, 'utf8');
  await assert.rejects(() => registerApp(root, {id: 'app-a', name: 'Different', url: 'https://a.example'}), /conflict|registered/i);
  assert.equal(await readFile(current, 'utf8'), before);
}));

test('rejects workspace and source alias symlink escapes', async () => withRoot(async (root, parent) => {
  await registerApp(root, {id: 'app-a', name: 'App A', url: 'https://a.example'});
  const workspace = join(root, 'workspaces', 'app-a');
  await rm(workspace, {recursive: true, force: true});
  await symlink(join(parent, 'outside'), workspace, 'junction');
  await assert.rejects(() => resolveAppWorkspace(root, 'app-a'), /symlink|outside|escape/i);
  await rm(workspace, {recursive: true, force: true});
  await mkdir(workspace, {recursive: true});
  const supplied = join(parent, 'source'); await mkdir(supplied);
  await registerSourceAlias(root, 'app-a', {alias: 'source-main', path: supplied});
  assert.equal(await resolveSourceAlias(root, 'app-a', 'source-main'), supplied);
  await rm(supplied, {recursive: true, force: true});
  await mkdir(join(parent, 'outside'));
  await symlink(join(parent, 'outside'), supplied, 'junction');
  await assert.rejects(() => resolveSourceAlias(root, 'app-a', 'source-main'), /symlink|changed/i);
}));

test('source alias filesystem failures are path-free and cached reads revalidate directory identity', async () => withRoot(async (root, parent) => {
  await registerApp(root, {id: 'app-a', name: 'App A', url: 'https://a.example'});
  const source = join(parent, 'private-source-root'); await mkdir(source);
  await registerSourceAlias(root, 'app-a', {alias: 'app-code', path: source});
  const data = loadWorkspace(resolve('packages/app-explorer/examples/demo-knowledge'));
  data.features[0].research = {sourceCandidates: [{id: 'candidate', sourceAlias: 'app-code', relativePath: 'src/file.ts', status: 'candidate', note: 'Candidate.'}], controls: []};
  const reader: any = {derivedBuilds: 0};
  await getRegisteredAppDerivedProjection(root, 'app-a', reader, data as any);
  await rm(source, {recursive: true});
  await assert.rejects(() => resolveSourceAlias(root, 'app-a', 'app-code'), (error: Error) => {
    assert.match(error.message, /source alias.*unavailable/i);
    assert.equal(error.message.includes(parent), false);
    return true;
  });
  await assert.rejects(() => getRegisteredAppDerivedProjection(root, 'app-a', reader, data as any), /source alias.*unavailable/i);
}));

test('rejects a symlink at registry.json for reads and writes', async (context) => withRoot(async (root, parent) => {
  const registryDirectory = join(root, '.app-explorer');
  await mkdir(registryDirectory, {recursive: true});
  const externalRegistry = join(parent, 'external-registry.json');
  const contents = '{"version":1,"apps":[]}\n';
  await writeFile(externalRegistry, contents, 'utf8');
  try {
    await symlink(externalRegistry, join(registryDirectory, 'registry.json'), 'file');
  } catch (error) {
    const code = (error as {code?: string}).code;
    if (code === 'EPERM' || code === 'ENOTSUP') context.skip(`File symlink creation is unavailable on this runner (${code}).`);
    throw error;
  }
  await assert.rejects(() => resolveAppWorkspace(root, 'app-a'), /symlink/i);
  await assert.rejects(() => registerApp(root, {id: 'app-a', name: 'App A', url: 'https://a.example'}), /symlink/i);
  assert.equal(await readFile(externalRegistry, 'utf8'), contents);
}));

test('readApp supports existing V1 and V2 datasets', async () => withRoot(async (root) => {
  await registerApp(root, {id: 'legacy', name: 'Legacy', url: 'https://legacy.example'});
  await registerApp(root, {id: 'modern', name: 'Modern', url: 'https://modern.example'});
  const legacy = await resolveAppWorkspace(root, 'legacy');
  const modern = await resolveAppWorkspace(root, 'modern');
  await mkdir(legacy, {recursive: true});
  await mkdir(modern, {recursive: true});
  const demo = resolve('packages/app-explorer/examples/demo-knowledge');
  await cp(demo, legacy, {recursive: true});
  await cp(demo, modern, {recursive: true});
  const {runKnowledgeCli} = await import('../packages/app-explorer/index.mjs');
  await runKnowledgeCli(['migrate', '--data', modern], {cwd: root});
  assert.equal((await readApp(root, 'legacy')).schemaVersion, 1);
  assert.equal((await readApp(root, 'modern')).schemaVersion, 2);
  assert.equal((await getAppWork(root, 'legacy')).receipt.schemaVersion, 1);
  assert.equal((await getAppWork(root, 'modern')).receipt.schemaVersion, 2);
}));



