import React from "react";
import {interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";
import {entryFade} from "../shared/choreography";
import {Placement, PlacementBox, resolveSize, SizeRole} from "../shared/canvas";
import {SPRING_SMOOTH} from "../shared/motion";

export type CountUpProps = {
  from?: number;
  to?: number;
  delay?: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  color?: string;
  fontSize?: number;
  size?: SizeRole;
  fontFamily?: string;
  fontWeight?: number;
  letterSpacing?: string;
  lineHeight?: number;
  align?: "left" | "center" | "right";
  placement?: Placement;
};

export const CountUp: React.FC<CountUpProps> = ({
  from = 0,
  to = 100,
  delay = 0,
  duration = 24,
  decimals = 0,
  prefix = "",
  suffix = "",
  color = "var(--onda-text, #F2F2F4)",
  fontSize = 120,
  size,
  fontFamily = 'var(--onda-font-display, "Clash Display", sans-serif)',
  fontWeight = 600,
  letterSpacing = "normal",
  lineHeight = 1.1,
  align = "left",
  placement,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const resolvedFontSize = size ? resolveSize(size, {width, height}) : fontSize;
  const {opacity} = entryFade({frame, fps, delay, durationInFrames: duration});
  const progress = spring({frame: frame - delay, fps, config: SPRING_SMOOTH, durationInFrames: duration});
  const value = interpolate(progress, [0, 1], [from, to], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const formatted = value.toLocaleString("en-US", {minimumFractionDigits: decimals, maximumFractionDigits: decimals});

  return (
    <PlacementBox placement={placement}>
      <div style={{
        opacity,
        color,
        fontSize: resolvedFontSize,
        fontFamily,
        fontWeight,
        letterSpacing,
        lineHeight,
        textAlign: align,
        fontVariantNumeric: "tabular-nums",
      }}>
        {prefix}{formatted}{suffix}
      </div>
    </PlacementBox>
  );
};
