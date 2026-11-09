import {interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import type {CSSProperties} from "react";

export type EasingFunction = (value: number) => number;

export const Easing = {
  linear: (value: number) => value,
  easeIn: (value: number) => value * value,
  easeOut: (value: number) => value * (2 - value),
  easeInOut: (value: number) =>
    value < 0.5 ? 2 * value * value : -1 + (4 - 2 * value) * value,
  easeInQuad: (value: number) => value * value,
  easeOutQuad: (value: number) => value * (2 - value),
  easeInOutQuad: (value: number) =>
    value < 0.5 ? 2 * value * value : -1 + (4 - 2 * value) * value,
  easeInCubic: (value: number) => value * value * value,
  easeOutCubic: (value: number) => (--value) * value * value + 1,
  easeInOutCubic: (value: number) =>
    value < 0.5
      ? 4 * value * value * value
      : (value - 1) * (2 * value - 2) * (2 * value - 2) + 1,
  easeInSine: (value: number) => 1 - Math.cos((value * Math.PI) / 2),
  easeOutSine: (value: number) => Math.sin((value * Math.PI) / 2),
  easeInOutSine: (value: number) => -(Math.cos(Math.PI * value) - 1) / 2,
  easeInQuart: (value: number) => value ** 4,
  easeOutQuart: (value: number) => 1 - (--value) * value * value * value,
  easeInOutQuart: (value: number) =>
    value < 0.5
      ? 8 * value ** 4
      : 1 - 8 * (--value) * value * value * value,
} as const;

export type EasingName = keyof typeof Easing;
export type Hold = {type: "hold"; frames: number};
export type AnimatedValue<T = number> = T | (T | Hold)[];

export interface TransformProps {
  x?: AnimatedValue;
  y?: AnimatedValue;
  z?: AnimatedValue;
  scale?: AnimatedValue;
  scaleX?: AnimatedValue;
  scaleY?: AnimatedValue;
  rotate?: AnimatedValue;
  rotateX?: AnimatedValue;
  rotateY?: AnimatedValue;
  rotateZ?: AnimatedValue;
  skew?: AnimatedValue;
  skewX?: AnimatedValue;
  skewY?: AnimatedValue;
  transform?: AnimatedValue<string>;
}

export interface VisualProps {
  opacity?: AnimatedValue;
  color?: string[];
  backgroundColor?: string[];
  blur?: AnimatedValue;
  borderRadius?: AnimatedValue;
}

export interface TimingProps {
  frames?: [number, number];
  duration?: number;
  delay?: number;
  easing?: EasingFunction | EasingName;
}

export interface MotionTimingConfig {
  frames?: [number, number];
  duration?: number;
  delay?: number;
  stagger?: number;
  unitIndex?: number;
  easing?: EasingFunction | EasingName;
  cycleOffset?: number;
}

export interface MotionStyleConfig {
  progress: number;
  transforms?: TransformProps;
  styles?: VisualProps;
  easing?: EasingFunction;
  baseStyle?: CSSProperties;
  duration?: number;
}

export function getEasingFunction(
  easing?: EasingFunction | EasingName,
): EasingFunction | undefined {
  if (!easing) return undefined;
  if (typeof easing === "function") return easing;
  return Easing[easing];
}

function numericInterpolation(
  input: number,
  inputRange: number[],
  outputRange: number[],
  easing?: EasingFunction,
): number {
  return interpolate(input, inputRange, outputRange, {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

export function interpolateKeyframes<T = number>(
  value: AnimatedValue<T>,
  progress: number,
  easingFn?: EasingFunction,
  duration?: number,
): T {
  if (!Array.isArray(value)) return value as T;
  if (value.length === 0) return 0 as unknown as T;

  const values = value.filter(
    (item): item is T =>
      !(typeof item === "object" && item !== null && "type" in item && item.type === "hold"),
  );
  if (values.length === 0) return 0 as unknown as T;

  const holds = value.filter(
    (item): item is Hold =>
      typeof item === "object" && item !== null && "type" in item && item.type === "hold",
  );

  if (holds.length === 0) {
    if (values.length === 1) return values[0];
    if (values.every((item) => typeof item === "number")) {
      return numericInterpolation(
        progress,
        values.map((_, index) => index / (values.length - 1)),
        values as number[],
        easingFn,
      ) as T;
    }
    return values[Math.min(values.length - 1, Math.floor(progress * values.length))];
  }

  if (typeof duration !== "number") return values[0];

  const totalHoldFrames = holds.reduce((total, hold) => total + hold.frames, 0);
  const transitionDuration =
    values.length > 1
      ? Math.max(0, duration - totalHoldFrames) / (values.length - 1)
      : 0;
  const inputRange: number[] = [];
  const outputValues: T[] = [];
  let currentFrame = 0;
  let valueIndex = 0;
  let lastValue: T | undefined;

  for (const item of value) {
    if (typeof item === "object" && item !== null && "type" in item && item.type === "hold") {
      if (lastValue !== undefined) {
        currentFrame += item.frames;
        inputRange.push(currentFrame / duration);
        outputValues.push(lastValue);
      }
      continue;
    }

    if (lastValue !== undefined) currentFrame += transitionDuration;
    lastValue = item as T;
    valueIndex += 1;
    inputRange.push(currentFrame / duration);
    outputValues.push(lastValue);
  }

  if (outputValues.every((item) => typeof item === "number")) {
    return numericInterpolation(
      progress,
      inputRange,
      outputValues as number[],
      easingFn,
    ) as T;
  }
  return outputValues[Math.min(outputValues.length - 1, Math.floor(progress * valueIndex))];
}

export function buildTransformString(
  transforms: TransformProps,
  progress: number,
  easingFn?: EasingFunction,
  duration?: number,
): string {
  const transformParts: string[] = [];
  if (transforms.transform !== undefined) {
    const value = interpolateKeyframes(transforms.transform, progress, easingFn, duration);
    if (typeof value === "string") transformParts.push(value);
  }

  const entries: Array<[keyof TransformProps, string]> = [
    ["x", "translateX"],
    ["y", "translateY"],
    ["z", "translateZ"],
    ["scale", "scale"],
    ["scaleX", "scaleX"],
    ["scaleY", "scaleY"],
    ["rotate", "rotate"],
    ["rotateX", "rotateX"],
    ["rotateY", "rotateY"],
    ["rotateZ", "rotateZ"],
    ["skew", "skew"],
    ["skewX", "skewX"],
    ["skewY", "skewY"],
  ];
  for (const [key, functionName] of entries) {
    const value = transforms[key];
    if (value === undefined) continue;
    const resolved = interpolateKeyframes(value, progress, easingFn, duration);
    const unit = functionName.startsWith("translate") ? "px" : functionName.startsWith("scale") ? "" : "deg";
    transformParts.push(`${functionName}(${resolved}${unit})`);
  }
  return transformParts.join(" ");
}

function colorValue(value: string): [number, number, number] | null {
  const hex = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
    return [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16)) as [number, number, number];
  }
  const rgb = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function interpolateColors(colors: string[], progress: number, easingFn?: EasingFunction): string {
  if (colors.length === 0) return "";
  if (colors.length === 1) return colors[0];
  const position = Math.min(colors.length - 1, Math.max(0, progress * (colors.length - 1)));
  const index = Math.min(colors.length - 2, Math.floor(position));
  const amount = easingFn ? easingFn(position - index) : position - index;
  const from = colorValue(colors[index]);
  const to = colorValue(colors[index + 1]);
  if (!from || !to) return colors[Math.round(position)];
  return `rgb(${from.map((channel, channelIndex) => Math.round(channel + (to[channelIndex] - channel) * amount)).join(", ")})`;
}

export function buildMotionStyles(config: MotionStyleConfig): CSSProperties {
  const {progress, transforms = {}, styles = {}, easing, baseStyle = {}, duration} = config;
  const easingFn = getEasingFunction(easing);
  const result: CSSProperties = {...baseStyle};
  const transform = buildTransformString(transforms, progress, easingFn, duration);
  if (transform) result.transform = transform;
  if (styles.opacity !== undefined) result.opacity = interpolateKeyframes(styles.opacity, progress, easingFn, duration) as number;
  if (styles.color) result.color = interpolateColors(styles.color, progress, easingFn);
  if (styles.backgroundColor) result.backgroundColor = interpolateColors(styles.backgroundColor, progress, easingFn);
  if (styles.blur !== undefined) {
    const blur = interpolateKeyframes(styles.blur, progress, easingFn, duration) as number;
    if (Number.isFinite(blur) && blur > 0) result.filter = `blur(${blur}px)`;
  }
  if (styles.borderRadius !== undefined) result.borderRadius = interpolateKeyframes(styles.borderRadius, progress, easingFn, duration) as number;
  return result;
}

export function useMotionTiming(config: MotionTimingConfig): number {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {frames, duration, delay = 0, stagger = 0, unitIndex = 0, cycleOffset} = config;
  const startFrame = cycleOffset !== undefined ? 0 : frames?.[0] ?? 0;
  const endFrame = cycleOffset !== undefined ? duration ?? 30 : frames?.[1] ?? duration ?? fps;
  const totalDuration = Math.max(1, endFrame - startFrame);
  const baseFrame = cycleOffset !== undefined ? cycleOffset : Math.max(0, frame - delay);
  const relativeFrame = baseFrame - unitIndex * stagger;
  return Math.min(1, Math.max(0, (relativeFrame - startFrame) / totalDuration));
}

/** The host project has no RemotionBits step context; standalone timing is used. */
export function useStepTiming(): {stepConfig?: unknown} | undefined {
  return undefined;
}
