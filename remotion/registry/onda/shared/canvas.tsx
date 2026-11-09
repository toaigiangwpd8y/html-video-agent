import React from "react";
import {AbsoluteFill} from "remotion";

export type Anchor = "center" | "top" | "bottom" | "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type PlacementCoords = {x: number; y: number; anchor?: Anchor};
export type PlacementRegion = "center" | "top" | "bottom" | "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "upper-third" | "lower-third";
export type Placement = PlacementRegion | PlacementCoords;
export type SizeRole = "hero" | "heading" | "subheading" | "body" | "caption";

const REGION_MAP: Record<PlacementRegion, Required<PlacementCoords>> = {
  center: {x: 0.5, y: 0.5, anchor: "center"},
  top: {x: 0.5, y: 0.15, anchor: "top"},
  bottom: {x: 0.5, y: 0.85, anchor: "bottom"},
  left: {x: 0.15, y: 0.5, anchor: "left"},
  right: {x: 0.85, y: 0.5, anchor: "right"},
  "top-left": {x: 0.1, y: 0.1, anchor: "top-left"},
  "top-right": {x: 0.9, y: 0.1, anchor: "top-right"},
  "bottom-left": {x: 0.1, y: 0.9, anchor: "bottom-left"},
  "bottom-right": {x: 0.9, y: 0.9, anchor: "bottom-right"},
  "upper-third": {x: 0.5, y: 0.28, anchor: "center"},
  "lower-third": {x: 0.5, y: 0.72, anchor: "center"},
};

const ANCHOR_TO_TRANSFORM: Record<Anchor, string> = {
  center: "translate(-50%, -50%)",
  top: "translate(-50%, 0)",
  bottom: "translate(-50%, -100%)",
  left: "translate(0, -50%)",
  right: "translate(-100%, -50%)",
  "top-left": "translate(0, 0)",
  "top-right": "translate(-100%, 0)",
  "bottom-left": "translate(0, -100%)",
  "bottom-right": "translate(-100%, -100%)",
};

const ANCHOR_TO_TEXT_ALIGN: Record<Anchor, "left" | "center" | "right"> = {
  center: "center",
  top: "center",
  bottom: "center",
  left: "left",
  right: "right",
  "top-left": "left",
  "top-right": "right",
  "bottom-left": "left",
  "bottom-right": "right",
};

const SIZE_ROLES: Record<SizeRole, number> = {
  hero: 0.15,
  heading: 0.09,
  subheading: 0.052,
  body: 0.03,
  caption: 0.02,
};

export function resolvePlacement(placement: Placement | undefined): Required<PlacementCoords> {
  if (placement === undefined) return {x: 0.5, y: 0.5, anchor: "center"};
  if (typeof placement === "string") return REGION_MAP[placement];
  return {anchor: "center", ...placement};
}

export function resolveSize(role: SizeRole, canvas: {width: number; height: number}): number {
  return Math.round(SIZE_ROLES[role] * Math.min(canvas.width, canvas.height));
}

export type PlacementBoxProps = {placement?: Placement; children: React.ReactNode};

export const PlacementBox: React.FC<PlacementBoxProps> = ({placement, children}) => {
  if (placement === undefined) return <>{children}</>;
  const {x, y, anchor} = resolvePlacement(placement);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          transform: ANCHOR_TO_TRANSFORM[anchor],
          maxWidth: "100%",
          textAlign: ANCHOR_TO_TEXT_ALIGN[anchor],
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};
