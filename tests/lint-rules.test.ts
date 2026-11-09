import test from "node:test";
import assert from "node:assert/strict";
import { runLint } from "../src/lint/registry.js";
import assetNotReady from "../src/lint/rules/asset-not-ready.js";
import connectorOverNode from "../src/lint/rules/connector-over-node.js";
import copyParity from "../src/lint/rules/copy-parity.js";
import objectOverText from "../src/lint/rules/object-over-text.js";
import outOfFrame from "../src/lint/rules/out-of-frame.js";
import textClipped from "../src/lint/rules/text-clipped.js";
import textOverlap from "../src/lint/rules/text-overlap.js";
import textTooSmall from "../src/lint/rules/text-too-small.js";
import type { LintContext, LintElement, LintFrame, LintRule } from "../src/lint/types.js";

const CONTEXT: LintContext = {
  canvasWidth: 1920,
  canvasHeight: 1080,
  sceneIds: ["a"],
  minFontPx: 1920 * 0.0145,
  tolerancePx: 2,
  canonicalText: [],
};

function element(overrides: Partial<LintElement> & { id: string }): LintElement {
  return {
    selector: `#${overrides.id}`,
    role: "text",
    rect: { x: 0, y: 0, width: 200, height: 40 },
    opaque: false,
    opacity: 1,
    order: 0,
    zIndex: 0,
    clipped: false,
    allowOverlap: false,
    allowOcclusion: false,
    allowConnectorOverlap: false,
    allowOverflow: false,
    ignored: false,
    ...overrides,
  };
}

function frameOf(elements: LintElement[], overrides: Partial<LintFrame> = {}): LintFrame {
  return {
    frame: 0,
    timeSeconds: 0,
    width: 1920,
    height: 1080,
    scenes: ["a"],
    elements,
    resources: { fontsReady: true, failedImages: [] },
    ...overrides,
  };
}

function codesFor(rule: LintRule, frames: LintFrame[], ctx: Partial<LintContext> = {}): string[] {
  const report = runLint({ frames, ctx: { ...CONTEXT, ...ctx }, rules: [rule], measurement: "unit" });
  return report.issues.map((issue) => `${issue.code}:${issue.selectors.join("+")}`);
}

test("text_overlap flags intersecting text runs but not nests or opt-outs", () => {
  const left = element({ id: "left", rect: { x: 0, y: 0, width: 200, height: 60 } });
  const right = element({ id: "right", rect: { x: 150, y: 20, width: 200, height: 60 } });
  assert.deepEqual(codesFor(textOverlap, [frameOf([left, right])]), ["text_overlap:#left+#right"]);
  const far = element({ id: "far", rect: { x: 900, y: 300, width: 200, height: 60 } });
  assert.deepEqual(codesFor(textOverlap, [frameOf([left, far])]), []);
  const nested = element({ id: "nested", parentId: "left", rect: { x: 10, y: 10, width: 100, height: 30 } });
  assert.deepEqual(codesFor(textOverlap, [frameOf([left, nested])]), []);
  const siblingA = element({ id: "sib-a", parentId: "stage", rect: { x: 0, y: 0, width: 200, height: 60 } });
  const siblingB = element({ id: "sib-b", parentId: "stage", rect: { x: 150, y: 20, width: 200, height: 60 } });
  assert.deepEqual(codesFor(textOverlap, [frameOf([siblingA, siblingB])]), ["text_overlap:#sib-a+#sib-b"]);
  const waived = element({ id: "waived", allowOverlap: true, rect: { x: 150, y: 20, width: 200, height: 60 } });
  assert.deepEqual(codesFor(textOverlap, [frameOf([left, waived])]), []);
});

test("object_over_text only flags surfaces painted above the text", () => {
  const text = element({ id: "caption", order: 1, rect: { x: 0, y: 0, width: 200, height: 40 } });
  const cover = element({ id: "panel", role: "surface", opaque: true, order: 5, rect: { x: 50, y: 0, width: 200, height: 100 } });
  assert.deepEqual(codesFor(objectOverText, [frameOf([text, cover])]), ["object_over_text:#caption+#panel"]);
  const behind = element({ id: "behind", role: "surface", opaque: true, order: 0, rect: { x: 50, y: 0, width: 200, height: 100 } });
  assert.deepEqual(codesFor(objectOverText, [frameOf([text, behind])]), []);
  const wrap = element({ id: "wrap", role: "surface", opaque: true, order: 9, rect: { x: -20, y: -20, width: 400, height: 200 } });
  const wrapped = element({ id: "wrapped-text", parentId: "wrap", order: 1, rect: { x: 0, y: 0, width: 200, height: 40 } });
  assert.deepEqual(codesFor(objectOverText, [frameOf([wrapped, wrap])]), []);
  const waivedCover = element({
    id: "scrim",
    role: "surface",
    opaque: true,
    order: 5,
    allowOcclusion: true,
    rect: { x: 50, y: 0, width: 200, height: 100 },
  });
  assert.deepEqual(codesFor(objectOverText, [frameOf([text, waivedCover])]), []);
});

