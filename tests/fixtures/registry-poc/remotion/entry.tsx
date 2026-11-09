import React from "react";
import {Composition, registerRoot} from "remotion";
import project from "./project.json";
import {GeneratedVideo} from "./Video";
import type {VideoProject} from "../../../../src/core/types";

const typedProject = project as VideoProject;

export const RegistryPocRoot: React.FC = () => (
  <Composition
    id="RegistryPoc"
    component={GeneratedVideo}
    defaultProps={{project: typedProject}}
    durationInFrames={typedProject.meta.durationsInFrames}
    fps={typedProject.meta.fps}
    width={typedProject.meta.width}
    height={typedProject.meta.height}
  />
);

registerRoot(RegistryPocRoot);
