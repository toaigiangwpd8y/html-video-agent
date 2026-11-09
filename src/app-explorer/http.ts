import type { IncomingMessage, ServerResponse } from 'node:http';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { buildExplorerHead, buildExplorerState, effectiveHeartbeatAt } from '../../packages/app-explorer/index.mjs';
import { readCaptureProgress } from '../web-capture/progress.js';
import { listApps } from './registry.js';
import { getRegisteredAppDerivedProjection, getAppExplorerReaders, type AppExplorerReaders } from './service.js';
import { readConfinedFile } from './safe-file.js';

export type ExplorerRequestOptions = { root: string; url: URL; readers: AppExplorerReaders };

function json(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function safeAppId(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(decoded) ? decoded : undefined;
  } catch { return undefined; }
}

async function captureProgress(root: string, appId: string, contextId?: string) {
  const videoRoot = resolve(root, '.video');
  const capturesRoot = join(videoRoot, 'web-capture');
  const runsRoot = join(capturesRoot, 'runs');
  try {
    for (const directory of [videoRoot, capturesRoot, runsRoot]) {
      const entry = await lstat(directory);
      if (!entry.isDirectory() || entry.isSymbolicLink()) return [];
    }
    const baseReal = await realpath(runsRoot);
    const entries = await readdir(runsRoot, { withFileTypes: true });
    const progress = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.name)) continue;
      const runDirectory = join(baseReal, entry.name);
      try {
        const runStat = await lstat(runDirectory);
        if (!runStat.isDirectory() || runStat.isSymbolicLink()) continue;
        const runReal = await realpath(runDirectory);
        const runRelative = relative(baseReal, runReal);
        if (runRelative === '..' || runRelative.startsWith(`..${sep}`) || isAbsolute(runRelative)) continue;
        const item = await readCaptureProgress(runDirectory, { appId, ...(contextId ? { contextId } : {}) });
        if (item) progress.push(item);
      } catch { /* Missing or concurrently removed run folders are omitted. */ }
    }
    return progress.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch { return []; }
}

async function evidenceFile(workspace: string, relativePath: string): Promise<{ bytes: Buffer; filename: string } | undefined> {
  let decoded: string;
  try { decoded = decodeURIComponent(relativePath); } catch { return undefined; }
  const parts = decoded.replace(/\\/g, '/').split('/');
  if (!decoded || decoded.includes('\0') || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.')) ||
      !/\.(png|jpe?g|webp|txt|json)$/i.test(decoded)) return undefined;
  const evidenceRoot = resolve(workspace, 'evidence');
  try {
    const bytes = await readConfinedFile(evidenceRoot, decoded);
    return { bytes, filename: join(evidenceRoot, ...parts) };
  } catch { return undefined; }
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8',
};

/** Handles Backlot's read-only Explorer API and returns false for all other paths. */
export async function handleExplorerRequest(req: IncomingMessage, res: ServerResponse, options: ExplorerRequestOptions): Promise<boolean> {
  const pathname = options.url.pathname;
  if (!pathname.startsWith('/api/explorer/')) return false;
  const listPath = '/api/explorer/apps';
  const match = /^\/api\/explorer\/apps(?:\/([^/]+)(?:\/(head|state|activity|diagnostics|evidence)(?:\/(.*))?)?)?$/.exec(pathname);
  if (!match) { json(res, { error: 'Not found' }, 404); return true; }
  if (req.method !== 'GET') { json(res, { error: 'Read-only API' }, 405); return true; }
  try {
    if (pathname === listPath) {
      json(res, await listApps(options.root));
      return true;
    }
    const appId = match[1] ? safeAppId(match[1]) : undefined;
    if (!appId) { json(res, { error: 'Not found' }, 404); return true; }
    const endpoint = match[2];
    if (!endpoint) { json(res, { error: 'Not found' }, 404); return true; }
    const appReaders = await getAppExplorerReaders(options.root, appId, options.readers);
    if (endpoint === 'diagnostics' && match[3] === undefined) {
      const rawLimit = options.url.searchParams.get('limit');
      const limit = rawLimit === null ? undefined : Number(rawLimit);
      json(res, appReaders.diagnostics.read({ after: options.url.searchParams.get('after'), limit }));
      return true;
    }
    if (endpoint === 'evidence' && match[3] !== undefined) {
      const file = await evidenceFile(appReaders.workspace, match[3]);
      if (!file) { json(res, { error: 'Not found' }, 404); return true; }
      res.writeHead(200, { 'Content-Type': MIME[extname(file.filename).toLowerCase()] || 'application/octet-stream', 'Content-Length': file.bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(file.bytes);
      return true;
    }
    if (endpoint === 'activity' && match[3] === undefined) {
      const data = appReaders.knowledge.readKnowledge();
      const events = data.activity || [];
      const after = options.url.searchParams.get('after');
      const cursor = events.at(-1)?.id ?? null;
      const capture = () => captureProgress(options.root, appId, options.url.searchParams.get('contextId') || undefined);
      if (after && !events.some((event: { id: string }) => event.id === after)) {
        json(res, { events: [], cursor, resync: true, reason: 'unknown_cursor', revision: data.revision, captureProgress: await capture() });
        return true;
      }
      const index = after ? events.findIndex((event: { id: string }) => event.id === after) + 1 : 0;
      json(res, { events: events.slice(index), cursor, resync: false, revision: data.revision, captureProgress: await capture() });
      return true;
    }
    if ((endpoint === 'head' || endpoint === 'state') && match[3] === undefined) {
      const data = appReaders.knowledge.readKnowledge();
      const live: Record<string, any> = {
        ...data,
        runs: data.runs.map((run: Record<string, any>) => {
          const current = { ...run };
          current.heartbeatAt = effectiveHeartbeatAt(appReaders.workspace, current) ?? current.heartbeatAt;
          return current;
        }),
      };
      const projectionOptions = { derived: await getRegisteredAppDerivedProjection(options.root, appId, appReaders, data), diagnostics: appReaders.diagnostics.head(), dataDir: appReaders.workspace };
      const value = endpoint === 'head'
        ? buildExplorerHead(live, new Date(), projectionOptions)
        : buildExplorerState(live, new Date(), projectionOptions);
      json(res, value);
      return true;
    }
    json(res, { error: 'Not found' }, 404);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missing = /not registered|unknown app|APP_WORKSPACE_NOT_FOUND|ENOENT/i.test(message);
    const sourceAliasFailure = /source alias/i.test(message);
    json(res, { error: missing ? 'Not found' : sourceAliasFailure ? 'Registered source directory is unavailable; update its source alias registration.' : message }, missing ? 404 : 400);
    return true;
  }
}