test("connector_over_node flags a shaft or arrowhead drawn inside a node box", () => {
  const node = element({ id: "fig-a", role: "surface", opaque: true, rect: { x: 400, y: 300, width: 420, height: 300 } });
  const crossing = element({
    id: "arrow",
    role: "connector",
    connector: { points: [{ x: 100, y: 450 }, { x: 500, y: 450 }, { x: 900, y: 450 }], strokeWidth: 10 },
  });
  assert.deepEqual(codesFor(connectorOverNode, [frameOf([node, crossing])]), ["connector_over_node:#arrow+#fig-a"]);
  const touching = element({
    id: "touching",
    role: "connector",
    connector: { points: [{ x: 100, y: 300 }, { x: 300, y: 300 }, { x: 400, y: 300 }], strokeWidth: 10 },
  });
  assert.deepEqual(codesFor(connectorOverNode, [frameOf([node, touching])]), []);
  const waived = element({
    id: "waived",
    role: "connector",
    allowConnectorOverlap: true,
    connector: { points: [{ x: 500, y: 450 }], strokeWidth: 10 },
  });
  assert.deepEqual(codesFor(connectorOverNode, [frameOf([node, waived])]), []);
  const child = element({ id: "inner", parentId: "arrow", role: "shape", opaque: true, rect: { x: 480, y: 440, width: 60, height: 60 } });
  assert.deepEqual(codesFor(connectorOverNode, [frameOf([crossing, child])]), []);
});

test("out_of_frame flags breaches, not full-bleed layers", () => {
  const breach = element({ id: "offscreen", rect: { x: 1900, y: 0, width: 100, height: 50 } });
  assert.deepEqual(codesFor(outOfFrame, [frameOf([breach])]), ["out_of_frame:#offscreen"]);
  const full = element({ id: "stage", role: "surface", rect: { x: 0, y: 0, width: 1920, height: 1080 } });
  assert.deepEqual(codesFor(outOfFrame, [frameOf([full])]), []);
  const oversized = element({id: "oversized", role: "image", rect: {x: -100, y: -100, width: 2120, height: 1280}});
  assert.deepEqual(codesFor(outOfFrame, [frameOf([oversized])]), ["out_of_frame:#oversized"]);
});

test("out_of_frame permits explicitly annotated travel without hiding other defects", () => {
  const travel = element({id: "travel", allowOverflow: true, rect: {x: -30, y: 20, width: 200, height: 40}});
  const accident = element({id: "accident", rect: {x: 1900, y: 0, width: 100, height: 50}});
  assert.deepEqual(codesFor(outOfFrame, [frameOf([travel, accident])]), ["out_of_frame:#accident"]);
  assert.deepEqual(codesFor(textOverlap, [frameOf([travel, element({id: "title", rect: {x: 0, y: 20, width: 200, height: 40}})])]), ["text_overlap:#travel+#title"]);
});

test("text_clipped and text_too_small respect their opt-outs and floors", () => {
  const clipped = element({ id: "clip", clipped: true, text: "A long line that does not fit" });
  assert.deepEqual(codesFor(textClipped, [frameOf([clipped])]), ["text_clipped:#clip"]);
  const bleed = element({ id: "bleed", clipped: true, allowOverflow: true, text: "A long line" });
  assert.deepEqual(codesFor(textClipped, [frameOf([bleed])]), []);
  const tiny = element({ id: "tiny", fontSizePx: 12, text: "label" });
  assert.deepEqual(codesFor(textTooSmall, [frameOf([tiny])]), ["text_too_small:#tiny"]);
  const legible = element({ id: "legible", fontSizePx: 40, text: "label" });
  assert.deepEqual(codesFor(textTooSmall, [frameOf([legible])]), []);
});

test("asset_not_ready reports unready fonts and broken images", () => {
  const broken = element({ id: "shot", role: "image", rect: { x: 0, y: 0, width: 400, height: 300 } });
  const frame = frameOf([broken], { resources: { fontsReady: false, failedImages: ["/assets/hero.png"] } });
  assert.deepEqual(codesFor(assetNotReady, [frame]).sort(), ["asset_not_ready:", "asset_not_ready:/assets/hero.png"]);
});

test("copy_parity unions rendered text across frames", () => {
  const first = frameOf([element({ id: "one", text: "Revenue grew" })], { frame: 0 });
  const second = frameOf([element({ id: "two", text: "by 40 percent" })], { frame: 30 });
  assert.deepEqual(codesFor(copyParity, [first, second], { canonicalText: ["Revenue grew by 40 percent"] }), []);
  assert.deepEqual(codesFor(copyParity, [first, second], { canonicalText: ["Profit fell"] }), ["copy_parity:"]);
});

test("runLint reports NOT_EVALUATED for unobserved scenes and collapses repeated frames", () => {
  const overlapped = frameOf(
    [
      element({ id: "left", rect: { x: 0, y: 0, width: 200, height: 60 } }),
      element({ id: "right", rect: { x: 150, y: 20, width: 200, height: 60 } }),
    ],
    { frame: 12 },
  );
  const repeat = { ...overlapped, frame: 24 };
  const report = runLint({ frames: [overlapped, repeat], ctx: CONTEXT, rules: [textOverlap], measurement: "unit" });
  assert.equal(report.status, "FAIL");
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].occurrences, 2);
  assert.equal(report.issues[0].frame, 12);
  const uncovered = runLint({
    frames: [{ ...overlapped, scenes: [] }],
    ctx: { ...CONTEXT, sceneIds: ["a", "b"] },
    rules: [textOverlap],
    measurement: "unit",
  });
  assert.equal(uncovered.status, "NOT_EVALUATED");
  assert.deepEqual(uncovered.coverage.unobservedScenes, ["a", "b"]);
  const strict = runLint({
    frames: [frameOf([element({ id: "tiny", fontSizePx: 12, text: "label" })])],
    ctx: CONTEXT,
    rules: [textTooSmall],
    measurement: "unit",
    strict: true,
  });
  assert.equal(strict.status, "FAIL");
  assert.equal(strict.issues[0].severity, "error");
});
