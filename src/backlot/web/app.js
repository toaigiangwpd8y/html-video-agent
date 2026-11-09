import { marked } from "./vendor/marked.js";
import DOMPurify from "./vendor/purify.js";

let currentState = null;
let currentStageId = "request_brief";
let eventSource = null;
let hasAutoSelectedInitialStage = false;
let visualReviewMutationPending = false;
let visualReviewDraft = { source: null, identity: null, reviewLabel: "", value: "", acknowledgedSource: null };
let lastVisualReviewIdentity = null;
let openedVisualReviewIdentity = null;
let visualReviewNeedsReopen = false;
let stateFetchStale = false;
let stateFetchSequence = 0;

const STAGE_GROUPS = [
  { id: "request_brief", name: "Yêu cầu & định hướng", children: ["request", "clarification", "video_brief"] },
  { id: "profile_script", name: "Kịch bản", children: ["production_profile", "script"] },
  { id: "storyboard", name: "Phân cảnh", children: ["storyboard"] },
  { id: "canonical_assets", name: "Dựng & tư liệu", children: ["canonical_project", "asset_acquisition"] },
  { id: "remotion_composition", name: "Duyệt bản dựng", children: ["hyperframes_renderer"] },
  { id: "final_render", name: "Bàn giao", children: ["final_render"] },
];

const STAGES_ORDER = ["overview", ...STAGE_GROUPS.map((stage) => stage.id)];
const HITL_STAGE_GROUP = {
  CLARIFICATION: "request_brief",
  VIDEO_BRIEF: "request_brief",
  RENDERER_SELECTION: "request_brief",
  SCRIPT: "profile_script",
  STORYBOARD: "storyboard",
  ASSET_PREFLIGHT: "canonical_assets",
  VISUAL_REVIEW: "remotion_composition",
};

document.addEventListener("DOMContentLoaded", () => {
  setupStageNavigation();
  setupStageHistoryDialog();
  setupMediaPreviewFallbacks();
  setupAssetCategoryFilters();
  setupRefreshButton();
  setupStudioVisualControls();
  const requestedStage = new URL(window.location.href).searchParams.get("stage");
  switchStage(requestedStage && STAGES_ORDER.includes(requestedStage) ? requestedStage : "overview", { historyMode: "replace" });
  window.addEventListener("popstate", () => {
    const stage = new URL(window.location.href).searchParams.get("stage");
    switchStage(stage && STAGES_ORDER.includes(stage) ? stage : "overview", { historyMode: "none" });
  });
  if (requestedStage && STAGES_ORDER.includes(requestedStage)) switchStage(requestedStage);
  connectSSE();
  fetchState();
});

function setupStageHistoryDialog() {
  const dialog = document.getElementById("stageHistoryDialog");
  const openButton = document.getElementById("openStageHistoryBtn");
  const closeButton = document.getElementById("closeStageHistoryBtn");
  if (!(dialog instanceof HTMLDialogElement) || !openButton || !closeButton) return;

  openButton.addEventListener("click", () => dialog.showModal());
  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

function setupMediaPreviewFallbacks() {
  document.addEventListener("error", (event) => {
    const target = event.target;
    if (target instanceof HTMLMediaElement) {
      const frame = target.closest(".asset-media-container");
      if (!frame) return;
      const poster = target instanceof HTMLVideoElement ? normalizeMediaUrl(target.poster) : "";
      frame.classList.remove("video-container", "audio-container");
      frame.classList.add(poster ? "image-container" : "file-container", "media-preview-error");
      frame.setAttribute("role", "status");
      if (poster) {
        const image = document.createElement("img");
        image.src = poster;
        image.alt = "Ảnh xem trước video";
        image.loading = "lazy";
        frame.replaceChildren(image);
      } else {
        frame.textContent = target instanceof HTMLVideoElement ? "Không phát được tệp video" : "Không phát được tệp âm thanh";
      }
      return;
    }
    if (!(target instanceof HTMLImageElement)) return;
    const sceneFrame = target.closest(".scene-card-media");
    if (sceneFrame) {
      const label = target.alt || "Khung hình xem trước";
      sceneFrame.classList.add("project-preview-placeholder");
      sceneFrame.setAttribute("role", "img");
      sceneFrame.setAttribute("aria-label", label);
      sceneFrame.replaceChildren(Object.assign(document.createElement("span"), { className: "preview-placeholder-caption", textContent: "Không tải được tư liệu xem trước" }));
      return;
    }
    const assetFrame = target.closest(".asset-media-container");
    if (!assetFrame) return;
    const label = target.alt || "Ảnh xem trước";
    assetFrame.classList.remove("image-container", "video-container");
    assetFrame.classList.add("file-container", "media-preview-error");
    assetFrame.setAttribute("role", "status");
    assetFrame.replaceChildren(document.createTextNode(`${label} · Không tải được bản xem trước`));
  }, true);
}

function setupStageNavigation() {
  document.addEventListener("click", (e) => {
    const guidanceBtn = e.target.closest("[data-guidance-stage]");
    if (guidanceBtn) {
      switchStage(guidanceBtn.getAttribute("data-guidance-stage"));
      return;
    }

    const hitlJumpBtn = e.target.closest("#hitlJumpBtn");
    if (hitlJumpBtn && currentState?.hitl) {
      const stageId = HITL_STAGE_GROUP[currentState.hitl.checkpoint];
      if (stageId) switchStage(stageId);
    }
  });
}

function switchStage(stageId, { historyMode = "push" } = {}) {
  if (!STAGES_ORDER.includes(stageId)) return;
  currentStageId = stageId;
  if (currentState) renderGlobalHitlBar(currentState);

  document.querySelectorAll(".stage-page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".step-node").forEach((s) => s.classList.remove("selected"));

  const targetPage = document.getElementById(`page-${stageId}`);
  if (targetPage) targetPage.classList.add("active");
  renderCurrentPageHeading(stageId);

  const targetNode = document.querySelector(`.step-node[data-stage="${stageId}"]`);
  if (targetNode) {
    targetNode.classList.add("selected");
    targetNode.setAttribute("aria-current", "page");
  }
  document.querySelectorAll(".step-node").forEach((node) => {
    if (node !== targetNode) node.removeAttribute("aria-current");
  });
  const url = new URL(window.location.href);
  const previousStage = url.searchParams.get("stage");
  url.searchParams.set("stage", stageId);
  if (historyMode === "none") return;
  if (previousStage === stageId) {
    if (historyMode === "replace") window.history.replaceState({}, "", url);
    return;
  }
  if (historyMode === "replace") window.history.replaceState({}, "", url);
  else window.history.pushState({}, "", url);
}

function renderCurrentPageHeading(stageId, state = currentState) {
  const page = document.getElementById(`page-${stageId}`);
  const titleEl = document.getElementById("currentPageTitle");
  const summaryEl = document.getElementById("currentPageSummary");
  if (!page || !titleEl || !summaryEl) return;

  let title = page.dataset.pageTitle || "Backlot";
  let summary = page.dataset.pageSummary || "";
  if (stageId === "overview") {
    title = "Tổng quan";
    summary = "Tiến độ, nội dung mới nhất và trạng thái cần theo dõi tiếp theo.";
  }

  titleEl.textContent = title;
  summaryEl.textContent = summary;
  const crumb = document.getElementById("studioCrumbName");
  if (crumb) crumb.textContent = title;
  const kicker = document.getElementById("studioPageKicker");
  if (kicker) kicker.textContent = stageId === "overview" ? "WORKSPACE / TỔNG QUAN" : stageId === "remotion_composition" ? "HOÀN THIỆN / DUYỆT" : stageId === "final_render" ? "HOÀN THIỆN / BÀN GIAO" : `SẢN XUẤT / ${String(Math.max(1, STAGES_ORDER.indexOf(stageId))).padStart(2, "0")}`;
  const overviewBadge = document.getElementById("overviewStateBadge");
  const reviewBadge = document.getElementById("reviewStatusLabel");
  if (overviewBadge) overviewBadge.hidden = stageId !== "overview";
  if (reviewBadge) reviewBadge.hidden = stageId !== "remotion_composition";
}

function setupRefreshButton() {
  const btn = document.getElementById("refreshBtn");
  if (btn) btn.addEventListener("click", () => fetchState());
}

function connectSSE() {
  const indicator = document.getElementById("connectionIndicator");
  const label = document.getElementById("connectionLabel");

  try {
    eventSource = new EventSource("/api/events");

    eventSource.onopen = () => {
      indicator.className = "status-indicator online";
      label.textContent = "ĐANG THEO DÕI";
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "change") {
          fetchState();
        }
      } catch {
        // Ignored
      }
    };

    eventSource.onerror = () => {
      indicator.className = "status-indicator offline";
      label.textContent = "ĐANG KẾT NỐI LẠI";
    };
  } catch {
    indicator.className = "status-indicator offline";
    label.textContent = "NGOẠI TUYẾN";
  }
}

async function fetchState() {
  const requestSequence = ++stateFetchSequence;
  try {
    const res = await fetch("/api/state");
    if (requestSequence !== stateFetchSequence) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const state = await res.json();
    if (requestSequence !== stateFetchSequence) return;
    currentState = state;
    stateFetchStale = false;
    const reviewMessage = document.getElementById("reviewActionMessage");
    if (reviewMessage?.dataset.kind === "stale") reviewMessage.hidden = true;
    render(state);

    if (!hasAutoSelectedInitialStage) {
      hasAutoSelectedInitialStage = true;
      selectInitialStage(state);
    }
  } catch (err) {
    if (requestSequence !== stateFetchSequence) return;
    console.error("Backlot state fetch error:", err);
    const status = document.getElementById("reviewStatusLabel");
    const description = document.getElementById("reviewStatusDescription");
    if (status) { status.textContent = "Mất kết nối"; status.dataset.state = "error"; }
    if (description) {
      description.hidden = false;
      description.textContent = currentState ? "Đang hiển thị trạng thái duyệt gần nhất. Hãy đồng bộ lại để kiểm tra cập nhật trước khi tiếp tục." : "Backlot không tải được trạng thái dự án. Hãy thử đồng bộ lại để kiểm tra nguồn hiện tại.";
    }
    if (!currentState) {
      const notice = document.getElementById("hitlNoticeBar");
      const noticeText = document.getElementById("hitlNoticeText");
      const jump = document.getElementById("hitlJumpBtn");
      notice?.classList.remove("hidden");
      if (noticeText) noticeText.textContent = "Không tải được trạng thái dự án. Hãy đồng bộ để thử lại.";
      if (jump) jump.hidden = true;
      const loadState = document.getElementById("overviewLoadState");
      if (loadState) {
        loadState.hidden = false;
        loadState.dataset.state = "error";
        loadState.textContent = "Không tải được trạng thái dự án. Hãy đồng bộ lại để thử lần nữa.";
      }
      if (!document.querySelector(".stage-page.active")) switchStage("overview", { historyMode: "replace" });
    }
    stateFetchStale = true;
    if (currentState) {
      renderOverview(currentState);
      renderStageGuidance(currentState);
    }
    showReviewMessage("Không thể cập nhật trạng thái duyệt. Nguồn gần nhất vẫn hiển thị; các quyết định sẽ tạm dừng đến khi Backlot kết nối lại.", true);
    const reviewMessage = document.getElementById("reviewActionMessage");
    if (reviewMessage) reviewMessage.dataset.kind = "stale";
    const approve = document.getElementById("approveRendererReviewBtn");
    const changes = document.querySelector("#rendererReviewHitlActionSlot .hitl-review-changes-submit");
    if (approve) approve.disabled = true;
    if (changes) changes.disabled = true;
  }
}

function selectInitialStage(state) {
  const requestedStage = new URL(window.location.href).searchParams.get("stage");
  if (requestedStage && STAGES_ORDER.includes(requestedStage)) { switchStage(requestedStage, { historyMode: "replace" }); return; }
  if (state.hitl?.status === "INPUT_REQUIRED" || state.hitl?.status === "REVIEW_REQUIRED" || state.hitl?.phase === "revision_requested") {
    const stageId = HITL_STAGE_GROUP[state.hitl.checkpoint];
    if (stageId) { switchStage(stageId, { historyMode: "replace" }); return; }
  }
  if (state.renderer?.visualApproval?.status === "approved" && state.renderer?.visualApproval?.approvedBy === "HUMAN") {
    switchStage("remotion_composition", { historyMode: "replace" });
    return;
  }

  switchStage("overview", { historyMode: "replace" });
}

// Aggregate atomic workflow states into their visible Backlot stage.
function hasWorkflowData(state) {
  return Boolean(
    state.requestText?.trim() || state.clarification || state.videoBrief || state.productionProfile ||
    state.scriptText || state.scriptReview || state.storyboard || state.storyboardReview ||
    state.canonicalProject || state.projectState || state.assetManifest || state.semanticPreflight ||
    state.productionPreflight || state.rendererSelection || state.renderer || state.finalizedDelivery ||
    state.finalVideoExists || state.previewExists || state.implementationManifest || state.finalManifest ||
    state.evidenceFiles?.length
  );
}

function isWorkflowNotStarted(state) {
  const waitingForHuman = state.hitl?.checkpoint ||
    state.hitl?.status === "INPUT_REQUIRED" || state.hitl?.status === "REVIEW_REQUIRED" ||
    state.hitl?.phase === "revision_requested";
  return !hasWorkflowData(state) && !waitingForHuman;
}

