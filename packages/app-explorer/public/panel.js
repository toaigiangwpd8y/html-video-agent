import { mergeActivity, pollDelay, selectedEvidence, selectedDiscoveryEvidence, resolveFeatureSelection, selectedScenarioEvidence, displayedRun, heartbeatExpired, visibilityAction, shouldRefreshKnowledge, mergeLiveHead } from './live-utils.js';

export function isCurrentExplorerResponse(current, response) {
  return current?.appId === response?.appId && current?.generation === response?.generation;
}

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isNullableString(value) { return value === null || typeof value === 'string'; }
function isValidExplorerHead(head) {
  const allowedKeys = new Set(['revision', 'schemaVersion', 'syncedAt', 'summary', 'coverage', 'frontierSummary', 'activeRuns', 'latestRun', 'frontierCounts', 'displayRunId', 'currentTask', 'nextTask', 'activityCursor', 'diagnosticsCursor', 'diagnosticsGap']);
  const validRevision = head?.schemaVersion === 1 ? head.revision === null : typeof head?.revision === 'string' && head.revision.length > 0;
  return isRecord(head) && Object.keys(head).every(key => allowedKeys.has(key)) && validRevision &&
    (head.schemaVersion === 1 || head.schemaVersion === 2) && typeof head.syncedAt === 'string' && Number.isFinite(Date.parse(head.syncedAt)) &&
    isRecord(head.summary) && ['total', 'verified', 'partial', 'discovered', 'blocked', 'tasks'].every(key => Number.isFinite(head.summary[key])) &&
    (head.coverage === null || isRecord(head.coverage)) && isRecord(head.frontierSummary) && typeof head.frontierSummary.state === 'string' &&
    Array.isArray(head.activeRuns) && head.activeRuns.every(run => isRecord(run) && typeof run.id === 'string' && typeof run.status === 'string' && typeof run.stale === 'boolean') &&
    (head.latestRun === null || (isRecord(head.latestRun) && typeof head.latestRun.id === 'string' && typeof head.latestRun.status === 'string' && typeof head.latestRun.stale === 'boolean')) &&
    isRecord(head.frontierCounts) && ['ready', 'waiting', 'blocked', 'done'].every(key => Number.isFinite(head.frontierCounts[key])) &&
    isNullableString(head.displayRunId) && isNullableString(head.currentTask) && (head.nextTask === null || isRecord(head.nextTask)) &&
    isNullableString(head.activityCursor) && isNullableString(head.diagnosticsCursor) && typeof head.diagnosticsGap === 'boolean';
}

export function mountExplorerPanel(root, { apiBase = '/api', appId = 'standalone', onAppChange } = {}) {
if (!root) throw new TypeError('An Explorer panel root element is required');
const document = root.ownerDocument;
const ownerWindow = document.defaultView || window;
let selectedAppId = appId;
let generation = 1;
let destroyed = false;
const controller = new AbortController();
const signal = controller.signal;
const requestIdentity = () => ({ appId: selectedAppId, generation });
const apiUrl = (resource, query = '') => apiBase.endsWith('/apps')
  ? `${apiBase}/${encodeURIComponent(selectedAppId)}/${resource}${query}`
  : `${apiBase}/${resource}${query}`;
let state;
let activity = [];
let activityCursor = null;
let diagnostics = [];
let captureProgress = [];
let diagnosticsCursor = null;
let lastPollAt = null;
let pollError = null;
let pollFailures = 0;
let pollTimer = null;
let toastTimer = null;
let polling = false;
let wasHidden = document.hidden;
let liveMarkup = '';
let lightboxEvidence = null;
let lightboxOpener = null;
const evidenceImageRuntime = new Map();
const requestedPollMs = Number(new URLSearchParams(ownerWindow.location.search).get('pollMs'));
const pollIntervalMs = Number.isFinite(requestedPollMs) && requestedPollMs >= 1000 ? Math.min(requestedPollMs, 60000) : 1000;
const activityLimit = 60;
const routeParams = new URLSearchParams(ownerWindow.location.search);
const ui = { view:['catalog','journeys','queue','activity'].includes(routeParams.get('view')) ? routeParams.get('view') : 'catalog', area:'all', status:'all', search:'', selected:routeParams.get('feature'), selectionClosed:false, featureSelections:{} };
const $ = (selector) => root.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const clean = escapeHtml;
const labels = { discovered:'Đã phát hiện', partial:'Đang kiểm tra', verified:'Đã xác minh', blocked:'Bị chặn' };
const outcomeLabels = { unknown:'Chưa quan sát', success:'Thành công', failure:'Chưa đạt', expected_denial:'Từ chối đúng như dự kiến' };
const outcomeLabel = (value) => outcomeLabels[value] || clean(value || 'Chưa quan sát');
const statusCopy = { open:'Đang mở', ready:'Sẵn sàng', waiting:'Đang chờ', queued:'Trong hàng đợi', in_progress:'Đang thực hiện', running:'Đang chạy', completed:'Hoàn tất', done:'Hoàn tất', unknown:'Chưa rõ', success:'Thành công', failure:'Chưa đạt', expected_denial:'Từ chối đúng như dự kiến' };
const statusLabel = (s) => `<span class="status ${escapeHtml(s)}">${labels[s] || statusCopy[s] || clean(s)}</span>`;
const evidenceUrl = (p) => `${apiBase.endsWith('/apps') ? `${apiBase}/${encodeURIComponent(selectedAppId)}` : apiBase}/evidence/${p.split('/').map(encodeURIComponent).join('/')}`;
function appUrl(url) { try { const resolved = new URL(url, state.app.baseUrl); return ['http:','https:'].includes(resolved.protocol) ? resolved.href : null; } catch {return null;} }
function toast(msg) { const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2300); }
function getFeature(id) { return state.features.find(f => f.id === id); }
function syncExplorerLocation() {
  const url = new URL(ownerWindow.location.href);
  if (ui.view === 'catalog') url.searchParams.delete('view'); else url.searchParams.set('view', ui.view);
  if (ui.selected) url.searchParams.set('feature', ui.selected); else url.searchParams.delete('feature');
  ownerWindow.history.replaceState({}, '', url);
}
function getFeatureView(id) { return state.featureViews?.find(view => view.feature.id === id) || null; }
function selectionFor(view) { const value=resolveFeatureSelection(view,ui.featureSelections[view.feature.id]||{});ui.featureSelections[view.feature.id]=value;return value; }
function selectedFeatureRun(view) { const s=selectionFor(view);const scenario=view.scenarios.find(x=>x.id===s.scenarioId);return scenario?.executions.find(x=>x.executionId===s.executionId)||(scenario&&!scenario.executions.length?scenario:null); }
function setNavigationEnabled(enabled) {
  root.querySelectorAll('[data-view], [data-area]').forEach(control => { control.disabled = !enabled; });
}
function syncNavigation(view = ui.view) {
  root.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}
