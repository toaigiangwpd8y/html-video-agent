import {stat} from "node:fs/promises";
import { resolve,basename } from "node:path";
import { readJson, readText, writeJson } from "../core/io.js";
import type { VideoProject, AuthorPreflightReport } from "../core/types.js";
import type { HyperFramesState } from "../harness/hyperframes.js";
import type { RemotionRendererState } from "../harness/remotion.js";
import { exists } from "../harness/fs.js";
import { harnessPaths } from "../harness/paths.js";
import { assertActiveHitlCheckpoint, universalHitlStatus } from "../harness/hitl-protocol.js";
import {
  approveScriptReview,
  approveStoryboardReview,
  approveVideoBrief,
  type VideoBrief,
} from "../harness/preproduction-hitl.js";
import { resolveClarification } from "../harness/clarification.js";
import {approveSelectedRendererReview} from "../harness/renderer.js";
import {approveProductionAssetPreflight,productionAssetPreflightStatus} from "../harness/production-preflight-hitl.js";
import {loadRendererSelection,rendererAvailability,rendererOptionsForBrief,selectRenderer,type RendererId,type RendererSelection} from "../harness/renderer-selection.js";
import {contrastRatio,deriveTheme,themeFontBindingWarning} from "../harness/theme.js";
import type {AssetManifestItem} from "../harness/assets.js";
import type {
  BacklotState,
  HitlApprovePayload,
  HitlClarifyPayload,
  HitlRequestChangesPayload,
  PipelineStage,
} from "./types.js";
import {submitReviewChange} from "../harness/review-changes.js";
import {reopenCheckpoint,type ReopenCheckpoint,reopenStatus} from "../harness/reopen.js";
import {chooseDurationAction} from "../harness/duration-decision.js";
import type {HitlReopenPayload,HitlDurationPayload} from "./types.js";
import {readResearchBinding,type ResearchBinding} from "../app-explorer/research-binding.js";

async function regularFile(path:string):Promise<boolean>{try{return (await stat(path)).isFile();}catch{return false;}}