function getGroupedStageStatus(group, state) {
  const childStatuses = (state.stages || [])
    .filter((stage) => group.children.includes(stage.id))
    .map((stage) => stage.status);
  const hitlStage = HITL_STAGE_GROUP[state.hitl?.checkpoint];

  if (
    hitlStage === group.id &&
    (state.hitl?.status === "INPUT_REQUIRED" || state.hitl?.status === "REVIEW_REQUIRED")
  ) {
    return "needs-review";
  }
  if (hitlStage === group.id && state.hitl?.phase === "revision_requested") return "active";
  if (childStatuses.includes("error")) return "error";
  if (isWorkflowNotStarted(state)) return "pending";
  if (childStatuses.includes("active")) return "active";
  if (childStatuses.length > 0 && childStatuses.every((status) => status === "completed")) return "completed";
  return "pending";
}

// Parse Markdown, sanitize the generated DOM, and block remote image loads.
function renderMarkdownHtml(source, inline = false) {
  const markdown = String(source ?? "");
  const rendered = inline ? marked.parseInline(markdown) : marked.parse(markdown);
  const fragment = DOMPurify.sanitize(rendered, {
    RETURN_DOM_FRAGMENT: true,
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["embed", "form", "iframe", "input", "object", "style"],
    FORBID_ATTR: ["style"],
  });
  const container = document.createElement("div");
  container.append(fragment);

  container.querySelectorAll("a[href]").forEach((link) => {
    try {
      const url = new URL(link.getAttribute("href"), window.location.href);
      if (!["http:", "https:", "mailto:"].includes(url.protocol)) link.removeAttribute("href");
    } catch {
      link.removeAttribute("href");
    }
  });

  container.querySelectorAll("img[src]").forEach((image) => {
    try {
      const url = new URL(image.getAttribute("src"), window.location.href);
      if (url.origin !== window.location.origin || !["http:", "https:"].includes(url.protocol)) {
        image.replaceWith(document.createTextNode(image.alt || ""));
      }
    } catch {
      image.replaceWith(document.createTextNode(image.alt || ""));
    }
  });

  return container.innerHTML;
}

// Render a full Markdown document into a preview surface.
function renderMarkdown(target, source) {
  if (target) target.innerHTML = renderMarkdownHtml(source);
}

function render(state) {
  renderTopMetrics(state);
  renderGlobalHitlBar(state);
  renderPipelineStepper(state);
  renderOverview(state);
  renderStageGuidance(state);

  // Render each content section inside the six grouped stage pages.
  renderStageRequest(state);
  renderStageClarification(state);
  renderStageVideoBrief(state);
  renderStageProductionProfile(state);
  renderStageScript(state);
  renderStageStoryboard(state);
  renderThemePanel(state);
  renderStageCanonical(state);
  renderStageAssets(state);
  renderStageRenderer(state);
  renderStageFinalRender(state);
}

function renderTopMetrics(state) {
  const titleEl = document.getElementById("topProjectTitle");
  const formatEl = document.getElementById("topProjectFormat");
  const durationEl = document.getElementById("topProjectDuration");

  const project = projectForBacklot(state);
  if (project?.meta) {
    titleEl.textContent = project.meta.title || "Dự án chưa đặt tên";
    formatEl.textContent = `${project.meta.width} × ${project.meta.height} · ${project.meta.fps} fps`;
    const durSec = (project.meta.durationsInFrames / (project.meta.fps || 30)).toFixed(1);
    durationEl.textContent = `${durSec} giây`;
  } else if (state.videoBrief) {
    titleEl.textContent = state.videoBrief.objective?.slice(0, 35) + "..." || "In Planning";
    formatEl.textContent = state.videoBrief.aspectRatio || "--";
    const policy = state.videoBrief.durationPolicy || { targetSeconds: state.videoBrief.durationSeconds };
    durationEl.textContent = `${policy.targetSeconds ? `Khoảng ${policy.targetSeconds} giây` : ""}${policy.targetSeconds && policy.maxSeconds ? " · " : ""}${policy.maxSeconds ? `tối đa ${policy.maxSeconds} giây` : ""}` || `Khoảng ${state.videoBrief.durationSeconds} giây`;
  } else {
    titleEl.textContent = "CHƯA KHỞI TẠO";
    formatEl.textContent = "--";
    durationEl.textContent = "--";
  }
  const sideTitle = document.getElementById("sidebarProjectName");
  const sideFormat = document.getElementById("sidebarProjectFormat");
  const headerTitle = document.getElementById("studioHeaderProject");
  if (sideTitle) sideTitle.textContent = titleEl.textContent;
  if (sideFormat) sideFormat.textContent = formatEl.textContent === "--" ? "Workspace · Production" : formatEl.textContent;
  if (headerTitle) headerTitle.textContent = titleEl.textContent;
}

function renderGlobalHitlBar(state) {
  const bar = document.getElementById("hitlNoticeBar");
  const text = document.getElementById("hitlNoticeText");

  const hitl = state.hitl;
  const hitlStage = HITL_STAGE_GROUP[hitl?.checkpoint];
  const actionOnCurrentStage = currentStageId === hitlStage;
  if (currentStageId !== "overview" && !actionOnCurrentStage && hitl && (hitl.status === "INPUT_REQUIRED" || hitl.status === "REVIEW_REQUIRED" || hitl.phase === "revision_requested")) {
    bar.classList.remove("hidden");
    text.textContent = hitl.message;
    const jump = document.getElementById("hitlJumpBtn");
    if (jump) jump.hidden = false;
  } else {
    bar.classList.add("hidden");
  }
}

function renderPipelineStepper(state) {
  const stepper = document.getElementById("pipelineStepper");
  const focusedStage = document.activeElement?.closest?.(".step-node")?.dataset.stage;
  stepper.innerHTML = "";

  const overview = document.createElement("button");
  overview.type = "button";
  overview.className = `step-node overview-nav-node ${currentStageId === "overview" ? "selected" : ""}`;
  overview.dataset.stage = "overview";
  overview.innerHTML = `<span class="studio-stage-icon" aria-hidden="true">▦</span><span class="step-label">Tổng quan</span>`;
  if (currentStageId === "overview") overview.setAttribute("aria-current", "page");
  overview.addEventListener("click", () => switchStage("overview"));
  stepper.appendChild(overview);

  const studioStageIcons = ["▤", "☷", "▣", "▧", "▷", "⇩"];
  STAGE_GROUPS.forEach((st, idx) => {
      const node = document.createElement("button");
      node.type = "button";
    const stateClass = getGroupedStageStatus(st, state);

    node.className = `step-node ${stateClass} ${st.id === currentStageId ? "selected" : ""}`;
    node.title = `${st.name} · ${statusLabelVi(stateClass)}`;
    node.setAttribute("aria-label", node.title);
    node.setAttribute("data-stage", st.id);
      if (st.id === currentStageId) node.setAttribute("aria-current", "page");

    const seqStr = String(idx + 1).padStart(2, "0");
    node.innerHTML = `
      <span class="studio-stage-icon" aria-hidden="true">${studioStageIcons[idx]}</span>
      <div class="step-meta">
        <span class="step-seq mono">${seqStr}</span>
      </div>
      <div class="step-title-row">
        <span class="step-label">${escapeHtml(st.name)}</span>
        <span class="step-state-tag">${statusLabelVi(stateClass)}</span>
      </div>
    `;

    node.addEventListener("click", () => switchStage(st.id));
    stepper.appendChild(node);
  });
  if (focusedStage) stepper.querySelector(`.step-node[data-stage="${focusedStage}"]`)?.focus();
}

function statusLabelVi(value) {
  const normalized = String(value || "").toLowerCase();
  return ({ active: "Đang làm", completed: "Hoàn tất", pending: "Chưa bắt đầu", "not-started": "Chưa bắt đầu", "needs-review": "Cần bạn xem", error: "Có lỗi", approved: "Đã duyệt", resolved: "Đã làm rõ", revision_requested: "Đã yêu cầu chỉnh sửa", review_required: "Chờ duyệt", input_required: "Cần bạn trả lời", working: "Đang thực hiện", ready: "Sẵn sàng", waiting: "Đang chờ", failed: "Chưa đạt", passed: "Đạt" })[normalized] || value;
}

function getWorkflowGuidance(state) {
  const rows = STAGE_GROUPS.map(group => ({ group, status: getGroupedStageStatus(group, state) }));
  const stageName = (id) => STAGE_GROUPS.find(group => group.id === id)?.name || "Bước tiếp theo";
  const hitlStage = HITL_STAGE_GROUP[state.hitl?.checkpoint];

  if (state.hitl?.status === "INPUT_REQUIRED" || state.hitl?.status === "REVIEW_REQUIRED") {
    const inputRequired = state.hitl.status === "INPUT_REQUIRED";
    const visualReview = state.hitl.checkpoint === "VISUAL_REVIEW";
    return {
      kind: "needs-review", status: "needs-review", stageId: hitlStage || "request_brief",
      kicker: inputRequired ? "CẦN THÔNG TIN TỪ BẠN" : "CẦN BẠN DUYỆT",
      title: inputRequired ? `Bổ sung thông tin · ${stageName(hitlStage)}` : `Xem và quyết định · ${stageName(hitlStage)}`,
      copy: visualReview ? "Mở Studio để xem đúng bản dựng đang chờ bạn. Bạn có thể yêu cầu chỉnh sửa hoặc duyệt bản này." : inputRequired ? "Bổ sung thông tin còn thiếu ở bước này để quy trình tiếp tục." : "Xem nội dung đang chờ và gửi quyết định tại bước này.",
      actionLabel: "Mở bước cần xử lý",
    };
  }

  if (state.hitl?.phase === "revision_requested") {
    return {
      kind: "active", status: "active", stageId: hitlStage || "request_brief",
      kicker: "ĐANG CHỈNH SỬA", title: `Đã nhận yêu cầu · ${stageName(hitlStage)}`,
      copy: "Yêu cầu chỉnh sửa đã được ghi nhận. Hệ thống đang cập nhật nội dung; Backlot sẽ hiển thị bản mới khi sẵn sàng.",
      actionLabel: `Theo dõi ${stageName(hitlStage)}`,
    };
  }

  const errorRow = rows.find(row => row.status === "error");
  if (errorRow) return {
    kind: "error", status: "error", stageId: errorRow.group.id,
    kicker: "CẦN KIỂM TRA", title: `Có lỗi tại ${errorRow.group.name}`,
    copy: "Mở bước này để xem thông tin lỗi và xác định việc cần xử lý tiếp theo.", actionLabel: "Mở bước có lỗi",
  };

  if (state.finalizedDelivery || rows.every(row => row.status === "completed")) return {
    kind: "completed", status: "completed", stageId: "final_render",
    kicker: "ĐÃ HOÀN TẤT", title: "Video đã sẵn sàng bàn giao",
    copy: "Các bước sản xuất và kiểm tra đã hoàn tất. Mở Bàn giao để xem video cùng bằng chứng kiểm tra.", actionLabel: "Xem bàn giao",
  };

  if (state.hitl?.status === "READY") return {
    kind: "ready", status: "ready", stageId: "final_render",
    kicker: "SẴN SÀNG", title: "Quy trình đã sẵn sàng render",
    copy: "Mở Bàn giao để theo dõi video và kết quả kiểm tra sau khi render.", actionLabel: "Mở Bàn giao",
  };

  if (isWorkflowNotStarted(state)) return {
    kind: "not-started", status: "not-started", stageId: "request_brief",
    kicker: "DỰ ÁN CHƯA BẮT ĐẦU", title: "Gửi yêu cầu video để khởi tạo quy trình",
    copy: "Gửi yêu cầu video qua Agent Video trong cuộc trò chuyện. Khi yêu cầu được ghi nhận, Backlot sẽ hiển thị brief và việc cần bạn xử lý tiếp theo.",
    actionLabel: "Cách bắt đầu",
  };

  const activeRow = rows.find(row => row.status === "active");
  if (activeRow) return {
    kind: "active", status: "active", stageId: activeRow.group.id,
    kicker: "ĐANG THỰC HIỆN", title: `Đang xử lý · ${activeRow.group.name}`,
    copy: `Hệ thống đang làm việc ở bước ${activeRow.group.name}. Mở bước này để theo dõi nội dung và trạng thái mới nhất.`,
    actionLabel: `Theo dõi ${activeRow.group.name}`,
  };

  const pendingRow = rows.find(row => row.status === "pending");
  if (pendingRow) return {
    kind: "waiting", status: "waiting", stageId: pendingRow.group.id,
    kicker: "BƯỚC TIẾP THEO", title: `Tiếp tục với ${pendingRow.group.name}`,
    copy: `Bước ${pendingRow.group.name} chưa bắt đầu. Mở nội dung để xem điều kiện cần hoàn tất trước khi tiếp tục.`,
    actionLabel: `Mở ${pendingRow.group.name}`,
  };

  return {
    kind: "waiting", status: "waiting", stageId: "overview",
    kicker: "ĐANG CHỜ CẬP NHẬT", title: "Chưa có bước mới để xử lý",
    copy: "Backlot đang chờ trạng thái mới từ quy trình sản xuất.", actionLabel: "Xem tổng quan",
  };
}

