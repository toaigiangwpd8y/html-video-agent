import {Easing} from "remotion";

export const EASING_ENTER = Easing.bezier(0.16, 1, 0.3, 1);
export const EASING_EXIT = Easing.in(Easing.cubic);

export function staggerDelay(
  index: number,
  staggerInFrames: number,
  baseDelayInFrames = 0,
): number {
  return baseDelayInFrames + index * staggerInFrames;
}