export async function collectBacklotState(root: string): Promise<BacklotState> {
  const p = harnessPaths(root);
  const hitl = await universalHitlStatus(root);

  let requestText: string | null = null;
  if (await exists(p.request)) {
    try {
      requestText = await readText(p.request);
    } catch {
      requestText = null;
    }
  }

  let clarification: Record<string, unknown> | null = null;
  if (await exists(p.clarification)) {
    try {
      clarification = await readJson(p.clarification);
    } catch {
      clarification = null;
    }
  }

  let videoBrief: VideoBrief | null = null;
  if (await exists(p.videoBrief)) {
    try {
      videoBrief = await readJson<VideoBrief>(p.videoBrief);
    } catch {
      videoBrief = null;
    }
  }

  let researchBinding:ResearchBinding|null = null;
  try { researchBinding = await readResearchBinding(root); } catch {}

  const rendererOptions=rendererOptionsForBrief(await rendererAvailability(root),videoBrief?.rendererRecommendation);
  let rendererSelection:RendererSelection|null=null;
  try{rendererSelection=await loadRendererSelection(root);}catch{}

  let productionProfile: Record<string, unknown> | null = null;
  if (await exists(p.productionProfile)) {
    try {
      productionProfile = await readJson(p.productionProfile);
    } catch {
      productionProfile = null;
    }
  }

  let scriptText: string | null = null;
  if (await exists(p.scriptDraft)) {
    try {
      scriptText = await readText(p.scriptDraft);
    } catch {
      scriptText = null;
    }
  }

  let scriptReview: Record<string, unknown> | null = null;
  if (await exists(p.scriptReview)) {
    try {
      scriptReview = await readJson(p.scriptReview);
      if(await exists(p.narrationManifest)){
        const manifest=await readJson<Record<string,unknown>&{segments?:Array<Record<string,unknown>>;totalAudioSeconds?:number;totalTimelineSeconds?:number;manifestHash?:string}>(p.narrationManifest);
        const segments=(manifest.segments??[]).map(segment=>{const name=typeof segment.audioFile==="string"?basename(segment.audioFile):"";return {...segment,...(/^[a-f0-9]{64}\.wav$/i.test(name)?{audioUrl:`/narration/${name}`}:{})};});
        (scriptReview as Record<string,unknown>).narration={manifestHash:manifest.manifestHash,totalAudioSeconds:manifest.totalAudioSeconds,totalTimelineSeconds:manifest.totalTimelineSeconds,segments};
      }
    } catch {
      scriptReview = null;
    }
  }

  let storyboard: VideoProject | null = null;
  if (await exists(p.storyboardDraft)) {
    try {
      storyboard = await readJson<VideoProject>(p.storyboardDraft);
    } catch {
      storyboard = null;
    }
  }

  let storyboardReview: Record<string, unknown> | null = null;
  if (await exists(p.storyboardReview)) {
    try {
      storyboardReview = await readJson(p.storyboardReview);
    } catch {
      storyboardReview = null;
    }
  }

  let canonicalProject: VideoProject | null = null;
  if (await exists(p.video)) {
    try {
      canonicalProject = await readJson<VideoProject>(p.video);
    } catch {
      canonicalProject = null;
    }
  }

  let projectState: Record<string, unknown> | null = null;
  if (await exists(p.projectState)) {
    try {
      projectState = await readJson(p.projectState);
    } catch {
      projectState = null;
    }
  }

  let assetManifest: { version: string; assets: Array<Record<string, unknown>> } | null = null;
  if (await exists(p.assetManifest)) {
    try {
      assetManifest = await readJson(p.assetManifest);
    } catch {
      assetManifest = null;
    }
  }

  let semanticPreflight: AuthorPreflightReport | null = null;
  if (await exists(p.preflight)) {
    try {
      semanticPreflight = await readJson<AuthorPreflightReport>(p.preflight);
    } catch {
      semanticPreflight = null;
    }
  }

  let productionPreflight: AuthorPreflightReport | null = null;
  if (await exists(p.productionPreflight)) {
    try {
      productionPreflight = await readJson<AuthorPreflightReport>(p.productionPreflight);
    } catch {
      productionPreflight = null;
    }
  }
  let implementationManifest: Record<string, unknown> | null = null;
  let finalManifest: Record<string, unknown> | null = null;
  if(await exists(p.finalManifest))try{finalManifest=await readJson<Record<string,unknown>>(p.finalManifest);}catch{}
  const selectedManifest=await exists(p.finalManifest)?p.finalManifest:rendererSelection?.selected==="remotion"?p.remotionManifest:p.manifest;
  if (await exists(selectedManifest)) {
    try {
      implementationManifest = await readJson(selectedManifest);
    } catch {
      implementationManifest = null;
    }
  }

  let renderer:BacklotState["renderer"]=null;
  if(rendererSelection?.selected==="remotion"&&await exists(p.remotionRendererState))try{const state=await readJson<RemotionRendererState>(p.remotionRendererState);renderer={id:"remotion",phase:state.phase,projectDir:"remotion/generated",...(state.previewUrl?{previewUrl:state.previewUrl}:{}),...(state.sourceHash?{sourceHash:state.sourceHash}:{}),...(state.visualApproval?{visualApproval:state.visualApproval}:{}),finalized:state.phase==="FINALIZED"};}catch{renderer=null;}
  else if(await exists(p.rendererState))try{const state=await readJson<HyperFramesState>(p.rendererState);renderer={id:"hyperframes",phase:state.phase,projectDir:state.projectDir,...(state.previewUrl?{previewUrl:state.previewUrl}:{}),...(state.sourceHash?{sourceHash:state.sourceHash}:{}),...(state.visualApproval?{visualApproval:state.visualApproval}:{}),finalized:state.phase==="FINALIZED"};}catch{renderer=null;}

  const theme=resolveBacklotTheme(storyboard,canonicalProject,assetManifest);
  const productionPreflightApproval=await productionAssetPreflightStatus(root);
  const currentReopenStatus=await reopenStatus(root);

  const previewExists = await exists(p.preview);
  const finalVideoExists = await exists(p.finalVideo);

  const evidenceRecord=finalManifest?.evidence&&typeof finalManifest.evidence==="object"?finalManifest.evidence as Record<string,unknown>:null;
  const listedEvidence:string[]=[];
  if(Array.isArray(evidenceRecord?.files)){
    for(const value of evidenceRecord.files)if(typeof value==="string")listedEvidence.push(value);
  }else if(renderer?.phase==="RENDERED"&&await exists(p.boundaryEvidenceIndex))try{
    const index=await readJson<Record<string,unknown>>(p.boundaryEvidenceIndex);
    const files:Array<unknown>=Array.isArray(index.frames)?(index.frames as Array<Record<string,unknown>>).map(frame=>frame.file):[
      ...((index.opening&&typeof index.opening==="object"?[((index.opening as Record<string,unknown>).file)]:[])),
      ...((Array.isArray(index.boundaries)?index.boundaries as Array<Record<string,unknown>>:[]).flatMap(boundary=>Array.isArray(boundary.files)?boundary.files:[])),
      ...((index.ending&&typeof index.ending==="object"?[((index.ending as Record<string,unknown>).file)]:[])),
    ];
    for(const value of files)if(typeof value==="string"&&/^output\/evidence\/[^/]+$/.test(value))listedEvidence.push(value);else if(typeof value==="string"&&/^[^/\\]+$/.test(value))listedEvidence.push(`output/evidence/${value}`);
  }catch{}
  const evidenceFiles:string[]=[];
  for(const value of listedEvidence){
    if(typeof value!=="string"||!/^output\/evidence\/[^/]+$/.test(value))continue;
    const name=value.slice("output/evidence/".length);if(await regularFile(resolve(root,value)))evidenceFiles.push(name);
  }
  const outputRecord=finalManifest?.output&&typeof finalManifest.output==="object"?finalManifest.output as Record<string,unknown>:null;
  const probe=outputRecord?.probe&&typeof outputRecord.probe==="object"?outputRecord.probe as Record<string,unknown>:null;
  const streams=Array.isArray(probe?.streams)?probe!.streams as Array<Record<string,unknown>>:[];
  const videoStream=streams.find(stream=>stream.codec_type==="video");
  const format=probe?.format&&typeof probe.format==="object"?probe.format as Record<string,unknown>:null;
  const fpsText=String(videoStream?.avg_frame_rate??videoStream?.r_frame_rate??"0/1"),[fpsNumerator,fpsDenominator]=fpsText.split("/").map(Number),actualFps=fpsDenominator?fpsNumerator/fpsDenominator:Number.NaN;
  const duration=Number(format?.duration),outputSha=outputRecord?.sha256;
  const evidenceIndex=evidenceRecord?.index;
  const evidenceIndexExists=typeof evidenceIndex==="string"&&!evidenceIndex.startsWith("/")&&!evidenceIndex.includes("\\")&&!evidenceIndex.includes("..")&&await regularFile(resolve(root,evidenceIndex));
  const visualApproval=finalManifest?.visualApproval&&typeof finalManifest.visualApproval==="object"?finalManifest.visualApproval as Record<string,unknown>:null;
  const checkRecord=finalManifest?.check&&typeof finalManifest.check==="object"?finalManifest.check as Record<string,unknown>:null;
  const audioRequired=Boolean(canonicalProject?.scenes.some(scene=>Boolean(scene.audio?.voiceoverText.trim()))),audioPresent=streams.some(stream=>stream.codec_type==="audio");
  const manifestMetadataValid=Boolean(canonicalProject&&projectState&&finalManifest?.version==="1"&&finalManifest.projectHash===projectState.projectHash&&finalManifest.projectId===projectState.projectId&&finalManifest.revision===projectState.revision&&finalManifest.renderer===renderer?.id&&typeof finalManifest.sourceHash==="string"&&visualApproval?.status==="approved"&&visualApproval.approvedBy==="HUMAN"&&visualApproval.sourceHash===finalManifest.sourceHash&&checkRecord?.passed===true&&Number(finalManifest.width)===canonicalProject.meta.width&&Number(finalManifest.height)===canonicalProject.meta.height&&Number(finalManifest.fps)===canonicalProject.meta.fps&&Number(finalManifest.durationInFrames)===canonicalProject.meta.durationsInFrames&&outputRecord?.file==="output/final.mp4"&&typeof outputSha==="string"&&(/^sha256:[0-9a-f]{64}$|^[0-9a-f]{64}$/).test(outputSha)&&videoStream&&Number(videoStream.width)===canonicalProject.meta.width&&Number(videoStream.height)===canonicalProject.meta.height&&Number.isFinite(actualFps)&&Math.abs(actualFps-canonicalProject.meta.fps)<0.001&&Number.isFinite(duration)&&Math.abs(duration-canonicalProject.meta.durationsInFrames/canonicalProject.meta.fps)<=1/canonicalProject.meta.fps+0.02&&(!audioRequired||audioPresent)&&Array.isArray(evidenceRecord?.files)&&evidenceRecord.files.length>0&&evidenceFiles.length===evidenceRecord.files.length&&evidenceIndexExists);
  const finalizedDelivery=Boolean(renderer?.phase==="FINALIZED"&&await regularFile(p.finalVideo)&&manifestMetadataValid);

  const stages: PipelineStage[] = [
    {
      id: "request",
      name: "User Request",
      status: requestText?.trim() ? "completed" : "pending",
      description: "Capture and freeze user video prompt.",
    },
    {
      id: "clarification",
      name: "Clarification",
      status:
        clarification?.status === "resolved"
          ? "completed"
          : hitl.checkpoint === "CLARIFICATION"
          ? "active"
          : requestText
          ? "active"
          : "pending",
      description: "Assess ambiguity and resolve material questions.",
    },
    {
      id: "video_brief",
      name: "Video Brief",
      status:
        videoBrief?.status === "approved" && rendererSelection
          ? "completed"
          : hitl.checkpoint === "VIDEO_BRIEF" || hitl.checkpoint === "RENDERER_SELECTION"
          ? "active"
          : clarification?.status === "resolved"
          ? "active"
          : "pending",
      description: "Define audience, objectives, duration, and tone.",
    },
    {
      id: "production_profile",
      name: "Production Profile",
      status:
        productionProfile
          ? "completed"
          : videoBrief?.status === "approved" && rendererSelection
          ? "active"
          : "pending",
      description: "Select and freeze specialized video-type skills.",
    },
    {
      id: "script",
      name: "Script",
      status:
        scriptReview?.status === "approved"
          ? "completed"
          : hitl.checkpoint === "SCRIPT"
          ? "active"
          : productionProfile
          ? "active"
          : "pending",
      description: "Draft screenplay, dialogue, and narration text.",
    },
    {
      id: "storyboard",
      name: "Storyboard",
      status:
        storyboardReview?.status === "approved"
          ? "completed"
          : hitl.checkpoint === "STORYBOARD"
          ? "active"
          : scriptReview?.status === "approved"
          ? "active"
          : "pending",
      description: "Plan scene budget, visual concepts, and audio.",
    },
    {
      id: "canonical_project",
      name: "Canonical Truth",
      status: canonicalProject && projectState ? "completed" : "pending",
      description: "Promote approved storyboard to canonical video.json.",
    },
    {
      id: "asset_acquisition",
      name: "Asset Preflight",
      status:
        productionPreflightApproval.status==="APPROVED"||productionPreflightApproval.status==="LEGACY_FINALIZED"
          ? "completed"
          : productionPreflightApproval.status==="FAILED"||productionPreflightApproval.status==="STALE"
          ? "error"
          : canonicalProject
          ? "active"
          : "pending",
      description: "Acquire, materialize, and validate production assets.",
    },
    {
      id: "hyperframes_renderer",
      name: "Studio Preview",
      status:
        finalizedDelivery || hitl.phase==="visual_review_approved" || renderer?.phase==="RENDERED" || renderer?.phase==="FINALIZED"
          ? "completed"
          : renderer || productionPreflightApproval.status==="APPROVED" || productionPreflightApproval.status==="LEGACY_FINALIZED"
          ? "active"
          : "pending",
      description: rendererSelection?.selected==="remotion"?"Review the local Remotion Studio preview and approve its frozen source.":rendererSelection?.selected==="hyperframes"?"Review the local HyperFrames Studio preview and approve its frozen source.":"The renderer choice is recorded during Video Brief review.",
    },
    {
      id: "final_render",
      name: "Final Render & QA",
      status: finalizedDelivery ? "completed" : finalVideoExists || renderer?.phase==="RENDERED" ? "active" : "pending",
      description: "Export full MP4 video and compile boundary evidence.",
    },
  ];

  const hasGeneratedArtifacts = Boolean(
    clarification || videoBrief || rendererSelection || productionProfile || scriptText || scriptReview ||
    storyboard || storyboardReview || canonicalProject || projectState || assetManifest || semanticPreflight ||
    productionPreflight || implementationManifest || finalManifest || renderer || previewExists || finalVideoExists ||
    evidenceFiles.length
  );
  const notStarted = !requestText?.trim() && !hasGeneratedArtifacts && !hitl.checkpoint;

  return {
    hitl,
    currentPhase: notStarted ? "not_started" : hitl.phase,
    stages,
    requestText,
    clarification,
    videoBrief,
    researchBinding,
    rendererOptions,
    rendererSelection,
    productionProfile,
    scriptText,
    scriptReview,
    storyboard: storyboard ?? canonicalProject,
    storyboardReview,
    canonicalProject,
    projectState,
    assetManifest,
    semanticPreflight,
    productionPreflight,
    productionPreflightApproval,
    reopenStatus:{generation:currentReopenStatus.generation,pending:currentReopenStatus.pending},
    theme,
    implementationManifest,
    finalManifest,
    finalizedDelivery,
    renderer,
    previewExists,
    finalVideoExists,
    evidenceFiles,
  };
}

