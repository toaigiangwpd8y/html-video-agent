import React from "react";

const THEME = {
  border: "var(--onda-border, #1C1C22)",
  accent: "var(--onda-accent, #D96B82)",
} as const;

export type GridFieldProps = {
  cell?: number;
  variant?: "lines" | "dots";
  color?: string;
  thickness?: number;
  opacity?: number;
};

export const GridField: React.FC<GridFieldProps> = ({
  cell = 48,
  variant = "lines",
  color = THEME.border,
  thickness = 1,
  opacity = 0.6,
}) => {
  const background = variant === "dots"
    ? `radial-gradient(circle ${thickness}px at ${thickness}px ${thickness}px, ${color} 99%, transparent 100%)`
    : `linear-gradient(to right, ${color} ${thickness}px, transparent ${thickness}px), linear-gradient(to bottom, ${color} ${thickness}px, transparent ${thickness}px)`;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity,
        backgroundImage: background,
        backgroundSize: `${cell}px ${cell}px`,
      }}
    />
  );
};

export type GlowProps = {
  color?: string;
  size?: number;
  x?: number;
  y?: number;
  opacity?: number;
};

export const Glow: React.FC<GlowProps> = ({
  color = THEME.accent,
  size = 0.8,
  x = 0.5,
  y = 0.5,
  opacity = 0.35,
}) => {
  const radius = `${size * 60}%`;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background: `radial-gradient(circle ${radius} at ${x * 100}% ${y * 100}%, ${color}, transparent 70%)`,
        opacity,
      }}
    />
  );
};
