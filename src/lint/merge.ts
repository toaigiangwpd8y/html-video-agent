import type { LayoutIssue, LintReport } from "./types.js";

const issueKey = (issue: LayoutIssue): string =>
  [issue.code, issue.selectors.slice().sort().join(","), issue.sceneIds.slice().sort().join(","), issue.frame ?? "-"].join("|");

const STATUS_ORDER: Record<LintReport["status"], number> = { PASS: 0, NOT_EVALUATED: 1, FAIL: 2 };

/** Combine renderer-native findings with the harness rule engine into one report and one exit signal. */
export function mergeLintReports(reports: LintReport[], strict = false): LintReport {
  const seen = new Set<string>();
  const issues: LayoutIssue[] = [];
  for (const issue of reports.flatMap((report) => report.issues)) {
    const key = issueKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(strict && issue.severity === "warning" ? { ...issue, severity: "error" } : issue);
  }
  const order: ("PASS" | "NOT_EVALUATED" | "FAIL")[] = ["PASS", "NOT_EVALUATED", "FAIL"];
  const failed = issues.some((issue) => issue.severity === "error");
  const base = reports.reduce((worst, report) => (STATUS_ORDER[report.status] > STATUS_ORDER[worst] ? report.status : worst), "PASS" as LintReport["status"]);
  const status: LintReport["status"] = failed ? "FAIL" : order.includes(base) ? base : "PASS";
  const first = reports[0];
  return {
    version: "1",
    status,
    strict,
    frames: [...new Set(reports.flatMap((report) => report.frames))].sort((a, b) => a - b),
    sceneIds: [...new Set(reports.flatMap((report) => report.sceneIds))].sort(),
    issues,
    checks: reports.flatMap((report) => report.checks),
    coverage: {
      observedScenes: [...new Set(reports.flatMap((report) => report.coverage.observedScenes))].sort(),
      unobservedScenes: [...new Set(reports.flatMap((report) => report.coverage.unobservedScenes))].sort(),
      fontsReady: reports.every((report) => report.coverage.fontsReady),
      failedImages: [...new Set(reports.flatMap((report) => report.coverage.failedImages))],
    },
    measurement: [...new Set(reports.map((report) => report.measurement).filter(Boolean))].join("+") || first?.measurement || "none",
  };
}
