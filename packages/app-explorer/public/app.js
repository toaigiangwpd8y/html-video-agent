import { mountExplorerPanel } from './panel.js';
const root = document.querySelector('#explorerRoot');
const template = await fetch('/panel.html', { cache: 'no-store' });
if (!template.ok) throw new Error(`Explorer panel unavailable (${template.status})`);
root.innerHTML = await template.text();
const panel = mountExplorerPanel(root, { apiBase: '/api', appId: 'standalone' });
window.addEventListener('pagehide', () => panel.destroy(), { once: true });
fetch('/api/config', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(config => {
  const link = root.querySelector('#upstreamDashboardLink');
  if (!link || !isLoopbackDashboard(config?.agentBrowserDashboardUrl)) return;
  link.href = config.agentBrowserDashboardUrl;
  link.hidden = false;
}).catch(() => {});
function isLoopbackDashboard(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}
