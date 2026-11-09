import React from "react";
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from "remotion";
import {entryFade, entryScale} from "../shared/choreography";
import {SPRING_SMOOTH} from "../shared/motion";
import {evolveLine} from "../shared/paths";

export type CalloutProps = {
  label?: string;
  x?: number;
  y?: number;
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  offset?: number;
  delay?: number;
  duration?: number;
  lineDelay?: number;
  lineDuration?: number;
  color?: string;
  bgColor?: string;
  borderColor?: string;
  arrowColor?: string;
  arrowWidth?: number;
  fontSize?: number;
  fontFamily?: string;
};

export const Callout: React.FC<CalloutProps> = ({
  label = "Look here",
  x = 0.5,
  y = 0.5,
  position = "top-right",
  offset = 160,
  delay = 0,
  duration = 18,
  lineDelay = 6,
  lineDuration = 18,
  color = "var(--onda-text, #F2F2F4)",
  bgColor = "var(--onda-surface, #0E0E12)",
  borderColor = "var(--onda-border-lit, #26262E)",
  arrowColor = "var(--onda-text, #F2F2F4)",
  arrowWidth = 2,
  fontSize = 20,
  fontFamily = 'var(--onda-font-display, "Clash Display", sans-serif)',
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const fade = entryFade({frame, fps, delay, durationInFrames: duration});
  const scaleStyle = entryScale({frame, fps, delay, durationInFrames: duration});
  const arrowProgress = spring({
    frame: Math.max(0, frame - delay - lineDelay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: lineDuration,
  });
  const anchorX = x * width;
  const anchorY = y * height;
  const offsetX = position === "top-right" || position === "bottom-right" ? offset : -offset;
  const offsetY = position === "bottom-left" || position === "bottom-right" ? offset : -offset;
  const bubbleCenterX = anchorX + offsetX;
  const bubbleCenterY = anchorY + offsetY;
  const bubbleEdgeX = anchorX + offsetX / 2;
  const bubbleEdgeY = anchorY + offsetY / 2;
  const arrowPath = `M ${bubbleEdgeX} ${bubbleEdgeY} L ${anchorX} ${anchorY}`;
  const {strokeDasharray, strokeDashoffset} = evolveLine(arrowProgress, bubbleEdgeX, bubbleEdgeY, anchorX, anchorY);

  return (
    <AbsoluteFill>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "visible"}}
      >
        <path
          d={arrowPath}
          stroke={arrowColor}
          strokeWidth={arrowWidth}
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: bubbleCenterX,
          top: bubbleCenterY,
          transform: `translate(-50%, -50%) ${scaleStyle.transform}`,
          opacity: fade.opacity,
          backgroundColor: bgColor,
          border: `1px solid ${borderColor}`,
          borderRadius: 12,
          padding: "8px 14px",
          boxShadow: "0 10px 30px -10px rgba(0,0,0,0.7)",
        }}
      >
        <span style={{color, fontSize, fontFamily, fontWeight: 500, whiteSpace: "nowrap"}}>
          {label}
        </span>
      </div>
    </AbsoluteFill>
  );
};
