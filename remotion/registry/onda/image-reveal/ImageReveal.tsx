import React from "react";
import {AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";
import {entryFade, entryScale} from "../shared/choreography";
import {Placement, PlacementBox} from "../shared/canvas";
import {SPRING_SMOOTH} from "../shared/motion";

/** Props adapted from Onda's registry/components/image-reveal/ImageReveal.tsx. */
export type ImageRevealProps = {
  src: string;
  alt?: string;
  delay?: number;
  duration?: number;
  motion?: "blur" | "fade" | "scale";
  fit?: "cover" | "contain";
  placement?: Placement;
  width?: number;
  height?: number;
  borderRadius?: number;
};

export const ImageReveal: React.FC<ImageRevealProps> = ({
  src,
  alt = "",
  delay = 0,
  duration = 18,
  motion = "blur",
  fit = "cover",
  placement,
  width,
  height,
  borderRadius = 0,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  let opacity = 1;
  let transform = "";
  let filter = "";

  if (motion === "fade") {
    ({opacity} = entryFade({frame, fps, delay, durationInFrames: duration}));
  } else if (motion === "scale") {
    const result = entryScale({frame, fps, delay, durationInFrames: duration, from: 0.95});
    opacity = result.opacity;
    transform = result.transform;
  } else {
    const local = Math.max(0, frame - delay);
    const progress = spring({frame: local, fps, config: SPRING_SMOOTH, durationInFrames: duration});
    opacity = interpolate(progress, [0, 1], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
    const blur = interpolate(progress, [0, 1], [10, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
    const translateY = interpolate(progress, [0, 1], [16, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
    filter = `blur(${blur}px)`;
    transform = `translateY(${translateY}px)`;
  }

  const imgStyle: React.CSSProperties = {
    objectFit: fit,
    borderRadius,
    opacity,
    transform,
    filter,
    display: "block",
    width,
    height,
  };

  if (placement === undefined) {
    return (
      <AbsoluteFill style={{overflow: "hidden"}}>
        <Img src={src} alt={alt} style={{...imgStyle, width: width ?? "100%", height: height ?? "100%"}} />
      </AbsoluteFill>
    );
  }

  return (
    <PlacementBox placement={placement}>
      <Img src={src} alt={alt} style={imgStyle} />
    </PlacementBox>
  );
};
