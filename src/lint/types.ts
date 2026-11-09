/** Renderer-neutral layout lint contract.
 *
 * Probes convert a renderer's rendered DOM into `LintFrame`s; rules are pure functions over those
 * frames. Adding a check means adding one module under `src/lint/rules/` and one registry entry in
 * `src/lint/rules/index.ts` — nothing else in the harness changes.
 */

export interface LintRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a rendered element is, inferred from the DOM (no authoring annotations required). */
export type LintRole = "text" | "image" | "shape" | "connector" | "surface" | "decoration" | "unknown";

export interface LintConnector {
  /** Canvas-relative centreline samples in path order (start → end). */
  points: { x: number; y: number }[];
  strokeWidth: number;
}

export interface LintElement {
  /** Stable identity for findings; unique inside one frame. */
  id: string;
  /** CSS selector an author can act on. */
  selector: string;
  sceneId?: string;
  parentId?: string;
  role: LintRole;
  /** Canvas-relative box; null when the element is not visible.
   *  A canvas-relative box inside the frame bounds is normal; `fragments` refine text geometry. */
  rect: LintRect | null;
  /** Canvas-relative client rects of this element's own text runs. */
  fragments?: LintRect[];
  connector?: LintConnector;
  /** Paints something that can hide what is behind it (raster, opaque background/border, SVG fill). */
  opaque: boolean;
  /** Effective opacity through the ancestor chain. */
  opacity: number;
  /** Document order index. */
  order: number;
  /** Computed z-index; `auto` is reported as 0. */
  zIndex: number;
  /** Text overflows a clipping box. */
  clipped: boolean;
  fontSizePx?: number;
  text?: string;
  allowOverlap: boolean;
  allowOcclusion: boolean;
  allowConnectorOverlap: boolean;
  allowOverflow: boolean;
  /** `data-layout-ignore`: never audited. */
  ignored: boolean;
}

export interface LintFrame {
  frame: number;
  timeSeconds: number;
  width: number;
  height: number;
  /** Scene ids observed in this frame. */
  scenes: string[];
  elements: LintElement[];
  resources: { fontsReady: boolean; failedImages: string[] };
}

export interface LintContext {
  canvasWidth: number;
  canvasHeight: number;
  /** Canonical scene ids that must all be observed by the sampled frames. */
  sceneIds: string[];
  /** Minimum legible rendered font size for this canvas. */
  minFontPx: number;
  tolerancePx: number;
  /** Canonical `video.json` copy that must be visible somewhere in the composition. */
  canonicalText: string[];
}

export interface LayoutIssue {
  code: string;
  severity: "error" | "warning" | "info";
  /** First frame the issue was observed at; null for cross-frame issues. */
  frame: number | null;
  timeSeconds?: number;
  sceneIds: string[];
  elementIds: string[];
  selectors: string[];
  message: string;
  expected: string;
  actual: string;
  rects?: LintRect[];
  fixHint?: string;
  /** How many sampled frames reproduced this issue. */
  occurrences?: number;
}

export interface LintRule {
  code: string;
  title: string;
  severity: "error" | "warning" | "info";
  /** False when a frame lacks the evidence this rule needs; unevaluated checks never read as clean. */
  applicable(frame: LintFrame): boolean;
  evaluate(frame: LintFrame, ctx: LintContext): LayoutIssue[];
  /** Cross-frame rules (copy parity, coverage) run once over every sampled frame. */
  evaluateAll?(frames: LintFrame[], ctx: LintContext): LayoutIssue[];
}

export interface LintCheckSummary {
  code: string;
  title: string;
  evaluated: boolean;
  issues: number;
}

export interface LintReport {
  version: "1";
  status: "PASS" | "FAIL" | "NOT_EVALUATED";
  strict: boolean;
  frames: number[];
  sceneIds: string[];
  issues: LayoutIssue[];
  checks: LintCheckSummary[];
  coverage: {
    observedScenes: string[];
    unobservedScenes: string[];
    fontsReady: boolean;
    failedImages: string[];
  };
  measurement: string;
}