// Resolves a preview theme from the storyboard or canonical project for Backlot review.
function resolveBacklotTheme(
  storyboard: VideoProject | null | undefined,
  canonicalProject: VideoProject | null,
  assetManifest: {assets: Array<Record<string, unknown>>} | null,
): BacklotState["theme"] {
  const project=storyboard??canonicalProject;
  if(!Array.isArray(project?.meta?.theme?.palette)||project.meta.theme.palette.length===0)return null;
  try{
    const derived=deriveTheme(project);
    const fontWarning=canonicalProject?themeFontBindingWarning(project,(assetManifest?.assets??[]) as unknown as AssetManifestItem[]):undefined;
    return {
      source:storyboard?"storyboard":"canonical",
      tokens:derived.tokens,
      pinnedRoles:Object.keys(project.meta.theme.roles??{}),
      contrast:{textOnPage:contrastRatio(derived.tokens.text,derived.tokens.page),accentOnPage:contrastRatio(derived.tokens.accent,derived.tokens.page)},
      warnings:fontWarning?[...derived.warnings,fontWarning]:derived.warnings,
    };
  }catch{return null;}
}

export async function handleHitlApprove(
  root: string,
  payload: HitlApprovePayload
): Promise<any> {
  const activeReview:{checkpoint:HitlApprovePayload["checkpoint"];status:"INPUT_REQUIRED"|"REVIEW_REQUIRED";phase:string}|undefined=payload?.checkpoint==="RENDERER_SELECTION"
    ? {checkpoint:"RENDERER_SELECTION",status:"INPUT_REQUIRED",phase:"needs_renderer_selection"}
    : payload?.checkpoint==="VIDEO_BRIEF"?{checkpoint:"VIDEO_BRIEF",status:"REVIEW_REQUIRED",phase:"needs_brief_review"}
    : payload?.checkpoint==="SCRIPT"?{checkpoint:"SCRIPT",status:"REVIEW_REQUIRED",phase:"needs_script_review"}
    : payload?.checkpoint==="STORYBOARD"?{checkpoint:"STORYBOARD",status:"REVIEW_REQUIRED",phase:"needs_storyboard_review"}
    : payload?.checkpoint==="ASSET_PREFLIGHT"?{checkpoint:"ASSET_PREFLIGHT",status:"REVIEW_REQUIRED",phase:"needs_asset_preflight_approval"}
    : payload?.checkpoint==="VISUAL_REVIEW"?{checkpoint:"VISUAL_REVIEW",status:"REVIEW_REQUIRED",phase:"needs_visual_review"}
    : undefined;
  if(!activeReview)throw new Error(`Unsupported checkpoint approval: ${String(payload?.checkpoint)}`);
  await assertActiveHitlCheckpoint(root,activeReview.checkpoint,activeReview.status,activeReview.phase);
  if (payload.checkpoint === "VIDEO_BRIEF") {
    if(!payload.renderer)throw new Error("Choose Remotion or HyperFrames before approving the Video Brief.");
    return approveVideoBrief(root, "HUMAN",payload.renderer);
  }
  if(payload.checkpoint==="RENDERER_SELECTION"){
    if(!payload.renderer)throw new Error("Choose Remotion or HyperFrames.");
    return selectRenderer(root,payload.renderer,"Explicitly selected by the human after reviewing the renderer comparison.");
  }
  if (payload.checkpoint === "SCRIPT") {
    return approveScriptReview(root, "HUMAN");
  }
  if (payload.checkpoint === "STORYBOARD") {
    return approveStoryboardReview(root, "HUMAN");
  }
  if(payload.checkpoint==="ASSET_PREFLIGHT"){
    return approveProductionAssetPreflight(root);
  }
  if(payload.checkpoint==="VISUAL_REVIEW"){
    return approveSelectedRendererReview(root);
  }
  throw new Error(`Unsupported checkpoint approval: ${String(payload.checkpoint)}`);
}

