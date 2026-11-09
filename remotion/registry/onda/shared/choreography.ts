import {interpolate, spring} from "remotion";
import {SPRING_SMOOTH} from "./motion";

export const entryFade = ({
  frame,
  fps,
  delay = 0,
  durationInFrames = 18,
}: {frame: number; fps: number; delay?: number; durationInFrames?: number}): {opacity: number} => {
  const progress = spring({frame: frame - delay, fps, config: SPRING_SMOOTH, durationInFrames});
  return {
    opacity: interpolate(progress, [0, 1], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  };
};

export const entryScale = ({
  frame,
  fps,
  delay = 0,
  durationInFrames = 18,
  from = 0.9,
}: {frame: number; fps: number; delay?: number; durationInFrames?: number; from?: number}): {opacity: number; transform: string} => {
  const progress = spring({frame: frame - delay, fps, config: SPRING_SMOOTH, durationInFrames});
  const opacity = interpolate(progress, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(progress, [0, 1], [from, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return {opacity, transform: `scale(${scale})`};
};
