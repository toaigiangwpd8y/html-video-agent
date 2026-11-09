import type { LayoutIssue, LintElement, LintFrame, LintRect, LintRule } from "../types.js";
import { sceneIdsOf } from "./support.js";

const isContent = (element: LintElement): element is LintElement & { rect: LintRect } =>
  Boolean(element.rect) &&
  !element.ignored &&
  !element.allowOverflow &&
  element.opacity > 0 &&
  (element.role === "text" || element.role === "image" || element.role === "shape");

function findBreaches(frame: LintFrame, tolerancePx: number): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (const element of frame.elements.filter(isContent)) {
    const rect = element.rect;
    const breach = Math.max(-rect.x, -rect.y, rect.x + rect.width - frame.width, rect.y + rect.height - frame.height);
    if (breach <= tolerancePx) continue;
    issues.push({
      code: "out_of_frame",
      severity: "error",
      frame: frame.frame,
      timeSeconds: frame.timeSeconds,
      sceneIds: sceneIdsOf(element),
      elementIds: [element.id],
      selectors: [element.selector],
      message: `${element.selector} renders outside the composition canvas.`,
      expected: `box inside ${frame.width}x${frame.height} with ${tolerancePx}px tolerance`,
      actual: `${Math.round(breach)}px beyond the canvas edge`,
      rects: [rect],
      fixHint: "Move the element inside the safe frame, or size it so entrance travel stays within the canvas.",
    });
  }
  return issues;
}

/** Text or media breaching the composition canvas. */
const rule: LintRule = {
  code: "out_of_frame",
  title: "Content outside the canvas",
  severity: "error",
  applicable: (frame) => frame.elements.some((element) => Boolean(element.rect)),
  evaluate: (frame, ctx) => findBreaches(frame, ctx.tolerancePx),
};

export default rule;
