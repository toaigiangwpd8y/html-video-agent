import type { LintReport } from "./types.js";

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

/** Human summary printed by the CLI after a lint run. */
export function formatLintSummary(report: LintReport, limit = 8): string {
  const lines = [
    `Layout lint ${report.status} · ${report.measurement} · ${report.frames.length} frame(s)${report.strict ? " · strict" : ""}`,
    `Checks: ${report.checks.map((check) => `${check.code}${check.evaluated ? "" : "(not evaluated)"}=${check.issues}`).join(" ")}`,
  ];
  const coverage = [
    `${report.coverage.observedScenes.length}/${report.sceneIds.length} scenes observed`,
    report.coverage.fontsReady ? "fonts ready" : "fonts NOT ready",
    `${report.coverage.failedImages.length} unready image(s)`,
  ];
  lines.push(`Coverage: ${coverage.join(" · ")}`);
  if (report.coverage.unobservedScenes.length) lines.push(`Unobserved scenes: ${report.coverage.unobservedScenes.join(", ")}`);
  if (report.status === "NOT_EVALUATED")
    lines.push("This run cannot certify the composition; fix the coverage gaps and re-run before review.");
  const ordered = report.issues.slice().sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  for (const issue of ordered.slice(0, limit)) {
    lines.push(
      `${issue.severity.toUpperCase()} ${issue.code} · frame ${issue.frame ?? "n/a"} · ${issue.selectors.join(" + ") || "-"} · ${issue.actual}`,
    );
  }
  if (ordered.length > limit) lines.push(`… ${ordered.length - limit} more finding(s) in .video/layout-lint.json`);
  return lines.join("\n");
}
