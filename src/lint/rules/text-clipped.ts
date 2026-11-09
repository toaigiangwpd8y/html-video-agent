import type { LayoutIssue, LintFrame, LintRule } from "../types.js";
import { normalizeCopy, sceneIdsOf } from "./support.js";

function findClipped(frame: LintFrame): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (const element of frame.elements) {
    if (element.role !== "text" || !element.clipped || element.ignored || element.allowOverflow || element.opacity <= 0) continue;
    issues.push({
      code: "text_clipped",
      severity: "error",
      frame: frame.frame,
      timeSeconds: frame.timeSeconds,
      sceneIds: sceneIdsOf(element),
      elementIds: [element.id],
      selectors: [element.selector],
      message: `${element.selector} clips its own copy.`,
      expected: "text fits inside its box without clipping",
      actual: `"${normalizeCopy(element.text ?? "").slice(0, 80)}" overflows the element box`,
      ...(element.rect ? { rects: [element.rect] } : {}),
      fixHint: "Grow the box, reduce the copy, or let the text wrap; mark intentional bleed with data-layout-allow-overflow.",
    });
  }
  return issues;
}

/** Text overflowing a box that clips it. */
const rule: LintRule = {
  code: "text_clipped",
  title: "Clipped text",
  severity: "error",
  applicable: (frame) => frame.elements.some((element) => element.role === "text"),
  evaluate: (frame) => findClipped(frame),
};

export default rule;
