import {preproductionHitlStatus} from "./preproduction-hitl.js";
import {productionAssetPreflightStatus} from "./production-preflight-hitl.js";
import {selectedRendererHitlStatus} from "./renderer.js";
import {applyPendingReviewChange} from "./review-changes.js";

export type UniversalHitlStatus="INPUT_REQUIRED"|"REVIEW_REQUIRED"|"WORKING"|"READY";

export interface UniversalHitlEvent {
  protocol:"video-hitl/1";
  status:UniversalHitlStatus;
  phase:string;
  checkpoint?: "CLARIFICATION"|"VIDEO_BRIEF"|"RENDERER_SELECTION"|"SCRIPT"|"DURATION_FIT"|"STORYBOARD"|"ASSET_PREFLIGHT"|"VISUAL_REVIEW";
  payload?:unknown;
  message:string;
}

async function baseUniversalHitlStatus(root:string):Promise<UniversalHitlEvent>{
  const raw=await preproductionHitlStatus(root);
  const phase=typeof raw.phase==="string"?raw.phase:"unknown";

  if(phase==="needs_user_input"){
    return {
      protocol:"video-hitl/1",
      status:"INPUT_REQUIRED",
      phase,
      checkpoint:"CLARIFICATION",
      payload:{questions:raw.questions??[]},
      message:"Human input is required. Surface the clarification questions through the harness and stop the agent turn."
    };
  }
  if(phase==="needs_brief_review"){
    return {
      protocol:"video-hitl/1",
      status:"REVIEW_REQUIRED",
      phase,
      checkpoint:"VIDEO_BRIEF",
      payload:{brief:raw.brief},
      message:"Video Brief is ready for human review. The creative agent cannot approve it."
    };
  }
  if(phase==="needs_renderer_selection"){
    return {
      protocol:"video-hitl/1",
      status:"INPUT_REQUIRED",
      phase,
      checkpoint:"RENDERER_SELECTION",
      payload:{rendererOptions:raw.rendererOptions??[],brief:raw.brief},
      message:"The Video Brief is approved. Present available renderers with brief-specific tradeoffs and wait for the user's explicit choice before profile or Script authoring."
    };
  }
  if(phase==="needs_script_review"){
    return {
      protocol:"video-hitl/1",
      status:"REVIEW_REQUIRED",
      phase,
      checkpoint:"SCRIPT",
      payload:{scriptReview:raw.meta??null},
      message:"Script is ready for human review. The creative agent cannot approve it."
    };
  }
  if(phase==="needs_duration_fit")return {protocol:"video-hitl/1",status:"INPUT_REQUIRED",phase,checkpoint:"DURATION_FIT",payload:{fit:raw.fit,choices:raw.choices,scriptPath:raw.scriptPath,narrationManifestHash:raw.narrationManifestHash,briefHash:raw.briefHash},message:"The measured narration exceeds the hard duration ceiling. Present the measured overrun and wait for the host to record shorten_script or revise_brief."};
  if(phase==="needs_storyboard_review"){
    return {
      protocol:"video-hitl/1",
      status:"REVIEW_REQUIRED",
      phase,
      checkpoint:"STORYBOARD",
      payload:{storyboardReview:raw.meta??null},
      message:"Storyboard is ready for human review. The creative agent cannot approve it."
    };
  }
  if(raw.ready===true || phase==="ready_to_render"){
    const assetPreflight=await productionAssetPreflightStatus(root);
    if(assetPreflight.status==="REVIEW_REQUIRED")return {
      protocol:"video-hitl/1",
      status:"REVIEW_REQUIRED",
      phase:"needs_asset_preflight_approval",
      checkpoint:"ASSET_PREFLIGHT",
      payload:{report:assetPreflight.report,projectHash:assetPreflight.projectHash,assetSnapshotHash:assetPreflight.assetSnapshotHash,reportHash:assetPreflight.reportHash},
      message:"Production asset preflight is ready for human review. Surface the report and registered asset list, then stop until the host records approval."
    };
    if(assetPreflight.status!=="APPROVED"&&assetPreflight.status!=="LEGACY_FINALIZED")return {
      protocol:"video-hitl/1",
      status:"WORKING",
      phase:`asset_preflight_${assetPreflight.status.toLowerCase()}`,
      payload:assetPreflight,
      message:assetPreflight.message
    };
    const renderer=await selectedRendererHitlStatus(root);
    if(renderer)return {protocol:"video-hitl/1",...renderer};
    return {
      protocol:"video-hitl/1",
      status:"READY",
      phase,
      message:"Pre-production HITL is complete."
    };
  }
  return {
    protocol:"video-hitl/1",
    status:"WORKING",
    phase,
    payload:raw,
    message:"No human action is required at this exact checkpoint."
  };
}

/** Surface pending human revision feedback as work while preserving the approval gate. */
export async function universalHitlStatus(root:string):Promise<UniversalHitlEvent>{
  return applyPendingReviewChange(root,await baseUniversalHitlStatus(root));
}

/** Guard every host action against the exact active checkpoint, including revision requests. */
export async function assertActiveHitlCheckpoint(root:string,checkpoint:NonNullable<UniversalHitlEvent["checkpoint"]>,status:UniversalHitlStatus,phase:string):Promise<UniversalHitlEvent>{
  const current=await universalHitlStatus(root);
  if(current.status!==status||current.checkpoint!==checkpoint||current.phase!==phase)throw new Error(`${checkpoint} is not the active ${status} checkpoint. Current checkpoint: ${current.checkpoint??"none"} (${current.status}, ${current.phase}).`);
  return current;
}
