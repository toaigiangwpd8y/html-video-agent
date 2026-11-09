import test from "node:test";
import assert from "node:assert/strict";
import {mkdir, mkdtemp, copyFile, readFile, rm, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {runHyperFramesLayoutProbe} from "../src/harness/hyperframes-lint.js";
import type {HyperFramesProjectManifest} from "../src/harness/hyperframes-project.js";
import {runLint} from "../src/lint/registry.js";
import type {LintContext} from "../src/lint/types.js";

const repositoryRoot = process.cwd();

/** A real HyperFrames page with the three defects this lint exists to catch. */
function fixtureDocument(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="./vendor/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #0a0a0a; font-family: Inter, system-ui, sans-serif; }
      #root { position: relative; width: 1920px; height: 1080px; }
      .figure { position: absolute; top: 300px; width: 420px; height: 300px; background: #1e3a8a; }
      #fig-a { left: 200px; }
      #fig-b { left: 1300px; }
      .caption { position: absolute; top: 360px; left: 260px; width: 300px; font-size: 40px; color: #ffffff; }
      #cover-panel { position: absolute; top: 330px; left: 380px; width: 260px; height: 160px; background: #7f1d1d; }
      .headline { position: absolute; font-size: 48px; color: #fef08a; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="10" data-width="1920" data-height="1080">
      <div id="scene-a" data-composition-id="scene-a" class="clip" data-start="0" data-duration="10" data-track-index="0">
        <div id="fig-a" class="figure"></div>
        <div id="fig-b" class="figure"></div>
        <svg width="1920" height="1080" viewBox="0 0 1920 1080" style="position:absolute;top:0;left:0">
          <defs>
            <marker id="arrowhead" markerWidth="18" markerHeight="14" refX="16" refY="7" orient="auto">
              <polygon points="0 0, 18 7, 0 14" fill="#fbbf24" />
            </marker>
          </defs>
          <path id="flow-arrow" class="connector" d="M 300 450 L 1500 450" fill="none" stroke="#fbbf24" stroke-width="10" marker-end="url(#arrowhead)" />
        </svg>
        <p id="caption-a" class="caption" data-canonical-text-id="caption-a">Ascending curve</p>
        <div id="cover-panel"></div>
        <h2 id="headline-1" class="headline" style="top:800px;left:200px" data-canonical-text-id="headline-1">OVERLAPPING TITLE</h2>
        <h2 id="headline-2" class="headline" style="top:820px;left:340px" data-canonical-text-id="headline-2">PAINTED OVER</h2>
      </div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const timeline = gsap.timeline({ paused: true });
      timeline.fromTo("#headline-1", { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0);
      window.__timelines["main"] = timeline;
      timeline.seek(0);
    </script>
  </body>
</html>
`;
}

test("HyperFrames layout probe measures a real composition and the rules catch vendor-blind defects", async () => {
  const projectDir = await mkdtemp(resolve(repositoryRoot, "tests/.tmp-hf-lint-"));
  try {
    await mkdir(resolve(projectDir, "vendor"), {recursive: true});
    await copyFile(resolve(repositoryRoot, "remotion/node_modules/gsap/dist/gsap.min.js"), resolve(projectDir, "vendor/gsap.min.js"));
    await writeFile(resolve(projectDir, "index.html"), fixtureDocument(), "utf8");
    const manifest = {
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 300,
      scenes: [{sceneId: "scene-a", durationInFrames: 300}],
    } as unknown as HyperFramesProjectManifest;
    const probed = await runHyperFramesLayoutProbe(repositoryRoot, {projectDir, manifest, timeout: 120_000});
    assert.equal(probed.error, undefined, probed.error);
    assert.ok(probed.frames.length >= 2, "the probe must sample at least the opening and closing frames");
    const first = probed.frames[0];
    assert.equal(first.width, 1920);
    assert.deepEqual(first.scenes, ["scene-a"], "scene identity must come from the composition DOM");
    const roles = new Map(probed.frames.flatMap((frame) => frame.elements).map((element) => [element.id, element.role]));
    assert.equal(roles.get("flow-arrow"), "connector");
    assert.equal(roles.get("fig-a"), "surface");
    assert.equal(roles.get("caption-a"), "text");
    assert.equal(roles.get("headline-1"), "text");
    const firstRoles = new Map(first.elements.map((element) => [element.id, element.role]));
    assert.ok(firstRoles.has("flow-arrow"), "the connector must be measured on the opening frame");
    assert.ok(
      first.elements.every((element) => element.id.length > 0),
      "every measured element needs a non-empty identity",
    );
    const ctx: LintContext = {
      canvasWidth: 1920,
      canvasHeight: 1080,
      sceneIds: ["scene-a"],
      minFontPx: 1920 * 0.0145,
      tolerancePx: 2,
      canonicalText: ["Ascending curve", "OVERLAPPING TITLE", "PAINTED OVER"],
    };
    const report = runLint({frames: probed.frames, ctx, measurement: probed.measurement});
    assert.equal(report.status, "FAIL");
    const codes = new Set(report.issues.map((issue) => issue.code));
    assert.ok(codes.has("connector_over_node"), "the arrow crosses both figures and the caption");
    assert.ok(codes.has("object_over_text"), "the panel covers the caption");
    assert.ok(codes.has("text_overlap"), "the headlines overlap");
    assert.ok(!codes.has("copy_parity"), "every canonical string renders");
    const arrow = report.issues.find((issue) => issue.code === "connector_over_node" && issue.selectors.includes("#fig-a"));
    assert.ok(arrow, "the connector rule must report the arrow crossing the first figure");
    assert.equal(arrow!.frame, 0);
    assert.equal(arrow!.occurrences, probed.frames.length);
  } finally {
    await rm(projectDir, {recursive: true, force: true});
  }
});
