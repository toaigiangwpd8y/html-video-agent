import { mountExplorerPanel } from './explorer-assets/panel.js';

const root = document.querySelector('#explorerRoot');
try {
  const panelMarkup = await fetch('./explorer-assets/panel.html', { cache: 'no-store' });
  if (!panelMarkup.ok) throw new Error(`Explorer panel unavailable (${panelMarkup.status})`);
  root.innerHTML = await panelMarkup.text();
} catch (error) {
  showShellError('Không thể mở Explorer', 'Giao diện Explorer chưa tải được. Hãy làm mới trang để thử lại.');
  console.error(error);
  throw error;
}
const appSwitcher = root.querySelector('#appSwitcher');
const appIdentity = root.querySelector('#appIdentity');
const liveStatus = root.querySelector('#liveStatus');
setNavigationEnabled(false);
const apps = await fetch('/api/explorer/apps', { cache: 'no-store' }).then(async response => {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const value = await response.json();
  if (!Array.isArray(value)) throw new Error('Invalid Explorer app list');
  return value;
}).catch(error => {
  appIdentity.textContent = 'Danh sách ứng dụng chưa khả dụng.';
  liveStatus.textContent = 'Không thể tải danh sách ứng dụng. Hãy làm mới trang để thử lại.';
  setNavigationEnabled(false);
  showMainState('Không thể tải danh sách ứng dụng', 'Explorer chưa nhận được danh sách ứng dụng từ Workspace. Hãy làm mới trang để thử lại.');
  console.error(error);
  return null;
});

if (apps?.length) {
  appSwitcher.replaceChildren(...apps.map(app => {
    const option = document.createElement('option');
    option.value = app.id;
    option.textContent = app.name;
    return option;
  }));
  appSwitcher.closest('.app-switcher-wrap').hidden = apps.length < 2;
  const panel = mountExplorerPanel(root, { apiBase: '/api/explorer/apps', appId: apps[0].id });
  appSwitcher.addEventListener('change', () => panel.selectApp(appSwitcher.value));
  window.addEventListener('pagehide', () => panel.destroy(), { once: true });
} else if (apps && apps.length === 0) {
  appIdentity.textContent = 'Chưa có ứng dụng nào được đăng ký.';
  liveStatus.textContent = 'Workspace này chưa có ứng dụng được đăng ký.';
  setNavigationEnabled(false);
  showMainState('Chưa có ứng dụng để khám phá', 'Đăng ký một ứng dụng trong Workspace. Khi ứng dụng xuất hiện ở đây, bạn có thể xem chức năng, hành trình và bằng chứng đã ghi nhận.');
}

function setNavigationEnabled(enabled) {
  root.querySelectorAll('[data-view], [data-area]').forEach(control => { control.disabled = !enabled; });
}

function showMainState(title, body) {
  const main = root.querySelector('#main');
  if (main) main.innerHTML = `<section class="explorer-empty-state" role="status"><span class="explorer-empty-mark" aria-hidden="true">B</span><div><p class="explorer-empty-kicker">APP EXPLORER</p><h1>${title}</h1><p>${body}</p></div></section>`;
  else root.innerHTML = `<main class="explorer-shell-error"><section class="explorer-empty-state" role="status"><span class="explorer-empty-mark" aria-hidden="true">B</span><div><p class="explorer-empty-kicker">APP EXPLORER</p><h1>${title}</h1><p>${body}</p><a href="./">Quay lại Backlot</a></div></section></main>`;
}

function showShellError(title, body) {
  root.innerHTML = '';
  showMainState(title, body);
}

fetch('/api/explorer/dashboard', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(config => {
  const link = document.querySelector('#agentBrowserDashboardLink');
  const url = config?.dashboardUrl;
  if (!link || !isLoopbackDashboard(url)) return;
  link.href = url;
  link.hidden = false;
}).catch(() => {});

function isLoopbackDashboard(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}
