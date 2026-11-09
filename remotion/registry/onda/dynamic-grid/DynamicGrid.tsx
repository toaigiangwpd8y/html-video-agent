import React from "react";
import {AbsoluteFill, useCurrentFrame} from "remotion";
import {GridField, Glow} from "../shared/primitives";

export type DynamicGridProps = {
  cell?: number;
  variant?: "lines" | "dots";
  color?: string;
  speed?: number;
  opacity?: number;
  glow?: boolean;
  glowColor?: string;
  background?: string;
};

export const DynamicGrid: React.FC<DynamicGridProps> = ({
  cell = 48,
  variant = "lines",
  color = "var(--onda-border, #1C1C22)",
  speed = 0.4,
  opacity = 0.6,
  glow = true,
  glowColor = "var(--onda-accent, #D96B82)",
  background = "var(--onda-bg, #08080A)",
}) => {
  const frame = useCurrentFrame();
  const offset = (frame * speed) % cell;
  return (
    <AbsoluteFill style={{background, overflow: "hidden"}}>
      <div style={{position: "absolute", inset: `-${cell}px`, transform: `translate(${-offset}px, ${-offset}px)`}}>
        <GridField cell={cell} variant={variant} color={color} opacity={opacity} />
      </div>
      {glow && <Glow color={glowColor} size={1} opacity={0.22} />}
    </AbsoluteFill>
  );
};
