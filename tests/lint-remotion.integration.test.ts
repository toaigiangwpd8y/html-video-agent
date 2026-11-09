import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdir,mkdtemp,readFile,rm,symlink,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {readJson, writeJson} from "../src/core/io.js";
import type {VideoProject} from "../src/core/types.js";
import {clarificationTemplate, commitClarification} from "../src/harness/clarification.js";
import {approveVideoBrief, commitVideoBrief, videoBriefTemplate} from "../src/harness/preproduction-hitl.js";
import {commitProductionProfile, productionProfileHash, productionProfileTemplate} from "../src/harness/production-profile.js";
import {createProjectState} from "../src/harness/project-state.js";
import {approveProductionAssetPreflight, runProductionAssetPreflight} from "../src/harness/production-preflight-hitl.js";
import {snapshotApprovedAssets} from "../src/harness/hyperframes-project.js";
import {runRemotionLint} from "../src/harness/remotion-lint.js";
import {reviewSelectedRenderer} from "../src/harness/renderer.js";
import type {LintRect, LintReport} from "../src/lint/types.js";

/** Union area of two axis-aligned rects; used to prove the finding rests on measured geometry. */
function intersectionArea(a: LintRect, b: LintRect): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

interface ProjectStateBinding {
  projectId: string;
  revision: number;
  projectHash: string;
}

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const VIDEO_SOURCE = [
  'import React from "react";',
  'import {AbsoluteFill,useCurrentFrame} from "remotion";',
  'import {PanelHandoff,RiseIn} from "../presets/editorial-motion";',
  'const SceneA=()=> <div data-scene-id="scene-a" style={{position:"absolute",inset:0}}>',
  '  <div style={{position:"absolute",left:80,top:80,width:260,height:70,fontSize:28,lineHeight:"32px",color:"#111111",whiteSpace:"nowrap"}}>Alpha headline</div>',
  '  <div style={{position:"absolute",left:180,top:90,width:260,height:70,fontSize:28,lineHeight:"32px",color:"#333333",whiteSpace:"nowrap"}}>Beta headline</div>',
  '</div>;',
  'const SceneB=()=> <div data-scene-id="scene-b" style={{position:"absolute",inset:0}}>',
  '  <div style={{position:"absolute",left:80,top:80,width:260,height:70,fontSize:28,lineHeight:"32px",color:"#111111",whiteSpace:"nowrap"}}>Beta headline</div>',
  '  <PanelHandoff startFrame={30} handoffFrame={45} endFrame={59} from={{left:100,top:85,width:200,height:50}} to={{left:100,top:85,width:200,height:50}} content={<div style={{width:"100%",height:"100%",background:"#101010"}}/>}/>',
  '</div>;',
  'const SceneC=()=> <div data-scene-id="scene-c" style={{position:"absolute",inset:0}}>',
  '  <RiseIn startFrame={60} distance={10}><div style={{position:"absolute",left:80,top:150,width:420,height:70,fontSize:28,lineHeight:"32px",color:"#111111",whiteSpace:"nowrap"}}>Gamma headline</div></RiseIn>',
  '</div>;',
  'export const GeneratedVideo:React.FC<{project:any;assetManifest:any}>=()=>{',
  '  const frame=useCurrentFrame();',
  '  const scene=frame<30?"a":frame<60?"b":"c";',
  '  return <AbsoluteFill style={{background:"#ffffff"}}>{scene==="a"?<SceneA/>:scene==="b"?<SceneB/>:<SceneC/>}</AbsoluteFill>;',
  '};',
].join("\n");

interface RemotionFixture {
  fixture: string;
  project: VideoProject;
  cleanup(): Promise<void>;
}

