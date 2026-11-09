import React from "react";
import {interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";
import {Placement, PlacementBox, resolveSize, SizeRole} from "../shared/canvas";
import {SPRING_SMOOTH} from "../shared/motion";

export type BlurRevealProps = {
  text?: string;
  delay?: number;
  duration?: number;
  color?: string;
  fontSize?: number;
  size?: SizeRole;
  fontFamily?: string;
  fontWeight?: number;
  letterSpacing?: string;
  lineHeight?: number;
  align?: "left" | "center" | "right";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  textShadow?: string;
  fontStyle?: "normal" | "italic" | "oblique";
  textWrap?: "wrap" | "nowrap" | "balance" | "pretty";
  placement?: Placement;
};

export const BlurReveal: React.FC<BlurRevealProps> = ({
  text = "Onda",
  delay = 0,
  duration = 18,
  color = "var(--onda-text, #F2F2F4)",
  fontSize = 96,
  size,
  fontFamily = 'var(--onda-font-display, "Clash Display", sans-serif)',
  fontWeight = 600,
  letterSpacing = "normal",
  lineHeight = 1.1,
  align = "left",
  textTransform,
  textShadow,
  fontStyle,
  textWrap,
  placement,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const local = Math.max(0, frame - delay);
  const resolvedFontSize = size ? resolveSize(size, {width, height}) : fontSize;
  const progress = spring({frame: local, fps, config: SPRING_SMOOTH, durationInFrames: duration});
  const opacity = interpolate(progress, [0, 1], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const blur = interpolate(progress, [0, 1], [10, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const translateY = interpolate(progress, [0, 1], [16, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});

  return (
    <PlacementBox placement={placement}>
      <div style={{
        opacity,
        filter: `blur(${blur}px)`,
        transform: `translateY(${translateY}px)`,
        color,
        fontSize: resolvedFontSize,
        fontFamily,
        fontWeight,
        letterSpacing,
        lineHeight,
        textAlign: align,
        textTransform,
        textShadow,
        fontStyle,
        textWrap,
      }}>
        {text}
      </div>
    </PlacementBox>
  );
};
