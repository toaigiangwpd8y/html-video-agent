import {Video} from "@remotion/media";
import {Img, interpolate, useCurrentFrame, useVideoConfig} from "remotion";

export type SplitScreenPanel = {
  src: string;
  label?: string;
  fit?: "cover" | "contain";
};

export type SplitScreenProps = {
  left: SplitScreenPanel;
  right: SplitScreenPanel;
  title?: string;
  wipeAtSeconds?: number;
  split?: number;
  backgroundColor?: string;
  accentColor?: string;
  theme?: "dark" | "light";
  holdSeconds?: number;
  speed?: number;
};

const T = {panels: 0, panelsFor: 0.62, title: 0.3, labels: 0.52, wipeFor: 1.1, exitFor: 0.42} as const;
const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;
const palettes = {
  dark: {page: "#08080b"},
  light: {page: "#f5f6f8"},
} as const;

function safeArea(width: number, height: number) {
  const horizontal = Math.round((80 / 1080) * width);
  const vertical = Math.round((100 / 1080) * height);
  return {paddingLeft: horizontal, paddingRight: horizontal, paddingTop: vertical, paddingBottom: vertical};
}

function mediaStyle(fit: "cover" | "contain" = "cover"): React.CSSProperties {
  return {width: "100%", height: "100%", objectFit: fit, display: "block"};
}

function isVideoSource(src: string) {
  return /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(src);
}

const Panel: React.FC<{panel: SplitScreenPanel}> = ({panel}) =>
  isVideoSource(panel.src) ? (
    <Video src={panel.src} muted loop fallbackOffthreadVideoProps={{pauseWhenBuffering: true}} style={mediaStyle(panel.fit)} />
  ) : (
    <Img src={panel.src} style={mediaStyle(panel.fit)} />
  );

/** Adapted from RemotionUI's default scenes/split-screen source. */
export const SplitScreen: React.FC<SplitScreenProps> = ({
  left,
  right,
  title,
  wipeAtSeconds,
  split = 0.5,
  backgroundColor,
  accentColor = "#E8B86D",
  theme = "dark",
  holdSeconds,
  speed = 1,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const palette = palettes[theme];
  const safe = safeArea(width, height);
  const at = (seconds: number) => (seconds * fps) / speed;
  const ease = (from: number, to: number, easing?: (value: number) => number) =>
    interpolate(frame, [at(from), at(to)], [0, 1], {easing, ...clamp});
  const editorial = (value: number) => value * value * (3 - 2 * value);
  const exitEase = (value: number) => value * value;
  const portrait = height > width;
  const u = portrait ? Math.min(width / 620, height / 1120) : Math.min(width / 1280, height / 720);
  const panelsIn = ease(T.panels, T.panels + T.panelsFor, editorial);
  const titleIn = title ? ease(T.title, T.title + 0.5) : 0;
  const labelsIn = ease(T.labels, T.labels + 0.45);
  const wipe = wipeAtSeconds === undefined ? 0 : ease(wipeAtSeconds, wipeAtSeconds + T.wipeFor, editorial);
  const exit = holdSeconds === undefined ? 0 : interpolate(frame, [at(holdSeconds), at(holdSeconds + T.exitFor)], [0, 1], {easing: exitEase, ...clamp});
  const at01 = interpolate(wipe, [0, 1], [split, 0]);
  const dividerPx = at01 * width;
  const handlePx = Math.min(Math.max(dividerPx, 22 * u), width - 22 * u);

  return (
    <div style={{width, height, background: backgroundColor ?? palette.page, fontFamily: "sans-serif", position: "relative", overflow: "hidden"}}>
      <div style={{position: "absolute", inset: 0, opacity: 1 - exit, scale: 1 - exit * 0.04}}>
        <div style={{position: "absolute", inset: 0}}>
          <div style={{width: "100%", height: "100%", translate: `${(1 - panelsIn) * 12}%`}}><Panel panel={right} /></div>
        </div>
        <div style={{position: "absolute", inset: 0, clipPath: `inset(0 ${(1 - at01) * 100}% 0 0)`}}>
          <div style={{width: "100%", height: "100%", translate: `${(1 - panelsIn) * -12}%`}}><Panel panel={left} /></div>
        </div>
        <div style={{position: "absolute", top: 0, bottom: 0, left: dividerPx - 1.5 * u, width: 3 * u, background: accentColor, boxShadow: `0 0 ${20 * u}px ${accentColor}88`, opacity: panelsIn}} />
        <div style={{position: "absolute", top: "50%", left: handlePx, width: 44 * u, height: 44 * u, marginLeft: -22 * u, marginTop: -22 * u, borderRadius: "50%", background: accentColor, display: "grid", placeItems: "center", boxShadow: `0 ${8 * u}px ${24 * u}px rgba(0,0,0,0.45)`, opacity: panelsIn, scale: interpolate(panelsIn, [0, 1], [0.6, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})}}>
          <svg width={22 * u} height={22 * u} viewBox="0 0 24 24" fill="none"><path d="M10 7 5.5 12 10 17M14 7l4.5 5-4.5 5" stroke={palette.page} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div style={{position: "absolute", inset: 0, background: `linear-gradient(180deg, ${palette.page}CC, transparent 34%, transparent 62%, ${palette.page}CC)`, pointerEvents: "none"}} />
        {title ? <div style={{position: "absolute", left: safe.paddingLeft, right: safe.paddingRight, top: safe.paddingTop, textAlign: "center", color: theme === "dark" ? "#F5F6F8" : "#17181c", fontSize: 42 * u, fontWeight: 700, letterSpacing: "-0.02em", opacity: titleIn, translate: `0 ${(1 - titleIn) * 12 * u}px`}}>{title}</div> : null}
        <div style={{position: "absolute", left: safe.paddingLeft, right: safe.paddingRight, top: safe.paddingTop + (title ? 62 * u : 0), display: "flex", justifyContent: "space-between", opacity: labelsIn}}>
          {[left, right].map((panel, index) => panel.label ? <div key={`${panel.label}-${index}`} style={{padding: `${9 * u}px ${18 * u}px`, borderRadius: 999, background: "rgba(8,8,11,0.66)", border: `1px solid ${accentColor}66`, color: "#F5F6F8", fontSize: 22 * u, fontWeight: 600, opacity: index === 0 ? 1 - wipe : 1, translate: `0 ${(1 - labelsIn) * 12 * u}px`}}>{panel.label}</div> : <span key={`spacer-${index}`} />)}
        </div>
      </div>
    </div>
  );
};