export async function handleHitlClarify(
  root: string,
  payload: HitlClarifyPayload
): Promise<Record<string, unknown>> {
  if (!payload || !Array.isArray(payload.answers)) {
    throw new Error("Invalid clarify payload: answers array required.");
  }
  await assertActiveHitlCheckpoint(root,"CLARIFICATION","INPUT_REQUIRED","needs_user_input");
  const formattedAnswers = payload.answers.map((a) => ({
    questionId: a.id,
    answer: a.answer,
    answeredBy: "HUMAN" as const,
  }));
  const answersDocPath = resolve(root, ".video/clarification-answers-temp.json");
  await writeJson(answersDocPath, { answers: formattedAnswers });
  return resolveClarification(root, answersDocPath);
}

/** Records reviewer feedback only for the active review checkpoint; approval remains separate. */
export async function handleHitlRequestChanges(root:string,payload:HitlRequestChangesPayload):Promise<Record<string,unknown>>{
  const allowed=new Set(["VIDEO_BRIEF","SCRIPT","STORYBOARD","ASSET_PREFLIGHT","VISUAL_REVIEW"]);
  if(!payload||!allowed.has(payload.checkpoint)||typeof payload.feedback!=="string")throw new Error("Invalid request-changes payload.");
  const current=await universalHitlStatus(root);
  if(current.status!=="REVIEW_REQUIRED"||current.checkpoint!==payload.checkpoint)throw new Error("Request changes is available only for the active review checkpoint.");
  return {...await submitReviewChange(root,current,payload.feedback)};
}

export async function handleHitlReopen(root:string,payload:HitlReopenPayload):Promise<Record<string,unknown>>{
  if(!payload||!(["VIDEO_BRIEF","SCRIPT","STORYBOARD","ASSET_PREFLIGHT","VISUAL_REVIEW"] as string[]).includes(payload.checkpoint)||typeof payload.reason!=="string"||!Number.isInteger(payload.expectedRevision))throw new Error("Invalid reopen request.");
  return {...await reopenCheckpoint(root,{checkpoint:payload.checkpoint as ReopenCheckpoint,reason:payload.reason,expectedRevision:payload.expectedRevision,...(payload.operationId?{operationId:payload.operationId}:{})})};
}

export async function handleHitlDuration(root:string,payload:HitlDurationPayload):Promise<Record<string,unknown>>{
  if(!payload||!(["shorten_script","revise_brief"] as string[]).includes(payload.choice)||typeof payload.reason!=="string"||!Number.isInteger(payload.expectedGeneration))throw new Error("Invalid duration decision.");
  await assertActiveHitlCheckpoint(root,"DURATION_FIT","INPUT_REQUIRED","needs_duration_fit");
  return {decision:await chooseDurationAction(root,payload.choice,payload.reason,payload.expectedGeneration)};
}
