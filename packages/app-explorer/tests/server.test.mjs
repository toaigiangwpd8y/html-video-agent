import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from '../server.mjs';

async function poll(url) {
  let last;
  for (let i = 0; i < 45; i++) {
    try { return await fetch(url); } catch (e) { last=e; await new Promise(resolve => setTimeout(resolve, 80)); }
  }
  throw last;
}
test('HTTP serves read-only dashboard, catalog and evidence', async (t) => {
  const port = 27000 + (process.pid % 12000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs','--data','examples/demo-knowledge','--port',String(port)], { cwd:process.cwd(), stdio:'ignore' });
  t.after(() => child.kill());
  const root = await poll(`${base}/`);
  assert.equal(root.status, 200);
  assert.match(await root.text(), /App Explorer/);
  const data = await (await fetch(`${base}/api/state`)).json();
  assert.equal(data.summary.total, 6);
  assert.equal(data.features[0].id, 'projects.create');
  assert.equal(data.featureViews.length, data.features.length);
  assert.equal(data.featureViews[0].feature.id, data.features[0].id);
  const evidence = await fetch(`${base}/api/evidence/demo-run/create-dialog.png`);
  assert.equal(evidence.status, 200);
  assert.match(evidence.headers.get('content-type'), /image\/png/);
  assert.equal((await fetch(`${base}/api/evidence/%2e%2e/secrets.txt`)).status, 404);
  assert.equal((await fetch(`${base}/api/state`, {method:'POST'})).status, 405);
});

test('dashboard configuration exposes only a safe loopback upstream URL', async (t) => {
  const validServer = createServer({ dashboardUrl: 'http://localhost:4848' });
  const invalidServer = createServer({ dashboardUrl: 'https://dashboard.example.test' });
  const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const validPort = await listen(validServer);
  const invalidPort = await listen(invalidServer);
  t.after(() => { validServer.close(); invalidServer.close(); });
  const valid = await (await fetch(`http://127.0.0.1:${validPort}/api/config`)).json();
  const invalid = await (await fetch(`http://127.0.0.1:${invalidPort}/api/config`)).json();
  assert.equal(valid.agentBrowserDashboardUrl, 'http://localhost:4848/');
  assert.equal(invalid.agentBrowserDashboardUrl, null);
});
