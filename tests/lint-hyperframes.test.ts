import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHyperFramesReport } from "../src/lint/hyperframes.js";

const OPTIONS = { fps: 30, width: 1920, height: 1080 };

function envelope(): Record<string, unknown> {
  return {
    ok: false,
    strict: false,
    lint: { ok: true, errorCount: 0, warningCount: 0, infoCount: 0, findings: [], filesScanned: 1 },
    runtime: { ok: true, errorCount: 0, warningCount: 0, infoCount: 0, findings: [] },
    layout: {
      ok: false,
      errorCount: 2,
      warningCount: 1,
      infoCount: 0,
      findings: [
        {
          code: "content_overlap",
          severity: "error",
          time: 0.5,
          selector: "#headline-1",
          containerSelector: "#headline-2",
          message: "Two text blocks overlap and may render unreadable.",
          rect: { left: 200, top: 800, right: 688, bottom: 859, width: 488, height: 59 },
          fixHint: "Give each block its own zone.",
          dataAttributes: { "data-hf-id": "hf-iz6u", "data-scene-id": "scene-a" },
          firstSeen: 0.5,
          lastSeen: 9.875,
          occurrences: 87,
          heldMs: 9750,
        },
        {
          code: "text_occluded",
          severity: "error",
          time: 0.556,
          selector: "#caption-a",
          containerSelector: "#cover-panel",
          message: "Text is hidden beneath an opaque element.",
          rect: { left: 260, top: 360, right: 460, bottom: 458, width: 200, height: 98 },
          coveredFraction: 0.22,
          fixHint: "Raise its stacking order.",
          dataAttributes: { "data-composition-id": "main" },
        },
        {
          code: "canvas_overflow",
          severity: "warning",
          time: 1,
          selector: "#box",
          message: "Element extends past the canvas edge.",
          rect: { left: 1900, top: 0, right: 2100, bottom: 100, width: 200, height: 100 },
          dataAttributes: {},
        },
      ],
      duration: 10,
      samples: [0.556, 1.667, 2.778],
      tolerance: 2,
      totalIssueCount: 3,
      truncated: false,
    },
    motion: {
      ok: false,
      errorCount: 1,
      warningCount: 0,
      infoCount: 0,
      findings: [
        {
          code: "sweep_static",
          severity: "error",
          selector: "[data-composition-id]",
          message: "Timeline did not advance under seek.",
          rect: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
        },
      ],
      enabled: true,
      samples: 0,
    },
    contrast: { ok: true, errorCount: 0, warningCount: 0, infoCount: 0, findings: [], enabled: false, checked: 0, passed: 0, samples: [] },
    browserSkipped: false,
  };
}

test("normalizeHyperFramesReport maps vendor findings into the shared contract", () => {
  const { issues, checks, status } = normalizeHyperFramesReport(envelope(), OPTIONS);
  const byCode = new Map(issues.map((issue) => [issue.code, issue]));

  assert.equal(status, "FAIL");
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ["content_overlap", "text_occluded", "canvas_overflow", "sweep_static"],
  );

  const overlap = byCode.get("content_overlap")!;
  assert.equal(overlap.severity, "error");
  assert.equal(overlap.frame, 15);
  assert.equal(overlap.timeSeconds, 0.5);
  assert.deepEqual(overlap.rects, [{ x: 200, y: 800, width: 488, height: 59 }]);
  assert.deepEqual(overlap.selectors, ["#headline-1", "#headline-2"]);
  assert.deepEqual(overlap.elementIds, ["#headline-1"]);
  assert.deepEqual(overlap.sceneIds, ["scene-a"]);
  assert.equal(overlap.expected, "text runs separated by at least the tolerance");
  assert.equal(overlap.actual, "Two text blocks overlap and may render unreadable.");
  assert.equal(overlap.fixHint, "Give each block its own zone.");
  assert.equal(overlap.occurrences, 87);

  const occluded = byCode.get("text_occluded")!;
  assert.equal(occluded.frame, 17);
  assert.equal(occluded.expected, "text painted above the surfaces it sits on");
  assert.deepEqual(occluded.sceneIds, [], "the canvas root data-composition-id='main' is not a scene");

  const overflow = byCode.get("canvas_overflow")!;
  assert.equal(overflow.severity, "warning");
  assert.equal(overflow.frame, 30);
  assert.equal(overflow.expected, "content inside its container and the canvas");
  assert.deepEqual(overflow.rects, [{ x: 1900, y: 0, width: 200, height: 100 }]);

  const motion = byCode.get("sweep_static")!;
  assert.equal(motion.frame, null, "motion findings without a time have no frame");
  assert.equal(motion.timeSeconds, undefined);
  assert.equal(motion.rects, undefined, "zero-size rects are dropped");
  assert.equal(motion.expected, "geometry changes across the sampled sweep");

  assert.deepEqual(
    checks.map((check) => [check.code, check.evaluated, check.issues]),
    [
      ["lint", true, 0],
      ["runtime", true, 0],
      ["layout", true, 3],
      ["motion", true, 1],
      ["contrast", false, 0],
    ],
  );
});

test("a skipped browser can never read as clean", () => {
  const skipped = { ...envelope(), browserSkipped: true };
  const { issues, checks, status } = normalizeHyperFramesReport(skipped, OPTIONS);
  assert.equal(status, "NOT_EVALUATED");
  assert.ok(issues.length > 0);
  assert.deepEqual(
    checks.map((check) => check.evaluated),
    [false, false, false, false, false],
  );
});

test("a truncated sweep and missing samples are NOT_EVALUATED", () => {
  const truncated = envelope();
  (truncated.layout as Record<string, unknown>).truncated = true;
  assert.equal(normalizeHyperFramesReport(truncated, OPTIONS).status, "NOT_EVALUATED");

  const noSamples = envelope();
  delete (noSamples.layout as Record<string, unknown>).samples;
  const empty = normalizeHyperFramesReport(noSamples, OPTIONS);
  assert.equal(empty.status, "NOT_EVALUATED");
  assert.equal(empty.checks.find((check) => check.code === "layout")?.evaluated, false);
});

test("a clean envelope passes and an unknown report is unevaluated", () => {
  const clean = envelope();
  for (const section of ["lint", "runtime", "layout", "motion", "contrast"]) {
    (clean[section] as Record<string, unknown>).findings = [];
  }
  assert.equal(normalizeHyperFramesReport(clean, OPTIONS).status, "PASS");

  const unknown = normalizeHyperFramesReport(undefined, OPTIONS);
  assert.equal(unknown.status, "NOT_EVALUATED");
  assert.deepEqual(unknown.issues, []);
  assert.ok(unknown.checks.every((check) => !check.evaluated));
});
