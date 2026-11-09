import {Easing, interpolate} from "remotion";
import {resolveSceneAsset as resolveRegisteredSceneAsset,resolveSceneVoiceover as resolveRegisteredSceneVoiceover,type SceneAssetReference} from "../../src/core/asset-resolution";

export const clamp01 = (frame: number, start: number, end: number) => interpolate(frame, [start, end], [0, 1], {
  extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1),
});

export const safePadding = (width: number, height: number) => ({horizontal: Math.max(48, width * 0.065), vertical: Math.max(48, height * 0.055)});

export const fittedHeadlineSize = (height: number, text: string) => {
  const preferred = height * 0.064;
  const pressure = Math.max(1, text.length / 32);
  return Math.max(height * 0.043, preferred / Math.sqrt(pressure));
};

export type ProductionAssetReference = SceneAssetReference;

/** Resolve renderer media from the post-approval production registry, never from canonical scene fields. */
export const resolveSceneAsset = resolveRegisteredSceneAsset;
export const resolveSceneVoiceover = resolveRegisteredSceneVoiceover;
