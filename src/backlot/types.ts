import type { UniversalHitlEvent } from "../harness/hitl-protocol.js";
import type { VideoBrief } from "../harness/preproduction-hitl.js";
import type { VideoProject, AuthorPreflightReport } from "../core/types.js";
import type {RendererAvailability,RendererSelection} from "../harness/renderer-selection.js";
import type {ThemeTokens,ThemeWarning} from "../harness/theme.js";
import type {ProductionPreflightStatusResult} from "../harness/production-preflight-hitl.js";
import type {ResearchBinding} from "../app-explorer/research-binding.js";

export interface BacklotTheme {
  source: "storyboard" | "canonical";
  tokens: ThemeTokens;
  pinnedRoles: string[];
  contrast: {textOnPage: number; accentOnPage: number};
  warnings: ThemeWarning[];
}

export interface PipelineStage {
  id: string;
  name: string;
  status: "pending" | "active" | "completed" | "error";
  description: string;
  details?: Record<string, unknown>;
}

export interface BacklotState {
  hitl: UniversalHitlEvent;
  currentPhase: string;
  stages: PipelineStage[];
  requestText: string | null;
  clarification: Record<string, unknown> | null;
  videoBrief: VideoBrief | null;
  researchBinding: ResearchBinding | null;
  rendererOptions: RendererAvailability[];
  rendererSelection: RendererSelection | null;
  productionProfile: Record<string, unknown> | null;
  scriptText: string | null;
  scriptReview: Record<string, unknown> | null;
  storyboard: VideoProject | null;
  storyboardReview: Record<string, unknown> | null;
  canonicalProject: VideoProject | null;
  projectState: Record<string, unknown> | null;
  assetManifest: { version: string; assets: Array<Record<string, unknown>> } | null;
  semanticPreflight: AuthorPreflightReport | null;
  productionPreflight: AuthorPreflightReport | null;
  productionPreflightApproval: ProductionPreflightStatusResult;
  reopenStatus: {generation:number;pending:string[]};
  theme: BacklotTheme | null;
  implementationManifest?: Record<string, unknown> | null;
  finalManifest?: Record<string, unknown> | null;
  finalizedDelivery: boolean;
  renderer: {id:string;phase:string;projectDir:string;previewUrl?:string;sourceHash?:string;visualApproval?:{status?:string};finalized:boolean} | null;
  previewExists: boolean;
  finalVideoExists: boolean;
  evidenceFiles: string[];
}

export interface HitlApprovePayload {
  checkpoint: "VIDEO_BRIEF" | "RENDERER_SELECTION" | "SCRIPT" | "STORYBOARD" | "ASSET_PREFLIGHT" | "VISUAL_REVIEW";
  renderer?: "remotion" | "hyperframes";
}

export interface HitlRequestChangesPayload {
  checkpoint: "VIDEO_BRIEF" | "SCRIPT" | "STORYBOARD" | "ASSET_PREFLIGHT" | "VISUAL_REVIEW";
  feedback: string;
}

export interface HitlClarifyPayload {
  answers: Array<{ id: string; answer: string }>;
}

export interface HitlReopenPayload {checkpoint:"VIDEO_BRIEF"|"SCRIPT"|"STORYBOARD"|"ASSET_PREFLIGHT"|"VISUAL_REVIEW";reason:string;expectedRevision:number;operationId?:string;}
export interface HitlDurationPayload {choice:"shorten_script"|"revise_brief";reason:string;expectedGeneration:number;}