function renderStageGuidance(state) {
  const workflow = getWorkflowGuidance(state);
  const hitlStage = HITL_STAGE_GROUP[state.hitl?.checkpoint];
  const globalContextNotice = currentStageId !== "overview" && currentStageId !== hitlStage &&
    (state.hitl?.status === "INPUT_REQUIRED" || state.hitl?.status === "REVIEW_REQUIRED" || state.hitl?.phase === "revision_requested");
  const activeReviewPage = workflow.kind === "needs-review" && workflow.stageId === currentStageId;
  STAGE_GROUPS.forEach((group) => {
    const page = document.getElementById(`page-${group.id}`);
    if (!page) return;
    let panel = page.querySelector(".stage-guidance");
    if (globalContextNotice && currentStageId === group.id) {
      panel?.remove();
      return;
    }
    if (activeReviewPage && group.id === currentStageId) {
      panel?.remove();
      return;
    }
    if (workflow.kind === "active" && workflow.stageId === group.id) {
      panel?.remove();
      return;
    }
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "stage-guidance";
      panel.setAttribute("role", "status");
      panel.setAttribute("aria-live", "polite");
      const firstSection = page.querySelector(".stage-subsection");
      if (firstSection) firstSection.before(panel);
      else page.prepend(panel);
    }

    let guidance = workflow;
    let showStartSteps = false;
    if (workflow.kind === "not-started" && group.id !== "request_brief") {
      guidance = {
        kind: "pending", status: "pending", stageId: "request_brief",
        kicker: "BẮT ĐẦU TẠI YÊU CẦU", title: "Dự án chưa khởi tạo",
        copy: `Hoàn tất bước Yêu cầu & định hướng trước khi chuyển tới ${group.name}.`,
        actionLabel: "Mở Yêu cầu",
      };
    } else if (workflow.kind === "not-started") {
      showStartSteps = true;
    } else if (workflow.stageId === group.id && workflow.kind === "needs-review") {
      guidance = { ...workflow, kicker: "BƯỚC CẦN BẠN", title: workflow.title, copy: workflow.copy };
    } else if (workflow.stageId === group.id && workflow.kind === "error") {
      guidance = { ...workflow, kicker: "BƯỚC CÓ LỖI", title: workflow.title };
    } else if (workflow.kind === "completed") {
      guidance = { ...workflow, stageId: null };
    }

    const destination = guidance.stageId && guidance.stageId !== group.id ? guidance.stageId : "";
    const details = showStartSteps
      ? `<ol class="stage-guidance-steps"><li>Gửi mô tả video qua Agent Video.</li><li>Quay lại đây để theo dõi yêu cầu và các bước cần bạn xử lý.</li></ol>`
      : "";
    const action = destination
      ? `<button class="btn btn-sm btn-ghost stage-guidance-action" type="button" data-guidance-stage="${escapeHtml(destination)}">${escapeHtml(guidance.actionLabel || "Mở bước này")} <span aria-hidden="true">→</span></button>`
      : "";
    panel.dataset.state = guidance.status || "pending";
    panel.innerHTML = `<div class="stage-guidance-copy"><span class="stage-guidance-kicker">${escapeHtml(guidance.kicker || statusLabelVi(guidance.status))}</span><h2>${escapeHtml(guidance.title || group.name)}</h2><p>${escapeHtml(guidance.copy || "")}</p>${details}</div>${action}`;
  });
}

function renderOverview(state) {
  const guidance = getWorkflowGuidance(state);
  if (currentStageId === "overview") renderCurrentPageHeading("overview", state);
  const loading = document.getElementById("overviewLoadState");
  if (loading) loading.hidden = true;
  const badge = document.getElementById("overviewStateBadge");
  badge.textContent = statusLabelVi(stateFetchStale ? "error" : guidance.status);
  badge.dataset.state = stateFetchStale ? "error" : guidance.status;

  const attentionEl = document.getElementById("overviewAttention");
  attentionEl.hidden = false;
  attentionEl.dataset.state = stateFetchStale ? "error" : guidance.status;
  const copy = stateFetchStale ? "Đang hiển thị dữ liệu gần nhất. Hãy đồng bộ lại để kiểm tra cập nhật trước khi tiếp tục." : guidance.copy;
  const titleText = stateFetchStale ? "Mất kết nối với trạng thái mới" : guidance.title;
  const actionLabel = stateFetchStale ? "Thử đồng bộ" : guidance.actionLabel;
  const targetStage = stateFetchStale ? "overview" : guidance.stageId;
  attentionEl.innerHTML = `<div class="overview-attention-copy"><span class="overview-kicker">${escapeHtml(stateFetchStale ? "CẦN ĐỒNG BỘ" : guidance.kicker)}</span><h2>${escapeHtml(titleText)}</h2><p>${escapeHtml(copy)}</p></div><button class="btn btn-primary" type="button" data-overview-stage="${escapeHtml(targetStage || "overview")}">${escapeHtml(actionLabel)} <span aria-hidden="true">→</span></button>`;
  attentionEl.querySelector("[data-overview-stage]")?.addEventListener("click", () => stateFetchStale ? fetchState() : switchStage(targetStage || "overview"));

  const rows = STAGE_GROUPS.map(group => ({ group, status: getGroupedStageStatus(group, state) }));
  const completed = rows.filter(row => row.status === "completed").length;
  document.getElementById("overviewProgress").innerHTML = `<div class="overview-progress-copy"><strong>${completed} / ${rows.length} bước hoàn tất</strong><span>${escapeHtml(statusLabelVi(guidance.status))}</span></div><progress max="${rows.length}" value="${completed}" aria-label="Tiến độ sản xuất"></progress>`;
  document.getElementById("overviewStages").innerHTML = rows.map(({ group, status }) => `<button class="overview-stage-row ${status}" data-overview-stage="${group.id}" type="button"><span class="overview-stage-dot ${status}"></span><span>${escapeHtml(group.name)}</span><span class="overview-stage-status">${escapeHtml(statusLabelVi(status))}</span><span aria-hidden="true">→</span></button>`).join("");
  document.querySelectorAll(".overview-stage-row").forEach(button => button.addEventListener("click", () => switchStage(button.dataset.overviewStage)));

  // Editorial overview: all hero information comes from the same real state.
  const project = projectForBacklot(state);
  const heroTitle = document.getElementById("studioHeroTitle");
  const heroSummary = document.getElementById("studioHeroSummary");
  const heroMedia = document.getElementById("studioHeroMedia");
  const heroOpen = document.getElementById("studioHeroOpenBtn");
  const percentage = rows.length ? (completed / rows.length) * 100 : 0;
  const progressFill = document.getElementById("studioProgressFill");
  if (progressFill) progressFill.style.width = `${percentage}%`;
  const progressLabel = document.getElementById("overviewCountLabel");
  if (progressLabel) progressLabel.textContent = `${completed}/${rows.length} bước hoàn tất`;
  const processLabel = document.getElementById("overviewProcessLabel");
  if (processLabel) processLabel.textContent = statusLabelVi(guidance.status);
  const realTitle = project?.meta?.title || state.videoBrief?.objective || "Dự án sản xuất video";
  if (heroTitle) heroTitle.textContent = realTitle;
  if (heroSummary) heroSummary.textContent = state.videoBrief?.objective || "Từ yêu cầu đến bản video cuối cùng — một quy trình rõ ràng, có thể theo dõi.";
  if (heroMedia) heroMedia.innerHTML = renderAssetFrame(state, realTitle, null, "latest-artifact-visual");
  if (heroOpen) heroOpen.onclick = () => switchStage(getLatestArtifact(state)?.stage || "request_brief");
  const heroFormat = document.getElementById("studioHeroFormat");
  if (heroFormat) heroFormat.textContent = project?.meta ? `${project.meta.width || "—"} × ${project.meta.height || "—"} / ${project.meta.fps || "—"} FPS` : (state.videoBrief?.aspectRatio || "VIDEO PROJECT");
  const statFormat = document.getElementById("studioStatFormat");
  if (statFormat) statFormat.textContent = project?.meta ? `${project.meta.width} × ${project.meta.height}` : state.videoBrief?.aspectRatio || "—";
  const statDuration = document.getElementById("studioStatDuration");
  if (statDuration) statDuration.textContent = document.getElementById("topProjectDuration")?.textContent || "—";
  const statStatus = document.getElementById("studioStatStatus");
  if (statStatus) statStatus.textContent = statusLabelVi(guidance.status);

  const latest = getLatestArtifact(state);
  document.getElementById("overviewLatest").innerHTML = latest
    ? `<div class="latest-artifact has-content">${renderAssetFrame(state, latest.title, null, "latest-artifact-visual")}<div class="latest-artifact-copy"><span class="latest-artifact-type">${escapeHtml(latest.type)}</span><h3>${escapeHtml(latest.title)}</h3><p>${escapeHtml(latest.summary)}</p><button class="btn btn-ghost" type="button" data-overview-stage="${latest.stage}">Mở nội dung <span aria-hidden="true">→</span></button></div></div>`
    : `<div class="latest-artifact empty">${renderAssetFrame(state, "Chưa có khung hình xem trước", null, "latest-artifact-visual")}<div class="latest-artifact-copy"><span class="latest-artifact-type">CHƯA CÓ NỘI DUNG</span><h3>Chưa có nội dung</h3><p>Nội dung sẽ xuất hiện tại đây khi dự án bắt đầu.</p><button class="btn btn-ghost" type="button" data-overview-stage="request_brief">Cách bắt đầu <span aria-hidden="true">→</span></button></div></div>`;
  document.querySelector("#overviewLatest [data-overview-stage]")?.addEventListener("click", event => switchStage(event.currentTarget.dataset.overviewStage));
}

function getOverallStatus(state) {
  return getWorkflowGuidance(state).status;
}

function getLatestArtifact(state) {
  if (state.finalVideoExists) return { type: "BÀN GIAO", title: "Video đã render", summary: state.finalizedDelivery ? "Video và kiểm tra bàn giao đã hoàn tất." : "Video đã có; kiểm tra bàn giao đang chờ." , stage: "final_render" };
  if (state.canonicalProject) return { type: "DỰNG", title: state.canonicalProject.meta?.title || "Dự án dựng", summary: "Dự án và danh sách tư liệu hiện có.", stage: "canonical_assets" };
  if (state.storyboard) return { type: "PHÂN CẢNH", title: "Bản phân cảnh", summary: "Mở nội dung và các ghi chú duyệt hiện có.", stage: "storyboard" };
  if (state.scriptText) return { type: "KỊCH BẢN", title: "Kịch bản", summary: "Mở bản kịch bản mới nhất.", stage: "profile_script" };
  if (state.requestText) return { type: "YÊU CẦU", title: "Yêu cầu video", summary: "Mở yêu cầu ban đầu của dự án.", stage: "request_brief" };
  return null;
}

function assetPreviewSource(asset) {
  const poster = normalizeMediaUrl(asset?.thumbnailUrl || asset?.posterUrl);
  if (poster) return poster;
  const previewUrl = typeof asset?.previewUrl === "string" ? asset.previewUrl.trim() : "";
  const previewType = asset?.previewType || (String(asset?.type || "").toLowerCase().startsWith("image/") ? asset.type : "");
  if (previewUrl && mediaKind({ path: previewUrl, type: previewType }) === "image") return normalizeMediaUrl(previewUrl) || "";
  return mediaKind(asset) === "image" ? assetMediaSource(asset, "image") : "";
}

function normalizeMediaUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim(), window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function assetMediaSource(asset, expectedKind = "unknown") {
  const candidates = [asset?.publicPath, asset?.path, asset?.previewUrl].filter((value) => typeof value === "string" && value.trim());
  const matching = candidates.find((value) => {
    const extensionKind = mediaKind({ path: value, type: "" });
    return expectedKind === "unknown" || extensionKind === expectedKind || (!/\.(avif|gif|jpe?g|png|svg|webp|mp3|m4a|ogg|wav|aac|flac|mp4|m4v|mov|webm|ogv)(?:[?#]|$)/i.test(value) && mediaKind(asset) === expectedKind);
  });
  const value = matching || (expectedKind === "unknown" ? candidates[0] : "");
  if (!value) return "";
  const localPath = value === asset?.publicPath || value === asset?.path;
  const resolved = localPath && !/^https?:\/\//i.test(value)
    ? normalizeMediaUrl(`/media/${value.trim().replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}`)
    : normalizeMediaUrl(value);
  return resolved || "";
}

function mediaKind(asset) {
  const type = String(asset?.type || "").toLowerCase();
  const path = String(asset?.publicPath || asset?.path || asset?.previewUrl || "").split(/[?#]/, 1)[0].toLowerCase();
  const extension = path.match(/\.(avif|gif|jpe?g|png|svg|webp|mp3|m4a|ogg|wav|aac|flac|mp4|m4v|mov|webm|ogv)$/)?.[1] || "";
  if (type.startsWith("image/") || ["avif", "gif", "jpg", "jpeg", "png", "svg", "webp"].includes(extension)) return "image";
  if (type.startsWith("video/") || ["mp4", "m4v", "mov", "webm", "ogv"].includes(extension)) return "video";
  if (type.startsWith("audio/") || ["mp3", "m4a", "ogg", "wav", "aac", "flac"].includes(extension)) return "audio";
  return "unknown";
}

function findScenePreviewAsset(state, sceneId) {
  const assets = state.assetManifest?.assets || [];
  const hasPreview = (asset) => Boolean(assetPreviewSource(asset));
  if (sceneId) return assets.find((asset) => asset.sceneIds?.includes(sceneId) && hasPreview(asset));
  return assets.find((asset) => hasPreview(asset) && ["project-preview", "project-cover", "thumbnail"].includes(String(asset.role || "").toLowerCase()));
}

function renderAssetFrame(state, alt, sceneId = null, className = "scene-card-media") {
  const asset = sceneId ? findScenePreviewAsset(state, sceneId) : findScenePreviewAsset(state, "");
  const src = assetPreviewSource(asset);
  if (src) return `<div class="${className}"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy"></div>`;
  return `<div class="${className} project-preview-placeholder" role="img" aria-label="${escapeHtml(alt)}"><span class="preview-placeholder-caption">Chưa có tư liệu xem trước</span></div>`;
}

// Stage 1: Request
function renderStageRequest(state) {
  const rawEl = document.getElementById("requestRawContent");
  const badgeEl = document.getElementById("requestLengthBadge");

  if (state.requestText) {
    renderMarkdown(rawEl, state.requestText);
    badgeEl.textContent = `${state.requestText.length} ký tự`;
  } else {
    rawEl.textContent = "Chưa có yêu cầu nào được ghi nhận.";
    badgeEl.textContent = "0 ký tự";
  }
}

// Stage 2: Clarification
function renderStageClarification(state) {
  const actionSlot = document.getElementById("clarifyHitlActionSlot");
  const formContainer = document.getElementById("clarifyFormContainer");
  const decisionsList = document.getElementById("clarifyDecisionsList");
  const questionsList = document.getElementById("clarifyQuestionsList");
  const badge = document.getElementById("clarifyStatusBadge");

  badge.textContent = state.clarification?.status ? statusLabelVi(state.clarification.status) : "Chưa ghi nhận";

  if (state.hitl?.status === "INPUT_REQUIRED" && state.hitl?.checkpoint === "CLARIFICATION") {
    actionSlot.classList.remove("hidden");
    const questions = state.hitl.payload?.questions || [];
    const questionKey = JSON.stringify(questions.map((q) => ({id: q.id, question: q.question, options: q.options || []})));
    let form = formContainer.querySelector("form");
    if (!form || form.dataset.questionKey !== questionKey) {
      formContainer.replaceChildren();
      form = document.createElement("form");
      form.dataset.questionKey = questionKey;
      questions.forEach((q, idx) => {
        const field = document.createElement("div");
        field.className = "clarify-field";
        const inputId = `clarify-answer-${escapeHtml(q.id)}`;
        field.innerHTML = `
          <label class="clarify-label" for="${inputId}">${idx + 1}. ${renderMarkdownHtml(q.question, true)}</label>
          <input id="${inputId}" type="text" class="clarify-input" name="${escapeHtml(q.id)}" required placeholder="${q.options?.length ? `Lựa chọn: ${escapeHtml(q.options.join(", "))}` : "Nhập câu trả lời của bạn"}">
        `;
        form.appendChild(field);
      });
      const errorMessage = document.createElement("p");
      errorMessage.className = "clarify-submit-error";
      errorMessage.setAttribute("role", "alert");
      errorMessage.hidden = true;
      form.appendChild(errorMessage);
      const submitBtn = document.createElement("button");
      submitBtn.type = "submit";
      submitBtn.className = "btn btn-primary";
      submitBtn.textContent = "Gửi câu trả lời";
      form.appendChild(submitBtn);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        submitBtn.disabled = true;
        submitBtn.textContent = "Đang gửi…";
        const answers = questions.map((q) => ({id: q.id, answer: form.elements[q.id]?.value || ""}));
        try {
          const res = await fetch("/api/hitl/clarify", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({answers})});
          const result = await res.json();
          if (!result.ok) throw new Error(result.error || "Gửi câu trả lời không thành công");
          await fetchState();
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Gửi câu trả lời";
          errorMessage.textContent = `Không gửi được câu trả lời: ${err.message}`;
          errorMessage.hidden = false;
        }
      });
      formContainer.appendChild(form);
    }
  } else {
    actionSlot.classList.add("hidden");
  }

  const decisions = state.clarification?.decisions || [];
  if (decisions.length > 0) {
    decisionsList.innerHTML = decisions.map((d) => `
      <div class="decision-item">
        <div class="decision-header">
          <span class="decision-id">${escapeHtml(d.label || d.id)}</span>
          <span class="decision-source mono">${escapeHtml(d.source)}</span>
        </div>
      <div class="decision-reason markdown-inline">${renderMarkdownHtml(d.reason || "Chưa có lý do được ghi nhận.", true)}</div>
      </div>
    `).join("");
  } else {
    decisionsList.innerHTML = '<div class="empty-note">Chưa ghi nhận quyết định nào.</div>';
  }

  const questions = state.clarification?.questions || [];
  if (questions.length > 0) {
    questionsList.innerHTML = questions.map((q, idx) => `
      <div class="decision-item">
        <div class="decision-id">${idx + 1}. ${renderMarkdownHtml(q.question, true)}</div>
        <div class="decision-reason mono">Resolves: ${escapeHtml((q.resolves || []).join(", "))}</div>
      </div>
    `).join("");
  } else {
    questionsList.innerHTML = '<div class="empty-note">Không cần câu hỏi làm rõ.</div>';
  }
}

// Stage 3: Video Brief
function renderStageVideoBrief(state) {
  const actionSlot = document.getElementById("briefHitlActionSlot");
  const approveBtn = document.getElementById("approveBriefBtn");
  const paramsEl = document.getElementById("briefParameters");
  const guardEl = document.getElementById("briefGuardrails");
  const rendererGrid = document.getElementById("rendererChoiceGrid");
  const rendererStatus = document.getElementById("rendererChoiceStatus");
  const rendererDescription = document.getElementById("rendererChoiceDescription");
  const badge = document.getElementById("briefStatusBadge");

  badge.textContent = state.videoBrief?.status ? statusLabelVi(state.videoBrief.status) : "Chưa ghi nhận";

  const briefReview = state.hitl?.status === "REVIEW_REQUIRED" && state.hitl?.checkpoint === "VIDEO_BRIEF";
  const rendererReview = state.hitl?.status === "INPUT_REQUIRED" && state.hitl?.checkpoint === "RENDERER_SELECTION";
  const briefRevisionRequested = isRevisionRequested(state, "VIDEO_BRIEF");
  if (briefReview || rendererReview || briefRevisionRequested) {
    actionSlot.classList.remove("hidden");
    approveBtn.hidden = !briefReview && !rendererReview;
    approveBtn.disabled = !(state.rendererOptions || []).some((option) => option.available);
    approveBtn.textContent = briefReview ? "Duyệt yêu cầu" : "Xác nhận Renderer";
    approveBtn.onclick = () => {
      const choice = document.querySelector('input[name="renderer-choice"]:checked');
      if (!choice) { alert("Hãy chọn một Renderer khả dụng trước."); return; }
      executeApproval(briefReview ? "VIDEO_BRIEF" : "RENDERER_SELECTION", approveBtn, choice.value);
    };
  } else {
    actionSlot.classList.add("hidden");
  }
  renderRequestChangesControls(actionSlot, "VIDEO_BRIEF", briefReview, state);

  const selectedRenderer = state.rendererSelection?.selected;
  const canChooseRenderer = !selectedRenderer && (briefReview || rendererReview);
  if (selectedRenderer) {
    rendererStatus.textContent = `Đã chọn: ${selectedRenderer.toUpperCase()}`;
    rendererDescription.textContent = "Renderer đã được chọn cho yêu cầu này.";
  } else if (canChooseRenderer) {
    rendererStatus.textContent = "Cần bạn chọn";
    rendererDescription.textContent = "Chọn Renderer sẽ dùng cho dự án. Lựa chọn được ghi nhận khi bạn duyệt định hướng video.";
  } else {
    rendererStatus.textContent = "Chờ duyệt định hướng";
    rendererDescription.textContent = "Renderer được chọn trước khi bắt đầu sản xuất.";
  }
  const options = state.rendererOptions || [];
  rendererGrid.innerHTML = options.map((option) => `
    <label class="renderer-choice ${!option.available ? "renderer-choice-unavailable" : selectedRenderer ? "renderer-choice-locked" : canChooseRenderer ? "" : "renderer-choice-disabled"}" aria-disabled="${!canChooseRenderer || !option.available}">
      <span class="renderer-choice-heading">
        <input type="radio" name="renderer-choice" value="${escapeHtml(option.id)}" ${selectedRenderer === option.id ? "checked" : ""} ${canChooseRenderer && option.available ? "" : "disabled"}>
        <span class="renderer-choice-name">${escapeHtml(option.label)}</span>
        ${option.recommended ? '<span class="renderer-choice-recommended">Phù hợp</span>' : ""}
        ${selectedRenderer === option.id ? '<span class="renderer-choice-lock">Đã chọn</span>' : ""}
        <span class="renderer-choice-availability">${option.available ? `Sẵn sàng${option.version ? ` · ${escapeHtml(option.version)}` : ""}` : "Cần cài đặt"}</span>
      </span>
      ${option.recommendationRationale ? `<span class="renderer-choice-detail">Phù hợp vì: ${escapeHtml(option.recommendationRationale)}</span>` : ""}
      <span class="renderer-choice-detail">Thích hợp cho: ${escapeHtml(option.bestFor)}</span>
      <span class="renderer-choice-detail">Lưu ý: ${escapeHtml(option.alternativeTradeoff || option.tradeoff)}</span>
      ${option.reason ? `<span class="renderer-choice-reason">${escapeHtml(option.reason)}</span>` : ""}
    </label>
  `).join("") || '<div class="empty-note">Chưa có thông tin về Renderer.</div>';
  if (!selectedRenderer && options.length && !options.some((option) => option.available)) {
    rendererGrid.insertAdjacentHTML("beforeend", '<div class="empty-note">Cài đặt ít nhất một Renderer trước khi chọn. Hệ thống không tự chọn thay bạn.</div>');
  }

  const b = state.videoBrief;
  if (b) {
    const briefValue = (value) => typeof value === "string" && value.trim() ? renderMarkdownHtml(value, true) : "Chưa cung cấp";
    const durationParts = [
      b.durationPolicy?.targetSeconds ? `Khoảng ${b.durationPolicy.targetSeconds} giây` : "",
      b.durationPolicy?.maxSeconds ? `tối đa ${b.durationPolicy.maxSeconds} giây` : !b.durationPolicy && b.durationSeconds ? `Khoảng ${b.durationSeconds} giây` : "",
    ].filter(Boolean);
    paramsEl.innerHTML = `
      <div class="param-row"><span class="param-label">Mục tiêu</span><span class="param-value">${briefValue(b.objective)}</span></div>
      <div class="param-row"><span class="param-label">Khán giả</span><span class="param-value">${briefValue(b.audience)}</span></div>
      <div class="param-row"><span class="param-label">Thời lượng · Tỉ lệ</span><span class="param-value">${durationParts.length ? durationParts.join(" · ") : "Chưa cung cấp"} · ${briefValue(b.aspectRatio)}</span></div>
      <div class="param-row"><span class="param-label">Giọng điệu · Nhịp độ</span><span class="param-value">${[briefValue(b.tone), briefValue(b.pacing)].join(" · ")}</span></div>
    `;

    guardEl.innerHTML = `
      <div class="param-row"><span class="param-label">Cần có</span><span class="param-value">${b.mustInclude?.length ? b.mustInclude.map((item) => renderMarkdownHtml(item, true)).join(", ") : "Không có yêu cầu"}</span></div>
      <div class="param-row"><span class="param-label">Tránh</span><span class="param-value">${b.mustAvoid?.length ? b.mustAvoid.map((item) => renderMarkdownHtml(item, true)).join(", ") : "Không có yêu cầu"}</span></div>
      <div class="param-row"><span class="param-label">Ghi chú nguồn</span><span class="param-value">${b.sourceNotes?.length ? b.sourceNotes.map((note) => renderMarkdownHtml(note, true)).join("; ") : "Chưa cung cấp"}</span></div>
    `;
  } else {
    paramsEl.innerHTML = '<div class="empty-note">Chưa có định hướng video được lưu.</div>';
    guardEl.innerHTML = '<div class="empty-note">Chưa ghi nhận giới hạn nội dung.</div>';
  }
}

// Stage 4: Production Profile
function renderStageProductionProfile(state) {
  const rawEl = document.getElementById("profileRawContent");
  const badge = document.getElementById("profileStatusBadge");

  if (state.productionProfile) {
    badge.textContent = "Đã chốt";
    rawEl.textContent = JSON.stringify(state.productionProfile, null, 2);
  } else {
    badge.textContent = "Đang chờ";
    rawEl.textContent = "Định hướng sản xuất chưa được chốt.";
  }
}

// Stage 5: Script
function renderStageScript(state) {
  const actionSlot = document.getElementById("scriptHitlActionSlot");
  const approveBtn = document.getElementById("approveScriptBtn");
  const scriptContent = document.getElementById("scriptContentArea");
  const metaEl = document.getElementById("scriptMetadataArea");

  const scriptReview = state.hitl?.status === "REVIEW_REQUIRED" && state.hitl?.checkpoint === "SCRIPT";
  const scriptRevisionRequested = isRevisionRequested(state, "SCRIPT");
  if (scriptReview || scriptRevisionRequested) {
    actionSlot.classList.remove("hidden");
    approveBtn.hidden = !scriptReview;
    approveBtn.onclick = () => executeApproval("SCRIPT", approveBtn);
  } else {
    actionSlot.classList.add("hidden");
  }
  renderRequestChangesControls(actionSlot, "SCRIPT", scriptReview, state);

  if (state.scriptText) {
    renderMarkdown(scriptContent, state.scriptText);
  } else {
    scriptContent.innerHTML = '<div class="empty-note">Chưa có bản nháp kịch bản được lưu.</div>';
  }
  renderStudioScriptOutline(scriptContent, state);

  const sm = state.scriptReview;
  if (sm) {
    metaEl.innerHTML = `
      <div class="param-row"><span class="param-label">Trạng thái duyệt</span><span class="param-value mono">${escapeHtml(sm.status || "đang chờ")}</span></div>
      <div class="param-row"><span class="param-label">Người duyệt</span><span class="param-value mono">${escapeHtml(sm.approvedBy || "NONE")}</span></div>
      <div class="param-row"><span class="param-label">Mã nội dung</span><span class="param-value mono" title="${escapeHtml(sm.contentHash || '')}">${escapeHtml(sm.contentHash || "--")}</span></div>
      <div class="param-row"><span class="param-label">Mã nguồn trước</span><span class="param-value mono" title="${escapeHtml(sm.upstreamHash || '')}">${escapeHtml(sm.upstreamHash || "--")}</span></div>
    `;
    const narration = sm.narration;
    if (narration && Array.isArray(narration.segments)) {
      const voiceSegments = narration.segments.filter(segment => segment.audioUrl);
      metaEl.innerHTML += `<div class="narration-review"><div class="param-row"><span class="param-label">Thời lượng giọng đọc</span><span class="param-value mono">${Number(narration.totalAudioSeconds || 0).toFixed(2)} giây âm thanh · ${Number(narration.totalTimelineSeconds || 0).toFixed(2)} giây tính cả khoảng nghỉ</span></div>${voiceSegments.map(segment => `<div class="narration-segment"><span class="param-label">${escapeHtml(segment.id)} · ${Number(segment.durationSeconds || 0).toFixed(2)} giây</span><audio controls preload="none" src="${escapeHtml(segment.audioUrl)}"></audio></div>`).join("")}</div>`;
    }
  } else {
    metaEl.innerHTML = '<div class="empty-note">Chưa có lịch sử duyệt kịch bản.</div>';
  }
  renderReopenControls(metaEl, state);
  renderDurationDecision(metaEl, state);
}

function renderReopenControls(container, state) {
  if (!container || !state.reopenStatus) return;
  const id = "hostReopenControls";
  let panel = document.getElementById(id);
  if (!panel) {
    panel = document.createElement("div"); panel.id = id; panel.className = "hitl-review-changes";
    panel.innerHTML = `<label class="hitl-review-changes-label" for="reopenCheckpoint">MỞ LẠI BƯỚC ĐÃ DUYỆT</label><div class="hitl-review-changes-form"><select id="reopenCheckpoint" class="hitl-review-changes-input"><option value="">Chọn bước</option><option>VIDEO_BRIEF</option><option>SCRIPT</option><option>STORYBOARD</option><option>ASSET_PREFLIGHT</option><option>VISUAL_REVIEW</option></select><button type="button" class="btn btn-ghost">MỞ LẠI</button></div><div class="hitl-review-changes-pending" role="status"></div>`;
    container.appendChild(panel);
    panel.querySelector("button").onclick = async () => {
      const checkpoint = panel.querySelector("select").value;
      if (!checkpoint) { alert("Hãy chọn bước đã duyệt."); return; }
      const reason = prompt(`Lý do mở lại bước ${checkpoint.replaceAll("_", " ")}:`);
      if (!reason || !reason.trim()) return;
      try {
        const response = await fetch("/api/hitl/reopen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkpoint, reason, expectedRevision: state.reopenStatus.generation }) });
        const result = await response.json(); if (!result.ok) throw new Error(result.error || "Không mở lại được bước đã duyệt"); await fetchState();
      } catch (error) { alert(`Lỗi khi mở lại bước: ${error.message}`); }
    };
  }
  const pending = panel.querySelector(".hitl-review-changes-pending");
  pending.textContent = state.reopenStatus.pending.length ? `Cần đối chiếu và duyệt lại: ${state.reopenStatus.pending.join(", ")}` : `Lần chỉnh sửa ${state.reopenStatus.generation}`;
}

function renderDurationDecision(container, state) {
  if (!container || state.hitl?.checkpoint !== "DURATION_FIT") return;
  const fit = state.hitl.payload?.fit || {}, panel = document.createElement("div"); panel.className = "hitl-review-changes";
  panel.innerHTML = `<div class="hitl-review-changes-label">VƯỢT THỜI LƯỢNG TỐI ĐA</div><div class="param-row"><span class="param-label">Thời lượng thực tế</span><span class="param-value mono">${Number(fit.measuredSeconds || 0).toFixed(2)} giây · tối đa ${Number(fit.maxSeconds || 0).toFixed(2)} giây · vượt ${Number(fit.overrunSeconds || 0).toFixed(2)} giây</span></div><div class="hitl-review-changes-form"><button type="button" class="btn btn-ghost" data-choice="shorten_script">RÚT GỌN KỊCH BẢN</button><button type="button" class="btn btn-ghost" data-choice="revise_brief">SỬA ĐỊNH HƯỚNG</button></div>`;
  for (const button of panel.querySelectorAll("button")) button.onclick = async () => {
    const reason = prompt(`Hướng xử lý cho bước ${button.dataset.choice.replaceAll("_", " ")}:`); if (!reason || !reason.trim()) return;
    try { const response = await fetch("/api/hitl/duration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice: button.dataset.choice, reason, expectedGeneration: state.reopenStatus?.generation || 0 }) }); const result = await response.json(); if (!result.ok) throw new Error(result.error || "Không thể lưu lựa chọn thời lượng"); await fetchState(); }
    catch (error) { alert(`Lỗi khi xử lý thời lượng: ${error.message}`); }
  };
  container.appendChild(panel);
}

// Stage 6: Storyboard
function renderStageStoryboard(state) {
  const actionSlot = document.getElementById("storyboardHitlActionSlot");
  const approveBtn = document.getElementById("approveStoryboardBtn");
  const container = document.getElementById("storyboardCardsContainer");

  const storyboardReview = state.hitl?.status === "REVIEW_REQUIRED" && state.hitl?.checkpoint === "STORYBOARD";
  const storyboardRevisionRequested = isRevisionRequested(state, "STORYBOARD");
  if (storyboardReview || storyboardRevisionRequested) {
    actionSlot.classList.remove("hidden");
    approveBtn.hidden = !storyboardReview;
    approveBtn.onclick = () => executeApproval("STORYBOARD", approveBtn);
  } else {
    actionSlot.classList.add("hidden");
  }
  renderRequestChangesControls(actionSlot, "STORYBOARD", storyboardReview, state);

  const project = projectForBacklot(state);
  const studioCount = document.getElementById("studioStoryCount");
  if (studioCount) studioCount.textContent = `${project?.scenes?.length || 0} cảnh`;
  if (!project?.scenes || project.scenes.length === 0) {
    container.innerHTML = '<li class="empty-note">Chưa có bảng phân cảnh được lưu.</li>';
    return;
  }

  container.innerHTML = "";
  const fps = project.meta?.fps || 30;
  const scriptBeats = extractScriptNarrativeBeats(state.scriptText);

  project.scenes.forEach((scene, idx) => {
    const card = document.createElement("li");
    card.className = "scene-card";
    const sec = (scene.durationInFrames / fps).toFixed(1);
    const sceneNum = String(idx + 1);
    const voText = scene.audio?.voiceoverText || scriptBeats[`scene-${sceneNum}`] || scriptBeats[sceneNum] || scriptBeats[scene.id];

    card.innerHTML = `
      ${renderAssetFrame(state, `Khung hình xem trước cảnh ${sceneNum}`, scene.id)}
      <div class="scene-card-content">
      <div class="scene-card-top">
        <span class="scene-card-id mono">CẢNH ${sceneNum.padStart(2, "0")} (${escapeHtml(scene.id)})</span>
        <span class="scene-card-timing">${sec} giây · ${scene.durationInFrames} khung hình</span>
      </div>
      <div class="scene-segment">
        <span class="segment-title">Chữ trên màn hình</span>
        <div class="segment-screentext markdown-inline">${scene.screenText ? renderMarkdownHtml(scene.screenText, true) : "<em>Chưa có chữ trên màn hình</em>"}</div>
      </div>
      <div class="scene-segment scene-narration">
        <span class="segment-title">Lời thuyết minh</span>
        <div class="segment-narration markdown-inline">${voText ? renderMarkdownHtml(voText, true) : "<em>Không có lời thoại</em>"}</div>
      </div>
      <div class="scene-segment">
        <span class="segment-title">Định hướng hình ảnh</span>
        <div class="segment-visual markdown-inline">${renderMarkdownHtml(scene.visualConcept || "Chưa có", true)}</div>
      </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function extractScriptNarrativeBeats(scriptText) {
  if (!scriptText) return {};
  const beats = {};
  const sceneRegex = /###\s*Scene\s*(\d+)[^\n]*[\s\S]*?-\s*\*\*Narrative Beat\*\*:\s*([^\n]+(?:\n(?!---|\n###)[^\n]+)*)/gi;
  let match;
  while ((match = sceneRegex.exec(scriptText)) !== null) {
    const sceneNum = match[1];
    const text = match[2].trim().replace(/\s+/g, " ");
    beats[`scene-${sceneNum}`] = text;
    beats[String(parseInt(sceneNum, 10))] = text;
  }
  return beats;
}

// Stage 7: Canonical Truth
// Theme review: the resolved renderer theme the reviewer is approving with the storyboard.
const CONTRAST_TEXT_MIN = 4.5;
const CONTRAST_ACCENT_MIN = 3;

function renderThemePanel(state) {
  const panel = document.getElementById("themePanel");
  const badge = document.getElementById("themeStatusBadge");
  if (!panel || !badge) return;

  const theme = state.theme;
  if (!theme) {
    badge.textContent = "CHƯA CÓ CHỦ ĐỀ";
    panel.innerHTML = '<div class="empty-note">Chưa có chủ đề hình ảnh được lưu.</div>';
    return;
  }

  const t = theme.tokens;
  const project = projectForBacklot(state);
  const warnings = theme.warnings || [];
  badge.textContent = warnings.length
    ? `${warnings.length} CẢNH BÁO`
    : `${t.mode.toUpperCase()} · ĐẠT`;

  const pinned = new Set(theme.pinnedRoles || []);
  const roleSwatch = (role, label, color) => `
    <div class="theme-swatch">
      <div class="theme-swatch-color" style="background-color:${escapeHtml(color)}"></div>
      <div class="theme-swatch-meta mono">
        <span class="theme-swatch-role">${escapeHtml(label)}</span>
        <span>${escapeHtml(color)}</span>
        <span class="theme-swatch-role muted">${pinned.has(role) ? "đã cố định" : "tự tạo"}</span>
      </div>
    </div>`;
  const paletteSwatch = (color) => `
    <div class="theme-swatch">
      <div class="theme-swatch-color" style="background-color:${escapeHtml(color)}"></div>
      <div class="theme-swatch-meta mono"><span>${escapeHtml(color)}</span></div>
    </div>`;
  const contrastRow = (label, value, min) => `
    <div class="param-row">
      <span class="param-label">${escapeHtml(label)}</span>
      <span class="param-value mono ${value < min ? "theme-contrast-fail" : ""}">${value.toFixed(2)}:1 (min ${min}:1)</span>
    </div>`;

  panel.innerHTML = `
    <div class="theme-sample" style="background-color:${escapeHtml(t.page)};border-color:${escapeHtml(t.border)};font-family:${escapeHtml(t.fontDisplay)}">
      <span class="theme-sample-chip" style="background-color:${escapeHtml(t.accent)};color:${escapeHtml(t.onAccent)}">MÀU NHẤN</span>
      <div class="theme-sample-heading" style="color:${escapeHtml(t.text)}">${escapeHtml(project?.meta?.title || "Tiêu đề mẫu")}</div>
      <div class="theme-sample-body" style="color:${escapeHtml(t.textMuted)}">Văn bản phụ trên khung hình video.</div>
      <div class="theme-sample-body" style="color:${escapeHtml(t.accentAlt)}">Màu nhấn phụ</div>
    </div>
    <div class="theme-details">
      <div class="theme-swatches">
        ${roleSwatch("page", "nền", t.page)}
        ${roleSwatch("text", "chữ", t.text)}
        ${roleSwatch("accent", "màu nhấn", t.accent)}
        ${roleSwatch("accentAlt", "màu nhấn phụ", t.accentAlt)}
      </div>
      <div class="theme-swatches">${(t.palette || []).map(paletteSwatch).join("")}</div>
      <div class="params-table">
        <div class="param-row"><span class="param-label">Chế độ</span><span class="param-value mono">${escapeHtml(t.mode)}</span></div>
        <div class="param-row"><span class="param-label">Phông chữ</span><span class="param-value mono">${escapeHtml(t.fontDisplay)}</span></div>
        <div class="param-row"><span class="param-label">Nguồn</span><span class="param-value mono">${escapeHtml(theme.source)}</span></div>
        ${contrastRow("Chữ trên nền", theme.contrast.textOnPage, CONTRAST_TEXT_MIN)}
        ${contrastRow("Màu nhấn trên nền", theme.contrast.accentOnPage, CONTRAST_ACCENT_MIN)}
      </div>
      ${warnings.map((w) => `<div class="theme-warning"><strong class="mono">${escapeHtml(w.code)}</strong> ${escapeHtml(w.message)}</div>`).join("")}
    </div>
  `;
}

function renderStageCanonical(state) {
  const canonicalBox = document.getElementById("canonicalProjectRaw");
  const stateBox = document.getElementById("projectStateRaw");
  const badge = document.getElementById("canonicalStatusBadge");

  if (state.canonicalProject) {
    badge.textContent = "ĐÃ CHỐT BẢN CHÍNH";
    canonicalBox.textContent = JSON.stringify(state.canonicalProject, null, 2);
  } else {
    badge.textContent = "CHƯA CHUYỂN THÀNH BẢN CHÍNH";
    canonicalBox.textContent = "Chưa chuyển video.json từ bảng phân cảnh thành bản chính.";
  }

  if (state.projectState) {
    stateBox.textContent = JSON.stringify(state.projectState, null, 2);
  } else {
    stateBox.textContent = "Chưa ghi nhận trạng thái dự án trong .video/project-state.json.";
  }
}

// Stage 8: Asset Acquisition & Categorization
let currentAssetFilter = "all";

function setupAssetCategoryFilters() {
  document.addEventListener("click", (e) => {
    const filterBtn = e.target.closest(".filter-tab");
    if (filterBtn) {
      const filter = filterBtn.getAttribute("data-filter");
      if (filter) setAssetFilter(filter);
    }
  });
}

function setAssetFilter(filter) {
  currentAssetFilter = filter;
  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.getAttribute("data-filter") === filter);
  });

  const sectionVideo = document.getElementById("assetCategoryGroupVideo");
  const sectionImage = document.getElementById("assetCategoryGroupImage");
  const sectionVoice = document.getElementById("assetCategoryGroupVoice");
  const sectionFont = document.getElementById("assetCategoryGroupFont");

  if (sectionVideo) {
    sectionVideo.classList.toggle("hidden", filter !== "all" && filter !== "video");
  }
  if (sectionImage) {
    sectionImage.classList.toggle("hidden", filter !== "all" && filter !== "image");
  }
  if (sectionVoice) {
    sectionVoice.classList.toggle("hidden", filter !== "all" && filter !== "voice");
  }
  if (sectionFont) {
    sectionFont.classList.toggle("hidden", filter !== "all" && filter !== "font");
  }
  const visibleAssets = [sectionVideo, sectionImage, sectionVoice, sectionFont]
    .filter((section) => section && !section.classList.contains("hidden"))
    .reduce((sum, section) => sum + section.querySelectorAll(".asset-card").length, 0);
  const emptyState = document.getElementById("assetsEmptyState");
  if (emptyState) {
    emptyState.hidden = visibleAssets > 0;
    if (!visibleAssets) {
      const labels = { all: "tư liệu", video: "video", image: "hình ảnh", voice: "âm thanh", font: "phông chữ" };
      emptyState.textContent = filter === "all" ? "Chưa có tư liệu được đăng ký cho dự án này." : `Không có ${labels[filter] || "tư liệu"} trong dự án này.`;
    }
  }
}

function classifyAsset(asset) {
  const type = (asset.type || "").toLowerCase();
  const role = (asset.role || "").toLowerCase();
  const path = (asset.publicPath || asset.path || "").toLowerCase();
  const id = (asset.id || "").toLowerCase();

  // 0. Font (checked first so font files never render as broken images)
  if (type.startsWith("font/") || role === "font" || /\.(woff2?|ttf|otf)$/i.test(path)) {
    return "font";
  }

  // 1. Video
  if (
    type.startsWith("video/") ||
    role === "video" || role === "footage" || role === "clip" || role === "motion" || role === "b-roll" ||
    id.startsWith("video-") || id.startsWith("video_") || id.startsWith("clip-") ||
    /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(path)
  ) {
    return "video";
  }

  // 2. Voice / Audio
  if (
    type.startsWith("audio/") ||
    role === "voiceover" || role === "voice" || role === "audio" || role === "narration" || role === "dialogue" || role === "sfx" ||
    id.startsWith("voice-") || id.startsWith("voice_") || id.startsWith("audio-") || id.startsWith("narration-") ||
    /\.(mp3|wav|ogg|aac|m4a|flac)$/i.test(path)
  ) {
    return "voice";
  }

  // 3. Image
  return "image";
}

// Registers manifest font faces with the dashboard document so font cards and the theme sample preview the real face.
const registeredPreviewFonts = new Set();

function registerPreviewFont(a, src) {
  const family = typeof a.family === "string" ? a.family.trim() : "";
  if (!family || !src || typeof FontFace === "undefined") return;
  const key = `${family}|${src}|${a.weight || ""}|${a.style || ""}`;
  if (registeredPreviewFonts.has(key)) return;
  registeredPreviewFonts.add(key);
  const descriptors = {};
  if (a.weight !== undefined) descriptors.weight = String(a.weight);
  if (a.style !== undefined) descriptors.style = String(a.style);
  new FontFace(family, `url("${src}")`, descriptors)
    .load()
    .then((face) => document.fonts.add(face))
    .catch(() => registeredPreviewFonts.delete(key));
}

function renderAssetCard(a, category) {
  const mediaCategory = category === "video" ? "video" : category === "voice" ? "audio" : category === "image" ? "image" : "unknown";
  const src = assetMediaSource(a, mediaCategory);
  const kind = mediaKind(a);
  const imagePreview = assetPreviewSource(a) || (kind === "image" ? src : "");
  const fileName = String(a.publicPath || a.path || "").split(/[\\/]/).filter(Boolean).pop();
  const categoryLabel = ({ video: "Video", image: "Ảnh", voice: "Âm thanh", font: "Phông chữ" })[category] || "Tư liệu";

  let previewHtml = "";
  if (category === "font") {
    const family = typeof a.family === "string" ? a.family.trim() : "";
    if (family && src) {
      registerPreviewFont(a, src);
      const stack = `${JSON.stringify(family)}, sans-serif`;
      const faceStyle = `font-family:${stack};${a.weight !== undefined ? `font-weight:${a.weight};` : ""}${a.style !== undefined ? `font-style:${a.style};` : ""}`;
      previewHtml = `
        <div class="asset-media-container font-container" style="${escapeHtml(faceStyle)}">
          <span class="font-sample-large">Aa Bb 0123</span>
          <span class="font-sample-small">The quick brown fox jumps over the lazy dog.</span>
        </div>
      `;
    } else if (family) {
      previewHtml = `
        <div class="asset-media-container font-container" style="font-family:${escapeHtml(family)},sans-serif">
          <span class="font-sample-large">Aa Bb 0123</span>
          <span class="font-sample-small">The quick brown fox jumps over the lazy dog.</span>
          <span class="asset-preview-caption">Phông chưa tải</span>
        </div>
      `;
    } else {
      previewHtml = `<div class="asset-media-container file-container"><span class="mono">${escapeHtml(a.type || "font")}${family ? "" : " · thiếu họ phông"}</span></div>`;
    }
  } else if (category === "voice") {
    if (src && kind === "audio") {
      previewHtml = `
        <div class="asset-media-container audio-container">
          <audio controls preload="metadata" class="asset-audio-player" src="${escapeHtml(src)}">Trình duyệt không hỗ trợ phát âm thanh này.</audio>
        </div>
      `;
    } else {
      previewHtml = `<div class="asset-media-container file-container"><span>${escapeHtml(a.type || "audio")} · Chưa có bản nghe</span></div>`;
    }
  } else if (category === "video") {
    if (src && kind === "video") {
      previewHtml = `
        <div class="asset-media-container video-container">
          <video controls preload="metadata" class="asset-video-player" src="${escapeHtml(src)}"${imagePreview ? ` poster="${escapeHtml(imagePreview)}"` : ""}>Trình duyệt không hỗ trợ phát video này.</video>
        </div>
      `;
    } else if (imagePreview) {
      previewHtml = `
        <div class="asset-media-container image-container video-poster-container">
          <img src="${escapeHtml(imagePreview)}" alt="Ảnh xem trước: ${escapeHtml(a.id || "video")}" loading="lazy">
        </div>
      `;
    } else {
      previewHtml = `<div class="asset-media-container file-container"><span>${escapeHtml(a.type || "video")} · Chưa có bản xem trước</span></div>`;
    }
  } else {
    // image
    if (src && kind === "image") {
      previewHtml = `
        <div class="asset-media-container image-container">
          <img src="${escapeHtml(src)}" alt="${escapeHtml(a.id || "")}" loading="lazy">
        </div>
      `;
    } else {
      previewHtml = `<div class="asset-media-container file-container"><span class="mono">${escapeHtml(a.type || "image")}</span></div>`;
    }
  }

  return `
    <div class="asset-card asset-card-${category}">
      ${previewHtml}
      <div class="asset-info mono">
        <strong class="asset-title">${escapeHtml(a.id || "Tư liệu")}</strong>
        <span class="asset-kind">${categoryLabel}</span>
        <span class="asset-meta">${escapeHtml(a.type || category)}</span>
        ${fileName ? `<span class="asset-meta asset-filename" title="${escapeHtml(a.publicPath || a.path)}">${escapeHtml(fileName)}</span>` : ""}
        ${category === "font" && a.family ? `<span class="asset-meta">${escapeHtml(a.family)}${a.weight !== undefined ? ` · ${escapeHtml(String(a.weight))}` : ""}${a.style !== undefined ? ` · ${escapeHtml(String(a.style))}` : ""}</span>` : ""}
        ${a.sceneIds?.length ? `<span class="asset-scenes">Cảnh ${escapeHtml(a.sceneIds.join(", "))}</span>` : ""}
      </div>
    </div>
  `;
}

function renderStageAssets(state) {
  const preflightBox = document.getElementById("prodPreflightRaw");
  const preflightBadge = document.getElementById("prodPreflightBadge");
  const approval = state.productionPreflightApproval;
  const actionSlot = document.getElementById("assetPreflightHitlActionSlot");
  const bindingBox = document.getElementById("assetPreflightReviewBinding");
  const approveButton = document.getElementById("approveAssetPreflightBtn");
  const countBadge = document.getElementById("assetsCountBadge");

  const filterAllCount = document.getElementById("countFilterAll");
  const filterVideoCount = document.getElementById("countFilterVideo");
  const filterImageCount = document.getElementById("countFilterImage");
  const filterVoiceCount = document.getElementById("countFilterVoice");
  const filterFontCount = document.getElementById("countFilterFont");

  const videoGrid = document.getElementById("assetVideoGrid");
  const imageGrid = document.getElementById("assetImageGrid");
  const voiceGrid = document.getElementById("assetVoiceGrid");
  const fontGrid = document.getElementById("assetFontGrid");
  const fallbackGrid = document.getElementById("assetRegistryGrid");
  const emptyState = document.getElementById("assetsEmptyState");

  if (state.productionPreflight) {
    preflightBadge.textContent = approval?.status ? statusLabelVi(approval.status) : (state.productionPreflight.valid ? "Đạt" : "Chưa đạt");
    preflightBox.textContent = JSON.stringify(state.productionPreflight, null, 2);
  } else {
    preflightBadge.textContent = approval?.status ? statusLabelVi(approval.status) : "Đang chờ";
    preflightBox.textContent = "Chưa kiểm tra tư liệu sản xuất.";
  }
  const needsApproval = state.hitl?.status === "REVIEW_REQUIRED" && state.hitl?.checkpoint === "ASSET_PREFLIGHT";
  const revisionRequested = isRevisionRequested(state, "ASSET_PREFLIGHT");
  if (actionSlot) actionSlot.classList.toggle("hidden", !needsApproval && !revisionRequested);
  if (bindingBox) bindingBox.textContent = approval
    ? JSON.stringify({status: approval.status, projectHash: approval.projectHash, assetSnapshotHash: approval.assetSnapshotHash, reportHash: approval.reportHash, message: approval.message}, null, 2)
    : "Hãy kiểm tra tư liệu để tạo bản chụp có thể duyệt.";
  if (approveButton) {
    approveButton.hidden = !needsApproval;
    approveButton.onclick = needsApproval ? () => executeApproval("ASSET_PREFLIGHT", approveButton) : null;
    if (needsApproval) {
      // Re-arm the action when a fresh snapshot becomes reviewable.
      approveButton.disabled = false;
      approveButton.textContent = "Duyệt tư liệu";
    }
  }
  if (actionSlot) renderRequestChangesControls(actionSlot, "ASSET_PREFLIGHT", needsApproval, state);

  const assets = state.assetManifest?.assets || [];
  if (countBadge) countBadge.textContent = `${assets.length} tư liệu`;

  const videoAssets = [];
  const imageAssets = [];
  const voiceAssets = [];
  const fontAssets = [];

  for (const a of assets) {
    const cat = classifyAsset(a);
    if (cat === "font") fontAssets.push(a);
    else if (cat === "video") videoAssets.push(a);
    else if (cat === "voice") voiceAssets.push(a);
    else imageAssets.push(a);
  }

  if (filterAllCount) filterAllCount.textContent = assets.length;
  if (filterVideoCount) filterVideoCount.textContent = videoAssets.length;
  if (filterImageCount) filterImageCount.textContent = imageAssets.length;
  if (filterVoiceCount) filterVoiceCount.textContent = voiceAssets.length;
  if (filterFontCount) filterFontCount.textContent = fontAssets.length;

  if (emptyState) emptyState.hidden = assets.length > 0;

  if (videoGrid) videoGrid.innerHTML = videoAssets.map((a) => renderAssetCard(a, "video")).join("");

  if (imageGrid) imageGrid.innerHTML = imageAssets.map((a) => renderAssetCard(a, "image")).join("");

  if (voiceGrid) voiceGrid.innerHTML = voiceAssets.map((a) => renderAssetCard(a, "voice")).join("");

  if (fontGrid) fontGrid.innerHTML = fontAssets.map((a) => renderAssetCard(a, "font")).join("");

  if (fallbackGrid) {
    fallbackGrid.innerHTML = "";
  }

  setAssetFilter(currentAssetFilter);
}

// Stage 9: Show the selected renderer's local Studio preview and approval action.
function renderStageRenderer(state) {
  const studioLink = document.getElementById("rendererPreviewLink");
  const sourceHash = document.getElementById("rendererSourceHash");
  const approveButton = document.getElementById("approveRendererReviewBtn");
  const actionSlot = document.getElementById("rendererReviewHitlActionSlot");
  const approvedNextStep = document.getElementById("reviewApprovedNextStep");
  const approvedStudioLink = document.getElementById("reviewDetailsStudioLink");
  const launcher = document.getElementById("reviewLauncher");
  const launcherHeading = document.getElementById("reviewLauncherHeading");
  const launcherHint = document.getElementById("reviewLauncherHint");
  const unavailable = document.getElementById("reviewStudioUnavailable");
  const rendererId = state.rendererSelection?.selected;
  const actualRendererId = state.renderer?.id;
  const rendererMatchesSelection = Boolean(rendererId && actualRendererId === rendererId);
  const rendererLabel = rendererId === "remotion" ? "Remotion" : rendererId === "hyperframes" ? "HyperFrames" : "Renderer";
  const rendererOption = (state.rendererOptions || []).find((option) => option.id === rendererId);
  const status = document.getElementById("reviewStatusLabel");
  const statusDescription = document.getElementById("reviewStatusDescription");
  const projectIdentity = document.getElementById("reviewProjectIdentity");
  const rendererIdentity = document.getElementById("reviewRendererIdentity");
  const projectContext = document.getElementById("reviewProjectContext");
  const sourceSummary = document.getElementById("reviewSourceSummary");
  const projectTitle = projectForBacklot(state)?.meta?.title || state.videoBrief?.objective || "Video chưa đặt tên";
  if (projectIdentity) projectIdentity.textContent = projectTitle;
  if (rendererIdentity) rendererIdentity.textContent = rendererId ? `${rendererLabel}${rendererOption?.version ? ` ${rendererOption.version}` : ""}` : "Chưa chọn";
  if (projectContext) {
    const revision = state.projectState ? `${state.projectState.projectId || "Dự án"} · bản sửa ${state.projectState.revision ?? "chưa rõ"}` : "Chưa có thông tin phiên bản dự án";
    projectContext.textContent = rendererId ? `${revision} · đã chọn ${rendererLabel} / hiện tại ${actualRendererId || "chưa có"} · ${state.renderer?.phase || "chưa rõ trạng thái"} · ${state.renderer?.projectDir || "chưa có thư mục làm việc"}` : revision;
  }

  let previewUrl = null;
  try {
    const candidate = new URL(state.renderer?.previewUrl || "");
    if (rendererMatchesSelection && candidate.protocol === "http:" && candidate.hostname === "127.0.0.1" && !candidate.username && !candidate.password) previewUrl = candidate.href;
  } catch {}
  if (launcherHeading) launcherHeading.textContent = rendererId ? "Xem trong Studio " + rendererLabel : "Xem trong Studio";
  if (launcherHint) launcherHint.textContent = "Mở trong thẻ mới.";
  if (studioLink) {
    studioLink.hidden = !previewUrl;
    if (previewUrl) {
      studioLink.href = previewUrl;
      studioLink.textContent = "Mở Studio " + rendererLabel;
      const markStudioOpened = () => {
        openedVisualReviewIdentity = sourceIdentity;
        visualReviewNeedsReopen = false;
        const message = document.getElementById("reviewActionMessage");
        if (message?.dataset.kind === "stale") message.hidden = true;
        if (currentState) renderStageRenderer(currentState);
      };
      studioLink.onclick = markStudioOpened;
      studioLink.onauxclick = (event) => { if (event.button === 1) markStudioOpened(); };
    }
  }
  if (unavailable) {
    unavailable.hidden = Boolean(previewUrl);
    unavailable.textContent = !rendererId ? "Hãy chọn Renderer trước khi xem." : state.renderer && !rendererMatchesSelection
      ? "Renderer đã chọn (" + rendererLabel + ") không khớp với Renderer hiện tại của dự án."
      : state.renderer?.phase === "AUTHORING" ? "Studio sẽ khả dụng khi bắt đầu bước duyệt bản dựng."
        : "Studio hiện chưa khả dụng. Hãy đồng bộ sau khi bước duyệt bắt đầu.";
  }
  const source = state.renderer?.sourceHash || null;
  const projectRevision = state.projectState ? `${state.projectState.projectId || "project"}:${state.projectState.revision ?? "unknown"}:${state.projectState.projectHash || ""}` : "revision-unavailable";
  const sourceIdentity = JSON.stringify([source, rendererId || "renderer-unselected", projectRevision]);
  const reviewLabel = `${rendererLabel} · ${state.projectState?.projectId || "project"} revision ${state.projectState?.revision ?? "unknown"}`;
  if (sourceIdentity !== lastVisualReviewIdentity && openedVisualReviewIdentity && openedVisualReviewIdentity !== sourceIdentity) {
    openedVisualReviewIdentity = null;
    visualReviewNeedsReopen = true;
  }
  if (source && lastVisualReviewIdentity && sourceIdentity !== lastVisualReviewIdentity) {
    const message = document.getElementById("reviewActionMessage");
    if (message && visualReviewNeedsReopen) {
      message.hidden = false;
      message.dataset.kind = "stale";
      message.textContent = "Nguồn duyệt đã thay đổi. Hãy mở Studio hiện tại trước khi duyệt.";
    }
  }
  if (source) lastVisualReviewIdentity = sourceIdentity;
  if (sourceHash) sourceHash.textContent = source || "Chưa có mã nguồn từ Renderer.";
  if (sourceSummary) sourceSummary.textContent = source ? `${source.slice(0, 19)}…${source.slice(-8)}` : "Chưa có mã nhận diện nguồn";
  const needsRendererApproval = state.hitl?.status === "REVIEW_REQUIRED" && state.hitl?.checkpoint === "VISUAL_REVIEW" && state.hitl?.phase === "needs_visual_review" && state.renderer?.phase === "VISUAL_REVIEW" && rendererMatchesSelection && Boolean(previewUrl && state.renderer?.sourceHash);
  const visualRevisionRequested = isRevisionRequested(state, "VISUAL_REVIEW");
  const approvedVisualSource = rendererMatchesSelection && state.renderer?.visualApproval?.status === "approved" && state.renderer?.visualApproval?.approvedBy === "HUMAN" && state.renderer?.visualApproval?.sourceHash === source;
  const finalRenderExists = Boolean(state.finalVideoExists);
  const deliveryReady = Boolean(state.finalizedDelivery);
  const sourceChanged = Boolean(visualReviewDraft.identity && visualReviewDraft.identity !== sourceIdentity);
  const draftPanel = actionSlot?.querySelector(".review-change-form");
  if (draftPanel) {
    draftPanel.hidden = !needsRendererApproval;
    const textarea = draftPanel.querySelector("textarea");
    const ackWrap = document.getElementById("reviewOldDraftNotice");
    const ack = document.getElementById("reviewDraftAcknowledge");
    textarea.oninput = () => {
      if (visualReviewDraft.identity === null && source) { visualReviewDraft.source = source; visualReviewDraft.identity = sourceIdentity; visualReviewDraft.reviewLabel = reviewLabel; }
      visualReviewDraft.value = textarea.value;
      textarea.removeAttribute("aria-invalid");
    };
    if (visualReviewDraft.identity === null && textarea.value) visualReviewDraft = {source, identity: sourceIdentity, reviewLabel, value: textarea.value, acknowledgedSource: null};
    if (textarea.value !== visualReviewDraft.value && !visualReviewMutationPending) visualReviewDraft.value = textarea.value;
    ackWrap.hidden = !sourceChanged;
    if (sourceChanged) {
      const oldSourceLabel = document.getElementById("reviewOldDraftSource");
      if (oldSourceLabel) oldSourceLabel.textContent = `${visualReviewDraft.source} · ${visualReviewDraft.reviewLabel}`;
      if (visualReviewDraft.acknowledgedSource !== sourceIdentity) visualReviewDraft.acknowledgedSource = null;
      ack.checked = visualReviewDraft.acknowledgedSource === sourceIdentity;
      textarea.dataset.oldSource = visualReviewDraft.identity;
    } else textarea.dataset.oldSource = "";
    textarea.disabled = visualReviewMutationPending;
    ack.disabled = visualReviewMutationPending;
    const submit = draftPanel.querySelector(".hitl-review-changes-submit");
    submit.disabled = stateFetchStale || visualReviewMutationPending || (sourceChanged && !ack.checked);
    ack.onchange = () => { visualReviewDraft.acknowledgedSource = ack.checked ? sourceIdentity : null; submit.disabled = stateFetchStale || visualReviewMutationPending || (sourceChanged && !ack.checked); };
    submit.onclick = () => submitVisualReviewChanges(textarea, submit, source, sourceIdentity);
  }
  if (approveButton) {
    approveButton.hidden = !needsRendererApproval || approvedVisualSource;
    approveButton.disabled = stateFetchStale || visualReviewMutationPending || visualReviewNeedsReopen;
    approveButton.textContent = visualReviewMutationPending ? "Đang gửi…" : "Duyệt bản dựng";
    approveButton.onclick = () => executeApproval("VISUAL_REVIEW", approveButton);
  }
  if (actionSlot) {
    actionSlot.hidden = (!needsRendererApproval && !visualRevisionRequested) || approvedVisualSource;
    actionSlot.classList.toggle("hidden", actionSlot.hidden);
  if (visualRevisionRequested) showReviewMessage(state.hitl?.payload?.reviewChange?.feedback || "Đã yêu cầu chỉnh sửa. Hãy cập nhật bước này rồi gửi bản duyệt mới.", false);
  }
  if (approvedNextStep) approvedNextStep.hidden = !approvedVisualSource;
  if (approvedStudioLink) {
    approvedStudioLink.hidden = !approvedVisualSource || !previewUrl;
    if (previewUrl) approvedStudioLink.href = previewUrl;
  }
  if (launcher) launcher.hidden = approvedVisualSource;
  const approvedCopy = document.getElementById("reviewApprovedCopy");
  const approvedHeading = document.getElementById("reviewApprovedHeading");
  const approvedLink = approvedNextStep?.querySelector("a");
  if (approvedCopy && approvedVisualSource) approvedCopy.textContent = deliveryReady
    ? "Video và bằng chứng bàn giao đã sẵn sàng."
    : finalRenderExists ? "Đã có video render; đang chờ kiểm tra cuối."
      : "Agent có thể bắt đầu render video.";
  if (approvedHeading && approvedVisualSource) approvedHeading.textContent = deliveryReady
    ? "Sẵn sàng bàn giao" : finalRenderExists ? "Chờ kiểm tra video" : "Sẵn sàng render";
  if (approvedLink && approvedVisualSource) approvedLink.textContent = deliveryReady
    ? "Xem video đã bàn giao" : finalRenderExists ? "Xem kiểm tra video" : "Xem trạng thái bàn giao";
  const statusText = approvedVisualSource ? "Đã duyệt" : state.renderer && !rendererMatchesSelection ? "Renderer không khớp" : visualRevisionRequested ? "Đã yêu cầu chỉnh sửa" : needsRendererApproval ? "Chờ bạn duyệt" : state.hitl?.checkpoint === "VISUAL_REVIEW" && state.hitl?.status === "REVIEW_REQUIRED" ? "Chưa sẵn sàng để duyệt" : state.renderer?.phase === "AUTHORING" ? "Đang chuẩn bị bản dựng" : previewUrl ? "Studio khả dụng" : "Chưa sẵn sàng";
  const statusState = approvedVisualSource ? "approved" : stateFetchStale ? "error" : "pending";
  if (status) { status.textContent = statusText; status.dataset.state = statusState; }
  if (statusDescription) {
    statusDescription.hidden = approvedVisualSource;
    statusDescription.textContent = state.renderer && !rendererMatchesSelection ? "Đã chọn " + rendererLabel + ", nhưng dự án hiện tại dùng " + (actualRendererId || "chưa có Renderer") + ". Hãy đồng bộ lại Renderer trước khi duyệt."
      : visualRevisionRequested ? "Đã gửi yêu cầu chỉnh sửa cho agent. Bản duyệt mới sẽ xuất hiện tại đây khi sẵn sàng."
        : needsRendererApproval ? visualReviewNeedsReopen ? "Nguồn đã thay đổi sau khi mở Studio. Hãy mở lại nguồn hiện tại trước khi duyệt." : "Xem nguồn hiện tại trong Studio, sau đó yêu cầu chỉnh sửa hoặc duyệt."
          : state.renderer?.phase === "AUTHORING" ? "Agent đang chuẩn bị bản dựng để duyệt."
            : "Studio và các lựa chọn duyệt sẽ xuất hiện khi nguồn sẵn sàng.";
  }
}

// Detects a host request for edits while leaving the checkpoint unapproved.
function isRevisionRequested(state, checkpoint) {
  return state.hitl?.status === "WORKING" && state.hitl?.phase === "revision_requested" && state.hitl?.checkpoint === checkpoint;
}

function approvalButtonLabel(checkpoint) {
  return ({
    VIDEO_BRIEF: "Duyệt yêu cầu",
    RENDERER_SELECTION: "Xác nhận Renderer",
    SCRIPT: "Duyệt kịch bản",
    STORYBOARD: "Duyệt phân cảnh",
    ASSET_PREFLIGHT: "Duyệt tư liệu",
    VISUAL_REVIEW: "Duyệt bản dựng",
  })[checkpoint] || "Duyệt";
}

// Shows reviewer feedback or a request form for the active review checkpoint.
function renderRequestChangesControls(slot, checkpoint, reviewRequired, state) {
  if (!slot) return;
  const revisionRequested = isRevisionRequested(state, checkpoint);
  let panel = slot.querySelector(`[data-review-changes="${checkpoint}"]`);
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "hitl-review-changes";
    panel.dataset.reviewChanges = checkpoint;
    panel.innerHTML = `
      <div class="hitl-review-changes-form">
        <label class="hitl-review-changes-label" for="reviewChanges-${checkpoint}">Ghi chú cho lần sửa tiếp theo</label>
        <textarea id="reviewChanges-${checkpoint}" class="hitl-review-changes-input" rows="3" maxlength="4000" placeholder="Mô tả những điểm cần chỉnh trước khi duyệt."></textarea>
        <button type="button" class="btn btn-ghost hitl-review-changes-submit">Yêu cầu chỉnh sửa</button>
      </div>
      <div class="hitl-review-changes-pending" role="status" hidden></div>
    `;
    slot.appendChild(panel);
  }
  panel.hidden = !reviewRequired && !revisionRequested;
  const form = panel.querySelector(".hitl-review-changes-form");
  const textarea = panel.querySelector(".hitl-review-changes-input");
  const button = panel.querySelector(".hitl-review-changes-submit");
  const pending = panel.querySelector(".hitl-review-changes-pending");
  form.hidden = !reviewRequired;
  pending.hidden = !revisionRequested;
  if (revisionRequested) {
    const feedback = state.hitl?.payload?.reviewChange?.feedback || "Người duyệt đã yêu cầu chỉnh sửa.";
    pending.textContent = `Đã yêu cầu chỉnh sửa. Hãy cập nhật bước này rồi gửi lại để duyệt.\n${feedback}`;
  }
  button.onclick = () => submitReviewChanges(checkpoint, textarea, button);
}

// Sends host feedback to the local HITL endpoint without approving the artifact.
async function submitReviewChanges(checkpoint, textarea, button) {
  const feedback = textarea.value.trim();
  if (!feedback) { alert("Hãy mô tả nội dung cần chỉnh trước khi gửi."); return; }
  if (!confirm(`Yêu cầu chỉnh sửa bước ${checkpoint.replaceAll("_", " ")}? Thao tác này không duyệt nội dung hiện tại.`)) return;
  button.disabled = true;
  button.textContent = "ĐANG GỬI…";
  try {
    const res = await fetch("/api/hitl/request-changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkpoint, feedback }),
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || "Không gửi được yêu cầu chỉnh sửa");
    textarea.value = "";
    await fetchState();
  } catch (err) {
    alert(`Lỗi khi gửi yêu cầu chỉnh sửa: ${err.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "Yêu cầu chỉnh sửa";
  }
}

function showReviewMessage(message, isError) {
  const output = document.getElementById("reviewActionMessage");
  if (!output) return;
  output.textContent = message;
  output.dataset.kind = isError ? "error" : "info";
  output.hidden = false;
}

async function submitVisualReviewChanges(textarea, button, source, sourceIdentity) {
  const feedback = textarea.value.trim();
  if (!feedback) { textarea.setAttribute("aria-invalid", "true"); textarea.focus(); showReviewMessage("Hãy mô tả nội dung cần chỉnh trước khi gửi.", true); return; }
  if (textarea.dataset.oldSource && !document.getElementById("reviewDraftAcknowledge")?.checked) {
    showReviewMessage("Hãy xác nhận ghi chú này áp dụng cho nguồn hiện tại trước khi gửi.", true);
    return;
  }
  if (!confirm("Yêu cầu chỉnh sửa bản dựng này? Thao tác này không duyệt nguồn hiện tại.")) return;
  visualReviewMutationPending = true;
  renderStageRenderer(currentState || {});
  try {
    const res = await fetch("/api/hitl/request-changes", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({checkpoint: "VISUAL_REVIEW", feedback}),
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || "Không gửi được yêu cầu chỉnh sửa");
    visualReviewDraft = {source, identity: sourceIdentity, reviewLabel: "", value: "", acknowledgedSource: null};
    textarea.value = "";
    showReviewMessage("Đã gửi yêu cầu chỉnh sửa. Hệ thống đã ghi nhận phản hồi của bạn.", false);
    await fetchState();
  } catch (err) {
    showReviewMessage(`Không gửi được yêu cầu chỉnh sửa: ${err.message}`, true);
  } finally {
    visualReviewMutationPending = false;
    if (currentState) renderStageRenderer(currentState);
  }
}

// Stage 10: Show the final video, boundary evidence, and implementation manifest.
function renderStageFinalRender(state) {
  const playerSlot = document.getElementById("finalVideoPlayerSlot");
  const videoBadge = document.getElementById("finalVideoBadge");
  const evidenceGrid = document.getElementById("finalEvidenceGrid");
  const evidenceCount = document.getElementById("finalEvidenceCountBadge");
  const manifestBox = document.getElementById("finalManifestContentRaw");

  if (state.finalVideoExists) {
    videoBadge.textContent = state.finalizedDelivery ? "Đã kiểm tra" : "Đã render · Chờ kiểm tra";
    const manifestMatchesCurrentSource = Boolean(state.renderer?.sourceHash && state.finalManifest?.sourceHash === state.renderer.sourceHash);
    const outputHash = manifestMatchesCurrentSource ? (state.finalManifest?.output?.sha256 || state.finalManifest?.outputSha256) : null;
    const projectIdentity = state.projectState
      ? `${state.projectState.projectId || "project"}:${state.projectState.revision ?? "unknown"}:${state.projectState.projectHash || ""}`
      : "project-identity-unavailable";
    const identity = outputHash || `${state.renderer?.id || "renderer-unknown"}:${state.renderer?.sourceHash || "source-unknown"}:${projectIdentity}`;
    const mediaUrl = `/media/output/final.mp4?v=${encodeURIComponent(identity)}`;
    let player = playerSlot.querySelector("video");
    if (!player) {
      playerSlot.replaceChildren();
      player = document.createElement("video");
      player.controls = true;
      player.style.cssText = "width: 100%; max-height: 540px; background: #000; border-radius: 4px;";
      const source = document.createElement("source");
      source.src = mediaUrl;
      source.type = "video/mp4";
      player.append(source, document.createTextNode("Trình duyệt không hỗ trợ phát video này."));
      player.dataset.deliveryIdentity = identity;
      playerSlot.appendChild(player);
    } else if (player.dataset.deliveryIdentity !== identity) {
      const source = player.querySelector("source");
      player.pause();
      source.src = mediaUrl;
      player.dataset.deliveryIdentity = identity;
      player.load();
    }
  } else {
    videoBadge.textContent = "Đang chờ";
    if (playerSlot.querySelector("video") || !playerSlot.querySelector(".empty-note")) playerSlot.innerHTML = '<div class="empty-note">Video chưa được render.</div>';
  }

  const evidence = state.evidenceFiles || [];
  if (evidenceCount) evidenceCount.textContent = `${evidence.length} khung hình`;
  if (evidenceGrid) evidenceGrid.innerHTML = evidence.length
    ? evidence.map((file) => {
      const url = `/media/output/evidence/${encodeURIComponent(file)}`;
      return `<div class="evidence-card"><a href="${url}" target="_blank" rel="noopener noreferrer" title="Mở bằng chứng kích thước đầy đủ"><img src="${url}" alt="${escapeHtml(file)}" loading="lazy" width="640" height="360"></a><div class="evidence-info mono">${escapeHtml(file)}</div></div>`;
    }).join("")
    : '<div class="empty-note">Bằng chứng sẽ xuất hiện sau khi render.</div>';
  if (manifestBox) manifestBox.textContent = state.finalManifest
    ? JSON.stringify(state.finalManifest, null, 2)
    : "Thông tin kỹ thuật sẽ có sau khi hoàn tất kiểm tra và bàn giao.";
}

async function executeApproval(checkpoint, btnElement, renderer) {
  if (checkpoint === "VISUAL_REVIEW" && visualReviewNeedsReopen) {
    showReviewMessage("Nguồn duyệt đã thay đổi. Hãy mở Studio hiện tại trước khi duyệt.", false);
    if (currentState) renderStageRenderer(currentState);
    return;
  }
  const localizedAction = checkpoint === "VIDEO_BRIEF" ? `duyệt định hướng video và chọn Renderer ${renderer}`
    : checkpoint === "RENDERER_SELECTION" ? `chọn Renderer ${renderer}`
      : checkpoint === "VISUAL_REVIEW" ? "duyệt đúng nguồn đang hiển thị trong Studio"
        : checkpoint === "ASSET_PREFLIGHT" ? "duyệt dự án hiện tại và danh sách tư liệu đã kiểm tra"
          : `duyệt bước ${checkpoint.replaceAll("_", " ")}`;
  if (!confirm(`Bạn có chắc muốn ${localizedAction}?`)) return;
  if (checkpoint === "VISUAL_REVIEW") {
    visualReviewMutationPending = true;
    const message = document.getElementById("reviewActionMessage");
    if (message) message.hidden = true;
    if (currentState) renderStageRenderer(currentState);
  }
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = checkpoint === "VISUAL_REVIEW" ? "Đang duyệt…" : "Đang gửi…";
  }

  try {
    const res = await fetch("/api/hitl/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkpoint, ...(renderer ? { renderer } : {}) }),
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || "Không gửi được quyết định duyệt");
    await fetchState();
  } catch (err) {
    if (checkpoint === "VISUAL_REVIEW") showReviewMessage(`Không duyệt được nguồn này: ${err.message}`, true);
    else alert(`Lỗi khi gửi quyết định duyệt: ${err.message}`);
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = approvalButtonLabel(checkpoint);
    }
  } finally {
    if (checkpoint === "VISUAL_REVIEW") {
      visualReviewMutationPending = false;
      if (currentState) renderStageRenderer(currentState);
    }
  }
}

// Prefer the pending Storyboard only while it is under review; canonical data wins afterward.
function projectForBacklot(state) {
  const storyboardReviewPending = state.hitl?.checkpoint === "STORYBOARD"
    && (state.hitl.status === "REVIEW_REQUIRED" || (state.hitl.status === "WORKING" && state.hitl.phase === "revision_requested"));
  return storyboardReviewPending
    ? (state.storyboard || state.canonicalProject)
    : (state.canonicalProject || state.storyboard);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Studio redesign: presentation-only interactions. No backend mutations here.
function setupStudioVisualControls() {
  const cards = document.getElementById("storyboardCardsContainer");
  const grid = document.getElementById("studioStoryGrid");
  const list = document.getElementById("studioStoryList");
  function setSceneMode(mode) {
    if (!cards || !grid || !list) return;
    const isGrid = mode === "grid";
    cards.classList.toggle("studio-grid-view", isGrid);
    cards.classList.toggle("studio-list-view", !isGrid);
    grid.classList.toggle("is-selected", isGrid);
    list.classList.toggle("is-selected", !isGrid);
    grid.setAttribute("aria-pressed", String(isGrid));
    list.setAttribute("aria-pressed", String(!isGrid));
  }
  grid?.addEventListener("click", () => setSceneMode("grid"));
  list?.addEventListener("click", () => setSceneMode("list"));
}

function renderStudioScriptOutline(scriptContent, state) {
  const outline = document.getElementById("studioScriptOutline");
  const length = document.getElementById("studioScriptLength");
  const status = document.getElementById("studioScriptStatus");
  if (length) length.textContent = `${String(state.scriptText || "").length.toLocaleString("vi-VN")} ký tự`;
  if (status) status.textContent = state.scriptReview?.status ? statusLabelVi(state.scriptReview.status) : "Chưa duyệt";
  if (!outline || !scriptContent) return;
  outline.replaceChildren();
  const headings = Array.from(scriptContent.querySelectorAll("h1,h2,h3"));
  if (!headings.length) {
    const fallback = document.createElement("p");
    fallback.textContent = "Kịch bản chưa có tiêu đề phân đoạn.";
    outline.appendChild(fallback);
    return;
  }
  headings.slice(0, 24).forEach((heading, index) => {
    const anchorId = `backlot-script-section-${index}`;
    heading.id = anchorId;
    const link = document.createElement("a");
    link.href = `#${anchorId}`;
    link.textContent = heading.textContent || `Phần ${index + 1}`;
    link.addEventListener("click", event => {
      event.preventDefault();
      heading.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    outline.appendChild(link);
  });
}
