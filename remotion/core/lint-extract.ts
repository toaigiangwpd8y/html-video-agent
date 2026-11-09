import type { LintElement, LintFrame, LintRect } from "../../src/lint/types";

/** Browser-side geometry extraction shared by every renderer probe.
 *
 * It infers roles from the rendered DOM so authored code carries no lint annotations, and honours
 * `data-layout-*` opt-outs so intentional layering stays expressible.
 */

const SKIP_TAGS: Record<string, true> = {
  script: true,
  style: true,
  link: true,
  meta: true,
  title: true,
  head: true,
  noscript: true,
  template: true,
  br: true,
  source: true,
  track: true,
  audio: true,
};

const SVG_SKIP: Record<string, true> = {
  defs: true,
  marker: true,
  clippath: true,
  symbol: true,
  mask: true,
  pattern: true,
  lineargradient: true,
  radialgradient: true,
  filter: true,
  stop: true,
};

const SVG_GEOMETRY: Record<string, true> = { path: true, line: true, polyline: true, polygon: true, circle: true, ellipse: true };

const MEDIA_TAGS: Record<string, true> = { img: true, picture: true, canvas: true, video: true };

const CONNECTOR_NAME = /(^|[^a-z])(connector|arrow|flow|link|edge|leader|pointer)([^a-z]|$)/i;

const CONNECTOR_SAMPLES = 24;

/** Alpha of a computed color string; unknown modern color spaces count as painted. */
function alphaOf(value: string): number {
  if (!value || value === "transparent" || value === "none") return 0;
  const rgb = /rgba?\(([^)]+)\)/.exec(value);
  if (!rgb) return 1;
  const parts = rgb[1].split(/[,\s/]+/).filter(Boolean);
  const alpha = parts.length >= 4 ? Number(parts[3]) : 1;
  return Number.isFinite(alpha) ? alpha : 1;
}

interface Viewport {
  origin: { x: number; y: number };
  scale: number;
}

const toRect = (rect: { x: number; y: number; width: number; height: number }, viewport: Viewport): LintRect => ({
  x: (rect.x - viewport.origin.x) * viewport.scale,
  y: (rect.y - viewport.origin.y) * viewport.scale,
  width: rect.width * viewport.scale,
  height: rect.height * viewport.scale,
});

function visibility(element: Element): { visible: boolean; opacity: number } {
  let opacity = 1;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return { visible: false, opacity: 0 };
    const own = Number(style.opacity);
    if (Number.isFinite(own)) opacity *= own;
  }
  return { visible: opacity > 0.01, opacity };
}

function selectorFor(element: Element, canvas: Element): string {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const parts: string[] = [];
  for (let node: Element | null = element; node && node !== canvas && parts.length < 4; node = node.parentElement) {
    const current = node;
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentElement ? [...current.parentElement.children].filter((child) => child.tagName === current.tagName) : [];
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag);
  }
  return parts.join(">");
}

/** Rendered text boxes of an element's whole contents, per line box. */
function glyphRuns(element: Element, viewport: Viewport): LintRect[] {
  const range = document.createRange();
  range.selectNodeContents(element);
  const runs = [...range.getClientRects()]
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => toRect(rect, viewport));
  range.detach();
  return runs;
}

function connectorGeometry(element: Element, viewport: Viewport) {
  const geometry = element as SVGGeometryElement;
  if (typeof geometry.getTotalLength !== "function" || typeof geometry.getPointAtLength !== "function") return undefined;
  const matrix = (element as SVGGraphicsElement).getScreenCTM?.();
  if (!matrix) return undefined;
  const total = geometry.getTotalLength();
  if (!Number.isFinite(total) || total <= 0) return undefined;
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index <= CONNECTOR_SAMPLES; index++) {
    const local = geometry.getPointAtLength((total * index) / CONNECTOR_SAMPLES);
    const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
    points.push({ x: (screen.x - viewport.origin.x) * viewport.scale, y: (screen.y - viewport.origin.y) * viewport.scale });
  }
  const strokeWidth = Number.parseFloat(getComputedStyle(element).strokeWidth);
  return { points, strokeWidth: Number.isFinite(strokeWidth) ? strokeWidth * viewport.scale : 0 };
}

