import { coveredFraction, intersectionArea, paintOrder, sharesTree } from "../geometry.js";
import type { LayoutIssue, LintElement, LintFrame, LintRect, LintRule } from "../types.js";
import { elementsById, sceneIdsOf, textRects } from "./support.js";

/** Minimum share of a text run that must be covered before it counts as occluded. */
const COVERED_FRACTION_FLOOR = 0.05;

function findOcclusions(frame: LintFrame, tolerancePx: number): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const byId = elementsById(frame);
  const texts = frame.elements.filter((element) => element.role === "text" && element.rect && !element.ignored && element.opacity > 0);
  const covers = frame.elements.filter(
    (element): element is LintElement & { rect: LintRect } =>
      Boolean(element.rect) && element.opaque && !element.ignored && element.opacity > 0.9 && element.role !== "connector",
  );
  for (const text of texts) {
    for (const cover of covers) {
      if (text.allowOcclusion || cover.allowOcclusion) continue;
      if (paintOrder(cover) <= paintOrder(text)) continue;
      if (sharesTree(byId, cover.id, text.id)) continue;
      if (text.sceneId && cover.sceneId && text.sceneId !== cover.sceneId) continue;
      const covered = textRects(text).filter(
        (run) => coveredFraction(run, cover.rect) >= COVERED_FRACTION_FLOOR && intersectionArea(run, cover.rect) > tolerancePx * tolerancePx,
      );
      if (!covered.length) continue;
      const share = Math.max(...covered.map((run) => coveredFraction(run, cover.rect)));
      issues.push({
        code: "object_over_text",
        severity: "error",
        frame: frame.frame,
        timeSeconds: frame.timeSeconds,
        sceneIds: sceneIdsOf(text, cover),
        elementIds: [text.id, cover.id],
        selectors: [text.selector, cover.selector],
        message: `${cover.selector} is painted over text in ${text.selector}.`,
        expected: "text painted above the surfaces it sits on",
        actual: `${Math.round(share * 100)}% of a text run is covered`,
        rects: [...covered, cover.rect],
        fixHint: "Raise the text's stacking order, give it its own zone, or mark intentional layering with data-layout-allow-occlusion.",
      });
    }
  }
  return issues;
}

/** An opaque element painted after text, covering part of that text. */
const rule: LintRule = {
  code: "object_over_text",
  title: "Object painted over text",
  severity: "error",
  applicable: (frame) => frame.elements.some((element) => element.role === "text" && Boolean(element.rect)),
  evaluate: (frame, ctx) => findOcclusions(frame, ctx.tolerancePx),
};

export default rule;
