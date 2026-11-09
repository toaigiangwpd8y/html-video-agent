import type { LayoutIssue, LintContext, LintFrame, LintRule } from "../types.js";
import { normalizeCopy } from "./support.js";

function findMissingCopy(frames: LintFrame[], ctx: LintContext): LayoutIssue[] {
  const rendered = frames
    .flatMap((frame) => frame.elements.filter((element) => element.role === "text" && element.rect).map((element) => normalizeCopy(element.text ?? "")))
    .filter(Boolean);
  const haystack = ` ${rendered.join(" ")} `;
  const issues: LayoutIssue[] = [];
  for (const canonical of ctx.canonicalText) {
    const needle = normalizeCopy(canonical);
    if (!needle || haystack.includes(needle)) continue;
    issues.push({
      code: "copy_parity",
      severity: "warning",
      frame: null,
      sceneIds: [],
      elementIds: [],
      selectors: [],
      message: `Canonical copy "${needle.slice(0, 80)}" never renders in the sampled frames.`,
      expected: "every canonical screen text is visible at some sampled frame",
      actual: "text absent from every sampled frame",
      fixHint: "Render the canonical string, and make sure its reveal has finished by a sampled frame.",
    });
  }
  return issues;
}

/** Canonical video.json copy that never appears in the rendered DOM. */
const rule: LintRule = {
  code: "copy_parity",
  title: "Canonical copy missing from the render",
  severity: "warning",
  applicable: (frame) => frame.elements.some((element) => element.role === "text"),
  evaluate: () => [],
  evaluateAll: (frames, ctx) => findMissingCopy(frames, ctx),
};

export default rule;
