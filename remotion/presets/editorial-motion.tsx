import React from "react";
import {Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";
import type {CSSProperties, ReactNode} from "react";

export const EDITORIAL_PALETTE = {
  paper: "#F5F2E9",
  sheet: "#FFFDF8",
  ink: "#242421",
  coral: "#F06B5B",
  coralInk: "#A84234",
  yellow: "#F6D86E",
  gray: "#B9B5AB",
  line: "#DED9CE",
  muted: "#79766F",
  soft: "#F2EFE7",
} as const;

export const EDITORIAL_FONTS = {
  sans: "Inter, Arial, sans-serif",
  mono: "IBM Plex Mono, SFMono-Regular, Consolas, monospace",
} as const;

export type EditorialRect = {left: number; top: number; width: number; height: number};

/** `handoffFrame` is the layout-change beat; `boundaryFrame` is a legacy alias. */
type SharedLayoutTiming =
  | {startFrame: number; handoffFrame: number; endFrame: number; boundaryFrame?: never}
  | {startFrame: number; handoffFrame?: never; endFrame: number; boundaryFrame: number};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const normalized = (value: string) => value.normalize("NFC").toLocaleLowerCase("vi-VN").replace(/[^\p{L}\p{N}]+/gu, "");

export const editorialCardStyle = (extra: CSSProperties = {}): CSSProperties => ({
  background: EDITORIAL_PALETTE.sheet,
  border: "2px solid " + EDITORIAL_PALETTE.line,
  borderRadius: 22,
  boxShadow: "0 18px 34px rgba(49, 43, 31, .075)",
  boxSizing: "border-box",
  ...extra,
});

export const EditorialCard: React.FC<{children: ReactNode; style?: CSSProperties}> = ({children, style}) => (
  <div style={editorialCardStyle(style)}>{children}</div>
);

export const PixelBotIcon: React.FC<{style?: CSSProperties; color?: string; faceColor?: string; title?: string}> = ({
  style,
  color = EDITORIAL_PALETTE.coral,
  faceColor = EDITORIAL_PALETTE.paper,
  title,
}) => (
  <svg width="76" height="58" viewBox="0 0 76 58" style={{display: "block", overflow: "visible", ...style}} aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
    {title ? <title>{title}</title> : null}
    <path fill={color} d="M12 4h52v10h10v26H64v10H52v8H44V48H28v10h-8V48H12V40H2V14h10z" />
    <path fill={faceColor} d="M24 17h7v8h-7zm22 0h7v8h-7z" />
  </svg>
);

export const BlinkingCaret: React.FC<{color?: string; width?: number; cycleFrames?: number}> = ({
  color = EDITORIAL_PALETTE.coralInk,
  width = 5,
  cycleFrames = 30,
}) => {
  const frame = useCurrentFrame();
  const halfCycle = Math.max(1, cycleFrames / 2);
  const opacity = frame % cycleFrames < halfCycle ? 1 : 0.12;
  return <span style={{display: "inline-block", width, height: "1em", background: color, marginLeft: 4, verticalAlign: "-0.12em", opacity}} aria-hidden="true" />;
};

export type TypewriterTextProps = {
  text: string;
  durationInFrames: number;
  startFrame?: number;
  minCharacters?: number;
  showCaret?: boolean;
  reserveSpace?: boolean;
  mono?: boolean;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  style?: CSSProperties;
};

export const TypewriterText: React.FC<TypewriterTextProps> = ({
  text,
  durationInFrames,
  startFrame = 0,
  minCharacters = 0,
  showCaret = true,
  reserveSpace = false,
  mono = false,
  fontSize = 34,
  fontWeight = 550,
  color = EDITORIAL_PALETTE.ink,
  style,
}) => {
  const frame = useCurrentFrame();
  const elapsed = Math.max(0, frame - startFrame);
  const duration = Math.max(1, durationInFrames);
  const progress = interpolate(elapsed, [0, duration], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const minimum = Math.max(0, Math.min(text.length, Math.floor(minCharacters)));
  const count = Math.max(minimum, Math.min(text.length, Math.floor(text.length * progress)));
  const caretActive = showCaret && frame >= startFrame && frame <= startFrame + durationInFrames;
  const rootStyle: CSSProperties = {
    display: reserveSpace ? "inline-grid" : "inline-block",
    whiteSpace: "pre-wrap",
    fontFamily: mono ? EDITORIAL_FONTS.mono : EDITORIAL_FONTS.sans,
    fontSize,
    lineHeight: 1.38,
    fontWeight,
    color,
    ...style,
  };
  const revealed = <>{text.slice(0, count)}{caretActive ? <BlinkingCaret /> : null}</>;
  if (!reserveSpace) return <span style={rootStyle}>{revealed}</span>;
  return (
    <span style={rootStyle}>
      <span style={{gridArea: "1 / 1", visibility: "hidden"}} aria-hidden="true">{text}</span>
      <span style={{gridArea: "1 / 1"}}>{revealed}</span>
    </span>
  );
};

export type SweptHighlightTextProps = {
  text: string;
  startFrame: number;
  durationInFrames: number;
  highlight?: boolean;
  color?: string;
  highlightColor?: string;
  size?: number;
  weight?: number;
  mono?: boolean;
  style?: CSSProperties;
};

export const SweptHighlightText: React.FC<SweptHighlightTextProps> = ({
  text,
  startFrame,
  durationInFrames,
  highlight = false,
  color = EDITORIAL_PALETTE.ink,
  highlightColor = EDITORIAL_PALETTE.yellow,
  size = 32,
  weight = 550,
  mono = false,
  style,
}) => {
  const frame = useCurrentFrame();
  const progress = highlight
    ? interpolate(frame, [startFrame, startFrame + Math.max(1, durationInFrames)], [0, 1], {easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp"})
    : 0;
  return (
    <span style={{position: "relative", display: "inline-block", fontFamily: mono ? EDITORIAL_FONTS.mono : EDITORIAL_FONTS.sans, fontSize: size, lineHeight: 1.35, fontWeight: weight, color, ...style}}>
      {highlight ? <span style={{position: "absolute", zIndex: 0, inset: "0 -0.08em", background: highlightColor, borderRadius: 3, transform: "scaleX(" + progress + ")", transformOrigin: "left center", opacity: 0.86}} aria-hidden="true" /> : null}
      <span style={{position: "relative", zIndex: 1}}>{text}</span>
    </span>
  );
};

export type WordCaptionCue = {
  text: string;
  startFrame: number;
  revealInFrames: number;
  highlightPhrases?: string[];
};

type WordCaptionProps = WordCaptionCue & {style?: CSSProperties; highlightSweepInFrames?: number};

export const WordCaption: React.FC<WordCaptionProps> = ({
  text,
  startFrame,
  revealInFrames,
  highlightPhrases = [],
  highlightSweepInFrames = 8,
  style,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const words = text.trim().split(/\s+/).filter(Boolean);
  const step = Math.max(2, revealInFrames / Math.max(1, words.length));
  const normalizedWords = words.map(normalized);
  const highlighted = new Set<number>();

  for (const phrase of highlightPhrases) {
    const parts = phrase.trim().split(/\s+/).filter(Boolean).map(normalized);
    if (parts.length === 0) continue;
    for (let i = 0; i <= normalizedWords.length - parts.length; i++) {
      if (parts.every((part, j) => normalizedWords[i + j] === part)) {
        for (let j = 0; j < parts.length; j++) highlighted.add(i + j);
      }
    }
  }

  return (
    <div style={{position: "absolute", left: "6%", right: "6%", bottom: "16%", minHeight: 208, boxSizing: "border-box", padding: "27px 30px 26px 34px", background: "rgba(255,253,248,.96)", border: "1px solid " + EDITORIAL_PALETTE.line, borderLeft: "6px solid " + EDITORIAL_PALETTE.coralInk, boxShadow: "0 10px 23px rgba(44,39,30,.045)", display: "flex", alignContent: "center", alignItems: "baseline", flexWrap: "wrap", columnGap: 12, rowGap: 0, overflow: "hidden", ...style}}>
      {words.map((word, index) => {
        const age = frame - startFrame - index * step;
        const rawPop = age < 0 ? 0 : spring({frame: age, fps, config: {damping: 13, stiffness: 210, mass: 0.62}});
        const pop = clamp01(rawPop);
        const selected = highlighted.has(index);
        const mark = selected && age >= 0
          ? interpolate(age, [0, Math.max(1, highlightSweepInFrames)], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})
          : 0;
        const current = age >= 0 && age < step * 0.9;
        return (
          <span key={index + "-" + word} style={{position: "relative", display: "inline-block", opacity: pop, translate: "0px " + ((1 - pop) * 16) + "px", scale: String(0.94 + pop * 0.06), fontFamily: EDITORIAL_FONTS.sans, fontSize: 40, lineHeight: 1.34, fontWeight: 590, color: current ? EDITORIAL_PALETTE.coralInk : EDITORIAL_PALETTE.ink, whiteSpace: "pre"}}>
            {selected ? <span style={{position: "absolute", zIndex: 0, inset: "0 -0.04em", borderRadius: 3, background: EDITORIAL_PALETTE.yellow, transform: "scaleX(" + mark + ")", transformOrigin: "left center", opacity: 0.88}} aria-hidden="true" /> : null}
            <span style={{position: "relative", zIndex: 1}}>{word}</span>
          </span>
        );
      })}
    </div>
  );
};

export const WordCaptionTrack: React.FC<{cues: WordCaptionCue[]; style?: CSSProperties}> = ({cues, style}) => {
  const frame = useCurrentFrame();
  const active = [...cues].sort((a, b) => a.startFrame - b.startFrame).filter((cue) => frame >= cue.startFrame).at(-1);
  if (!active) return null;
  return <WordCaption key={active.startFrame} {...active} style={style} />;
};

export const verticalPopStyle = (frame: number, startFrame: number, fps = 30, distance = 18): CSSProperties => {
  const p = frame < startFrame ? 0 : clamp01(spring({frame: frame - startFrame, fps, config: {damping: 16, stiffness: 155, mass: 0.7}}));
  return {opacity: p, translate: "0px " + ((1 - p) * distance) + "px", scale: String(0.985 + p * 0.015)};
};

export const RiseIn: React.FC<{children: ReactNode; startFrame: number; durationInFrames?: number; distance?: number; style?: CSSProperties}> = ({
  children,
  startFrame,
  durationInFrames = 18,
  distance = 18,
  style,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const raw = frame < startFrame ? 0 : spring({frame: frame - startFrame, fps, config: {damping: 16, stiffness: 155, mass: 0.7}});
  const p = clamp01(raw);
  const age = frame - startFrame;
  const opacity = age < 0 ? 0 : interpolate(age, [0, Math.max(1, durationInFrames)], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  return <div style={{opacity: Math.min(p, opacity), translate: "0px " + ((1 - p) * distance) + "px", scale: String(0.985 + p * 0.015), ...style}}>{children}</div>;
};

export const PanelHandoff: React.FC<{
  from: EditorialRect;
  to: EditorialRect;
  content?: ReactNode;
  /** @deprecated Use `content`. Kept for older generated sources. */
  fromContent?: ReactNode;
  /** @deprecated Ignored. A handoff keeps the same information visible. */
  toContent?: ReactNode;
  style?: CSSProperties;
} & SharedLayoutTiming> = (props) => {
  const {from, to, startFrame, endFrame, content, fromContent, style} = props;
  const handoffFrame = props.handoffFrame ?? props.boundaryFrame;
  const frame = useCurrentFrame();
  if (frame < startFrame || frame > endFrame) return null;
  if (handoffFrame === undefined || !(startFrame < handoffFrame && handoffFrame < endFrame)) {
    throw new Error("PanelHandoff's handoffFrame must sit inside its movement window.");
  }
  const persistentContent = content ?? fromContent;
  if (persistentContent === undefined) {
    throw new Error("PanelHandoff requires persistent content.");
  }
  const progress = interpolate(frame, [startFrame, endFrame], [0, 1], {easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const rect = {
    left: interpolate(progress, [0, 1], [from.left, to.left]),
    top: interpolate(progress, [0, 1], [from.top, to.top]),
    width: interpolate(progress, [0, 1], [from.width, to.width]),
    height: interpolate(progress, [0, 1], [from.height, to.height]),
  };
  return (
    <div style={{...editorialCardStyle({overflow: "hidden", padding: 24, ...style}), position: "absolute", zIndex: 20, opacity: 1, pointerEvents: "none", left: rect.left, top: rect.top, width: rect.width, height: rect.height}}>
      {persistentContent}
    </div>
  );
};

export type SharedLayoutItem = {
  id: string;
  from: EditorialRect;
  to: EditorialRect;
  /** Measured intermediate rectangles along the shared 0..1 transition progress. */
  waypoints?: Array<{progress: number; rect: EditorialRect}>;
  /** The same information-bearing object rendered continuously for the whole move. */
  content?: ReactNode;
  /** @deprecated Use `content`. Kept so older generated sources remain type-compatible. */
  fromContent?: ReactNode;
  /** @deprecated Ignored. A shared-layout move never crossfades to replacement content. */
  toContent?: ReactNode;
  zIndex?: number;
  style?: CSSProperties;
};

export type SharedLayoutWindow = {
  startFrame: number;
  endFrame: number;
  ids: readonly string[];
};

/**
 * Use with composition-frame time to hide only the scene-local copies carried
 * by a composition-level SharedLayoutTransition. Keep the source and target
 * copies mounted at their exact endpoint rectangles; do not hide the whole scene.
 */
export const isSharedLayoutIdActive = (
  id: string,
  compositionFrame: number,
  windows: readonly SharedLayoutWindow[],
): boolean => windows.some((window) => (
  compositionFrame >= window.startFrame
  && compositionFrame <= window.endFrame
  && window.ids.includes(id)
));

/**
 * Render one scene-local endpoint copy for a composition-level shared-layout
 * overlay. Use the same id, rect, visual style, and child tree as the matching
 * SharedLayoutTransition item. Only this carried copy is hidden while the
 * overlay owns the object.
 */
export const SharedLayoutSceneCopy: React.FC<{
  id: string;
  sceneStartFrame: number;
  rect: EditorialRect;
  windows: readonly SharedLayoutWindow[];
  children: ReactNode;
  style?: CSSProperties;
  zIndex?: number;
}> = ({id, sceneStartFrame, rect, windows, children, style, zIndex = 2}) => {
  const compositionFrame = useCurrentFrame() + sceneStartFrame;
  const carriedByOverlay = isSharedLayoutIdActive(id, compositionFrame, windows);

  return (
    <div
      data-shared-layout-id={id}
      style={{
        ...editorialCardStyle({overflow: "hidden", padding: 24, ...style}),
        position: "absolute",
        zIndex,
        visibility: carriedByOverlay ? "hidden" : "visible",
        ...rect,
      }}
    >
      {children}
    </div>
  );
};

const rectAtSharedProgress = (
  from: EditorialRect,
  to: EditorialRect,
  progress: number,
  waypoints: Array<{progress: number; rect: EditorialRect}> = [],
): EditorialRect => {
  if (waypoints.length === 0) {
    return {
      left: interpolate(progress, [0, 1], [from.left, to.left]),
      top: interpolate(progress, [0, 1], [from.top, to.top]),
      width: interpolate(progress, [0, 1], [from.width, to.width]),
      height: interpolate(progress, [0, 1], [from.height, to.height]),
    };
  }

  const stops = [{progress: 0, rect: from}, ...waypoints, {progress: 1, rect: to}];
  let segmentIndex = stops.length - 2;
  for (let index = 1; index < stops.length; index++) {
    if (progress <= stops[index].progress) {
      segmentIndex = index - 1;
      break;
    }
  }

  const before = stops[Math.max(0, segmentIndex - 1)];
  const start = stops[segmentIndex];
  const end = stops[segmentIndex + 1];
  const after = stops[Math.min(stops.length - 1, segmentIndex + 2)];
  const duration = end.progress - start.progress;
  const t = interpolate(progress, [start.progress, end.progress], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const t2 = t * t;
  const t3 = t2 * t;

  const hermite = (key: keyof EditorialRect) => {
    const v0 = before.rect[key];
    const v1 = start.rect[key];
    const v2 = end.rect[key];
    const v3 = after.rect[key];
    const flatSegment = Math.abs(v2 - v1) < 0.01;
    const flatBefore = Math.abs(v1 - v0) < 0.01;
    const flatAfter = Math.abs(v3 - v2) < 0.01;
    const tangentStart = flatSegment || flatBefore
      ? 0
      : segmentIndex === 0
        ? v2 - v1
        : ((v2 - v0) / (end.progress - before.progress)) * duration;
    const tangentEnd = flatSegment || flatAfter
      ? 0
      : segmentIndex === stops.length - 2
        ? v2 - v1
        : ((v3 - v1) / (after.progress - start.progress)) * duration;

    return (2 * t3 - 3 * t2 + 1) * v1
      + (t3 - 2 * t2 + t) * tangentStart
      + (-2 * t3 + 3 * t2) * v2
      + (t3 - t2) * tangentEnd;
  };

  return {left: hermite("left"), top: hermite("top"), width: hermite("width"), height: hermite("height")};
};

export const SharedLayoutTransition: React.FC<{
  items: SharedLayoutItem[];
} & SharedLayoutTiming> = (props) => {
  const {items, startFrame, endFrame} = props;
  const handoffFrame = props.handoffFrame ?? props.boundaryFrame;
  const frame = useCurrentFrame();
  if (items.length < 2) {
    throw new Error("SharedLayoutTransition requires at least two persistent items; use PanelHandoff for a single object.");
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("SharedLayoutTransition item IDs must be unique.");
  }
  for (const item of items) {
    let previousProgress = 0;
    for (const waypoint of item.waypoints ?? []) {
      if (!Number.isFinite(waypoint.progress) || waypoint.progress <= previousProgress || waypoint.progress >= 1) {
        throw new Error(`SharedLayoutTransition waypoints for ${item.id} must be strictly increasing between 0 and 1.`);
      }
      const values = [waypoint.rect.left, waypoint.rect.top, waypoint.rect.width, waypoint.rect.height];
      if (!values.every(Number.isFinite) || waypoint.rect.width <= 0 || waypoint.rect.height <= 0) {
        throw new Error(`SharedLayoutTransition waypoint rectangles for ${item.id} must have finite coordinates and positive dimensions.`);
      }
      previousProgress = waypoint.progress;
    }
  }
  if (handoffFrame === undefined || !(startFrame < handoffFrame && handoffFrame < endFrame)) {
    throw new Error("SharedLayoutTransition's handoffFrame must sit inside its movement window.");
  }
  if (frame < startFrame || frame > endFrame) return null;
  const progress = interpolate(frame, [startFrame, endFrame], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      {items.map((item) => {
        const rect = rectAtSharedProgress(item.from, item.to, progress, item.waypoints);
        const content = item.content ?? item.fromContent;
        if (content === undefined) {
          throw new Error(`SharedLayoutTransition item ${item.id} requires persistent content.`);
        }

        return (
          <div
            key={item.id}
            data-shared-layout-id={item.id}
            style={{
              ...editorialCardStyle({overflow: "hidden", padding: 24, ...item.style}),
              position: "absolute",
              zIndex: item.zIndex ?? 20,
              // Keep the overlay opaque at both exact endpoints so ownership
              // can pass to the scene-local copy without a blank frame.
              opacity: 1,
              pointerEvents: "none",
              ...rect,
            }}
          >
            {content}
          </div>
        );
      })}
    </>
  );
};
