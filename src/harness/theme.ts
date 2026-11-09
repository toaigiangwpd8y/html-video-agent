import type {VideoProject, VideoThemeMode} from "../core/types.js";
import type {AssetManifestItem} from "./remotion-manifest.js";

/**
 * Canonical `meta.theme` is `{palette, font}` plus optional `mode` and `roles`.
 * The renderer needs named roles, so any role the author did not pin is
 * derived deterministically from measured palette properties, never by position.
 *
 * Derivation contract (stable, do not reorder):
 *   page      = roles.page, else lowest relative luminance ("dark", the default)
 *               or highest relative luminance ("light")
 *   text      = roles.text, else highest contrast against page, excluding page
 *   accent    = roles.accent, else highest OKLab chroma among the remaining colors
 *   accentAlt = highest remaining chroma after accent, else accent
 * Ties break by original palette index, so one theme always yields one token set.
 * `meta.theme` is never rewritten: derived roles are renderer-side only.
 */

export interface ThemeWarning {
  code: string;
  message: string;
}

export interface ThemeTokens {
  mode: VideoThemeMode;
  page: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  borderLit: string;
  text: string;
  textMuted: string;
  accent: string;
  accentAlt: string;
  onAccent: string;
  /** CSS font-family stack: the canonical family followed by a generic fallback. */
  fontDisplay: string;
  fontText: string;
  palette: string[];
}

export type ThemeRole = "hero" | "heading" | "subheading" | "body" | "caption";

/** Shared with the vendored Onda family's `resolveSize` roles. */
export const TYPE_SCALE: Record<ThemeRole, number> = {
  hero: 0.15,
  heading: 0.09,
  subheading: 0.052,
  body: 0.03,
  caption: 0.02,
};

export interface DerivedTheme {
  tokens: ThemeTokens;
  cssVars: Record<string, string>;
  warnings: ThemeWarning[];
}

export interface FontFaceBinding {
  family: string;
  publicPath: string;
  weight?: string;
  style?: string;
  assetId: string;
}

const CONTRAST_TEXT_MIN = 4.5;
const CONTRAST_ACCENT_MIN = 3;
const GENERIC_FONT_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong"]);

