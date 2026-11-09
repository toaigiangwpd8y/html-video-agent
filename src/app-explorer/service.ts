import { auditCoverage, buildFeatureView, buildResearchProjection, createDiagnosticsReader, createWorkspaceReader, loadWorkspace, getWorkPacket, summary, tasks } from '../../packages/app-explorer/index.mjs';
import { stat } from 'node:fs/promises';
import { resolveAppWorkspace, resolveSourceAlias, sourceAliasRegistryIdentity } from './registry.js';

export type AppExplorerReader = {
  workspace: string;
  knowledge: ReturnType<typeof createWorkspaceReader>;
  diagnostics: ReturnType<typeof createDiagnosticsReader>;
  derived?: Record<string, any>;
  derivedRevision?: string | null;
  derivedData?: Record<string, any>;
  sourceAliasValidation?: { appId: string; revision: string | null; legacyData?: Record<string, any>; registryIdentity: string; aliases: string[] };
  derivedBuilds: number;
};
export type AppExplorerReaders = { apps: Map<string, AppExplorerReader> };

export function createAppExplorerReaders(): AppExplorerReaders {
  return { apps: new Map() };
}

/** Reader instances are isolated by registered app; each reader itself keys immutable data by CURRENT receipt. */
export async function getAppExplorerReaders(root: string, appId: string, readers: AppExplorerReaders) {
  const workspace = await resolveAppWorkspace(root, appId);
  if (!(await stat(workspace)).isDirectory()) throw new Error('APP_WORKSPACE_NOT_FOUND');
  let current = readers.apps.get(appId);
  if (!current || current.workspace !== workspace) {
    current = { workspace, knowledge: createWorkspaceReader(workspace), diagnostics: createDiagnosticsReader(workspace), derivedBuilds: 0 };
    readers.apps.set(appId, current);
  }
  return current;
}

/** Expensive feature and coverage views are cached by each app's immutable CURRENT revision. */
export function getAppDerivedProjection(reader: AppExplorerReader, data: Record<string, any>): Record<string, any> {
  const revision = data.schemaVersion === 2 ? data.revision : null;
  const sameRevision = reader.derived && reader.derivedRevision === revision &&
    (revision !== null || reader.derivedData === data);
  if (sameRevision) return reader.derived!;
  const coverage = data.schemaVersion === 2 ? auditCoverage(data) : undefined;
  reader.derived = { coverage, summary: summary(data), tasks: tasks(data), featureViews: data.features.map((feature: { id: string }) => buildFeatureView(data, feature.id)), research: buildResearchProjection(data) };
  reader.derivedRevision = revision;
  reader.derivedData = data;
  reader.derivedBuilds++;
  return reader.derived;
}

export async function getRegisteredAppDerivedProjection(root: string, appId: string, reader: AppExplorerReader, data: Record<string, any>): Promise<Record<string, any>> {
  // Cache successful alias validation by immutable knowledge revision and exact registry bytes.
  // Only opaque identities/aliases are retained here; private roots stay inside registry.ts.
  const aliases: string[] = [...new Set<string>((data.features || []).flatMap((feature: any) => (feature.research?.sourceCandidates || []).map((candidate: any) => String(candidate.sourceAlias))))].sort();
  const revision = data.schemaVersion === 2 ? data.revision : null;
  if (aliases.length) {
    const registryIdentity = await sourceAliasRegistryIdentity(root, appId);
    const cached = reader.sourceAliasValidation;
    const validCache = cached && cached.appId === appId && cached.revision === revision && (revision !== null || cached.legacyData === data) && cached.registryIdentity === registryIdentity && cached.aliases.length === aliases.length && cached.aliases.every((alias, index) => alias === aliases[index]);
    // Revision and registry bytes do not detect deletion/replacement of a source directory.
    // Recheck canonical identities on each read; realpath is cheap and no source files are opened.
    if (validCache) {
      for (const alias of aliases) await resolveSourceAlias(root, appId, alias);
    } else {
      for (const alias of aliases) await resolveSourceAlias(root, appId, alias);
      reader.sourceAliasValidation = { appId, revision, ...(revision === null ? { legacyData: data } : {}), registryIdentity, aliases };
    }
  }
  return getAppDerivedProjection(reader, data);
}

export async function readApp(root: string, appId: string) {
  const directory = await resolveAppWorkspace(root, appId);
  return loadWorkspace(directory);
}

export async function getAppWork(root: string, appId: string, options: { contextId?: string; runId?: string } = {}) {
  const directory = await resolveAppWorkspace(root, appId);
  return getWorkPacket(directory, options);
}