/** Builds an isolated, prepared Remotion project whose scenes carry deliberate layout defects. */
async function buildRemotionFixture(): Promise<RemotionFixture> {
  const root = process.cwd();
  const fixture = await mkdtemp(resolve(root, "remotion/.tmp-lint-fixture-"));
  const previousBrowser = process.env.REMOTION_BROWSER_EXECUTABLE;
  try {
    const project: VideoProject = {
      meta: {title: "Layout lint fixture", width: 640, height: 360, durationsInFrames: 90, fps: 30, theme: {palette: ["#ffffff", "#222222"], font: "Arial"}, constraints: {style: "fixture", disallowed: [], motionTone: "steady"}},
      scenes: [
        {id: "scene-a", durationInFrames: 30, screenText: "Alpha headline", visualConcept: "two overlapping text blocks"},
        {id: "scene-b", durationInFrames: 30, screenText: "Beta headline", visualConcept: "an opaque box painted over text"},
        {id: "scene-c", durationInFrames: 30, screenText: "Gamma headline", visualConcept: "clean single text block"},
      ],
    };
    for (const dir of [".video/candidates", "assets", "remotion/generated", "remotion/public", "remotion/scripts", "remotion/qa", "remotion/core", "remotion/presets", ".agents/skills/remotion-best-practices", ".agents/skills/remotion-create", ".agents/skills/agent-video/references", ".agents/skills/video-types/neutral"]) await mkdir(resolve(fixture, dir), {recursive: true});
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await symlink(resolve(root, "remotion/node_modules"), resolve(fixture, "remotion/node_modules"), linkType);
    await symlink(resolve(root, "node_modules"), resolve(fixture, "node_modules"), linkType);

    await writeJson(resolve(fixture, "video.json"), project);
    await writeJson(resolve(fixture, "assets/manifest.json"), {version: "1", assets: []});
    await writeFile(resolve(fixture, ".video/request.txt"), "isolated deterministic layout lint fixture");
    await createProjectState(fixture, project);
    if (!process.env.REMOTION_BROWSER_EXECUTABLE && !process.env.CHROME_PATH && existsSync("/opt/brave-bin/brave")) process.env.REMOTION_BROWSER_EXECUTABLE = "/opt/brave-bin/brave";
    // Renderer availability contract so the preproduction bindings can select Remotion.
    await writeJson(resolve(fixture, "remotion/package.json"), {
      type: "module",
      dependencies: {remotion: JSON.parse(await readFile(resolve(root, "remotion/package.json"), "utf8")).dependencies.remotion},
      scripts: {typecheck: "node scripts/typecheck-fixture.mjs", still: "node scripts/still-fixture.mjs ../output/preview.png"},
    });
    await writeFile(resolve(fixture, "remotion/AUTHORING.md"), "# Remotion authoring fixture\n");
    await writeFile(resolve(fixture, "remotion/scripts/loopback-only.mjs"), "// loopback guard fixture\n");
    await writeFile(resolve(fixture, "remotion/scripts/typecheck-fixture.mjs"), "process.exit(0);\n");
    await writeFile(resolve(fixture, "remotion/scripts/still-fixture.mjs"), `import {mkdirSync,writeFileSync} from "node:fs";mkdirSync("../output",{recursive:true});writeFileSync("../output/preview.png",Buffer.from("${ONE_PIXEL_PNG.toString("base64")}","base64"));\n`);

    // Preproduction bindings required to freeze a production profile.
    await writeFile(resolve(fixture, ".agents/skills/remotion-best-practices/SKILL.md"), "# Official Remotion router fixture\n");
    await writeFile(resolve(fixture, ".agents/skills/remotion-create/SKILL.md"), "# Official Remotion skill fixture\n");
    await writeFile(resolve(fixture, ".agents/skills/agent-video/references/remotion-handoff.md"), "# Remotion handoff fixture\n");
    await writeFile(resolve(fixture, ".agents/skills/video-types/catalog.json"), JSON.stringify({version: "1", profiles: [{id: "neutral", description: "neutral fixture"}]}));
    await writeFile(resolve(fixture, ".agents/skills/video-types/neutral/SKILL.md"), "# Neutral fixture\n\n## Renderer Guidance\n\nNeutral layout guidance for the isolated fixture.\n");
    await writeJson(resolve(fixture, "skills-lock.json"), {skills: {"remotion-best-practices": {source: "remotion-dev/skills"}, "remotion-create": {source: "remotion-dev/skills"}}});
    const clarification = await clarificationTemplate(fixture);
    clarification.decisions = [{...clarification.decisions[0], value: "Validate deterministic layout lint", source: "CONTEXT_INFERRED", confidence: 1, reason: "This isolated fixture exists to validate layout lint behavior."}];
    await writeJson(resolve(fixture, ".video/candidates/clarification.json"), clarification);
    await commitClarification(fixture, ".video/candidates/clarification.json");
    const briefTemplate = await videoBriefTemplate(fixture);
    const brief = {...briefTemplate, objective: "Validate deterministic layout lint", audience: "Test harness", durationSeconds: 3, aspectRatio: "16:9", language: "English", angle: "Pipeline fixture", tone: "Neutral", pacing: "Steady", mustInclude: [], mustAvoid: [], sourceNotes: [], rendererRecommendation: {renderer: "remotion" as const, rationale: "The fixture exercises the Remotion Player layout lint probe.", alternativeTradeoff: "HyperFrames is not installed in this isolated fixture."}};
    await writeJson(resolve(fixture, ".video/candidates/brief.json"), brief);
    await commitVideoBrief(fixture, ".video/candidates/brief.json");
    await approveVideoBrief(fixture, "HUMAN", "remotion", "Fixture selects Remotion for the layout lint probe.");
    const profile = await productionProfileTemplate(fixture);
    profile.primary = {id: "neutral", source: "MODEL_INFERRED", reason: "The approved fixture brief has no specialized objective."};
    await writeJson(resolve(fixture, ".video/candidates/profile.json"), profile);
    await commitProductionProfile(fixture, ".video/candidates/profile.json");

    // Renderer inputs the lint gate revalidates before sampling.
    const state = await readJson<ProjectStateBinding>(resolve(fixture, ".video/project-state.json"));
    await writeJson(resolve(fixture, ".video/remotion-state.json"), {
      version: "1", renderer: "remotion", phase: "AUTHORING", projectId: state.projectId, revision: state.revision,
      projectHash: state.projectHash, productionProfileHash: await productionProfileHash(fixture),
      assetManifestHash: (await snapshotApprovedAssets(fixture, {version: "1", assets: []})).hash, updatedAt: new Date().toISOString(),
    });
    await writeJson(resolve(fixture, "remotion/generated/project.json"), project);
    await writeJson(resolve(fixture, "remotion/generated/asset-manifest.json"), {version: "1", assets: []});
    await writeJson(resolve(fixture, "remotion/generated/timeline.json"), {version: "3", fps: 30, durationInFrames: 90, scenes: [{sceneId: "scene-a", startFrame: 0, endFrame: 30}, {sceneId: "scene-b", startFrame: 30, endFrame: 60}, {sceneId: "scene-c", startFrame: 60, endFrame: 90}]});
    await writeFile(resolve(fixture, "remotion/generated/Video.tsx"), VIDEO_SOURCE);
    await writeFile(resolve(fixture, "remotion/presets/editorial-motion.tsx"), await readFile(resolve(root, "remotion/presets/editorial-motion.tsx"), "utf8"));
    await writeFile(resolve(fixture, "remotion/qa/player-entry.tsx"), await readFile(resolve(root, "remotion/qa/player-entry.tsx"), "utf8"));
    await writeFile(resolve(fixture, "remotion/core/lint-extract.ts"), await readFile(resolve(root, "remotion/core/lint-extract.ts"), "utf8"));
    await writeFile(resolve(fixture, "remotion/scripts/run-layout-probe.mjs"), await readFile(resolve(root, "remotion/scripts/run-layout-probe.mjs"), "utf8"));
    return {
      fixture,
      project,
      async cleanup() {
        if (previousBrowser === undefined) delete process.env.REMOTION_BROWSER_EXECUTABLE;
        else process.env.REMOTION_BROWSER_EXECUTABLE = previousBrowser;
        await rm(fixture, {recursive: true, force: true});
      },
    };
  } catch (error) {
    await rm(fixture, {recursive: true, force: true});
    throw error;
  }
}

