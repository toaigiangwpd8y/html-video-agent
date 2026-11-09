import {spawn} from "node:child_process";
import {resolve} from "node:path";
import {readJson, writeJson} from "../core/io.js";
import type {VideoProject} from "../core/types.js";
import type {LintContext, LintFrame, LintReport} from "../lint/types.js";
import {runLint} from "../lint/registry.js";
import {formatLintSummary} from "../lint/report.js";
import {requireFile} from "./fs.js";
import {harnessPaths} from "./paths.js";
import {plannedBoundaryEvidence} from "./remotion-evidence.js";
import {validateRemotionTimeline, type RemotionTimelineEvidence} from "./remotion-timeline.js";
import {assertRemotionInputsFresh, readRemotionState} from "./remotion.js";

/** Probe measurement tag; every report produced here is browser-measured Player DOM geometry. */
const MEASUREMENT = "remotion-player-dom";

export interface RemotionLintOptions {
  /** Restrict sampling to one canonical scene id. */
  sceneId?: string;
  /** Promote warnings to errors in the report. */
  strict?: boolean;
  /** Milliseconds before the probe child process is killed. */
  timeout?: number;
}

interface ProbeJob {
  frames: number[];
  fps: number;
  entryPoint: string;
  publicDir: string;
  width: number;
  height: number;
}

interface ProbeResult {
  ok: boolean;
  frames: LintFrame[];
  timings: {bundleMs: number; totalMs: number};
  browserExecutable: string;
  measurement: string;
}

/** Frames to sample: scene starts, midpoints, endpoints, boundary topology, and the video extents. */
function planSampleFrames(timeline: RemotionTimelineEvidence, project: VideoProject, sceneId?: string): number[] {
  const last = Math.max(0, timeline.durationInFrames - 1);
  const wanted = new Set<number>([0, last]);
  for (const scene of timeline.scenes) {
    wanted.add(scene.startFrame);
    wanted.add(scene.endFrame - 1);
    wanted.add(Math.floor((scene.startFrame + scene.endFrame - 1) / 2));
  }
  for (const boundary of plannedBoundaryEvidence(timeline, project)) for (const frame of boundary.frames) wanted.add(frame);
  let frames = [...wanted].filter((frame) => frame >= 0 && frame <= last);
  if (sceneId) {
    const scene = timeline.scenes.find((candidate) => candidate.sceneId === sceneId);
    if (!scene) throw new Error(`Scene '${sceneId}' is not present in the resolved Remotion timeline.`);
    frames = frames.filter((frame) => frame >= scene.startFrame && frame <= scene.endFrame - 1);
    if (!frames.length) frames = [Math.floor((scene.startFrame + scene.endFrame - 1) / 2)];
  }
  return [...new Set(frames)].sort((a, b) => a - b);
}

function runProbe(cwd: string, job: ProbeJob, timeout?: number): Promise<ProbeResult> {
  const {promise, resolve: resolveProbe, reject: rejectProbe} = Promise.withResolvers<ProbeResult>();
  const script = resolve(cwd, "scripts/run-layout-probe.mjs");
  const child = spawn(process.execPath, [script], {cwd, stdio: ["pipe", "pipe", "pipe"]});
  let stdout = "";
  let stderr = "";
  let settled = false;
  const timer = timeout
    ? setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        rejectProbe(new Error(`Layout probe timed out after ${timeout}ms.`));
      }, timeout)
    : undefined;
  const finish = (): void => {
    clearTimeout(timer);
  };
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  child.on("error", (error: Error) => {
    if (settled) return;
    settled = true;
    finish();
    rejectProbe(error);
  });
  child.on("close", (code: number | null) => {
    if (settled) return;
    settled = true;
    finish();
    if (code !== 0) {
      rejectProbe(new Error(`Layout probe exited with code ${code}.\n${stderr || stdout}`));
      return;
    }
    try {
      resolveProbe(JSON.parse(stdout.trim()) as ProbeResult);
    } catch (error) {
      rejectProbe(new Error(`Layout probe returned invalid JSON: ${error instanceof Error ? error.message : String(error)}\n${stdout}`));
    }
  });
  child.stdin.end(JSON.stringify(job));
  return promise;
}

/** Samples rendered Player DOM geometry and runs the deterministic layout rules. */
export async function runRemotionLint(root = process.cwd(), options: RemotionLintOptions = {}): Promise<{report: LintReport; summary: string}> {
  const p = harnessPaths(root);
  await requireFile(p.video, "Canonical video.json");
  await requireFile(p.assetManifest, "Asset manifest");
  const project = await readJson<VideoProject>(p.video);
  const state = await readRemotionState(root);
  await assertRemotionInputsFresh(root, state);
  await requireFile(p.remotionTimeline, "Resolved Remotion timeline evidence");
  const validation = await validateRemotionTimeline(await readJson(p.remotionTimeline), project, p.remotionGenerated);
  if (!validation.valid || !validation.timeline)
    throw new Error(`Resolved Remotion timeline rejected:\n${validation.diagnostics.map((diagnostic) => `${diagnostic.path} [${diagnostic.code}] ${diagnostic.message}`).join("\n")}`);
  const timeline = validation.timeline;
  const frames = planSampleFrames(timeline, project, options.sceneId);
  await requireFile(resolve(p.remotion, "scripts/run-layout-probe.mjs"), "Layout lint probe");
  const scopedScenes = options.sceneId ? project.scenes.filter((scene) => scene.id === options.sceneId) : project.scenes;
  const ctx: LintContext = {
    canvasWidth: project.meta.width,
    canvasHeight: project.meta.height,
    sceneIds: scopedScenes.map((scene) => scene.id),
    minFontPx: 0.0145 * project.meta.width,
    tolerancePx: 2,
    canonicalText: scopedScenes.map((scene) => scene.screenText).filter(Boolean),
  };
  const probe = await runProbe(
    p.remotion,
    {
      frames,
      fps: project.meta.fps,
      entryPoint: "qa/player-entry.tsx",
      publicDir: "public",
      width: project.meta.width,
      height: project.meta.height,
    },
    options.timeout,
  );
  if (probe.measurement !== MEASUREMENT) throw new Error(`Layout probe reported an unexpected measurement '${String(probe.measurement)}'.`);
  const report = runLint({frames: probe.frames, ctx, strict: options.strict, measurement: MEASUREMENT});
  await writeJson(p.layoutLint, report);
  return {report, summary: formatLintSummary(report)};
}
