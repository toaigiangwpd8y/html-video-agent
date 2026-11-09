import canonicalProject from "../../fixtures-valid-project.json" with {type: "json"};
import assetManifest from "./assets/manifest.json" with {type: "json"};
import type React from "react";
import {Img, Interactive, Sequence, staticFile} from "remotion";
import {resolveSceneAsset} from "../../../remotion/core/video-utils";

const scene = canonicalProject.scenes[0];
const localImage = staticFile(resolveSceneAsset(scene.id, "illustration", assetManifest.assets).slice(1));

const CardInner = ({children, style}: {children: React.ReactNode; style: React.CSSProperties}) => (
  <div style={{boxSizing: "border-box", display: "flex", alignItems: "center", minHeight: 180, padding: 24, ...style}}>
    {children}
  </div>
);

const Card = Interactive.create({
  Component: CardInner,
  layout: "none",
  schema: {
    ...Interactive.backgroundSchema,
    ...Interactive.borderRadiusSchema,
    ...Interactive.childrenSchema,
    "style.width": {type: "number", default: 420, description: "Card width", min: 300, max: 600, step: 10, hiddenFromList: false},
  },
});

const EditableSceneView = () => (
  <Sequence name="Scene one" from={0} durationInFrames={scene.durationInFrames} layout="none">
    <div data-scene-id={scene.id} style={{position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 32, padding: 80}}>
      <Interactive.Div name="Scene title" from={0} durationInFrames={scene.durationInFrames} style={{fontFamily: "Inter", fontSize: 72, color: "#F8FAFC"}}>
        {scene.screenText}
      </Interactive.Div>
      <Img name="Local supporting image" src={localImage} from={0} durationInFrames={scene.durationInFrames} style={{width: 160, height: 160}} />
      <div style={{display: "flex", gap: 24}}>
        <Card name="Summary card one" from={0} durationInFrames={scene.durationInFrames} style={{width: 420, backgroundColor: "#0B1930", borderRadius: 24}}>{scene.screenText}</Card>
        <Card name="Summary card two" from={0} durationInFrames={scene.durationInFrames} style={{width: 420, backgroundColor: "#76E6C4", borderRadius: 24}}>{scene.screenText}</Card>
      </div>
    </div>
  </Sequence>
);

export const EditableSceneFixture = Interactive.create({
  Component: EditableSceneView,
  layout: "absolute-fill",
  schema: {},
});
