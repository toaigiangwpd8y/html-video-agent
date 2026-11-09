import React from "react";
import {interpolate, useCurrentFrame} from "remotion";

export const TestFade: React.FC<{children?: React.ReactNode}> = ({children}) => {
  const opacity = interpolate(useCurrentFrame(), [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <div style={{opacity}}>{children}</div>;
};