function runCli(root: string, args: string[]): Promise<{code: number | null; stdout: string; stderr: string}> {
  const {promise, resolve: resolveRun, reject} = Promise.withResolvers<{code: number | null; stdout: string; stderr: string}>();
  const child = spawn(process.execPath, [resolve(process.cwd(), "dist/src/cli.js"), ...args], {cwd: root, stdio: ["ignore", "pipe", "pipe"]});
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  child.on("error", reject);
  child.on("close", (code: number | null) => resolveRun({code, stdout, stderr}));
  return promise;
}

test("layout lint measures real Player DOM geometry and flags overlap and occlusion", {timeout: 240000}, async () => {
  const {fixture, cleanup} = await buildRemotionFixture();
  try {
    const {report, summary} = await runRemotionLint(fixture, {timeout: 180000});
    assert.equal(report.measurement, "remotion-player-dom");
    assert.ok(report.frames.length >= 3, summary);

    const overlap = report.issues.find((issue) => issue.code === "text_overlap");
    if (!overlap) throw new Error(`expected a text_overlap finding\n${summary}`);
    assert.ok(overlap.sceneIds.includes("scene-a"), `overlap must localize to scene-a: ${JSON.stringify(overlap.sceneIds)}`);
    assert.match(overlap.actual, /px²/);
    if (!overlap.rects || overlap.rects.length < 2) throw new Error("overlap finding must carry the measured text rects");
    assert.ok(intersectionArea(overlap.rects[0], overlap.rects[1]) > 0, "overlap rects must genuinely intersect");

    const occlusion = report.issues.find((issue) => issue.code === "object_over_text");
    if (!occlusion) throw new Error(`expected an object_over_text finding\n${summary}`);
    assert.ok(occlusion.sceneIds.includes("scene-b"));
    assert.ok(occlusion.rects?.some((rect) => Math.abs(rect.x - 100) < 2 && Math.abs(rect.y - 85) < 2 && Math.abs(rect.width - 200) < 2 && Math.abs(rect.height - 50) < 3), `the measured helper overlay rectangle must remain in overlap findings: ${JSON.stringify(occlusion.rects)}`);
    assert.ok(occlusion.frame !== null && occlusion.frame >= 30 && occlusion.frame <= 59, "the helper overlay overlap must be measured inside its active frame window");
    assert.match(occlusion.actual, /% of a text run is covered/);
    if (!occlusion.rects || occlusion.rects.length < 2) throw new Error("occlusion finding must carry the measured text and cover rects");
    assert.ok(intersectionArea(occlusion.rects[0], occlusion.rects[1]) > 0, "occlusion rects must genuinely intersect");

    assert.ok(!report.issues.some((issue) => (issue.code === "text_overlap" || issue.code === "object_over_text") && issue.sceneIds.includes("scene-c")), "the clean scene must not be flagged");
    assert.equal(report.status, "FAIL");

    const persisted = await readJson<LintReport>(resolve(fixture, ".video/layout-lint.json"));
    assert.equal(persisted.measurement, "remotion-player-dom");
    assert.ok(persisted.frames.length >= 3);
  } finally {
    await cleanup();
  }
});