function parseHex(value: string): {r: number; g: number; b: number} | undefined {
  const hex = value.replace(/^#/, "");
  if (hex.length !== 6 && hex.length !== 8) return undefined;
  if (!/^[0-9A-Fa-f]+$/.test(hex)) return undefined;
  return {r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16)};
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: {r: number; g: number; b: number}): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/** OKLab chroma: hue-agnostic "how colorful", used to pick accents by measurement. */
function oklabChroma(color: {r: number; g: number; b: number}): number {
  const r = linearize(color.r), g = linearize(color.g), b = linearize(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return Math.hypot(a, bb);
}

export function contrastRatio(a: string, b: string): number {
  const left = parseHex(a), right = parseHex(b);
  if (!left || !right) return 1;
  const la = relativeLuminance(left), lb = relativeLuminance(right);
  const [high, low] = la >= lb ? [la, lb] : [lb, la];
  return (high + 0.05) / (low + 0.05);
}

/**
 * Mixes color channels in encoded sRGB space, which is what surface/border
 * derivation is specified against: `mix(darkCanvas, lightText, 0.06)` must read
 * as a 6% lift, not as 6% of linear light (which lands near mid-gray on a dark
 * canvas). Gamma-aware math is deliberately limited to luminance and contrast.
 */
function mix(from: string, to: string, amount: number): string {
  const a = parseHex(from), b = parseHex(to);
  if (!a || !b) return from;
  const channel = (x: number, y: number) =>
    Math.max(0, Math.min(255, Math.round(x * (1 - amount) + y * amount)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

/** Quotes a named family and appends a generic fallback so a missing face degrades predictably. */
export function fontStack(font: string): string {
  const family = font.trim();
  if (GENERIC_FONT_FAMILIES.has(family.toLowerCase())) return family.toLowerCase();
  return `${JSON.stringify(family)}, sans-serif`;
}

export function deriveTheme(project: VideoProject): DerivedTheme {
  const warnings: ThemeWarning[] = [];
  const {palette: canonicalPalette, font, mode = "dark", roles = {}} = project.meta.theme;
  const palette = canonicalPalette.slice();
  const measured = palette.map((hex, index) => {
    const parsed = parseHex(hex) ?? {r: 0, g: 0, b: 0};
    return {hex, index, luminance: relativeLuminance(parsed), chroma: oklabChroma(parsed)};
  });
  // Pinned roles are validated as palette members; match case-insensitively so tokens keep the palette spelling.
  const pinned = (hex: string | undefined) => (hex === undefined ? undefined : measured.find((entry) => entry.hex.toUpperCase() === hex.toUpperCase()));

  const byLuminance = [...measured].sort((a, b) => a.luminance - b.luminance || a.index - b.index);
  const page = pinned(roles.page) ?? (mode === "light" ? [...measured].sort((a, b) => b.luminance - a.luminance || a.index - b.index)[0] : byLuminance[0]);
  const textCandidate =
    pinned(roles.text) ??
    measured
      .filter((entry) => entry.index !== page.index)
      .sort((a, b) => contrastRatio(b.hex, page.hex) - contrastRatio(a.hex, page.hex) || a.index - b.index)[0];

  if (!textCandidate) {
    warnings.push({
      code: "THEME_SINGLE_COLOR",
      message: `meta.theme.palette holds one color, so the text role was synthesized by maximum contrast against ${page.hex}. Add a contrasting color when the video needs intentional typography.`,
    });
  }
  if (mode === "light" && !roles.page && page.luminance < 0.5) {
    warnings.push({
      code: "THEME_MODE_MISMATCH",
      message: `meta.theme.mode is 'light' but the lightest palette color ${page.hex} is dark. Add a light canvas color or pin meta.theme.roles.page.`,
    });
  }

  // Best-contrast on-color for text sitting on a colored surface (accent chips, badges).
  const onColor = (surface: string) =>
    contrastRatio("#FFFFFF", surface) >= contrastRatio("#000000", surface) ? "#FFFFFF" : "#000000";
  const text = textCandidate?.hex ?? onColor(page.hex);
  const remaining = measured
    .filter((entry) => entry.index !== page.index && entry.index !== textCandidate?.index)
    .sort((a, b) => b.chroma - a.chroma || a.index - b.index);
  const accentEntry = pinned(roles.accent) ?? remaining[0];

  if (!accentEntry) {
    warnings.push({
      code: "THEME_NO_DISTINCT_ACCENT",
      message: "meta.theme.palette has no color beyond page and text, so the accent role falls back to the text color. Add a third color when the video needs a distinct accent.",
    });
  }

  const accent = accentEntry?.hex ?? text;
  const accentAlt = remaining.find((entry) => entry.index !== accentEntry?.index)?.hex ?? accent;

  const pageTextContrast = contrastRatio(page.hex, text);
  if (pageTextContrast < CONTRAST_TEXT_MIN) {
    warnings.push({
      code: "THEME_CONTRAST_LOW",
      message: `Derived text ${text} on canvas ${page.hex} measures ${pageTextContrast.toFixed(2)}:1, below ${CONTRAST_TEXT_MIN}:1. Verify legibility or supply a palette with more separation.`,
    });
  }
  const accentContrast = contrastRatio(accent, page.hex);
  if (accentContrast < CONTRAST_ACCENT_MIN) {
    warnings.push({
      code: "THEME_ACCENT_LOW_CONTRAST",
      message: `Derived accent ${accent} measures ${accentContrast.toFixed(2)}:1 against canvas ${page.hex}, below ${CONTRAST_ACCENT_MIN}:1; accents may not read on this canvas.`,
    });
  }

  const tokens: ThemeTokens = {
    mode,
    page: page.hex,
    surface: mix(page.hex, text, 0.06),
    surfaceRaised: mix(page.hex, text, 0.1),
    border: mix(page.hex, text, 0.16),
    borderLit: mix(page.hex, text, 0.26),
    text,
    textMuted: mix(text, page.hex, 0.28),
    accent,
    accentAlt,
    onAccent: onColor(accent),
    fontDisplay: fontStack(font),
    fontText: fontStack(font),
    palette,
  };

  // `--video-*` is the harness-owned, vendor-neutral ABI. Each vendored family
  // gets an alias block below so it themes itself without source edits.
  const neutral: Record<string, string> = {
    "--video-page": tokens.page,
    "--video-surface": tokens.surface,
    "--video-surface-raised": tokens.surfaceRaised,
    "--video-border": tokens.border,
    "--video-border-lit": tokens.borderLit,
    "--video-text": tokens.text,
    "--video-text-muted": tokens.textMuted,
    "--video-accent": tokens.accent,
    "--video-accent-alt": tokens.accentAlt,
    "--video-on-accent": tokens.onAccent,
    "--video-font-display": tokens.fontDisplay,
    "--video-font-text": tokens.fontText,
  };
  const onda: Record<string, string> = {
    "--onda-bg": tokens.page,
    "--onda-surface": tokens.surface,
    "--onda-border": tokens.border,
    "--onda-border-lit": tokens.borderLit,
    "--onda-text": tokens.text,
    "--onda-accent": tokens.accent,
    "--onda-font-display": tokens.fontDisplay,
  };

  return {tokens, cssVars: {...neutral, ...onda}, warnings};
}

export function themeFontFamilies(assets: AssetManifestItem[]): string[] {
  const families = new Set<string>();
  for (const asset of assets) {
    if (asset.role !== "font") continue;
    const family = typeof asset.family === "string" ? asset.family.trim() : "";
    if (family) families.add(family);
  }
  return [...families].sort();
}

export function themeFontBindingWarning(project: VideoProject, assets: AssetManifestItem[]): ThemeWarning | undefined {
  const wanted = project.meta.theme.font.trim().toLowerCase();
  if (GENERIC_FONT_FAMILIES.has(wanted)) return undefined;
  const families = themeFontFamilies(assets);
  if (families.some((family) => family.toLowerCase() === wanted)) return undefined;
  return {
    code: "THEME_FONT_UNBOUND",
    message: families.length
      ? `meta.theme.font '${project.meta.theme.font}' matches no manifest font asset (registered families: ${families.join(", ")}). Rendering falls back to an OS font.`
      : `meta.theme.font '${project.meta.theme.font}' has no manifest font asset with role 'font', so typography falls back to an OS font. Register a local font file under assets/ with role 'font' and a matching family.`,
  };
}

export function resolveFontBindings(assets: AssetManifestItem[]): FontFaceBinding[] {
  const bindings: FontFaceBinding[] = [];
  for (const asset of assets) {
    if (asset.role !== "font") continue;
    const family = typeof asset.family === "string" ? asset.family.trim() : "";
    if (!family || !asset.id || typeof asset.publicPath !== "string" || !asset.publicPath.startsWith("/assets/")) continue;
    bindings.push({
      family,
      publicPath: asset.publicPath,
      ...(asset.weight === undefined ? {} : {weight: asset.weight}),
      ...(asset.style === undefined ? {} : {style: asset.style}),
      assetId: asset.id,
    });
  }
  return bindings.sort((a, b) => a.assetId.localeCompare(b.assetId));
}

/** Emits `remotion/generated/theme.ts`, the single source of renderer color and typography tokens. */
export function renderThemeModule(project: VideoProject, derived: DerivedTheme): string {
  const warnings = derived.warnings.length
    ? derived.warnings.map((warning) => `// WARNING ${warning.code}: ${warning.message}`).join("\n")
    : "// No theme derivation warnings.";
  return `// HARNESS-GENERATED from canonical video.json meta.theme. Do not edit by hand.
// Re-emitted by \`video remotion prepare\` and by every renderer sync.
// Token contract: .agents/skills/agent-video/references/remotion-handoff.md
${warnings}
import type {CSSProperties} from "react";
import "./fonts";

export interface ThemeTokens {
  mode: "dark" | "light";
  page: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  borderLit: string;
  text: string;
  textMuted: string;
  accent: string;
  accentAlt: string;
  onAccent: string;
  fontDisplay: string;
  fontText: string;
  palette: string[];
}

export const theme: ThemeTokens = ${JSON.stringify(derived.tokens, null, 2)};

/**
 * CSS custom properties; spread onto the composition's root AbsoluteFill.
 * \`--video-*\` is the neutral contract; \`--onda-*\` aliases theme the vendored Onda family.
 */
export const themeCssVars = ${JSON.stringify(derived.cssVars, null, 2)} as const;
export const themeCssVarsStyle = themeCssVars as unknown as CSSProperties;

export type ThemeRole = "hero" | "heading" | "subheading" | "body" | "caption";
const TYPE_SCALE: Record<ThemeRole, number> = ${JSON.stringify(TYPE_SCALE, null, 2)};
/** Font size in px for a role, scaled against the shorter composition edge. */
export const typeScale = (role: ThemeRole, canvas: {width: number; height: number}): number =>
  Math.round(TYPE_SCALE[role] * Math.min(canvas.width, canvas.height));
`;
}

/**
 * Emits `remotion/generated/motion.ts`: optional rhythm defaults expressed in
 * this project's frames. Unlike theme tokens they are not binding; Remotion
 * keeps temporal freedom and may use local values when a scene needs them.
 */
export function renderMotionModule(project: VideoProject): string {
  const fps = project.meta.fps;
  const framesFromSeconds = (value: number) => Math.max(1, Math.round(value * fps));
  return `// HARNESS-GENERATED from canonical video.json meta.fps. Do not edit by hand.
// Optional motion-rhythm defaults. Remotion keeps temporal freedom: use these for
// cross-scene consistency, and use local values when a scene's timing needs them.
import type {SpringConfig} from "remotion";
import {Easing} from "remotion";

export const DURATION_IN_FRAMES = {fast: ${framesFromSeconds(0.4)}, normal: ${framesFromSeconds(0.8)}, slow: ${framesFromSeconds(1.2)}} as const;
export const DELAY_IN_FRAMES = {short: ${framesFromSeconds(0.1)}, normal: ${framesFromSeconds(0.2)}, long: ${framesFromSeconds(0.4)}} as const;
export const STAGGER_IN_FRAMES = {tight: ${framesFromSeconds(0.08)}, normal: ${framesFromSeconds(0.16)}, loose: ${framesFromSeconds(0.28)}} as const;
export const SECONDS_PER_FRAME = 1 / ${fps};
export const EASING = {enter: Easing.bezier(0.16, 1, 0.3, 1), exit: Easing.in(Easing.cubic)} as const;

const SPRING_SMOOTH: SpringConfig = {damping: 200, mass: 1, stiffness: 100, overshootClamping: true};
const SPRING_SNAPPY: SpringConfig = {damping: 20, mass: 0.8, stiffness: 200, overshootClamping: true};
const SPRING_BOUNCY: SpringConfig = {damping: 12, mass: 0.9, stiffness: 180, overshootClamping: false};
export const SPRING = {smooth: SPRING_SMOOTH, snappy: SPRING_SNAPPY, bouncy: SPRING_BOUNCY} as const;
`;
}

/** Emits `remotion/generated/fonts.ts`, which registers every manifest font face at import. */
export function renderFontsModule(project: VideoProject, assets: AssetManifestItem[]): string {
  const bindings = resolveFontBindings(assets);
  const header = `// HARNESS-GENERATED from assets/manifest.json font assets. Do not edit by hand.
// Re-emitted by \`video remotion prepare\` and by every renderer sync.
// Faces are registered by loadRegisteredFonts(), which remotion/root.tsx calls when the root component
// renders. Do not load at import time: Remotion's render entry evaluates remotion/no-react after user
// modules, which resets window.remotion_delayRenderHandles and orphans any delayRender() created earlier;
// the orphaned font handle is then never cleared and cancels every render longer than the timeout.
`;
  if (bindings.length === 0) {
    return `${header}
export interface RegisteredFontFace {
  family: string;
  url: string;
  weight?: string;
  style?: string;
  assetId: string;
}

/** meta.theme.font for this project; no manifest font asset matched it. */
export const unregisteredThemeFont: string | null = ${JSON.stringify(project.meta.theme.font)};
export const registeredFontFaces: RegisteredFontFace[] = [];

/** No manifest font faces are registered, so there is nothing to load. */
export const loadRegisteredFonts = (): void => {};
`;
  }
  const faces = bindings
    .map((binding) =>
      `  {${[
        `family: ${JSON.stringify(binding.family)}`,
        `url: ${JSON.stringify(binding.publicPath.replace(/^\//, ""))}`,
        ...(binding.weight === undefined ? [] : [`weight: ${JSON.stringify(String(binding.weight))}`]),
        ...(binding.style === undefined ? [] : [`style: ${JSON.stringify(binding.style)}`]),
        `assetId: ${JSON.stringify(binding.assetId)}`,
      ].join(", ")}}`,
    )
    .join(",\n");
  return `${header}
import {loadFont} from "@remotion/fonts";
import {staticFile} from "remotion";

export interface RegisteredFontFace {
  family: string;
  url: string;
  weight?: string;
  style?: string;
  assetId: string;
}

export const unregisteredThemeFont: string | null = null;
export const registeredFontFaces: RegisteredFontFace[] = [
${faces},
];

let fontsRequested = false;
/** Register every manifest face once. Call from a rendering component (remotion/root.tsx), never at import time. */
export const loadRegisteredFonts = (): void => {
  if (fontsRequested) return;
  fontsRequested = true;
  for (const face of registeredFontFaces) {
    void loadFont({
      family: face.family,
      url: staticFile(face.url),
      ...(face.weight === undefined ? {} : {weight: face.weight}),
      ...(face.style === undefined ? {} : {style: face.style}),
    });
  }
};
`;
}
