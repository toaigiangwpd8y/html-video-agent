import React from "react";
import {AbsoluteFill, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {BlurReveal} from "../../../../remotion/registry/onda/blur-reveal/BlurReveal";
import {SplitScreen} from "../../../../remotion/registry/remotionui/split-screen/SplitScreen";
import type {Scene, VideoProject} from "../../../../src/core/types";

type SceneProps = {scene: Scene};

const canvasStyle: React.CSSProperties = {
  backgroundColor: "#0b0b10",
  color: "#f2f2f4",
  fontFamily: "Arial, sans-serif",
};

const SceneHeading: React.FC<{scene: Scene}> = ({scene}) => (
  <div style={{position: "absolute", left: 120, right: 120, bottom: 84, color: "rgba(242,242,244,0.72)", fontSize: 28, letterSpacing: "0.04em", textAlign: "center"}}>
    {scene.screenText}
  </div>
);

const HeadlineScene: React.FC<SceneProps> = ({scene}) => {
  // SOURCE_SCENE: headline-progressive-reveal
  // LAYOUT_BLUEPRINT: typewriter-reveal
  // MATERIALIZATION: The canonical headline progressively resolves through a spring-driven Onda reveal.
  // REGISTRY_SOURCE: onda-blur-reveal
  return (
    <AbsoluteFill style={canvasStyle}>
      <div style={{position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 42%, rgba(232,184,109,0.18), transparent 42%)"}} />
      <BlurReveal text={scene.screenText} color="#f2f2f4" fontFamily="Arial, sans-serif" fontSize={92} fontWeight={700} align="center" placement="upper-third" delay={4} duration={36} />
      <SceneHeading scene={scene} />
    </AbsoluteFill>
  );
};

const ComparisonScene: React.FC<SceneProps> = ({scene}) => {
  // SOURCE_SCENE: comparison-after-asset-inspection
  // LAYOUT_BLUEPRINT: comparison-split
  // MATERIALIZATION: Inspected local image evidence is compared in a shared frame with a surviving split-screen treatment.
  // REGISTRY_SOURCE: remotionui-split-screen (adapted)
  // SELECTED_MEDIA_ITEM: comparison-subject-pair
  return (
    <AbsoluteFill style={canvasStyle}>
      <SplitScreen
        left={{src: staticFile("media/subject-a.svg"), label: "Subject A", fit: "contain"}}
        right={{src: staticFile("media/subject-b.svg"), label: "Subject B", fit: "contain"}}
        title="Inspect the meaningful difference"
        split={0.5}
        accentColor="#8bd3dd"
        backgroundColor="#0b0b10"
      />
      <SceneHeading scene={scene} />
    </AbsoluteFill>
  );
};

const CausalScene: React.FC<SceneProps> = ({scene}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const progress = interpolate(frame, [6, 42], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const lineLength = Math.hypot(width * 0.26, height * 0.08);

  // SOURCE_SCENE: causal-mechanical-evidence
  // LAYOUT_BLUEPRINT: causal-mechanical-evidence-custom
  // MATERIALIZATION: A deterministic SVG force-and-response link makes the causal change itself visible.
  return (
    <AbsoluteFill style={canvasStyle}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{position: "absolute", inset: 0, width: "100%", height: "100%"}} aria-hidden>
        <defs><marker id="causal-arrow" markerWidth="14" markerHeight="14" refX="10" refY="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#e8b86d" /></marker></defs>
        <circle cx={width * 0.28} cy={height * 0.5} r={72 + progress * 18} fill="rgba(139,211,221,0.2)" stroke="#8bd3dd" strokeWidth={5} />
        <line x1={width * 0.36} y1={height * 0.5} x2={width * 0.64} y2={height * 0.5} stroke="#e8b86d" strokeWidth={8} strokeDasharray={lineLength} strokeDashoffset={lineLength * (1 - progress)} markerEnd="url(#causal-arrow)" />
        <circle cx={width * 0.72} cy={height * 0.5} r={72} fill={`rgba(232,184,109,${0.16 + progress * 0.24})`} stroke="#e8b86d" strokeWidth={5} />
        <path d={`M ${width * 0.28} ${height * 0.5} C ${width * 0.4} ${height * 0.32}, ${width * 0.6} ${height * 0.68}, ${width * 0.72} ${height * 0.5}`} fill="none" stroke="rgba(242,242,244,0.22)" strokeWidth={2} opacity={progress} />
      </svg>
      <SceneHeading scene={scene} />
    </AbsoluteFill>
  );
};

export type GeneratedVideoProps = {project: VideoProject};

export const GeneratedVideo: React.FC<GeneratedVideoProps> = ({project}) => {
  const [headline, comparison, causal] = project.scenes;
  const comparisonStart = headline.durationInFrames;
  const causalStart = comparisonStart + comparison.durationInFrames;

  return (
    <AbsoluteFill style={canvasStyle}>
      <Sequence from={0} durationInFrames={headline.durationInFrames}><HeadlineScene scene={headline} /></Sequence>
      <Sequence from={comparisonStart} durationInFrames={comparison.durationInFrames}><ComparisonScene scene={comparison} /></Sequence>
      <Sequence from={causalStart} durationInFrames={causal.durationInFrames}><CausalScene scene={causal} /></Sequence>
    </AbsoluteFill>
  );
};
