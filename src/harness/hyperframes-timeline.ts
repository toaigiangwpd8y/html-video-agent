import type {VideoProject} from "../core/types.js";

export interface HyperFramesSceneTiming {
  sceneId: string;
  startFrame: number;
  durationInFrames: number;
  startSeconds: number;
  durationSeconds: number;
}

export interface HyperFramesTimeline {
  fps: number;
  durationInFrames: number;
  durationSeconds: number;
  scenes: HyperFramesSceneTiming[];
}

/** Converts an integer frame boundary to a stable decimal seconds value. */
export function frameToSeconds(frame: number, fps: number): number {
  if (!Number.isInteger(frame) || frame < 0) throw new Error("Frame must be a non-negative integer.");
  if (!Number.isInteger(fps) || fps < 1) throw new Error("FPS must be a positive integer.");
  const seconds = Number((frame / fps).toFixed(9));
  if (Math.round(seconds * fps) !== frame) throw new Error(`Frame ${frame} cannot round-trip at ${fps} fps.`);
  return seconds;
}

/** Resolves sequential semantic frame budgets without accumulating floating-point time. */
export function resolveHyperFramesTimeline(project: VideoProject): HyperFramesTimeline {
  const {fps, durationsInFrames} = project.meta;
  if (!Number.isInteger(fps) || fps < 1) throw new Error("video.json meta.fps must be a positive integer.");
  if (!Number.isInteger(durationsInFrames) || durationsInFrames < 1) throw new Error("video.json duration must be a positive frame count.");

  let startFrame = 0;
  const scenes = project.scenes.map((scene) => {
    if (!Number.isInteger(scene.durationInFrames) || scene.durationInFrames < 1) {
      throw new Error(`Scene '${scene.id}' must have a positive integer durationInFrames.`);
    }
    const timing: HyperFramesSceneTiming = {
      sceneId: scene.id,
      startFrame,
      durationInFrames: scene.durationInFrames,
      startSeconds: frameToSeconds(startFrame, fps),
      durationSeconds: frameToSeconds(scene.durationInFrames, fps),
    };
    startFrame += scene.durationInFrames;
    return timing;
  });

  if (startFrame !== durationsInFrames) {
    throw new Error(`Scene frame budgets sum to ${startFrame}; video.json declares ${durationsInFrames}.`);
  }

  return {
    fps,
    durationInFrames: durationsInFrames,
    durationSeconds: frameToSeconds(durationsInFrames, fps),
    scenes,
  };
}

/** Returns zero-based frame indices around each adjacent scene boundary. */
export function plannedHyperFramesBoundaries(timeline: HyperFramesTimeline): Array<{fromSceneId: string; toSceneId: string; frames: number[]}> {
  const finalFrame = Math.max(0, timeline.durationInFrames - 1);
  return timeline.scenes.slice(1).map((scene, index) => ({
    fromSceneId: timeline.scenes[index].sceneId,
    toSceneId: scene.sceneId,
    frames: [...new Set([scene.startFrame - 1, scene.startFrame].filter((frame) => frame >= 0 && frame <= finalFrame))],
  }));
}
