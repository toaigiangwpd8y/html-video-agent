import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { AppRegistration, AppRegistry } from './types.js';

const REGISTRY_PATH = '.app-explorer/registry.json';
const APP_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SOURCE_ALIAS = APP_ID;

type PathKind = 'directory' | 'file';

function validateAppId(appId: string): void {
  if (typeof appId !== 'string' || !APP_ID.test(appId) || appId === '.' || appId === '..') throw new Error(`Invalid app ID: ${appId}`);
}
function validateAlias(alias: string): void {
  if (typeof alias !== 'string' || !SOURCE_ALIAS.test(alias)) throw new Error(`Invalid source alias: ${alias}`);
}
async function canonicalRoot(root: string): Promise<string> {
  const resolved = resolve(root);
  await mkdir(resolved, { recursive: true });
  return realpath(resolved);
}
async function assertNoSymlinkEscape(root: string, target: string, finalType: PathKind = 'directory'): Promise<void> {
  const relativeTarget = relative(root, target);
  if (relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) throw new Error('Path escapes host root.');
  let cursor = root;
  const parts = relativeTarget.split(sep).filter(Boolean);
  for (const [index, part] of parts.entries()) {
    cursor = join(cursor, part);
    try {
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink()) throw new Error(`Symlink path is not allowed: ${cursor}`);
      const shouldBeDirectory = index < parts.length - 1 || finalType === 'directory';
      if (shouldBeDirectory ? !entry.isDirectory() : !entry.isFile()) throw new Error(`Unexpected path type: ${cursor}`);
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') break;
      throw error;
    }
  }
}
async function readRegistry(root: string): Promise<AppRegistry> {
  const file = join(root, REGISTRY_PATH);
  await assertNoSymlinkEscape(root, file, 'file');
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as AppRegistry;
    if (value?.version !== 1 || !Array.isArray(value.apps)) throw new Error('Invalid app registry schema.');
    return value;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return { version: 1, apps: [] };
    throw error;
  }
}
async function writeRegistry(root: string, registry: AppRegistry): Promise<void> {
  const file = join(root, REGISTRY_PATH);
  await assertNoSymlinkEscape(root, dirname(file));
  await mkdir(dirname(file), { recursive: true });
  await assertNoSymlinkEscape(root, file, 'file');
  const temporary = `${file}.tmp-${randomUUID()}`;
  await assertNoSymlinkEscape(root, temporary, 'file');
  await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}
async function workspace(root: string, appId: string, create: boolean): Promise<{ canonical: string; target: string }> {
  validateAppId(appId);
  const canonical = await canonicalRoot(root);
  const target = join(canonical, 'workspaces', appId);
  await assertNoSymlinkEscape(canonical, target);
  if (create) await mkdir(target, { recursive: true });
  await assertNoSymlinkEscape(canonical, target);
  return { canonical, target };
}

export async function registerApp(root: string, input: { id: string; name: string; url: string }): Promise<AppRegistration> {
  validateAppId(input?.id);
  if (!input.name?.trim()) throw new Error('App name is required.');
  let parsedUrl: URL;
  try { parsedUrl = new URL(input.url); } catch { throw new Error('App URL must be a valid http:// or https:// URL.'); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new Error('App URL must be http:// or https:// and must not contain username or password.');
  }
  const canonical = await canonicalRoot(root);
  const registry = await readRegistry(canonical);
  const existing = registry.apps.find((app) => app.id === input.id);
  if (existing && (existing.name !== input.name.trim() || existing.url !== input.url.trim() || existing.workspaceRelativePath !== `workspaces/${input.id}`)) {
    throw new Error(`Conflicting registration for app ${input.id}.`);
  }
  await workspace(canonical, input.id, true);
  if (!existing) {
    registry.apps.push({ id: input.id, name: input.name.trim(), url: input.url.trim(), workspaceRelativePath: `workspaces/${input.id}` });
    await writeRegistry(canonical, registry);
  }
  return registry.apps.find((app) => app.id === input.id)!;
}

export async function resolveAppWorkspace(root: string, appId: string): Promise<string> {
  const { canonical, target } = await workspace(root, appId, false);
  const registry = await readRegistry(canonical);
  const app = registry.apps.find((item) => item.id === appId);
  if (!app || app.workspaceRelativePath !== `workspaces/${appId}`) throw new Error(`App is not registered: ${appId}`);
  return target;
}

export async function listApps(root: string): Promise<Omit<AppRegistration, 'sourceAliases'>[]> {
  const canonical = await canonicalRoot(root);
  const registry = await readRegistry(canonical);
  return registry.apps.map(({ id, name, url, workspaceRelativePath }) => ({ id, name, url, workspaceRelativePath }));
}

export async function registerSourceAlias(root: string, appId: string, input: { alias: string; path: string }): Promise<void> {
  validateAlias(input?.alias);
  if (!input.path?.trim()) throw new Error('Source path is required.');
  const canonical = await canonicalRoot(root);
  const appWorkspace = await resolveAppWorkspace(canonical, appId);
  const sourcePath = await realpath(resolve(input.path));
  if (!(await stat(sourcePath)).isDirectory()) throw new Error('Source alias path must be a directory.');
  const registry = await readRegistry(canonical);
  const app = registry.apps.find((item) => item.id === appId)!;
  const aliases = app.sourceAliases ?? {};
  if (aliases[input.alias] && aliases[input.alias] !== sourcePath) throw new Error(`Conflicting source alias: ${input.alias}`);
  aliases[input.alias] = sourcePath;
  app.sourceAliases = aliases;
  await assertNoSymlinkEscape(canonical, appWorkspace);
  await writeRegistry(canonical, registry);
}

export async function resolveSourceAlias(root: string, appId: string, alias: string): Promise<string> {
  validateAlias(alias);
  const canonical = await canonicalRoot(root);
  const appWorkspace = await resolveAppWorkspace(canonical, appId);
  await assertNoSymlinkEscape(canonical, appWorkspace);
  const registry = await readRegistry(canonical);
  const app = registry.apps.find((item) => item.id === appId);
  const sourcePath = app?.sourceAliases?.[alias];
  if (!sourcePath) throw new Error(`Unknown source alias ${alias} for app ${appId}.`);
  let currentPath: string;
  try { currentPath = await realpath(sourcePath); }
  catch { throw new Error(`Source alias ${alias} is unavailable; restore the registered directory or update its registration.`); }
  if (currentPath !== sourcePath) throw new Error(`Source alias path changed through a symlink: ${alias}`);
  return sourcePath;
}

/** Opaque identity for the current registered source roots; the registry's private paths never leave this module. */
export async function sourceAliasRegistryIdentity(root: string, appId: string): Promise<string> {
  const canonical = await canonicalRoot(root);
  await resolveAppWorkspace(canonical, appId);
  const file = join(canonical, REGISTRY_PATH);
  await assertNoSymlinkEscape(canonical, file, 'file');
  let contents: string;
  try { contents = await readFile(file, 'utf8'); }
  catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') throw new Error(`App is not registered: ${appId}`);
    throw error;
  }
  return createHash('sha256').update(contents).digest('hex');
}
