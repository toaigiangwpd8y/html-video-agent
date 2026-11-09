import type { LayoutIssue, LintFrame, LintRule } from "../types.js";

function findUnready(frame: LintFrame): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  if (!frame.resources.fontsReady) {
    issues.push({
      code: "asset_not_ready",
      severity: "error",
      frame: frame.frame,
      timeSeconds: frame.timeSeconds,
      sceneIds: [],
      elementIds: [],
      selectors: [],
      message: "Document fonts were not ready when geometry was measured.",
      expected: "document.fonts.status === \"loaded\" before measuring",
      actual: "fonts still loading",
      fixHint: "Register fonts through the harness font assets so blocks render with the intended face.",
    });
  }
  for (const image of frame.resources.failedImages) {
    issues.push({
      code: "asset_not_ready",
      severity: "error",
      frame: frame.frame,
      timeSeconds: frame.timeSeconds,
      sceneIds: [],
      elementIds: [image],
      selectors: [image],
      message: `Image ${image} failed to decode.`,
      expected: "every rendered image decodes with a non-zero natural size",
      actual: "missing or broken image",
      fixHint: "Materialize the asset through the asset registry and reference its public path.",
    });
  }
  return issues;
}

/** Fonts or images that were not ready when geometry was read. */
const rule: LintRule = {
  code: "asset_not_ready",
  title: "Unready fonts or images",
  severity: "error",
  applicable: () => true,
  evaluate: (frame) => findUnready(frame),
};

export default rule;
