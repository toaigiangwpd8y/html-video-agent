import type React from "react";
import {Composition} from "remotion";
import canonicalProject from "../../fixtures-valid-project.json" with {type: "json"};
import {EditableSceneFixture} from "./Video";

const scene = canonicalProject.scenes[0];

export const ConnectedCompositionFixture:React.FC=()=> (
  <Composition
    id="EditableSceneFixture"
    component={EditableSceneFixture}
    width={canonicalProject.meta.width}
    height={canonicalProject.meta.height}
    fps={canonicalProject.meta.fps}
    durationInFrames={scene.durationInFrames}
    defaultProps={{}}
  />
);
