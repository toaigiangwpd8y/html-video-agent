#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExplorerHead, buildExplorerState } from './lib/live-view.mjs';
import { assetPath, checkWorkspace, summary, tasks } from './lib/store.mjs';
import { auditCoverage } from './lib/coverage.mjs';
import { buildFeatureView } from './lib/feature-view.mjs';
import { createDiagnosticsReader } from './lib/diagnostics.mjs';
import { createWorkspaceReader } from './lib/workspace-reader.mjs';
import { effectiveHeartbeatAt } from './lib/presence.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv;
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i+1] : undefined; };
const configuredDataDir = flag('--data') || process.env.KNOWLEDGE_DIR;
const dir = configuredDataDir ? path.resolve(configuredDataDir) : undefined;
const port = Number(flag('--port') || process.env.PORT || 4173);
const host = '127.0.0.1'; // local only: evidence may contain private screen content
const webDir = path.resolve(moduleDir, 'public');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.txt':'text/plain; charset=utf-8', '.json':'application/json; charset=utf-8' };
function json(res, payload, status=200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control':'no-store' }); res.end(JSON.stringify(payload)); }
function file(res, target, allow = undefined) {
  try {
    if (allow && !allow(target)) throw new Error('Not allowed');
    const stat = fs.statSync(target);
    if (!stat.isFile()) throw new Error('Not a file');
    res.writeHead(200, {'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
    fs.createReadStream(target).pipe(res);
  } catch { json(res, { error: 'Not found' }, 404); }
}
function safeDashboardUrl(value) {
 if (!value) return null;
 try {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
  return url.href;
 } catch { return null; }
}
export function createServer({ dataDir = dir, staticDir = webDir, now = () => new Date(), dashboardUrl = process.env.APP_EXPLORER_AGENT_BROWSER_DASHBOARD_URL } = {}) {
 const workspaceReader = createWorkspaceReader(dataDir);
 const diagnosticsReader = createDiagnosticsReader(dataDir);
 let derivedCache = null;
 const derivedFor = (data) => {
  if (derivedCache?.revision === data.revision) return derivedCache;
  const coverage = data.schemaVersion === 2 ? auditCoverage(data) : undefined;
  derivedCache = { revision: data.revision, coverage, summary: summary(data), tasks: tasks(data),
    featureViews: data.features.map((feature) => buildFeatureView(data, feature.id)) };
  return derivedCache;
 };
 const readLiveWorkspace = () => {
  const knowledge = workspaceReader.readKnowledge();
  return { ...knowledge, runs: knowledge.runs.map((run) => {
    const current = { ...run };
    Object.defineProperty(current, 'effectiveHeartbeatAt', { value: effectiveHeartbeatAt(dataDir, current), enumerable: false });
    return current;
  }) };
 };
 const buildLiveHead = (data, currentTime) => buildExplorerHead(data, currentTime, { derived: derivedFor(data), diagnostics: diagnosticsReader.head(), dataDir });
 return http.createServer((req,res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method !== 'GET') return json(res, {error:'Read-only API'}, 405);
  try {
    const url = new URL(req.url, 'http://' + host + ':' + port);
    if (url.pathname === '/api/config') return json(res, { agentBrowserDashboardUrl: safeDashboardUrl(dashboardUrl) });
    if (url.pathname === '/api/head') {
      const data = readLiveWorkspace();
      return json(res, buildLiveHead(data, now()));
    }
    if (url.pathname === '/api/state') {
      const data = readLiveWorkspace();
      return json(res, buildExplorerState(data, now(), { derived: derivedFor(data), diagnostics: diagnosticsReader.head(), dataDir }));
    }
    if (url.pathname === '/api/diagnostics') {
      const after = url.searchParams.get('after');
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit == null ? undefined : Number(rawLimit);
      return json(res, diagnosticsReader.read({ after, limit }));
    }
    if (url.pathname === '/api/activity') {
      const data = readLiveWorkspace();
      const events = data.activity || [];
      const after = url.searchParams.get('after');
      const cursor = events.at(-1)?.id ?? null;
      if (after && !events.some(event => event.id === after)) {
        return json(res, { events: [], cursor, resync: true, reason: 'unknown_cursor', revision: data.revision });
      }
      const index = after ? events.findIndex(event => event.id === after) + 1 : 0;
      return json(res, { events: events.slice(index), cursor, resync: false, revision: data.revision });
    }
    if (url.pathname.startsWith('/api/evidence/')) {
      const relative = decodeURIComponent(url.pathname.slice('/api/evidence/'.length));
      const target = assetPath(dataDir, relative);
      return file(res, target);
    }
    const route = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (!['index.html','app.js','panel.js','panel.html','style.css','live-utils.js'].includes(route)) return json(res, { error: 'Not found' }, 404);
    return file(res, path.join(staticDir, route));
  } catch (error) { return json(res, {error: error.message}, 400); }
 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!dir) throw new Error('Configure a real knowledge workspace with --data <path> or KNOWLEDGE_DIR. Sample data is not loaded automatically.');
  checkWorkspace(dir);
  const server = createServer();
  server.listen(port, host, () => console.log(`App Explorer: http://${host}:${port}\nKnowledge: ${dir}\nRead-only UI; CLI handles updates.`));
}