export function extractLintFrame(input: { frame: number; timeSeconds: number; innerWidth: number; innerHeight: number }): LintFrame {
  const canvas =
    document.querySelector("[data-lint-canvas]") ??
    document.querySelector("[data-composition-id='main']") ??
    document.querySelector("[data-width][data-height]") ??
    document.body;
  const canvasBox = canvas.getBoundingClientRect();
  const declaredWidth = Number(canvas.getAttribute("data-width"));
  const canvasWidth = Number.isFinite(declaredWidth) && declaredWidth > 0 ? declaredWidth : canvasBox.width;
  const viewport: Viewport = {
    origin: { x: canvasBox.x, y: canvasBox.y },
    scale: canvasBox.width > 0 ? canvasWidth / canvasBox.width : 1,
  };
  const elements: LintElement[] = [];
  const usedIds = new Set<string>();
  const scenes = new Set<string>();
  const all = [canvas, ...Array.from(canvas.querySelectorAll("*"))];
  all.forEach((element, index) => {
    const tag = element.tagName.toLowerCase();
    if (SKIP_TAGS[tag]) return;
    if (element.namespaceURI === "http://www.w3.org/2000/svg" && SVG_SKIP[tag]) return;
    if (element.closest("defs")) return;
    const { visible, opacity } = visibility(element);
    if (!visible) return;
    const box = element.getBoundingClientRect();
    const isSvgGeometry = element.namespaceURI === "http://www.w3.org/2000/svg" && Boolean(SVG_GEOMETRY[tag]);
    if (isSvgGeometry ? box.width < 0 || box.height < 0 : box.width <= 0 || box.height <= 0) return;
    const style = getComputedStyle(element);
    const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const className = typeof element.className === "string" ? element.className : (element.className as SVGAnimatedString | null)?.baseVal ?? "";
    const nameMatches = CONNECTOR_NAME.test(`${element.id} ${className}`);
    const marked = element.hasAttribute("marker-start") || element.hasAttribute("marker-end");
    const connector = isSvgGeometry && alphaOf(style.stroke) > 0 && (marked || nameMatches) ? connectorGeometry(element, viewport) : undefined;
    const directText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()));
    const hasTextChildren = [...element.children].some((child) => Boolean(child.textContent?.trim()));
    const isText = directText || (Boolean(text) && !hasTextChildren);
    const background = alphaOf(style.backgroundColor);
    const border = Number.parseFloat(style.borderTopWidth) > 0 ? alphaOf(style.borderTopColor) : 0;
    const painted = background >= 0.9 || border >= 0.9 || (Boolean(style.boxShadow) && style.boxShadow !== "none");
    const role: LintElement["role"] = connector
      ? "connector"
      : MEDIA_TAGS[tag]
        ? "image"
        : isText
          ? "text"
          : element.namespaceURI === "http://www.w3.org/2000/svg"
            ? "shape"
            : painted
              ? "surface"
              : "decoration";
    const sceneMarker = element.closest("[data-scene-id]");
    const compositionMarker = element.closest("[data-composition-id]");
    const compositionId = compositionMarker?.getAttribute("data-composition-id") ?? undefined;
    const sceneId = sceneMarker?.getAttribute("data-scene-id") ?? (compositionId && compositionId !== "main" ? compositionId : undefined);
    if (sceneId) scenes.add(sceneId);
    const baseId = element.getAttribute("data-lint-id") || element.id || element.getAttribute("data-canonical-text-id") || element.getAttribute("data-canonical-caption-id") || sceneId || `el-${index}`;
    const id = usedIds.has(baseId) ? `${baseId}-${index}` : baseId;
    usedIds.add(id);
    const runs = role === "text" ? glyphRuns(element, viewport) : undefined;
    const rawRect = toRect(box, viewport);
    const rect =
      connector && (rawRect.width === 0 || rawRect.height === 0)
        ? {
            x: rawRect.x - connector.strokeWidth / 2,
            y: rawRect.y - connector.strokeWidth / 2,
            width: rawRect.width + connector.strokeWidth,
            height: rawRect.height + connector.strokeWidth,
          }
        : rawRect;
    const clipped =
      (style.overflow !== "visible" || style.overflowX !== "visible" || style.overflowY !== "visible") &&
      (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1);
    const fontSizePx = Number.parseFloat(style.fontSize);
    elements.push({
      id,
      selector: selectorFor(element, canvas),
      ...(sceneId ? { sceneId } : {}),
      ...(element.parentElement?.closest("[data-lint-id],[id]") ? { parentId: element.parentElement.closest("[data-lint-id],[id]")!.getAttribute("data-lint-id") ?? element.parentElement.closest("[data-lint-id],[id]")!.id } : {}),
      role,
      rect,
      ...(runs?.length ? { fragments: runs } : {}),
      ...(connector ? { connector } : {}),
      opaque: role === "image" || role === "shape" || role === "connector" || painted,
      opacity,
      order: index,
      zIndex: Number.parseInt(style.zIndex) || 0,
      clipped,
      ...(role === "text" && Number.isFinite(fontSizePx) ? { fontSizePx: fontSizePx * viewport.scale } : {}),
      ...(text ? { text } : {}),
      allowOverlap: element.hasAttribute("data-layout-allow-overlap"),
      allowOcclusion: element.hasAttribute("data-layout-allow-occlusion"),
      allowConnectorOverlap: element.hasAttribute("data-layout-allow-connector-overlap"),
      allowOverflow: element.hasAttribute("data-layout-allow-overflow") || element.hasAttribute("data-layout-bleed"),
      ignored: element.hasAttribute("data-layout-ignore") || element.hasAttribute("data-lint-ignore"),
    });
  });
  const images = [...document.querySelectorAll("img")] as HTMLImageElement[];
  return {
    frame: input.frame,
    timeSeconds: input.timeSeconds,
    width: canvasWidth,
    height: Number.isFinite(Number(canvas.getAttribute("data-height"))) && Number(canvas.getAttribute("data-height")) > 0 ? Number(canvas.getAttribute("data-height")) : canvasBox.height,
    scenes: [...scenes],
    elements,
    resources: {
      fontsReady: document.fonts.status === "loaded",
      failedImages: images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.currentSrc || image.src || "<unnamed image>"),
    },
  };
}
