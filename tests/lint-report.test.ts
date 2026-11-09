import test from "node:test";
import assert from "node:assert/strict";
import {planHyperFramesLintFrames} from "../src/harness/hyperframes-lint.js";
import type {HyperFramesProjectManifest} from "../src/harness/hyperframes-project.js";
import {mergeLintReports} from "../src/lint/merge.js";
import {formatLintSummary} from "../src/lint/report.js";
import type {LayoutIssue, LintReport} from "../src/lint/types.js";

const issue = (overrides: Partial<LayoutIssue> & {code: string}): LayoutIssue => ({
  severity: "error",
  frame: 0,
  sceneIds: ["a"],
  elementIds: ["#one"],
  selectors: ["#one"],
  message: "message",
  expected: "expected",
  actual: "actual",
  ...overrides,
});

const report = (overrides: Partial<LintReport> = {}): LintReport => ({
  version: "1",
  status: "PASS",
  strict: false,
  frames: [0],
  sceneIds: ["a"],
  issues: [],
  checks: [{code: "text_overlap", title: "Overlapping text blocks", evaluated: true, issues: 0}],
  coverage: {observedScenes: ["a"], unobservedScenes: [], fontsReady: true, failedImages: []},
  measurement: "unit",
  ...overrides,
});

test("mergeLintReports keeps the worst status and de-duplicates identical findings", () => {
  const shared = issue({code: "text_occluded", severity: "warning", selectors: ["#a"], elementIds: ["#a"], sceneIds: ["a"]});
  const merged = mergeLintReports([
    report({status: "PASS", issues: [shared], measurement: "hyperframes-cli"}),
    report({status: "NOT_EVALUATED", issues: [{...shared}], measurement: "hyperframes-preview-dom"}),
  ]);
  assert.equal(merged.status, "NOT_EVALUATED");
  assert.equal(merged.issues.length, 1);
  assert.equal(merged.measurement, "hyperframes-cli+hyperframes-preview-dom");
  const failing = mergeLintReports([report({status: "NOT_EVALUATED"}), report({status: "PASS", issues: [issue({code: "out_of_frame"})]})]);
  assert.equal(failing.status, "FAIL");
});

test("mergeLintReports escalates warnings only in strict mode and unions coverage", () => {
  const warning = issue({code: "text_too_small", severity: "warning"});
  assert.equal(mergeLintReports([report({issues: [warning]})]).status, "PASS");
  const strict = mergeLintReports([report({issues: [warning]})], true);
  assert.equal(strict.status, "FAIL");
  assert.equal(strict.issues[0].severity, "error");
  const merged = mergeLintReports([
    report({coverage: {observedScenes: ["a"], unobservedScenes: ["b"], fontsReady: true, failedImages: []}}),
    report({coverage: {observedScenes: ["b"], unobservedScenes: [], fontsReady: false, failedImages: ["/assets/x.png"]}}),
  ]);
  assert.deepEqual(merged.coverage.observedScenes, ["a", "b"]);
  assert.deepEqual(merged.coverage.unobservedScenes, ["b"]);
  assert.equal(merged.coverage.fontsReady, false);
  assert.deepEqual(merged.coverage.failedImages, ["/assets/x.png"]);
});

test("planHyperFramesLintFrames samples every scene and can focus one", () => {
  const manifest = {
    fps: 30,
    durationInFrames: 120,
    scenes: [
      {sceneId: "a", durationInFrames: 40},
      {sceneId: "b", durationInFrames: 50},
      {sceneId: "c", durationInFrames: 30},
    ],
  } as unknown as HyperFramesProjectManifest;
  const all = planHyperFramesLintFrames(manifest);
  assert.deepEqual(all.map((entry) => entry.frame), [0, 20, 39, 40, 65, 89, 90, 105, 119]);
  assert.equal(all[1].timeSeconds, 20 / 30);
  const focused = planHyperFramesLintFrames(manifest, "b");
  assert.deepEqual(focused.map((entry) => entry.frame), [0, 40, 65, 89, 119]);
});

test("formatLintSummary states the verdict, coverage, and top findings", () => {
  const summary = formatLintSummary(
    report({
      status: "FAIL",
      measurement: "remotion-player-dom",
      issues: [issue({code: "connector_over_node", selectors: ["#arrow", "#fig-a"], actual: "path runs 150px inside the node box"})],
    }),
  );
  assert.match(summary, /Layout lint FAIL · remotion-player-dom · 1 frame\(s\)/);
  assert.match(summary, /1\/1 scenes observed/);
  assert.match(summary, /ERROR connector_over_node · frame 0 · #arrow \+ #fig-a · path runs 150px inside the node box/);
});
