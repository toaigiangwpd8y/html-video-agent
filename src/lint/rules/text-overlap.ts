import { intersectionArea, sharesTree } from "../geometry.js";
import type { LayoutIssue, LintFrame, LintRect, LintRule } from "../types.js";
import { elementsById, sceneIdsOf, textRects } from "./support.js";

function findOverlaps(frame: LintFrame, tolerancePx: number): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const byId = elementsById(frame);
  const texts = frame.elements.filter(
    (element) => element.role === "text" && element.rect && !element.ignored && !element.allowOverlap && element.opacity > 0,
  );
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const [a, b] = [texts[i], texts[j]];
      if (a.sceneId && b.sceneId && a.sceneId !== b.sceneId) continue;
      if (sharesTree(byId, a.id, b.id)) continue;
      const pairs: { left: LintRect; right: LintRect; area: number }[] = [];
      for (const left of textRects(a)) {
        for (const right of textRects(b)) {
          const area = intersectionArea(left, right);
          if (area > tolerancePx * tolerancePx) pairs.push({ left, right, area });
        }
      }
      if (!pairs.length) continue;
      const area = pairs.reduce((sum, pair) => sum + pair.area, 0);
      issues.push({
        code: "text_overlap",
        severity: "error",
        frame: frame.frame,
        timeSeconds: frame.timeSeconds,
        sceneIds: sceneIdsOf(a, b),
        elementIds: [a.id, b.id],
        selectors: [a.selector, b.selector],
        message: `Text from ${a.selector} and ${b.selector} renders on top of itself.`,
        expected: "text runs separated by at least the tolerance",
        actual: `${Math.round(area)}px² of overlapping text`,
        rects: [...pairs.map((pair) => pair.left), ...pairs.map((pair) => pair.right)],
        fixHint: "Give each block its own zone, or mark intentional layering with data-layout-allow-overlap.",
      });
    }
  }
  return issues;
}

/** Two text blocks whose glyph boxes overlap. */
const rule: LintRule = {
  code: "text_overlap",
  title: "Overlapping text blocks",
  severity: "error",
  applicable: (frame) => frame.elements.some((element) => element.role === "text" && Boolean(element.rect)),
  evaluate: (frame, ctx) => findOverlaps(frame, ctx.tolerancePx),
};

export default rule;