test("renderer check exits non-zero on findings and passes for a focused clean scene", {timeout: 300000}, async () => {
  const {fixture, cleanup} = await buildRemotionFixture();
  try {
    await runProductionAssetPreflight(fixture);
    await approveProductionAssetPreflight(fixture);

    const failing = await runCli(fixture, ["renderer", "check"]);
    assert.equal(failing.code, 1, `expected a non-zero check exit\n${failing.stdout}\n${failing.stderr}`);
    const report = await readJson<LintReport>(resolve(fixture, ".video/layout-lint.json"));
    assert.equal(report.status, "FAIL");
    assert.ok(report.issues.some((issue) => issue.code === "text_overlap" && issue.selectors.length === 2));

    const focused = await runCli(fixture, ["renderer", "check", "--scene", "scene-c"]);
    assert.equal(focused.code, 0, `a clean focused scene must pass\n${focused.stdout}\n${focused.stderr}`);
    const focusedReport = await readJson<LintReport>(resolve(fixture, ".video/layout-lint.json"));
    assert.equal(focusedReport.status, "PASS");
    assert.deepEqual(focusedReport.sceneIds, ["scene-c"]);
    assert.ok(focusedReport.frames.every((frame: number) => frame >= 60 && frame <= 89), `focused frames stay inside scene-c: ${JSON.stringify(focusedReport.frames)}`);

    // A focused PASS cannot substitute for the full review gate.
    await assert.rejects(()=>reviewSelectedRenderer(fixture), /layout lint is FAIL/);
    await writeFile(resolve(fixture,"remotion/generated/Video.tsx"),VIDEO_SOURCE.replaceAll('data-scene-id="scene-c"','data-scene-id="unobserved"'));
    await assert.rejects(()=>reviewSelectedRenderer(fixture,{sceneId:"scene-c"}), /layout lint is NOT_EVALUATED/);
  } finally {
    await cleanup();
  }
});
