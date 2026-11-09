import React from "react";
import {Composition} from "remotion";
import project from "./generated/project.json";
import assetManifest from "./generated/asset-manifest.json";
import {GeneratedVideo} from "./generated/Video";
import {GeneratedCompositions} from "./generated/Compositions";
import "./generated/theme";
import {loadRegisteredFonts} from "./generated/fonts";
import type {VideoProject} from "../src/core/types";
import type {AssetManifest} from "../src/harness/assets";
const typedProject=project as VideoProject;
const typedAssetManifest=assetManifest as AssetManifest;
// Registers local fonts after Remotion initializes delayRender and supplies frozen canonical inputs.
export const RemotionRoot:React.FC=()=>{loadRegisteredFonts();return <><Composition id="MainVideo" component={GeneratedVideo} defaultProps={{project:typedProject,assetManifest:typedAssetManifest}} durationInFrames={typedProject.meta.durationsInFrames} fps={typedProject.meta.fps} width={typedProject.meta.width} height={typedProject.meta.height} calculateMetadata={async({props})=>{const current=props.project as VideoProject;return {width:current.meta.width,height:current.meta.height,fps:current.meta.fps,durationInFrames:current.meta.durationsInFrames};}}/><GeneratedCompositions/></>};