function getFeatures() {
  const term = ui.search.trim().toLocaleLowerCase();
  return state.features.filter(f => (ui.area === 'all' || f.area === ui.area) && (ui.status === 'all' || f.status === ui.status) && (!term || [f.title,f.area,f.summary,f.id].join(' ').toLocaleLowerCase().includes(term)));
}
function setView(view) {
  ui.view=view;ui.selected=null;ui.selectionClosed=false;ui.area='all';ui.search='';ui.status='all';
  syncExplorerLocation();
  syncNavigation(view);
  $('#breadcrumbs').textContent={catalog:'Chức năng',journeys:'Hành trình',queue:'Việc tiếp theo',activity:'Hoạt động'}[view];
  renderAreas();renderMain();ownerWindow.scrollTo({top:0,behavior:'instant'});
}
function renderAreas() {
  const areas=[...new Set(state.features.map(f=>f.area))].sort();
  $('#areas').innerHTML = areas.map(area => {
    const active = ui.area === area && ui.view === 'catalog';
    return `<button type="button" class="area-link ${active?'active':''}" data-area="${clean(area)}"${active?' aria-current="true"':''}>${clean(area)}<span class="area-count">${state.features.filter(f=>f.area===area).length}</span></button>`;
  }).join('');
}
function stats() {
  const c=state.summary;
  const entries=[['Chức năng phát hiện',c.total,'◈','Danh mục hiện tại'],['Đã xác minh',c.verified,'✓','Có bằng chứng'],['Đang kiểm tra',c.partial,'◔','Chưa hoàn tất'],['Cần xử lý',c.discovered+c.blocked,'!','Mới phát hiện hoặc bị chặn']];
  return `<div class="stats">${entries.map(([label,n,ico,foot])=>`<section class="stat"><div class="stat-title">${label}<span class="stat-icon">${ico}</span></div><div class="stat-number">${n}</div><div class="stat-foot">${foot}</div></section>`).join('')}</div>`;
}
function head(kicker,title,description) {
  return `<header class="page-head"><div><h1>${title}</h1><p class="subheading">${description}</p></div></header>`;
}
function card(f) {
  const num=state.schemaVersion === 2 ? (getFeatureView(f.id)?.scenarios.length || 0) : f.steps.length;
  const nextCount = state.schemaVersion === 2 ? (getFeatureView(f.id)?.openTasks.length || 0) : f.nextActions.length;
  const status = state.schemaVersion === 2 ? (getFeatureView(f.id)?.verification.verifiedScenarioIds.length ? '<span class="status verified">Có bằng chứng</span>' : '<span class="status partial">Chưa rõ</span>') : statusLabel(f.status);
  return '<button class="feature-card ' + (ui.selected===f.id?'selected':'') + '" type="button" data-key="feature:' + clean(f.id) + '" data-feature="' + clean(f.id) + '" aria-pressed="' + (ui.selected===f.id) + '" aria-label="Mở ' + clean(f.title) + '">' +
    '<span class="feature-row-copy"><span class="feature-row-title">' + clean(f.title) + '</span><span class="feature-row-summary">' + clean(f.summary) + '</span><span class="feature-row-meta">' + clean(f.area) + ' · ' + num + ' bước · ' + nextCount + ' việc tiếp</span></span>' +
    '<span class="feature-row-state">' + status + '</span><span class="arrow" aria-hidden="true">&rarr;</span></button>';
}
function scenarioDetails(f) {
 const v=getFeatureView(f.id);if(!v)return '';const sel=selectionFor(v),sc=v.scenarios.find(x=>x.id===sel.scenarioId),run=selectedFeatureRun(v),entry=appUrl(f.entry?.url||'');
 const scenarioOptions=v.scenarios.map(x=>'<option value="'+clean(x.id)+'" '+(x.id===sel.scenarioId?'selected':'')+'>'+clean((x.role||x.contextId)+' - '+x.goal)+'</option>').join('');
 const executionOptions=sc?.executions.map(x=>'<option title="'+clean(x.executionId)+'" value="'+clean(x.executionId)+'" '+(x.executionId===sel.executionId?'selected':'')+'>'+clean((x.date||'Chưa rõ ngày')+' - '+outcomeLabel(x.outcome)+' - '+x.executionId.slice(-8))+'</option>').join('')||'';
 const criteria=(run?.completionCriteria||sc?.completionCriteria||[]).map(c=>'<li class="scenario-criterion '+(c.met?'is-met':'is-open')+'"><b>'+(c.met?'Đạt':'Chưa đạt')+':</b> '+clean(c.description)+(c.observed?'<p>'+clean(c.observed)+'</p>':'')+(c.evidenceRefs||[]).map(ref=>'<a href="'+evidenceUrl(ref)+'" target="_blank" rel="noopener noreferrer">Bằng chứng: '+clean(ref.split('/').pop())+'</a>').join('')+'</li>').join('');
 const steps=(run?.steps||sc?.steps||[]).map((x,i)=>'<article class="step" data-key="scenario-step:'+clean(sc.id)+':'+clean(run?.executionId||'definition')+':'+clean(x.id||i)+'"><span class="step-num">'+(i+1)+'</span><div class="step-name">'+clean(x.action||x.title||'Bước')+'</div><p class="step-line"><b>Kết quả quan sát:</b> '+clean(x.observed||'Chưa ghi nhận')+'</p>'+(x.evidenceRefs||[]).map(ref=>/\.(png|jpe?g|webp)$/i.test(ref)?'<button class="screenshot scenario-screenshot" type="button" data-key="image:'+clean(sc.id)+':'+clean(run?.executionId)+':'+clean(x.id)+':'+clean(ref)+'" data-image="'+clean(ref)+'" data-image-title="'+clean(x.action||x.title||'Bằng chứng')+'" data-feature-id="'+clean(f.id)+'" data-scenario-id="'+clean(sc.id)+'" data-execution-id="'+clean(run?.executionId)+'" data-step-id="'+clean(x.id)+'"><img data-evidence-ref="'+clean(ref)+'" loading="lazy" width="640" height="360" src="'+evidenceUrl(ref)+'" alt="Ảnh chụp bằng chứng"/><span class="evidence-caption">'+clean(ref.split('/').pop())+' - Phóng to</span></button>':'<a class="snapshot-link" href="'+evidenceUrl(ref)+'" target="_blank" rel="noopener noreferrer">Mở ảnh chụp '+clean(ref.split('/').pop())+'</a>').join('')+'</article>').join('');
 const questions=v.questions.filter(x=>typeof x==='string'||x.contextId==null||!sc?.contextId||x.contextId===sc.contextId).map(x=>'<div class="question" data-key="question:'+clean(typeof x==='string'?x:x.id)+'"><b>'+clean(typeof x==='string'?'Đang mở':statusCopy[x.state]||x.state)+'</b> - '+clean(typeof x==='string'?x:x.text)+(typeof x==='object'?'<div>Ngữ cảnh: '+clean(x.contextId||'toàn ứng dụng')+'</div>'+(x.reason?'<div>'+clean(x.reason)+'</div>':'')+(x.evidenceRefs||[]).map(ref=>'<a href="'+evidenceUrl(ref)+'" target="_blank" rel="noopener noreferrer">Bằng chứng: '+clean(ref.split('/').pop())+'</a>').join(''):'')+'</div>').join('');
 const scopedTasks=v.openTasks.filter(x=>!x.contextId||!sc?.contextId||x.contextId===sc.contextId).map(x=>'<div class="follow-task" data-key="task:'+clean(x.id||x.goal)+'"><strong>'+clean(x.goal)+'</strong><span>'+clean(statusCopy[x.status]||x.status||x.reason||'Đang mở')+(x.contextId?' - '+clean(x.contextRole||x.contextId):'')+(x.depth!=null?' - mức '+clean(x.depth)+' - thứ tự '+clean(x.sequence):'')+'</span></div>').join('');
 const selectedCoverage=v.coverageByContext?.[sc?.contextId]||v.coverage;const exclusion=(selectedCoverage?.exclusions||v.coverage?.exclusions||[]).find(x=>x.contextId==null||x.contextId===sc?.contextId)||null;
 const unknown=v.verification.unknownScenarioIds.length?'<div class="scope-note">Đã xác minh '+v.verification.verifiedScenarioIds.length+' trên '+v.scenarios.length+' kịch bản. Chưa rõ: '+v.verification.unknownScenarioIds.map(clean).join(', ')+'</div>':'<div class="scope-note">Kết quả xác minh áp dụng cho các kịch bản và ngữ cảnh đã ghi nhận.</div>';
 const badge=v.verification.verifiedScenarioIds.length?'<span class="status verified">Đã xác minh '+v.verification.verifiedScenarioIds.length+' kịch bản</span>':'<span class="status partial">Chưa có kịch bản được xác minh</span>';
 const discovery=(v.discoverySteps||[]).map((step,i)=>'<article class="step discovery-step" data-discovery-step="'+clean(step.id||i)+'"><div class="step-name">'+clean(step.title||'Quan sát '+(i+1))+'</div><p class="step-line"><b>Thao tác:</b> '+clean(step.action||'Chưa ghi nhận')+'</p><p class="step-line"><b>Kết quả quan sát:</b> '+clean(step.observed||'Chưa ghi nhận')+'</p>'+(step.screenshot?'<button class="screenshot discovery-screenshot" type="button" data-image-kind="discovery" data-image="'+clean(step.screenshot)+'" data-image-title="'+clean(step.title||'Ảnh khám phá')+'" data-feature-id="'+clean(f.id)+'" data-step-id="'+clean(step.id||i)+'"><img data-evidence-ref="'+clean(step.screenshot)+'" loading="lazy" width="640" height="360" src="'+evidenceUrl(step.screenshot)+'" alt="Ảnh khám phá: '+clean(step.title||'Quan sát')+'"/><span class="evidence-caption">'+clean(step.screenshot.split('/').pop())+' · Mở ảnh</span></button>':'')+(step.snapshot?'<p><a class="snapshot-link" href="'+evidenceUrl(step.snapshot)+'" target="_blank" rel="noopener noreferrer">Mở bản chụp đã lưu ('+clean(step.snapshot.split('/').pop())+')</a></p>':'')+'</article>').join('');
 const outcome=run?.outcome||sc?.outcome||'unknown',cls=outcome==='success'?'verified':outcome==='expected_denial'?'discovered':outcome==='failure'?'blocked':'partial';
 return '<aside class="detail" id="featureDetail" data-key="detail:'+clean(f.id)+'" aria-label="Chi tiết chức năng"><div class="detail-header"><button type="button" class="detail-back" data-close-detail>Đóng chi tiết</button><div class="detail-heading"><h2>'+clean(f.title)+'</h2>'+badge+'</div><p class="detail-desc">'+clean(f.summary)+'</p>'+unknown+'</div><div class="detail-content" data-key="detail-content:'+clean(f.id)+'"><div class="details-meta"><div><div class="meta-label">Nhóm</div><div class="meta-val">'+clean(f.area)+'</div></div><div><div class="meta-label">Điểm truy cập</div><div class="meta-val">'+(entry?'<a href="'+clean(entry)+'" target="_blank" rel="noopener noreferrer">'+clean(f.entry?.label||f.entry?.url||'Mở ứng dụng')+' (mở)</a>':'Chưa ghi nhận')+'</div></div></div><section class="detail-section"><h3>Quan sát khi khám phá</h3>'+(discovery||'<p class="small-empty">Chưa có quan sát khi khám phá.</p>')+'</section><section class="detail-section"><h3>Kịch bản và lần thực hiện</h3><label class="scenario-label">Kịch bản / vai trò<select class="select scenario-select" data-key="scenario-select:'+clean(f.id)+'" data-scenario-select="'+clean(f.id)+'">'+scenarioOptions+'</select></label>'+(sc?.executions.length?'<label class="scenario-label">Lịch sử thực hiện<select class="select execution-select" data-key="execution-select:'+clean(f.id)+'" data-execution-select="'+clean(f.id)+'">'+executionOptions+'</select></label>':'<p class="small-empty">Chưa ghi nhận lần thực hiện nào.</p>')+'<div class="selected-outcome"><span class="status '+cls+'">'+outcomeLabel(outcome)+'</span><span>'+clean(run?.role||sc?.role||'Chưa rõ vai trò')+' - '+clean(run?.date||'Chưa rõ ngày')+' - '+clean(run?.contextId||sc?.contextId||'Chưa rõ ngữ cảnh')+'</span></div><p class="step-line"><b>Mục tiêu:</b> '+clean(sc?.goal||'Chưa ghi nhận kịch bản')+'</p></section><section class="detail-section"><h3>Tiêu chí hoàn tất và kết quả</h3><ul class="criteria-list">'+(criteria||'<li class="small-empty">Chưa ghi nhận tiêu chí hoàn tất.</li>')+'</ul></section><section class="detail-section"><h3>Các bước và bằng chứng</h3>'+(steps||'<p class="small-empty">Chưa ghi nhận bước thực hiện nào.</p>')+'</section>'+(exclusion?'<section class="detail-section"><h3>Phạm vi chưa kiểm tra</h3><p>'+clean(exclusion.reason)+' - '+clean(exclusion.contextId||'toàn ứng dụng')+'</p></section>':'')+'<section class="detail-section"><h3>Việc còn lại</h3>'+(scopedTasks||'<p class="small-empty">Không còn việc nào trong ngữ cảnh này.</p>')+'</section><section class="detail-section"><h3>Câu hỏi còn mở</h3>'+(questions||'<p class="small-empty">Không còn câu hỏi nào trong ngữ cảnh này.</p>')+'</section><section class="detail-section"><div class="meta-label">Mã chức năng</div><div class="meta-val">'+clean(f.id)+'</div></section></div></aside>';
}
function details(f) {
  if (!f) return '';
  if (state.schemaVersion === 2) return scenarioDetails(f);
  const entry=appUrl(f.entry?.url || '');
  const linkedOpenTasks = state.schemaVersion === 2 ? (f.openTasks || []).map((id) => state.tasks.find((task) => task.id === id)).filter(Boolean) : [];
  const followups = state.schemaVersion === 2
    ? linkedOpenTasks.map((task) => `<div class="follow-task"><strong>${clean(task.goal)}</strong><span>${clean(statusCopy[task.status] || task.status)} · ${clean(task.kind)} · mức ${clean(task.depth)} · thứ tự ${clean(task.sequence)}</span></div>`).join('')
    : f.nextActions.map((task) => `<div class="follow-task"><strong>${clean(task.goal)}</strong>${clean(task.reason)}</div>`).join('');
  return `<aside class="detail" id="featureDetail" aria-label="Chi tiết chức năng">
    <div class="detail-header"><button type="button" class="detail-back" data-close-detail>← Đóng chi tiết</button><div class="detail-heading"><h2>${clean(f.title)}</h2>${statusLabel(f.status)}</div><p class="detail-desc">${clean(f.summary)}</p></div>
    <div class="detail-content"><details class="details-meta-disclosure"><summary>Thông tin và đường dẫn</summary><div class="details-meta">
      <div><div class="meta-label">Nhóm</div><div class="meta-val">${clean(f.area)}</div></div>
      <div><div class="meta-label">Vai trò đã thử</div><div class="meta-val">${clean(f.testedContext?.role || 'Chưa thử')}</div></div>
      <div><div class="meta-label">Điểm truy cập</div><div class="meta-val">${entry ? `<a href="${clean(entry)}" target="_blank" rel="noopener noreferrer">${clean(f.entry?.label || f.entry?.url || 'Mở ứng dụng')} ↗</a>` : clean(f.entry?.label || 'Chưa rõ')}</div></div>
      <div><div class="meta-label">Xác minh gần nhất</div><div class="meta-val">${clean(f.lastVerifiedAt || 'Chưa xác minh')}</div></div>
    </div></details>
    <h3>Hướng dẫn & bằng chứng <span class="muted-count">(${f.steps.length})</span></h3>
    ${f.steps.length ? f.steps.map((s,i)=>`<div class="step"><span class="step-num">${i+1}</span><div class="step-name">${clean(s.title)}</div><p class="step-line"><b>Thao tác:</b> ${clean(s.action)}</p><p class="step-line"><b>Kết quả:</b> ${clean(s.observed || 'Chưa xác minh')}</p>
      ${s.screenshot ? `<button class="screenshot" type="button" data-image="${clean(s.screenshot)}" data-image-title="${clean(s.title)}" data-feature-id="${clean(f.id)}" data-step-id="${clean(s.id)}"><img data-evidence-ref="${clean(s.screenshot)}" loading="lazy" width="640" height="360" src="${evidenceUrl(s.screenshot)}" alt="Bằng chứng: ${clean(s.title)}"/><figcaption><span>${clean(s.screenshot.split('/').pop())}</span><span>Phóng to ↗</span></figcaption></button>` : ''}
      ${s.snapshot ? `<div class="snapshot-link"><a href="${evidenceUrl(s.snapshot)}" target="_blank" rel="noopener noreferrer">Mở bản chụp đã lưu (${clean(s.snapshot.split('/').pop())}) ↗</a></div>`:''}
      ${s.note ? `<p class="step-line">${clean(s.note)}</p>`:''}
    </div>`).join('') : '<p class="small-empty">Chưa có hướng dẫn từng bước. Agent cần quan sát và ghi lại các bước.</p>'}
    <div class="detail-section"><h3>Cần tìm hiểu tiếp</h3>${followups || '<p class="small-empty">Không có công việc đang chờ.</p>'}</div>
    ${f.questions.length ? `<div class="detail-section"><h3>Câu hỏi còn mở</h3>${f.questions.map(q=>`<div class="question">${clean(q)}</div>`).join('')}</div>` : ''}
    <div class="detail-section"><div class="meta-label">Định danh</div><div class="meta-val">${clean(f.id)}</div></div>
    </div></aside>`;
}
function renderCatalog() {
  const features=getFeatures();
  const ratio=state.summary.total ? Math.round(100*state.summary.verified/state.summary.total) : 0;
  if (!features.some(feature => feature.id === ui.selected)) ui.selected = ui.selectionClosed ? null : features[0]?.id || null;
  syncExplorerLocation();
  const body = `<div class="toolbar"><div><span class="toolbar-title">Danh mục chức năng</span><span class="toolbar-info">${features.length} kết quả · ${ratio}% đã xác minh</span></div>
      <div class="toolbar-controls"><div class="search-wrap"><input class="search" id="featureSearch" type="search" placeholder="Tìm chức năng..." value="${clean(ui.search)}" aria-label="Tìm chức năng"/></div><select class="select" id="statusFilter" aria-label="Lọc trạng thái"><option value="all">Mọi trạng thái</option>${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${ui.status===k?'selected':''}>${v}</option>`).join('')}</select></div></div>`;
  const result = features.length ? `<div class="feature-list">${features.map(card).join('')}</div>` : '<div class="empty">Không tìm thấy chức năng phù hợp.</div>';
  const selected = ui.selected && getFeature(ui.selected) ? details(getFeature(ui.selected)) : '<aside class="detail detail-empty"><h2>Chọn chức năng để xem bằng chứng</h2><p>Hướng dẫn, kết quả quan sát và ảnh chụp sẽ xuất hiện tại đây nếu đã được ghi nhận.</p></aside>';
  return head('ỨNG DỤNG / KHÁM PHÁ', 'Chức năng', 'Tìm mục cần kiểm tra rồi xem hướng dẫn và bằng chứng bên cạnh.') + body + `<div class="layout-with-detail"><section class="feature-browser" aria-label="Danh sách chức năng">${result}</section>${selected}</div>`;
}
function renderJourneys() {
  const contextName = (contextId) => state.contexts?.find((item) => item.id === contextId)?.role || contextId || 'Chưa rõ ngữ cảnh';
  const nodeTypeName = (type) => ({ scenario: 'Kịch bản', feature: 'Chức năng', task: 'Việc cần làm', action: 'Thao tác', checkpoint: 'Điểm kiểm tra' }[String(type || '').toLowerCase()] || type || 'Bước');
  return head('HÀNH TRÌNH ĐÃ GHI NHẬN','Hành trình','Theo dõi đường đi theo thứ tự, xem kết quả quan sát và bằng chứng tại từng bước.') +
    (state.journeys.length ? '<div class="journey-list">' + state.journeys.map((journey) => {
      const nodeById = new Map(journey.nodes.map((node) => [node.id, node]));
      const branches = journey.edges.map((edge) => {
        const from = nodeById.get(edge.from); const to = nodeById.get(edge.to); const result = outcomeLabel(edge.outcome);
        return '<li class="journey-branch"><span class="branch-from">' + clean(from?.title || edge.from) + '</span><span class="branch-condition">' + clean(edge.condition || 'Chưa ghi nhận điều kiện') + '</span><span aria-hidden="true">-&gt;</span><span class="branch-to">' + clean(to?.title || edge.to) + '</span><span class="branch-outcome">' + clean(result) + '</span>' + (edge.contextSwitch ? '<span class="branch-context">Chuyển tiếp từ ' + clean(contextName(edge.contextSwitch.from)) + ' sang ' + clean(edge.contextSwitch.role) + ' - ' + clean(contextName(edge.contextSwitch.to)) + '</span>' : '') + '</li>';
      }).join('');
      const nodes = journey.nodes.map((node, index) => {
        const execution = state.scenarios?.flatMap((item) => (item.history || []).map((record) => ({ ...record, scenarioId: item.id }))).find((item) => item.executionId === node.scenarioRunId);
        const scenario = execution;
        const feature = getFeature(node.featureId || scenario?.featureId);
        const evidence = [...(node.beforeEvidenceRefs || []).map((ref) => ({ref,label:'Trước'})), ...[...new Set([...(node.evidenceRefs || []), ...(scenario?.evidenceRefs || [])])].map((ref) => ({ref,label:'Bằng chứng'})), ...(node.afterEvidenceRefs || []).map((ref) => ({ref,label:'Sau'}))];
        const displayTitle = feature?.title || node.title || nodeTypeName(node.type);
        return '<article class="journey-node"><div class="journey-node-heading"><span class="journey-node-number">' + (index + 1) + '</span><div><strong>' + clean(displayTitle) + '</strong><span class="journey-node-type">' + clean(nodeTypeName(node.type)) + (node.outcome ? ' · ' + outcomeLabel(node.outcome) : '') + '</span></div></div>' +
          (node.contextId ? '<p><b>Ngữ cảnh:</b> ' + clean(contextName(node.contextId)) + ' - ' + clean(node.contextId) + '</p>' : '') +
          (execution ? '<p><b>Lần thực hiện:</b> ' + clean(execution.executionId) + ' - ' + outcomeLabel(execution.outcome) + (execution.testedContext ? ' - ' + clean(execution.testedContext.role) + ' - ' + clean(execution.testedContext.contextId) + ' - ' + clean(execution.testedContext.date) : '') + '</p>' : '') +
          (node.action ? '<p><b>Thao tác:</b> ' + clean(node.action) + '</p>' : '') +
          (node.preconditions?.length ? '<p><b>Điều kiện trước:</b> ' + clean(node.preconditions.join('; ')) + '</p>' : '') +
          (node.expectedResult ? '<p><b>Kết quả dự kiến:</b> ' + clean(node.expectedResult) + '</p>' : '') +
          (node.completionCriteria?.length ? '<p><b>Tiêu chí hoàn tất:</b> ' + clean(node.completionCriteria.join('; ')) + '</p>' : '') +
          (node.outputs && Object.keys(node.outputs).length ? '<p><b>Tên đầu ra:</b> ' + clean(Object.entries(node.outputs).map(([key,value]) => key + '=' + value).join(', ')) + '</p>' : '') +
          (node.observed ? '<p><b>Kết quả quan sát:</b> ' + clean(node.observed) + '</p>' : '') +
          (node.blocker ? '<p class="journey-blocker"><b>Bị chặn:</b> ' + clean(node.blocker.reason || 'Chưa ghi nhận lý do') + '</p>' : '') +
          (feature ? '<button class="queue-open" type="button" data-feature-from-journey="' + clean(feature.id) + '">Mở chức năng: ' + clean(feature.title) + '</button>' : '') +
          (evidence.length ? '<div class="journey-evidence">' + evidence.map(({ref,label}) => /\.(png|jpe?g|webp)$/i.test(ref) ? '<button class="screenshot journey-screenshot" type="button" data-image="' + clean(ref) + '" data-journey-id="' + clean(journey.id) + '" data-journey-node-id="' + clean(node.id) + '" data-image-title="' + clean(node.title) + '"><img data-evidence-ref="' + clean(ref) + '" loading="lazy" width="640" height="360" src="' + evidenceUrl(ref) + '" alt="' + clean(label + ': ' + node.title) + '"/><span class="evidence-caption">' + clean(label) + ' - ' + clean(ref.split('/').pop()) + ' - Mở ảnh</span></button>' : '<a href="' + evidenceUrl(ref) + '" target="_blank" rel="noopener noreferrer">Mở ảnh chụp đã ẩn dữ liệu: ' + clean(ref.split('/').pop()) + '</a>').join('') + '</div>' : '') + '</article>';
      }).join('');
      return '<article class="journey-card" data-key="journey-' + clean(journey.id) + '"><header class="journey-card-header"><div><div class="journey-title">' + clean(journey.title) + '</div><p>' + clean(journey.description || '') + '</p></div><span class="journey-outcome outcome-' + clean(journey.outcome || 'unknown') + '">' + outcomeLabel(journey.outcome) + '</span></header>' +
        (journey.testedContext ? '<p class="journey-context">Ngữ cảnh đã kiểm tra: ' + clean(journey.testedContext.role) + ' - ' + clean(journey.testedContext.contextId) + ' - ' + clean(journey.testedContext.date) + '</p>' : '<p class="journey-context">Chưa ghi nhận ngữ cảnh kiểm tra cho toàn hành trình.</p>') +
        (journey.completionCriteria?.length ? '<p class="journey-criteria"><b>Tiêu chí hoàn tất:</b> ' + clean(journey.completionCriteria.map((c) => typeof c === 'string' ? c : c.description + (c.observed ? ' - kết quả: ' + c.observed : '')).join('; ')) + '</p>' : '') +
        (journey.blocker ? '<p class="journey-blocker"><b>Điểm chặn:</b> ' + clean(journey.blocker.reason || 'Chưa ghi nhận lý do') + '</p>' : '') +
        '<div class="journey-graph" aria-label="Các bước trong hành trình theo thứ tự">' + nodes + '</div>' +
        (branches ? '<details class="journey-branches"><summary>Nhánh và điều kiện (' + journey.edges.length + ')</summary><ul>' + branches + '</ul></details>' : '<p class="small-empty">Chưa ghi nhận nhánh tiếp theo.</p>') +
        (journey.evidenceRefs?.length ? '<section class="journey-evidence-summary"><h3>Bằng chứng của hành trình</h3>' + journey.evidenceRefs.map((ref) => /\.(png|jpe?g|webp)$/i.test(ref) ? '<button class="screenshot journey-screenshot" type="button" data-image="' + clean(ref) + '" data-journey-id="' + clean(journey.id) + '" data-image-title="' + clean(journey.title) + '"><img data-evidence-ref="' + clean(ref) + '" loading="lazy" width="640" height="360" src="' + evidenceUrl(ref) + '" alt="Bằng chứng hành trình: ' + clean(journey.title) + '"/><span class="evidence-caption">' + clean(ref.split('/').pop()) + ' · Mở ảnh</span></button>' : '<a href="' + evidenceUrl(ref) + '" target="_blank" rel="noopener noreferrer">Mở bằng chứng đã ẩn dữ liệu: ' + clean(ref.split('/').pop()) + '</a>').join('') + '</section>' : '') + '</article>';
    }).join('') + '</div>' : '<div class="empty">Chưa có hành trình nào được ghi nhận.</div>');
}
function renderQueue() {
  const isV2 = state.schemaVersion === 2;
  const cards = state.tasks.map((task, i) => '<article class="queue-card"><span class="queue-number">' + (i + 1) + '</span><div class="queue-body"><div class="queue-title">' + clean(task.goal) + '</div>' + statusLabel(task.status) + '<div class="queue-reason">' + clean(task.reason) + '</div><div class="queue-info">' + (isV2 ? 'mức ' + clean(task.depth) + ' \u00b7 thứ tự ' + clean(task.sequence) + ' \u00b7 ' + clean(task.kind) + ' \u00b7 ' + clean(task.contextRole || task.contextId || 'toàn ứng dụng') : clean(task.featureTitle) + ' \u00b7 ' + clean(task.area)) + ' \u00b7 ' + clean(task.entryPath) + '</div></div>' + (task.featureId ? '<button type="button" class="queue-open" data-feature-from-journey="' + clean(task.featureId) + '">Xem ch\u1ee9c n\u0103ng \u2197</button>' : '') + '</article>').join('');
  return head('CÔNG VIỆC THEO THỨ TỰ','Việc tiếp theo', isV2 ? 'Các việc giữ nguyên thứ tự đã lưu, kèm trạng thái hiện tại.' : 'Các bước tiếp theo được ghi nhận trong quá trình khám phá.') +
    (cards ? '<div class="queue-list">' + cards + '</div>' : '<div class="empty">Danh sách hiện đang trống.</div>');
}
function evidenceImageStatus(image, status) {
  const key = image.dataset.evidenceId || evidenceImageIdentity(image);
  const runtime = evidenceImageRuntime.get(key) || {};
  runtime.status = status;
  if (image.getAttribute('src') && (!runtime.src || status !== 'loading')) runtime.src = image.getAttribute('src');
  if (status === 'loaded' || status === 'error') runtime.retrying = false;
  evidenceImageRuntime.set(key, runtime);
  image.dataset.loadState = status;
  const isLightbox = image.id === 'lightboxImg';
  const statusElement = isLightbox ? $('#lightboxImageStatus') : image.parentElement?.nextElementSibling?.querySelector('.evidence-image-status');
  const retry = isLightbox ? $('#retryLightboxImage') : image.parentElement?.nextElementSibling?.querySelector('.evidence-image-retry');
  if (!statusElement || !retry) return;
  statusElement.dataset.state = status;
  statusElement.textContent = status === 'loaded' ? 'Đã tải ảnh' : status === 'error' ? 'Không tải được ảnh.' : 'Đang tải ảnh…';
  retry.hidden = status === 'loaded' || (status === 'loading' && !runtime.retrying);
  retry.setAttribute('aria-label', `Thử tải lại ảnh ${image.dataset.evidenceRef?.split('/').pop() || ''}`.trim());
}
function syncEvidenceImageControls() {
  for (const image of root.querySelectorAll('img[data-evidence-ref]')) {
    if (image.id !== 'lightboxImg' && !image.dataset.evidenceId) {
      image.dataset.evidenceId = evidenceImageIdentity(image);
      const anchor = image.closest('button.screenshot') || image.closest('figure') || image;
      const feedback = document.createElement('div');
      feedback.className = 'evidence-image-feedback';
      feedback.dataset.runtimeEvidenceFeedback = 'true';
      const status = document.createElement('span');
      status.className = 'evidence-image-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      const retry = document.createElement('button');
      retry.className = 'evidence-image-retry';
      retry.type = 'button';
      retry.dataset.evidenceRetry = image.dataset.evidenceId;
      retry.textContent = 'Thử tải lại ảnh';
      retry.hidden = true;
      feedback.append(status, retry);
      anchor.insertAdjacentElement('afterend', feedback);
    }
    const runtime = evidenceImageRuntime.get(image.dataset.evidenceId || evidenceImageIdentity(image));
    if (runtime?.src && image.getAttribute('src') !== runtime.src) image.src = runtime.src;
    const state = runtime?.status || (image.complete ? (image.naturalWidth > 0 ? 'loaded' : 'error') : 'loading');
    evidenceImageStatus(image, state);
  }
  const evidenceIds = new Set([...root.querySelectorAll('img[data-evidence-ref]')].map(image => image.dataset.evidenceId));
  for (const feedback of root.querySelectorAll('.evidence-image-feedback[data-runtime-evidence-feedback="true"]')) {
    if (!evidenceIds.has(feedback.querySelector('[data-evidence-retry]')?.dataset.evidenceRetry)) feedback.remove();
  }
}
function evidenceImageIdentity(image) {
  const anchor = image.closest('button.screenshot');
  const context = [
    anchor?.dataset.key,
    anchor?.dataset.featureId,
    anchor?.dataset.scenarioId,
    anchor?.dataset.executionId,
    anchor?.dataset.stepId,
    anchor?.dataset.journeyId,
    anchor?.dataset.journeyNodeId,
    image.closest('[data-discovery-step]')?.dataset.discoveryStep,
    image.dataset.evidenceRef,
  ].filter(Boolean).join(':');
  const siblings = anchor?.parentElement ? [...anchor.parentElement.children].filter(node => node.matches('button.screenshot') && node.querySelector('img[data-evidence-ref]')?.dataset.evidenceRef === image.dataset.evidenceRef) : [];
  const occurrence = Math.max(0, siblings.indexOf(anchor));
  return `${encodeURIComponent(selectedAppId)}:${encodeURIComponent(context)}:${occurrence}`;
}
function retryEvidenceImage(image) {
  if (!image?.dataset.evidenceRef) return;
  const key = image.dataset.evidenceId || evidenceImageIdentity(image);
  if (evidenceImageRuntime.get(key)?.retrying) return;
  const src = `${evidenceUrl(image.dataset.evidenceRef)}?retry=${Date.now()}`;
  evidenceImageRuntime.set(key, { src, status: 'loading', retrying: true });
  evidenceImageStatus(image, 'loading');
  image.src = src;
}
function renderMain() {
  syncNavigation();
  if (!state) {
    const main = $('#main');
    if (pollError) {
      main.innerHTML = `<section class="explorer-empty-state" role="status"><span class="explorer-empty-mark" aria-hidden="true">!</span><div><p class="explorer-empty-kicker">KẾT NỐI WORKSPACE</p><h1>Chưa tải được dữ liệu ứng dụng</h1><p>Explorer chưa thể đọc danh mục và bằng chứng. Kiểm tra Workspace rồi thử tải lại dữ liệu.</p><button id="retrySync" type="button" class="retry-button">Thử lại</button></div></section>`;
    } else {
      main.innerHTML = '<section class="explorer-empty-state" role="status"><span class="explorer-empty-mark" aria-hidden="true">…</span><div><p class="explorer-empty-kicker">APP EXPLORER</p><h1>Đang kết nối ứng dụng</h1><p>Đang tải danh mục chức năng và bằng chứng từ Workspace.</p></div></section>';
    }
    setNavigationEnabled(false);
    return;
  }
  setNavigationEnabled(true);
  const template = document.createElement('template');
  template.innerHTML = ui.view === 'catalog' ? renderCatalog() : ui.view === 'journeys' ? renderJourneys() : ui.view === 'queue' ? renderQueue() : renderActivity();
  const focusedEvidenceRetry = document.activeElement?.dataset?.evidenceRetry;
  patchChildren($('#main'), template.content);
  syncEvidenceImageControls();
  if (focusedEvidenceRetry) root.querySelector(`[data-evidence-retry="${CSS.escape(focusedEvidenceRetry)}"]`)?.focus({ preventScroll: true });
}
function renderActivity() {
  const latest = activity.slice().reverse();
  const failures = diagnostics.filter(event => ['failed','interrupted','recovered'].includes(event.status) || ['error','recovery'].includes(event.phase)).slice().reverse();
  return head('DÒNG THỜI GIAN', 'Hoạt động', 'Các quan sát và sự kiện thực tế được ghi trong Workspace.') +
    '<section class="activity-view"><div class="activity-view-header"><h2>Sự kiện gần đây</h2><span>' + latest.length + '</span></div>' + (latest.length ? '<div class="activity-view-list">' + latest.map(event => '<article class="activity-view-item">' + renderActivityEvent(event) + '<time>' + clean(readableTime(event.timestamp)) + '</time></article>').join('') + '</div>' : '<p class="small-empty">Chưa có sự kiện được ghi nhận.</p>') +
    '<details class="activity-diagnostics"><summary>Sự cố và khôi phục (' + failures.length + ')</summary>' + (failures.length ? '<div class="activity-view-list">' + failures.map(event => '<article class="activity-view-item">' + renderDiagnosticEvent(event) + '<time>' + clean(readableTime(event.timestamp)) + '</time></article>').join('') + '</div>' : '<p class="small-empty">Chưa ghi nhận sự cố hoặc khôi phục.</p>') + '</details></section>';
}
function patchChildren(current, incoming) {
  const oldNodes = [...current.childNodes].filter(node => !(node.nodeType === 1 && node.dataset?.runtimeEvidenceFeedback === 'true'));
  const incomingNodes = [...incoming.childNodes];
  const reusedNodes = new Set();
  const keyed = new Map(oldNodes.filter(node => node.nodeType === 1 && node.dataset?.key).map(node => [node.dataset.key, node]));
  incomingNodes.forEach((fresh, index) => {
    const key = fresh.nodeType === 1 ? fresh.dataset?.key : null;
    const existing = key ? keyed.get(key) : oldNodes[index];
    if (existing && compatible(existing, fresh)) {
      reusedNodes.add(existing);
      const visibleNodes = [...current.childNodes].filter(node => !(node.nodeType === 1 && node.dataset?.runtimeEvidenceFeedback === 'true'));
      if (existing !== visibleNodes[index]) current.insertBefore(existing, visibleNodes[index] || null);
      patchNode(existing, fresh);
    } else {
      const visibleNodes = [...current.childNodes].filter(node => !(node.nodeType === 1 && node.dataset?.runtimeEvidenceFeedback === 'true'));
      current.insertBefore(fresh.cloneNode(true), visibleNodes[index] || null);
    }
  });
  for (const oldNode of oldNodes) if (!reusedNodes.has(oldNode)) oldNode.remove();
}
function compatible(a, b) { return a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && a.dataset?.key === b.dataset?.key)); }
function patchNode(current, incoming) {
  if (current.nodeType === 3) { if (current.nodeValue !== incoming.nodeValue) current.nodeValue = incoming.nodeValue; return; }
  const runtimeImage = current instanceof ownerWindow.HTMLImageElement && incoming instanceof ownerWindow.HTMLImageElement && current.dataset.evidenceRef === incoming.dataset.evidenceRef;
  const runtime = runtimeImage && evidenceImageRuntime.get(current.dataset.evidenceId || evidenceImageIdentity(current));
  for (const attr of [...current.attributes]) if (!incoming.hasAttribute(attr.name) && !(runtimeImage && ['src', 'data-evidence-id', 'data-load-state'].includes(attr.name))) current.removeAttribute(attr.name);
  for (const attr of [...incoming.attributes]) {
    if (runtimeImage && (attr.name === 'data-evidence-id' || attr.name === 'data-load-state' || (attr.name === 'src' && runtime?.src))) continue;
    if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
  }
  if (current instanceof ownerWindow.HTMLInputElement && current.type !== 'checkbox' && current !== document.activeElement && current.value !== incoming.value) current.value = incoming.value;
  patchChildren(current, incoming);
}
function readableTime(value) {
  if (!value) return 'Chưa có';
  try { return new Intl.DateTimeFormat('vi-VN', { hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(new Date(value)); } catch { return value; }
}
function renderLiveStatus() {
  if (!state) {
    const markup = pollError ? `<div class="sync-state stale"><span class="sync-dot"></span><span>Chưa tải được Workspace: ${clean(pollError)}</span><button id="retrySync" type="button" class="retry-button">Thử lại</button></div>` : '<div class="sync-state"><span>Đang kết nối với Workspace…</span></div>';
    setLiveStatus(markup);
    return;
  }
  const frontier = state.frontierSummary || {};
  const liveCounts = state.frontierCounts || {};
  const active = state.activeRuns || [];
  const latestRun = state.latestRun;
  const run = active.find(item => item.id === state.displayRunId) || displayedRun(active, latestRun);
  const currentTaskId = run?.currentTaskId || state.currentTask;
  const currentTask = state.frontier?.tasks?.find(task => task.id === currentTaskId);
  const running = run?.status === 'running' && !run.stale;
  const staleHeartbeat = heartbeatExpired(run);
  const lifecycle = staleHeartbeat ? 'Mất tín hiệu cập nhật' : run?.status || frontier.state || 'Chưa có việc';
  const events = activity.slice(-5).reverse();
  const diagnosticEvents = diagnostics.filter(event => ['failed', 'interrupted', 'recovered'].includes(event.status) || ['error', 'recovery'].includes(event.phase)).slice(-5).reverse();
  const sync = pollError ? `<div class="sync-state stale"><span class="sync-dot"></span><span>Dữ liệu gần nhất · lỗi cập nhật: ${clean(pollError)}</span><button id="retrySync" type="button" class="retry-button">Thử lại</button></div>` :
    `<div class="sync-state"><span class="sync-dot"></span><span>Đã đồng bộ ${clean(readableTime(lastPollAt).slice(0, 5))} · ${clean(state.revision || 'chưa có bản ghi')}</span></div>`;
  const runLabel = ({legacy_work_pending:'Còn việc cũ cần làm',legacy_no_open_tasks:'Không còn việc cũ đang chờ',waiting_user:'Chờ người dùng',waiting_external:'Chờ bên ngoài',interrupted:'Cần khôi phục',paused:'Đã tạm dừng',exhausted_in_scope:'Đã hết việc trong phạm vi',ready:'Sẵn sàng',running:'Đang thực hiện',blocked:'Bị chặn',inventory_incomplete:'Cần khám phá thêm'})[lifecycle] || lifecycle;
  const stopReason = run?.stopReason || run?.reason || run?.stateReason;
  setLiveStatus(`${sync}<div class="live-grid"><div class="live-summary"><div class="live-kicker">TRẠNG THÁI KHÁM PHÁ</div><strong class="run-state ${running ? 'is-running' : ''}">${clean(runLabel)}</strong><div class="live-task">${currentTask ? `${clean(currentTask.goal)} · mức BFS ${clean(currentTask.depth ?? '—')}` : state.nextTask ? `Tiếp theo: ${clean(state.nextTask.goal)} · mức BFS ${clean(state.nextTask.depth)}` : clean(frontier.reason || 'Không có việc nào sẵn sàng.')}</div><div class="frontier-counts"><span>Sẵn sàng ${clean(liveCounts.ready ?? 0)}</span><span>Đang chờ ${clean(liveCounts.waiting ?? 0)}</span><span>Bị chặn ${clean(liveCounts.blocked ?? 0)}</span><span>Hoàn tất ${clean(liveCounts.done ?? 0)}</span></div>${stopReason ? `<div class="frontier-reason">${clean(stopReason)}</div>` : frontier.reason ? `<div class="frontier-reason">${clean(frontier.reason)}</div>` : ''}${run?.heartbeatAt ? `<div class="heartbeat">Cập nhật hoạt động: ${clean(readableTime(run.heartbeatAt))}${staleHeartbeat ? ' · đã cũ' : ''}</div>` : ''}</div><div class="live-activity-stack"><div class="live-activity"><div class="live-kicker">HOẠT ĐỘNG GẦN ĐÂY</div>${events.length ? events.map(renderActivityEvent).join('') : '<div class="activity-empty">Chưa có sự kiện đã ghi nhận.</div>'}</div><div class="live-activity"><div class="live-kicker">S&#x1EF1; c&#x1ED1; &amp; kh&#xF4;i ph&#x1EE5;c</div>${diagnosticEvents.length ? diagnosticEvents.map(renderDiagnosticEvent).join('') : '<div class="activity-empty">Ch&#x01B0;a c&#xF3; s&#x1EF1; c&#x1ED1; ho&#x1EB7;c ph&#x1EE5;c h&#x1ED3;i.</div>'}</div></div></div>`);
}
function setLiveStatus(markup) {
  if (markup === liveMarkup) { renderCaptureProgress(); return; }
  const scrollX = ownerWindow.scrollX;
  const scrollY = ownerWindow.scrollY;
  const focusedEventId = document.activeElement?.dataset?.activityId;
  liveMarkup = markup;
  $('#liveStatus').innerHTML = markup;
  if (focusedEventId) $('#liveStatus').querySelector('[data-activity-id="' + CSS.escape(focusedEventId) + '"]')?.focus({ preventScroll: true });
  if (ownerWindow.scrollX !== scrollX || ownerWindow.scrollY !== scrollY) ownerWindow.scrollTo(scrollX, scrollY);
  renderCaptureProgress();
}
function renderCaptureProgress() {
  const scrollX = ownerWindow.scrollX;
  const scrollY = ownerWindow.scrollY;
  let container = $('#captureProgress');
  if (!captureProgress.length) {
    container?.remove();
    if (ownerWindow.scrollX !== scrollX || ownerWindow.scrollY !== scrollY) ownerWindow.scrollTo(scrollX, scrollY);
    return;
  }
  if (!container) {
    container = document.createElement('section');
    container.id = 'captureProgress';
    container.className = 'live-activity capture-progress';
    $('#liveStatus').append(container);
  }
  container.innerHTML = `<div class="live-kicker">Tiến độ ghi nhận</div>${captureProgress.slice(-5).reverse().map(item => `<div class="activity-item"><span>${clean(item.runId)} · ${clean(item.stepId)} · ${clean(({ queued: 'Đang chờ', running: 'Đang ghi nhận', succeeded: 'Đã hoàn tất', failed: 'Chưa thành công' })[item.state] || item.state)}</span><span class="activity-link">${clean(readableTime(item.timestamp))}${item.errorCode ? ' · ' + clean(item.errorCode) : ''}</span></div>`).join('')}`;
  if (ownerWindow.scrollX !== scrollX || ownerWindow.scrollY !== scrollY) ownerWindow.scrollTo(scrollX, scrollY);
}
function closeLightbox(restore = true) {
  if ($('#lightbox').hidden) return;
  $('#lightbox').hidden = true;
  $('#lightboxImg').src = '';
  lightboxEvidence = null;
  const opener = lightboxOpener;
  lightboxOpener = null;
  if (restore && opener?.isConnected) opener.focus();
  else if (restore) $('#main').focus();
}
function refreshLightboxEvidence() {
  if ($('#lightbox').hidden || !lightboxEvidence) return;
  let ref; let title;
  if (lightboxEvidence.kind === 'journey') {
    const journey = state.journeys.find((item) => item.id === lightboxEvidence.journeyId);
    const node = journey?.nodes?.find((item) => item.id === lightboxEvidence.nodeId);
    const nodeRefs = [...(node?.beforeEvidenceRefs || []), ...(node?.evidenceRefs || []), ...(node?.afterEvidenceRefs || [])];
    ref = nodeRefs.includes(lightboxEvidence.ref) ? lightboxEvidence.ref : (journey?.evidenceRefs || []).includes(lightboxEvidence.ref) ? lightboxEvidence.ref : null;
    title = node?.title || journey?.title;
  } else if (lightboxEvidence.kind === 'scenario') {
    const updated = selectedScenarioEvidence(getFeatureView(lightboxEvidence.featureId), lightboxEvidence);
    ref = updated?.ref; title = updated?.title;
    if (updated) lightboxEvidence = { ...lightboxEvidence, ...updated };
  } else if (lightboxEvidence.kind === 'discovery') {
    const updated = selectedDiscoveryEvidence(getFeatureView(lightboxEvidence.featureId), lightboxEvidence);
    const legacy = updated || selectedEvidence(getFeature(lightboxEvidence.featureId), lightboxEvidence.stepId);
    ref = legacy?.ref || legacy?.screenshot; title = legacy?.title;
    if (ref && ref !== lightboxEvidence.ref) ref = null;
    if (updated) lightboxEvidence = { ...lightboxEvidence, ...updated };
  }
  if (!ref) { closeLightbox(); return; }
  const image = $('#lightboxImg');
  const previousRef = image.dataset.evidenceRef;
  const src = evidenceUrl(ref);
  image.dataset.evidenceRef = ref;
  const retry = evidenceImageRuntime.get(evidenceImageIdentity(image));
  const retryInFlight = previousRef === ref && retry?.retrying && retry.status === 'loading' && image.getAttribute('src') === retry.src;
  const nextSrc = retryInFlight ? retry.src : src;
  if (image.getAttribute('src') !== nextSrc) { image.src = nextSrc; evidenceImageStatus(image, 'loading'); }
  $('#lightboxTitle').textContent = title || 'Evidence image';
}
function renderDiagnosticEvent(event) {
  const task = event.taskId ? ' / ' + clean(event.taskId) : '';
  const code = event.errorCode ? ' / ' + clean(event.errorCode) : '';
  return '<div class="activity-item"><span>' + clean(event.operation) + ' / ' + clean(event.status) + code + '</span>' + (event.runId ? '<span class="activity-link">' + clean(event.runId) + task + '</span>' : '') + '<span class="activity-link">' + clean(readableTime(event.timestamp)) + '</span></div>';
}
function renderActivityEvent(event) {
  const task = state.frontier?.tasks?.find(item => item.id === event.taskId);
  const feature = getFeature(task?.featureId);
  return `<div class="activity-item"><span>${clean(event.message)}</span>${task ? `<span class="activity-link">${clean(task.goal)}</span>` : ''}${feature ? `<button class="activity-feature" type="button" data-activity-id="${clean(event.id)}" data-feature-from-journey="${clean(feature.id)}">${clean(feature.title)}</button>` : ''}${event.evidenceRefs?.map(ref=>`<a href="${evidenceUrl(ref)}" target="_blank" rel="noopener noreferrer">${clean(ref.split('/').pop())}</a>`).join('') || ''}</div>`;
}
async function fetchJson(url) {
  const response = await fetch(url, { cache:'no-store', signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload;
}
async function refresh() {
  if (polling || destroyed) return;
  polling = true;
  const responseIdentity = requestIdentity();
  const current = () => !destroyed && isCurrentExplorerResponse(requestIdentity(), responseIdentity);
  try {
    let head = await fetchJson(apiUrl('head'));
    if (!current()) return;
    if (!isValidExplorerHead(head)) throw new Error('Invalid Explorer head response');
    if (shouldRefreshKnowledge(state, head)) {
      let latest;
      let coherent = false;
      for (let attempt = 0; attempt < 3 && !coherent; attempt++) {
        latest = await fetchJson(apiUrl('state'));
        if (!current()) return;
        const validStateIdentity = latest?.schemaVersion === 1 ? latest.revision === null : latest?.schemaVersion === 2 && typeof latest.revision === 'string' && latest.revision.length > 0;
        if (!latest || !Array.isArray(latest.features) || !latest.summary || !latest.app || typeof latest.app.name !== 'string' || typeof latest.app.baseUrl !== 'string' || !validStateIdentity) throw new Error('Invalid Explorer state response');
        if (latest.schemaVersion === 1 && head.schemaVersion === 1 && latest.revision === head.revision) { coherent = true; break; }
        const confirmedHead = await fetchJson(apiUrl('head'));
        if (!current()) return;
        if (!isValidExplorerHead(confirmedHead)) throw new Error('Invalid Explorer head response');
        if (confirmedHead.schemaVersion === latest.schemaVersion && confirmedHead.revision === latest.revision) { coherent = true; head = confirmedHead; }
        else head = confirmedHead;
      }
      if (!coherent) throw new Error('Explorer head changed repeatedly while loading state; retry the read.');
      const scrollX = ownerWindow.scrollX;
      const scrollY = ownerWindow.scrollY;
      state = latest;
      $('#appIdentity').innerHTML=`<span class="app-icon">${clean(state.app.name.slice(0,1).toUpperCase())}</span><span>${clean(state.app.name)}<small>${clean(state.app.baseUrl.replace(/^https?:\/\//,''))}</small></span>`;
      $('#navCount').textContent=state.summary.total;
      $('#queueCount').textContent=state.summary.tasks;
      renderAreas();renderMain();
      refreshLightboxEvidence();
      ownerWindow.scrollTo(scrollX, scrollY);
    }
    if (state) mergeLiveHead(state, head);
    const activityUrl = apiUrl('activity', activityCursor ? `?after=${encodeURIComponent(activityCursor)}` : '');
    let page = await fetchJson(activityUrl);
    if (!current()) return;
    let replaceActivity = false;
    if (page.resync) { page = await fetchJson(apiUrl('activity')); if (!current()) return; replaceActivity = true; }
    activity = mergeActivity(activity, page.events || [], { replace: replaceActivity, limit: activityLimit });
    captureProgress = Array.isArray(page.captureProgress) ? page.captureProgress : captureProgress;
    activityCursor = page.cursor;
    try {
      const diagnosticsUrl = apiUrl('diagnostics', diagnosticsCursor ? '?after=' + encodeURIComponent(diagnosticsCursor) : '');
      let diagnosticPage = await fetchJson(diagnosticsUrl);
      if (!current()) return;
      let replaceDiagnostics = diagnosticPage.resync;
      if (replaceDiagnostics) { diagnosticPage = await fetchJson(apiUrl('diagnostics')); if (!current()) return; replaceDiagnostics = true; }
      const incomingDiagnostics = diagnosticPage.events || [];
      const combinedDiagnostics = replaceDiagnostics ? incomingDiagnostics : [...diagnostics, ...incomingDiagnostics];
      diagnostics = [...new Map(combinedDiagnostics.map(event => [event.id, event])).values()].slice(-100);
      diagnosticsCursor = diagnosticPage.cursor;
    } catch { if (!current()) return; /* Keep the runtime feed independent from semantic knowledge Activity. */ }
    pollError = null;
    pollFailures = 0;
    lastPollAt = new Date().toISOString();
  } catch (error) {
    pollError = error.message || 'Kết nối bị gián đoạn';
    pollFailures++;
  } finally {
    if (current()) { polling = false; renderMain(); renderLiveStatus(); schedulePoll(); }
  }
}
function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(refresh, pollDelay(pollIntervalMs, pollFailures, document.hidden));
}
root.addEventListener('load', (e) => { if (e.target instanceof ownerWindow.HTMLImageElement && e.target.dataset.evidenceRef) evidenceImageStatus(e.target, 'loaded'); }, true);
root.addEventListener('error', (e) => { if (e.target instanceof ownerWindow.HTMLImageElement && e.target.dataset.evidenceRef) evidenceImageStatus(e.target, 'error'); }, true);
root.addEventListener('click', (e) => {
  const nav=e.target.closest('[data-view]');if(nav&&!nav.disabled){setView(nav.dataset.view);return;}
  const area=e.target.closest('[data-area]');if(area&&!area.disabled){ui.view='catalog';ui.area=ui.area===area.dataset.area?'all':area.dataset.area;ui.selected=null;ui.selectionClosed=true;syncNavigation('catalog');$('#breadcrumbs').textContent='Chức năng';renderAreas();renderMain();syncExplorerLocation();return;}
  const journey=e.target.closest('[data-feature-from-journey]');if(journey){setView('catalog');ui.selectionClosed=false;ui.selected=journey.dataset.featureFromJourney;renderMain();return;}
  const f=e.target.closest('[data-feature]');if(f){ui.selectionClosed=false;ui.selected=f.dataset.feature;syncExplorerLocation();renderMain();return;}
  if (e.target.closest('[data-close-detail]')) {ui.selectionClosed=true;ui.selected=null;syncExplorerLocation();renderMain();return;}
  const retryControl=e.target.closest('[data-evidence-retry]');if(retryControl){const image=root.querySelector(`img[data-evidence-id="${CSS.escape(retryControl.dataset.evidenceRetry)}"]`);retryEvidenceImage(image);return;}
  if(e.target.closest('#retryLightboxImage')){retryEvidenceImage($('#lightboxImg'));return;}
  const img=e.target.closest('[data-image]');if(img){lightboxOpener=img;const ref=img.dataset.image;lightboxEvidence=img.dataset.imageKind==='discovery'||(img.dataset.featureId&&img.dataset.stepId&&!img.dataset.scenarioId)?{kind:'discovery',featureId:img.dataset.featureId,stepId:img.dataset.stepId,ref}:{kind:img.dataset.scenarioId&&img.dataset.executionId?'scenario':'journey',featureId:img.dataset.featureId,scenarioId:img.dataset.scenarioId,executionId:img.dataset.executionId,stepId:img.dataset.stepId,journeyId:img.dataset.journeyId,nodeId:img.dataset.journeyNodeId||null,ref};const lightboxImage=$('#lightboxImg');lightboxImage.dataset.evidenceRef=ref;lightboxImage.src=evidenceUrl(ref);evidenceImageStatus(lightboxImage,'loading');$('#lightboxTitle').textContent=img.dataset.imageTitle||'\u1ea2nh b\u1eb1ng ch\u1ee9ng';$('#lightbox').hidden=false;$('#closeLightbox').focus();return;}
  if(e.target.closest('#closeLightbox')||e.target===$('#lightbox')) { closeLightbox();return; }
}, { signal });
root.addEventListener('input',(e)=>{if(e.target.id==='featureSearch'){const cursor=e.target.selectionStart;ui.search=e.target.value;renderMain();$('#featureSearch')?.focus();$('#featureSearch')?.setSelectionRange(cursor,cursor);}}, { signal });
root.addEventListener('change',(e)=>{if(e.target.id==='appSwitcher'){selectApp(e.target.value);return;}if(e.target.id==='statusFilter'){ui.status=e.target.value;ui.selected=null;ui.selectionClosed=false;renderMain();return;}const featureId=e.target.dataset.scenarioSelect;if(featureId){const view=getFeatureView(featureId);ui.featureSelections[featureId]=resolveFeatureSelection(view,{scenarioId:e.target.value});renderMain();return;}const executionFeature=e.target.dataset.executionSelect;if(executionFeature){const previous=ui.featureSelections[executionFeature]||{};ui.featureSelections[executionFeature]={scenarioId:previous.scenarioId,executionId:e.target.value};renderMain();}}, { signal });
root.addEventListener('click',e=>{if(e.target.closest('#retrySync')){clearTimeout(pollTimer);refresh();}}, { signal });
root.addEventListener('keydown',(e)=>{
  if ($('#lightbox').hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); return; }
  if (e.key !== 'Tab') return;
  const focusable = [...$('#lightbox').querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter((item) => item.getClientRects().length);
  if (!focusable.length) { e.preventDefault(); $('#closeLightbox').focus(); return; }
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (e.shiftKey && (document.activeElement === first || !$('#lightbox').contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !$('#lightbox').contains(document.activeElement))) { e.preventDefault(); first.focus(); }
}, { signal });
document.addEventListener('visibilitychange',()=>{
  const action = visibilityAction(wasHidden, document.hidden);
  wasHidden = document.hidden;
  if (action === 'refresh') { clearTimeout(pollTimer); refresh(); }
  else if (action === 'reschedule') schedulePoll();
}, { signal });
renderMain();
refresh();
function selectApp(id) {
  if (!id || id === selectedAppId || destroyed) return;
  closeLightbox(false);
  selectedAppId = id;
  if ($('#appSwitcher')) $('#appSwitcher').value = id;
  ui.view = 'catalog';
  ui.area = 'all';
  ui.status = 'all';
  ui.search = '';
  ui.selected = null;
  ui.selectionClosed = false;
  ui.featureSelections = {};
  syncExplorerLocation();
  syncNavigation('catalog');
  $('#breadcrumbs').textContent = 'Chức năng';
  generation++;
  state = undefined;
  activity = [];
  diagnostics = [];
  captureProgress = [];
  activityCursor = diagnosticsCursor = null;
  pollError = null;
  pollFailures = 0;
  polling = false;
  clearTimeout(pollTimer);
  $('#main').replaceChildren();
  $('#captureProgress')?.remove();
  $('#liveStatus').innerHTML = '<div class="sync-state"><span>Đang kết nối ứng dụng đã chọn…</span></div>';
  $('#appIdentity').textContent = 'Đang tải…';
  setNavigationEnabled(false);
  renderMain();
  onAppChange?.(id);
  refresh();
}
function destroy() {
  if (destroyed) return;
  destroyed = true;
  clearTimeout(pollTimer);
  clearTimeout(toastTimer);
  controller.abort();
  $('#featureDetail')?.remove();
}
return { selectApp, destroy };
}
