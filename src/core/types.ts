export type VideoThemeMode = "dark" | "light";
/** Optional pins for renderer color roles. Each value must be a member of `palette`. */
export interface VideoThemeRoles {
  page?: string;
  text?: string;
  accent?: string;
}
export interface VideoTheme {
  palette: string[];
  font: string;
  /** Canvas polarity. Defaults to "dark": the darkest palette color becomes the page. */
  mode?: VideoThemeMode;
  roles?: VideoThemeRoles;
}
export interface VideoConstraints {
  style: string;
  disallowed: string[];
  motionTone: string;
}

export interface SceneAudio {
  voiceoverText: string;
  /** Stable Script-stage TTS segment ID; present after approved narration is bound. */
  voiceSegmentId?: string;
}

export interface Scene {
  id: string;
  /** Sequential frame budget. For narrated scenes, cover measured Script-stage TTS rounded up to a frame; add time only for purposeful visual pacing. All scene budgets sum to the composition budget. */
  durationInFrames: number;
  /** Omit audio for silent/text-led scenes. When present, this is approved narration text only. */
  audio?: SceneAudio;
  screenText: string;
  /** Semantic visual WHAT/WHY, never asset paths, geometry, components, or animation recipes. */
  visualConcept: string;
}

/** Canonical semantic truth written to video.json. Top-level keys are exactly meta and scenes. */
export interface VideoProject {
  meta: {
    title: string;
    width: number;
    height: number;
    durationsInFrames: number;
    fps: number;
    theme: VideoTheme;
    constraints: VideoConstraints;
  };
  scenes: Scene[];
}

export type ValidationSeverity = "error" | "warning";
export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface AuthorPreflightIssue {
  code: string;
  severity: "error" | "warning";
  blocking: boolean;
  message: string;
  path: string;
}

export interface AuthorPreflightReport {
  valid: boolean;
  issues: AuthorPreflightIssue[];
}

export interface HarnessPatchOperation {
  op: "replace" | "add" | "remove";
  path: string;
  value?: unknown;
  oldValue?: unknown;
}

export interface HarnessPatchDocument {
  /** Revision lives in .video/project-state.json, outside canonical semantic content. */
  baseRevision: number;
  operations: HarnessPatchOperation[];
}
