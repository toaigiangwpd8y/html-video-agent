import {linearTiming, springTiming} from "@remotion/transitions";
import {wipe} from "@remotion/transitions/wipe";
import {Easing} from "remotion";

export type WipeDirection = "from-left" | "from-right" | "from-top" | "from-bottom";
export type TransitionVariant = "linear" | "spring" | "editorial";
export type TransitionWipeConfig = {
  durationInFrames?: number;
  direction?: WipeDirection;
  variant?: TransitionVariant;
};

/** Adapted from RemotionUI's primitives/transition-wipe.tsx. */
export function transitionWipe({
  durationInFrames = 22,
  direction = "from-left",
  variant = "editorial",
}: TransitionWipeConfig = {}) {
  const timing = variant === "spring"
    ? springTiming({durationInFrames, config: {damping: 200, mass: 1, stiffness: 100, overshootClamping: true}})
    : linearTiming({
        durationInFrames,
        easing: variant === "editorial" ? Easing.bezier(0.45, 0, 0.55, 1) : undefined,
      });
  return {presentation: wipe({direction}), timing};
}

export function getTransitionWipeDuration(config: TransitionWipeConfig = {}, fps: number): number {
  return transitionWipe(config).timing.getDurationInFrames({fps});
}
