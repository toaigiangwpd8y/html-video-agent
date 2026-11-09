import type { LayoutIssue, LintFrame, LintRule } from "../types.js";
import { normalizeCopy, sceneIdsOf } from "./support.js";

function findSmallCopy(frame: LintFrame, minFontPx: number): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (const element of frame.elements) {
    if (element.role !== "text" || element.ignored || element.opacity <= 0) continue;
    if (element.fontSizePx === undefined || element.fontSizePx <= 0) continue;
    if (!normalizeCopy(element.text ?? "")) continue;
    if (element.fontSizePx >= minFontPx) continue;
    issues.push({
      code: "text_too_small",
      severity: "warning",
      frame: frame.frame,
      timeSeconds: frame.timeSeconds,
      sceneIds: sceneIdsOf(element),
      elementIds: [element.id],
      selectors: [element.selector],
      message: `${element.selector} renders below the legibility floor.`,
      expected: `rendered font size ≥ ${Math.round(minFontPx)}px for a ${frame.width}px-wide canvas`,
      actual: `${Math.round(element.fontSizePx * 10) / 10}px`,
      ...(element.rect ? { rects: [element.rect] } : {}),
      fixHint: "Raise the font size or scale the composition; keep teaching labels legible on a phone.",
    });
  }
  return issues;
}

/** Copy below the canvas legibility floor. */
const rule: LintRule = {
  code: "text_too_small",
  title: "Copy below the legibility floor",
  severity: "warning",
  applicable: (frame) => frame.elements.some((element) => element.role === "text" && element.fontSizePx !== undefined),
  evaluate: (frame, ctx) => findSmallCopy(frame, ctx.minFontPx),
};

export default rule;
