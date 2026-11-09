import type { LayoutIssue, LintCheckSummary, LintContext, LintFrame, LintReport, LintRule } from "./types.js";
import { lintRules } from "./rules/index.js";

const issueKey = (issue: LayoutIssue): string =>
  [issue.code, issue.elementIds.slice().sort().join(","), issue.sceneIds.slice().sort().join(",")].join("|");

/** One issue per distinct defect, with the number of sampled frames that reproduced it. */
function collapse(issues: LayoutIssue[]): LayoutIssue[] {
  const byKey = new Map<string, LayoutIssue>();
  for (const issue of issues) {
    const key = issueKey(issue);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...issue, occurrences: issue.occurrences ?? 1 });
      continue;
    }
    existing.occurrences = (existing.occurrences ?? 1) + 1;
    if (issue.frame !== null && (existing.frame === null || issue.frame < existing.frame)) existing.frame = issue.frame;
  }
  return [...byKey.values()].sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0) || a.code.localeCompare(b.code));
}

export function runLint(input: {
  frames: LintFrame[];
  ctx: LintContext;
  rules?: LintRule[];
  strict?: boolean;
  measurement: string;
}): LintReport {
  const rules = input.rules ?? lintRules;
  const raw: LayoutIssue[] = [];
  const checks: LintCheckSummary[] = [];
  for (const rule of rules) {
    const applicable = input.frames.filter((frame) => rule.applicable(frame));
    for (const frame of applicable) raw.push(...rule.evaluate(frame, input.ctx));
    if (rule.evaluateAll && applicable.length) raw.push(...rule.evaluateAll(input.frames, input.ctx));
    checks.push({ code: rule.code, title: rule.title, evaluated: applicable.length > 0, issues: 0 });
  }
  const issues = collapse(raw).map((issue) =>
    input.strict && issue.severity === "warning" ? { ...issue, severity: "error" as const } : issue,
  );
  for (const check of checks) check.issues = issues.filter((issue) => issue.code === check.code).length;
  const observedScenes = [...new Set(input.frames.flatMap((frame) => frame.scenes))].sort();
  const unobservedScenes = input.ctx.sceneIds.filter((sceneId) => !observedScenes.includes(sceneId));
  const evaluated = checks.some((check) => check.evaluated);
  const failed = issues.some((issue) => issue.severity === "error");
  const status: LintReport["status"] = !input.frames.length || !evaluated || unobservedScenes.length ? "NOT_EVALUATED" : failed ? "FAIL" : "PASS";
  return {
    version: "1",
    status,
    strict: input.strict ?? false,
    frames: input.frames.map((frame) => frame.frame).sort((a, b) => a - b),
    sceneIds: input.ctx.sceneIds,
    issues,
    checks,
    coverage: {
      observedScenes,
      unobservedScenes,
      fontsReady: input.frames.every((frame) => frame.resources.fontsReady),
      failedImages: [...new Set(input.frames.flatMap((frame) => frame.resources.failedImages))],
    },
    measurement: input.measurement,
  };
}
