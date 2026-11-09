/** HyperFrames → layout-lint finding adapter.
 *
 * The pinned HyperFrames CLI (`hyperframes@0.8.50`) already audits a rendered composition in a real
 * browser and emits a structured JSON envelope (`check --json`). This module normalizes that envelope
 * into the renderer-neutral `LayoutIssue`/`LintCheckSummary` contract so HyperFrames findings can be
 * merged with the harness rules and the Remotion probe into one report.
 *
 * The vendor keeps ownership of what it does well: finding codes, severities, selectors, messages and
 * fix hints are copied verbatim. The harness only re-frames them: seconds → frames, `rect` → canvas
 * `LintRect`, and a short invariant per code so `--json` reports read the same for both renderers.
 */

import type { LayoutIssue, LintCheckSummary, LintRect } from "./types.js";

export interface HyperFramesNormalizeOptions {
  fps: number;
  /** Composition canvas width in CSS px. HyperFrames already reports canvas-relative rects. */
  width: number;
  /** Composition canvas height in CSS px. */
  height: number;
}

export interface HyperFramesNormalizedReport {
  issues: LayoutIssue[];
  checks: LintCheckSummary[];
  status: "PASS" | "FAIL" | "NOT_EVALUATED";
}

const SECTIONS = ["lint", "runtime", "layout", "motion", "contrast"] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_TITLES: Record<Section, string> = {
  lint: "HyperFrames lint",
  runtime: "HyperFrames runtime",
  layout: "HyperFrames layout",
  motion: "HyperFrames motion",
  contrast: "HyperFrames contrast",
};

/** Short invariant per vendor code; findings carry the vendor message as `actual` instead. */
const EXPECTED_BY_CODE: Record<string, string> = {
  text_occluded: "text painted above the surfaces it sits on",
  content_overlap: "text runs separated by at least the tolerance",
  canvas_overflow: "content inside its container and the canvas",
  text_box_overflow: "content inside its container and the canvas",
  container_overflow: "content inside its container and the canvas",
  clipped_text: "text fits inside its box",
  connector_detached: "connector endpoints anchored to their nodes",
  connector_orphan: "connector endpoints anchored to their nodes",
  text_not_painted: "glyphs painted with a visible fill",
  sweep_static: "geometry changes across the sampled sweep",
  panel_out_of_canvas: "painted elements inside the canvas frame",
  escaped_container: "painted elements inside the canvas frame",
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const severityOf = (value: unknown): LayoutIssue["severity"] =>
  value === "error" || value === "warning" || value === "info" ? value : "warning";

/** Canvas rects the vendor reports as `{left,top,right,bottom,width,height}`. */
function rectsOf(rect: Record<string, unknown> | undefined): LintRect[] {
  if (!rect) return [];
  const x = finiteNumber(rect.left);
  const y = finiteNumber(rect.top);
  const width = finiteNumber(rect.width);
  const height = finiteNumber(rect.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return [];
  if (width <= 0 && height <= 0) return [];
  return [{ x, y, width, height }];
}

/** Scene attribution from the finding's own DOM attributes; `main` is the canvas root, not a scene. */
function sceneIdsOf(dataAttributes: unknown): string[] {
  const attributes = asRecord(dataAttributes);
  if (!attributes) return [];
  return [
    ...new Set(
      [attributes["data-composition-id"], attributes["data-scene-id"]].filter(
        (value): value is string => typeof value === "string" && value.length > 0 && value !== "main",
      ),
    ),
  ];
}

function mapFinding(section: Section, raw: unknown, fps: number): LayoutIssue | undefined {
  const finding = asRecord(raw);
  if (!finding) return undefined;
  const code = nonEmptyString(finding.code) ?? `${section}_finding`;
  const selector = nonEmptyString(finding.selector);
  const containerSelector = nonEmptyString(finding.containerSelector);
  const message = nonEmptyString(finding.message) ?? code;
  const time = finiteNumber(finding.time);
  const fixHint = nonEmptyString(finding.fixHint);
  const occurrences = finiteNumber(finding.occurrences);

  const issue: LayoutIssue = {
    code,
    severity: severityOf(finding.severity),
    frame: time === undefined ? null : Math.round(time * fps),
    sceneIds: sceneIdsOf(finding.dataAttributes),
    elementIds: selector ? [selector] : [],
    selectors: [...(selector ? [selector] : []), ...(containerSelector ? [containerSelector] : [])],
    message,
    expected: EXPECTED_BY_CODE[code] ?? "no layout finding",
    actual: message,
  };
  if (time !== undefined) issue.timeSeconds = time;
  const rects = rectsOf(asRecord(finding.rect));
  if (rects.length) issue.rects = rects;
  if (fixHint) issue.fixHint = fixHint;
  if (occurrences !== undefined) issue.occurrences = occurrences;
  return issue;
}

/** Normalizes a `hyperframes check --json` envelope into the shared lint contract. */
export function normalizeHyperFramesReport(
  report: unknown,
  options: HyperFramesNormalizeOptions,
): HyperFramesNormalizedReport {
  const root = asRecord(report) ?? {};
  const browserSkipped = root.browserSkipped === true;
  const layout = asRecord(root.layout);
  const samples = layout && Array.isArray(layout.samples) ? layout.samples : undefined;
  const samplesEmpty = !samples || samples.length === 0;
  const truncated = layout?.truncated === true;

  const issues: LayoutIssue[] = [];
  const checks: LintCheckSummary[] = [];
  for (const section of SECTIONS) {
    const payload = asRecord(root[section]);
    const findings = payload && Array.isArray(payload.findings) ? payload.findings : [];
    const mapped: LayoutIssue[] = [];
    for (const finding of findings) {
      const issue = mapFinding(section, finding, options.fps);
      if (issue) mapped.push(issue);
    }
    issues.push(...mapped);
    const enabled =
      section === "motion" ? payload?.enabled === true : section === "contrast" ? payload?.enabled === true : payload !== undefined;
    const evaluated = !browserSkipped && (!samplesEmpty || section !== "layout") && enabled;
    checks.push({ code: section, title: SECTION_TITLES[section], evaluated, issues: mapped.length });
  }

  const status: HyperFramesNormalizedReport["status"] =
    browserSkipped || truncated || samplesEmpty ? "NOT_EVALUATED" : issues.some((issue) => issue.severity === "error") ? "FAIL" : "PASS";
  return { issues, checks, status };
}
