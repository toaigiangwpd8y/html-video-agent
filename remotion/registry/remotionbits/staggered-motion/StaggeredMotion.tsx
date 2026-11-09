import React from "react";
import { random } from "remotion";
import type { EasingName, EasingFunction } from "../shared/motion";
import {
  useMotionTiming,
  buildMotionStyles,
  getEasingFunction,
  type AnimatedValue,
  type TransformProps,
  type VisualProps,
  type TimingProps,
} from "../shared/motion";

export type { AnimatedValue };

export type StaggerDirection = "forward" | "reverse" | "center" | "random";

export type StaggeredMotionTransitionProps = TransformProps & VisualProps & TimingProps & {
  stagger?: number;
  staggerDirection?: StaggerDirection;
};

export type StaggeredMotionProps = {
  transition?: StaggeredMotionTransitionProps;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  cycleOffset?: number;
};

function calculateStaggerIndex(
  actualIndex: number,
  totalChildren: number,
  direction: StaggerDirection
): number {
  if (direction === "reverse") {
    return totalChildren - 1 - actualIndex;
  }

  if (direction === "center") {
    const mid = Math.floor(totalChildren / 2);
    return Math.abs(actualIndex - mid);
  }

  if (direction === "random") {
    const indices = Array.from({ length: totalChildren }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(random(`stagger-${i}`) * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.indexOf(actualIndex);
  }

  return actualIndex;
}

type StaggeredMotionChildProps = {
  child: React.ReactNode;
  actualIndex: number;
  totalChildren: number;
  transition?: StaggeredMotionTransitionProps;
  cycleOffset?: number;
};

const StaggeredMotionChild: React.FC<StaggeredMotionChildProps> = ({
  child,
  actualIndex,
  totalChildren,
  transition,
  cycleOffset,
}) => {
  const {
    opacity,
    color,
    backgroundColor,
    blur,
    borderRadius,
    frames,
    duration,
    delay = 0,
    stagger = 0,
    staggerDirection = "forward",
    easing,
  } = transition ?? {};
  const easingFn = getEasingFunction(easing);
  const staggerIndex = calculateStaggerIndex(actualIndex, totalChildren, staggerDirection);
  const resolvedDuration = duration ?? (frames ? frames[1] - frames[0] : 30);
  const progress = useMotionTiming({
    frames,
    duration,
    delay,
    stagger,
    unitIndex: staggerIndex,
    easing,
    cycleOffset: cycleOffset !== undefined ? cycleOffset - delay : undefined,
  });
  const motionStyle = buildMotionStyles({
    progress,
    transforms: transition,
    styles: {opacity, color, backgroundColor, blur, borderRadius},
    easing: easingFn,
    duration: resolvedDuration,
  });

  if (React.isValidElement(child)) {
    const existingStyle = (child.props as any).style || {};
    return React.cloneElement(child, {
      key: actualIndex,
      style: {...existingStyle, ...motionStyle},
    } as any);
  }

  return <span style={motionStyle}>{child}</span>;
};

export const StaggeredMotion: React.FC<StaggeredMotionProps> = ({
  transition,
  children,
  className,
  style,
  cycleOffset,
}) => {
  const childArray = React.Children.toArray(children);
  const totalChildren = childArray.length;

  return (
    <div
      className={className}
      style={style}
    >
      {childArray.map((child, actualIndex) => (
        <StaggeredMotionChild
          key={actualIndex}
          child={child}
          actualIndex={actualIndex}
          totalChildren={totalChildren}
          transition={transition}
          cycleOffset={cycleOffset}
        />
      ))}
    </div>
  );
};
