import {resolve} from "node:path";
import {readJson,readText,writeJson,writeText} from "../core/io.js";
import {sha256} from "../core/hash.js";
import type {VideoProject} from "../core/types.js";
import {exists,requireFile} from "./fs.js";
import {harnessPaths} from "./paths.js";
import {assertClarificationResolved} from "./clarification.js";
import {productionProfileHash} from "./production-profile.js";
import {loadProductionProfile} from "./production-profile.js";
import {requestHash} from "./request.js";
import {promoteCanonicalProject,promoteCanonicalRevision,rollbackCanonicalPromotion,type CanonicalPromotionResult,validateCanonicalProject} from "./canonical-promotion.js";
import {loadProjectState} from "./project-state.js";
import {loadRendererSelection,rendererAvailability,rendererOptionsForBrief,selectRenderer,type RendererId} from "./renderer-selection.js";
import {validateNarrationManifest} from "../tts/cache.js";
import type {NarrationManifest} from "../tts/types.js";
import {validateStoryboardNarrationMapping} from "./narration-bindings.js";
import {durationPolicy as normalizeDurationPolicy,assessNarrationFit} from "../tts/duration.js";
import {assertCheckpointCurrent,markCheckpointReapproved,withHostApprovalLock} from "./reopen.js";
import {assertReconciliationCurrent} from "./reconciliation.js";
import {researchBindingDigest} from "../app-explorer/research-binding.js";

export type ReviewStatus="awaiting_user_review"|"approved";
export type ReviewActor="HUMAN"|"AUTO";

export interface RendererRecommendation {renderer:RendererId;rationale:string;alternativeTradeoff:string;}
export interface VideoBrief {version:"1";requestHash:string;researchBindingHash?:string;status:ReviewStatus;approvedBy?:ReviewActor;objective:string;audience:string;durationSeconds:number;durationPolicy:{version:"1";targetSeconds?:number;maxSeconds?:number};aspectRatio:string;language:string;angle:string;tone:string;pacing:string;mustInclude:string[];mustAvoid:string[];sourceNotes:string[];rendererRecommendation:RendererRecommendation;}
export interface ContentReviewMeta {version:"1";requestHash:string;researchBindingHash?:string;status:ReviewStatus;approvedBy?:ReviewActor;contentHash:string;upstreamHash:string;narrationManifestHash?:string;projectRevision?:number;}
export interface StoryboardApprovalResult {review:ContentReviewMeta;promotion:CanonicalPromotionResult;}

const nonempty=(v:unknown):v is string=>typeof v==="string"&&v.trim().length>0;
const hasPlaceholder=(v:string)=>/REPLACE:|TODO|<[^>]+>/.test(v);
const projectHash=(project:VideoProject):string=>sha256(JSON.stringify(project));

function strings(value:unknown,label:string):string[]{
  if(!Array.isArray(value))throw new Error(`${label} must be an array.`);
  return value.map((x,i)=>{if(!nonempty(x)||hasPlaceholder(x))throw new Error(`${label}[${i}] must be concrete.`);return x.trim();});
}

async function assertClarificationResolvedLocally(root:string):Promise<void>{
  await assertClarificationResolved(root);
}

function validateBrief(value:unknown):VideoBrief{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Video Brief must be an object.");
  const x=value as Record<string,unknown>;
  if(x.version!=="1")throw new Error("Video Brief must use version 1.");
  if(!nonempty(x.requestHash))throw new Error("Video Brief requires requestHash.");
  if(x.status!=="awaiting_user_review"&&x.status!=="approved")throw new Error("Video Brief status is invalid.");
  for(const key of ["objective","audience","aspectRatio","language","angle","tone","pacing"] as const)if(!nonempty(x[key])||hasPlaceholder(x[key]))throw new Error(`Video Brief ${key} must be concrete.`);
  const duration=normalizeDurationPolicy(x.durationPolicy,x.durationSeconds);
  if(typeof x.durationSeconds!=="number"||!Number.isFinite(x.durationSeconds)||x.durationSeconds<=0)throw new Error("Video Brief durationSeconds must be > 0.");
  if(x.approvedBy!==undefined&&x.approvedBy!=="HUMAN"&&x.approvedBy!=="AUTO")throw new Error("Video Brief approvedBy must be HUMAN or AUTO.");
  if(x.status==="approved"&&!x.approvedBy)throw new Error("Approved Video Brief requires approvedBy.");
  const recommendation=x.rendererRecommendation;
  if(!recommendation||typeof recommendation!=="object"||Array.isArray(recommendation))throw new Error("Video Brief rendererRecommendation is required.");
  const recommendationValue=recommendation as Record<string,unknown>;
  if(recommendationValue.renderer!=="remotion"&&recommendationValue.renderer!=="hyperframes")throw new Error("Video Brief rendererRecommendation.renderer must be remotion or hyperframes.");
  if(!nonempty(recommendationValue.rationale)||hasPlaceholder(recommendationValue.rationale)||!nonempty(recommendationValue.alternativeTradeoff)||hasPlaceholder(recommendationValue.alternativeTradeoff))throw new Error("Video Brief rendererRecommendation requires concrete rationale and alternativeTradeoff text.");
  const rendererRecommendation:RendererRecommendation={renderer:recommendationValue.renderer,rationale:recommendationValue.rationale.trim(),alternativeTradeoff:recommendationValue.alternativeTradeoff.trim()};
  if(x.researchBindingHash!==undefined&&!nonempty(x.researchBindingHash))throw new Error("Video Brief researchBindingHash must be a nonempty digest.");
  return {version:"1",requestHash:x.requestHash,...(x.researchBindingHash?{researchBindingHash:x.researchBindingHash as string}:{}),status:x.status,approvedBy:x.approvedBy as ReviewActor|undefined,objective:x.objective as string,audience:x.audience as string,durationSeconds:x.durationSeconds,durationPolicy:{version:"1",...duration},aspectRatio:x.aspectRatio as string,language:x.language as string,angle:x.angle as string,tone:x.tone as string,pacing:x.pacing as string,mustInclude:strings(x.mustInclude??[],"mustInclude"),mustAvoid:strings(x.mustAvoid??[],"mustAvoid"),sourceNotes:strings(x.sourceNotes??[],"sourceNotes"),rendererRecommendation};
}

export async function videoBriefTemplate(root:string):Promise<VideoBrief>{
  await assertClarificationResolvedLocally(root);const researchBindingHash=await researchBindingDigest(root);return {version:"1",requestHash:await requestHash(root),...(researchBindingHash?{researchBindingHash}:{}),status:"awaiting_user_review",objective:"REPLACE: what the video must achieve.",audience:"REPLACE: target viewer.",durationSeconds:30,durationPolicy:{version:"1",targetSeconds:30},aspectRatio:"REPLACE: 9:16, 16:9, or 1:1.",language:"REPLACE: language.",angle:"REPLACE: specific content angle.",tone:"REPLACE: tone.",pacing:"REPLACE: pacing.",mustInclude:[],mustAvoid:[],sourceNotes:[],rendererRecommendation:{renderer:"REPLACE: remotion or hyperframes" as RendererId,rationale:"REPLACE: why this engine fits this brief.",alternativeTradeoff:"REPLACE: the tradeoff of the other engine for this brief."}};
}

export async function commitVideoBrief(root:string,file:string):Promise<{brief:VideoBrief;briefHash:string}>{
  const p=harnessPaths(root);await assertClarificationResolvedLocally(root);if(await exists(p.videoBrief))throw new Error("Video Brief already exists. Use `video brief revise` while pending.");const brief=validateBrief(await readJson(resolve(root,file)));if(brief.status!=="awaiting_user_review")throw new Error("A new Video Brief must start pending review.");if(brief.requestHash!==await requestHash(root))throw new Error("Video Brief requestHash does not match the captured request.");if((brief.researchBindingHash??null)!==await researchBindingDigest(root))throw new Error("Video Brief research binding fingerprint does not match the current selected research.");await writeJson(p.videoBrief,brief);return {brief,briefHash:sha256(JSON.stringify(brief))};
}

export async function reviseVideoBrief(root:string,file:string):Promise<{brief:VideoBrief;briefHash:string}>{
  const p=harnessPaths(root),current=validateBrief(await readJson(p.videoBrief));if(current.requestHash!==await requestHash(root))throw new Error("Video Brief belongs to a different request or the request was modified.");if(current.status!=="awaiting_user_review")throw new Error("Approved Video Brief is frozen.");const next=validateBrief(await readJson(resolve(root,file)));if(next.status!=="awaiting_user_review"||next.requestHash!==current.requestHash)throw new Error("Revised Video Brief must remain pending and bound to the same request.");if((next.researchBindingHash??null)!==await researchBindingDigest(root))throw new Error("Revised Video Brief research binding fingerprint does not match the current selected research.");await writeJson(p.videoBrief,next);return {brief:next,briefHash:sha256(JSON.stringify(next))};
}

async function approveVideoBriefLocked(root:string,actor:ReviewActor,renderer?:RendererId,rationale="Selected by the user during Video Brief review."):Promise<{brief:VideoBrief;briefHash:string;rendererSelection?:Awaited<ReturnType<typeof selectRenderer>>}>{
  await assertReconciliationCurrent(root);
  const p=harnessPaths(root),current=await loadVideoBrief(root);
  if(actor==="HUMAN"&&!renderer)throw new Error("A human must explicitly choose Remotion or HyperFrames before approving the Video Brief.");
  if(renderer&&actor!=="HUMAN")throw new Error("Only a human may select the renderer.");
  if(renderer){const option=(await rendererAvailability(root)).find(item=>item.id===renderer);if(!option?.available)throw new Error(`${renderer} is unavailable: ${option?.reason??"runtime could not be detected"}`);}
  const next=current.status==="approved"?current:validateBrief({...current,status:"approved",approvedBy:actor});
  if(current.status!=="approved")await writeJson(p.videoBrief,next);
  const rendererSelection=renderer?await selectRenderer(root,renderer,rationale,"HUMAN"):undefined;
  if(actor==="HUMAN")await markCheckpointReapproved(root,"VIDEO_BRIEF");
  return {brief:next,briefHash:sha256(JSON.stringify(next)),...(rendererSelection?{rendererSelection}:{})};
}
export async function approveVideoBrief(root:string,actor:ReviewActor,renderer?:RendererId,rationale="Selected by the user during Video Brief review."){return withHostApprovalLock(root,()=>approveVideoBriefLocked(root,actor,renderer,rationale));}

export async function loadVideoBrief(root:string):Promise<VideoBrief>{
  const p=harnessPaths(root);await requireFile(p.videoBrief,"Video Brief");const brief=validateBrief(await readJson(p.videoBrief));if(brief.requestHash!==await requestHash(root))throw new Error("Video Brief belongs to a different request or the request was modified.");if((brief.researchBindingHash??null)!==await researchBindingDigest(root))throw new Error("Video Brief research binding changed; reopen/revise through the existing HITL review path.");return brief;
}

export async function videoBriefStatus(root:string):Promise<Record<string,unknown>>{const p=harnessPaths(root);if(!(await exists(p.videoBrief)))return {ready:false,phase:"needs_video_brief",rendererOptions:await rendererAvailability(root)};try{const brief=await loadVideoBrief(root),rendererOptions=rendererOptionsForBrief(await rendererAvailability(root),brief.rendererRecommendation);let rendererSelection;try{rendererSelection=await loadRendererSelection(root);}catch{}return {ready:brief.status==="approved"&&Boolean(rendererSelection),phase:brief.status,brief,briefHash:sha256(JSON.stringify(brief)),rendererSelection,rendererOptions};}catch(error){return {ready:false,error:error instanceof Error?error.message:String(error),rendererOptions:await rendererAvailability(root)};}}
export async function assertVideoBriefApproved(root:string):Promise<string>{await assertReconciliationCurrent(root);await assertCheckpointCurrent(root,"VIDEO_BRIEF");const brief=await loadVideoBrief(root);if(brief.status!=="approved")throw new Error("NEEDS_USER_REVIEW: Video Brief is awaiting review. Surface it to the user and stop, then run `npm run video:host -- brief approve <renderer>`.");try{await loadRendererSelection(root);}catch(error){throw new Error(`NEEDS_USER_INPUT: Select an available Remotion or HyperFrames runtime before profile and Script authoring. ${error instanceof Error?error.message:String(error)}`);}return sha256(JSON.stringify(brief));}

async function readMeta(root:string,path:string,label:string):Promise<ContentReviewMeta>{await requireFile(path,label);const m=await readJson<ContentReviewMeta>(path);if(m.version!=="1"||(m.status!=="awaiting_user_review"&&m.status!=="approved")||!nonempty(m.requestHash)||!nonempty(m.contentHash)||!nonempty(m.upstreamHash))throw new Error(`${label} metadata is invalid.`);if(m.status==="approved"&&m.approvedBy!=="HUMAN"&&m.approvedBy!=="AUTO")throw new Error(`${label} approvedBy is invalid.`);if(m.requestHash!==await requestHash(root))throw new Error(`${label} belongs to a different request or the request was modified.`);return m;}

async function commitTextReview(root:string,file:string,contentPath:string,metaPath:string,label:string,upstreamHash:string):Promise<ContentReviewMeta>{if(await exists(metaPath))throw new Error(`${label} already exists. Use revise while pending.`);const text=await readText(resolve(root,file));if(text.trim().length<40)throw new Error(`${label} content is too short to review.`);await writeText(contentPath,text);const meta:ContentReviewMeta={version:"1",requestHash:await requestHash(root),status:"awaiting_user_review",contentHash:sha256(text),upstreamHash};await writeJson(metaPath,meta);return meta;}
async function reviseTextReview(root:string,file:string,contentPath:string,metaPath:string,label:string):Promise<ContentReviewMeta>{const current=await readMeta(root,metaPath,label);if(current.status!=="awaiting_user_review")throw new Error(`Approved ${label} is frozen.`);const text=await readText(resolve(root,file));if(text.trim().length<40)throw new Error(`${label} content is too short to review.`);await writeText(contentPath,text);const next={...current,contentHash:sha256(text)};await writeJson(metaPath,next);return next;}

async function currentNarration(root:string,scriptText?:string):Promise<NarrationManifest>{
  const p=harnessPaths(root),validation=await validateNarrationManifest(root);
  if(!validation.valid)throw new Error(`NEEDS_TTS: Script review requires complete current local narration synthesis (including an explicit empty manifest for a silent video). ${validation.errors.join(" ")}`);
  const manifest=await readJson<NarrationManifest>(p.narrationManifest);
  if(scriptText!==undefined&&manifest.scriptHash!==sha256(scriptText))throw new Error("Narration manifest is not bound to the Script text being reviewed.");
  return manifest;
}
export async function scriptUpstreamHash(root:string):Promise<string>{const narration=await currentNarration(root),researchBindingHash=await researchBindingDigest(root);return sha256(JSON.stringify({requestHash:await requestHash(root),approvedBriefHash:await assertVideoBriefApproved(root),productionProfileHash:await productionProfileHash(root),narrationManifestHash:narration.manifestHash,...(researchBindingHash?{researchBindingHash}:{})}));}

export async function commitScriptReview(root:string,file:string):Promise<ContentReviewMeta>{await assertReconciliationCurrent(root);const p=harnessPaths(root),text=await readText(resolve(root,file)),narration=await currentNarration(root,text),upstreamHash=await scriptUpstreamHash(root),researchBindingHash=await researchBindingDigest(root);const review=await commitTextReview(root,file,p.scriptDraft,p.scriptReview,"Script review",upstreamHash);const next={...review,...(researchBindingHash?{researchBindingHash}:{}),narrationManifestHash:narration.manifestHash};await writeJson(p.scriptReview,next);return next;}
export async function reviseScriptReview(root:string,file:string):Promise<ContentReviewMeta>{await assertReconciliationCurrent(root);const p=harnessPaths(root),text=await readText(resolve(root,file)),narration=await currentNarration(root,text),current=await readMeta(root,p.scriptReview,"Script review");if(current.status!=="awaiting_user_review")throw new Error("Approved Script is frozen.");const upstreamHash=await scriptUpstreamHash(root),researchBindingHash=await researchBindingDigest(root),revised=await reviseTextReview(root,file,p.scriptDraft,p.scriptReview,"Script review"),next={...revised,upstreamHash,...(researchBindingHash?{researchBindingHash}:{}),narrationManifestHash:narration.manifestHash};await writeJson(p.scriptReview,next);return next;}
async function approveScriptReviewLocked(root:string,actor:ReviewActor):Promise<ContentReviewMeta>{await assertReconciliationCurrent(root);const p=harnessPaths(root),current=await readMeta(root,p.scriptReview,"Script review"),narration=await currentNarration(root,await readText(p.scriptDraft)),brief=await loadVideoBrief(root),fit=assessNarrationFit(narration,brief.durationPolicy,brief.pacing);if(fit.status==="over_ceiling")throw new Error(`NEEDS_USER_INPUT: Script exceeds the approved duration ceiling by ${fit.overrunSeconds}s. Await a host DURATION_FIT decision and revise the Brief or Script.`);if(current.narrationManifestHash!==narration.manifestHash)throw new Error("Narration audio changed after Script review was created.");if(current.contentHash!==sha256(await readText(p.scriptDraft)))throw new Error("Script review content changed after review was created.");if(current.upstreamHash!==await scriptUpstreamHash(root))throw new Error("Script review upstream inputs changed after review was created.");if((current.researchBindingHash??null)!==await researchBindingDigest(root))throw new Error("Script research binding changed after review was created.");const next={...current,status:"approved" as const,approvedBy:actor};await writeJson(p.scriptReview,next);if(actor==="HUMAN")await markCheckpointReapproved(root,"SCRIPT");return next;}
export async function approveScriptReview(root:string,actor:ReviewActor):Promise<ContentReviewMeta>{return withHostApprovalLock(root,()=>approveScriptReviewLocked(root,actor));}
export async function scriptReviewStatus(root:string):Promise<Record<string,unknown>>{const p=harnessPaths(root);if(!(await exists(p.scriptReview)))return {ready:false,phase:"needs_script_draft"};const meta=await readMeta(root,p.scriptReview,"Script review");const narration=await validateNarrationManifest(root);let manifest:unknown;try{manifest=await readJson(p.narrationManifest);}catch{}return {ready:meta.status==="approved"&&narration.valid,phase:meta.status,meta,scriptPath:p.scriptDraft,narration:{...narration,manifest}};}
export async function assertScriptApproved(root:string):Promise<ContentReviewMeta>{await assertReconciliationCurrent(root);await assertCheckpointCurrent(root,"SCRIPT");const p=harnessPaths(root),meta=await readMeta(root,p.scriptReview,"Script review");if(meta.status!=="approved")throw new Error("NEEDS_USER_REVIEW: Script is awaiting review. Surface it to the user and stop, then run `npm run video:host -- script approve`.");const narration=await currentNarration(root,await readText(p.scriptDraft));if(meta.narrationManifestHash!==narration.manifestHash)throw new Error("Approved narration bytes or timing changed after Script approval.");if(meta.contentHash!==sha256(await readText(p.scriptDraft)))throw new Error("Approved script changed after approval.");if(meta.upstreamHash!==await scriptUpstreamHash(root))throw new Error("Approved Script upstream inputs changed after Script review.");return meta;}

export async function commitStoryboardReview(root:string,file:string):Promise<ContentReviewMeta>{await assertReconciliationCurrent(root);const p=harnessPaths(root),script=await assertScriptApproved(root);if(await exists(p.storyboardReview))throw new Error("Storyboard review already exists. Use revise while pending.");const project=await readJson<VideoProject>(resolve(root,file)),mapping=await validateStoryboardNarrationMapping(root,project);if(!mapping.valid)throw new Error(`Storyboard narration mapping or measured frame budget is invalid: ${mapping.errors.join(" ")}`);await writeJson(p.storyboardDraft,project);const meta:ContentReviewMeta={version:"1",requestHash:await requestHash(root),status:"awaiting_user_review",contentHash:projectHash(project),upstreamHash:script.contentHash};await writeJson(p.storyboardReview,meta);return meta;}
export async function reviseStoryboardReview(root:string,file:string):Promise<ContentReviewMeta>{await assertReconciliationCurrent(root);const p=harnessPaths(root),current=await readMeta(root,p.storyboardReview,"Storyboard review");if(current.status!=="awaiting_user_review")throw new Error("Approved storyboard is frozen.");const script=await assertScriptApproved(root),project=await readJson<VideoProject>(resolve(root,file)),mapping=await validateStoryboardNarrationMapping(root,project);if(!mapping.valid)throw new Error(`Storyboard narration mapping or measured frame budget is invalid: ${mapping.errors.join(" ")}`);await writeJson(p.storyboardDraft,project);const next={...current,contentHash:projectHash(project),upstreamHash:script.contentHash};await writeJson(p.storyboardReview,next);return next;}
async function approveStoryboardReviewLocked(root:string,actor:ReviewActor):Promise<StoryboardApprovalResult>{await assertReconciliationCurrent(root);const p=harnessPaths(root),script=await assertScriptApproved(root),current=await readMeta(root,p.storyboardReview,"Storyboard review");if(current.status==="approved")throw new Error("Storyboard is already approved.");const project=await readJson<VideoProject>(p.storyboardDraft),mapping=await validateStoryboardNarrationMapping(root,project);if(!mapping.valid)throw new Error(`Storyboard narration mapping or measured frame budget is invalid: ${mapping.errors.join(" ")}`);if(current.contentHash!==projectHash(project))throw new Error("Storyboard content changed after review was created.");if(current.upstreamHash!==script.contentHash)throw new Error("Approved Script changed after Storyboard review was created.");let promotion:CanonicalPromotionResult|undefined;const isRevision=await exists(p.video);try{promotion=isRevision?await promoteCanonicalRevision(root,project):await promoteCanonicalProject(root,project);const review={...current,status:"approved" as const,approvedBy:actor,projectRevision:promotion.revision};await writeJson(p.storyboardReview,review);if(actor==="HUMAN")await markCheckpointReapproved(root,"STORYBOARD");return {review,promotion};}catch(error){if(promotion&&!isRevision)await rollbackCanonicalPromotion(root);throw error;}}
export async function approveStoryboardReview(root:string,actor:ReviewActor):Promise<StoryboardApprovalResult>{return withHostApprovalLock(root,()=>approveStoryboardReviewLocked(root,actor));}
export async function storyboardReviewStatus(root:string):Promise<Record<string,unknown>>{const p=harnessPaths(root);if(!(await exists(p.storyboardReview)))return {ready:false,phase:"needs_storyboard_draft"};const meta=await readMeta(root,p.storyboardReview,"Storyboard review");return {ready:meta.status==="approved",phase:meta.status,meta,storyboard:p.storyboardDraft};}
export async function assertStoryboardApproved(root:string):Promise<void>{await assertReconciliationCurrent(root);await assertCheckpointCurrent(root,"STORYBOARD");const p=harnessPaths(root),meta=await readMeta(root,p.storyboardReview,"Storyboard review");if(meta.status!=="approved")throw new Error("NEEDS_USER_REVIEW: Storyboard is awaiting review. Surface it to the user and stop, then run `npm run video:host -- storyboard approve`.");const script=await assertScriptApproved(root);if(meta.upstreamHash!==script.contentHash)throw new Error("Approved Script changed after Storyboard approval.");const stored=await readJson<VideoProject>(p.storyboardDraft);if(meta.contentHash!==projectHash(stored))throw new Error("Approved storyboard changed after approval.");const canonical=await readJson<VideoProject>(p.video),state=await loadProjectState(root,canonical),approvedRevision=meta.projectRevision??1;if(!Number.isInteger(approvedRevision)||approvedRevision<1||approvedRevision>state.revision)throw new Error(`Approved Storyboard revision ${approvedRevision} is not an available canonical revision.`);const revisionPath=resolve(p.revisions,`video-r${approvedRevision}.json`);await requireFile(revisionPath,`Approved Storyboard revision ${approvedRevision}`);const approvedProject=await readJson<VideoProject>(revisionPath);if(projectHash(approvedProject)!==meta.contentHash)throw new Error(`Revision ${approvedRevision} does not match the active approved Storyboard provenance.`);}

export async function preproductionHitlStatus(root:string):Promise<Record<string,unknown>>{
  const p=harnessPaths(root);
  if(!(await exists(p.request)))return {ready:false,phase:"needs_request"};
  if(!(await exists(p.clarification)))return {ready:false,phase:"needs_clarification_assessment"};
  try{
    const c=await readJson<{status?:string;questions?:unknown[];requestHash?:string}>(p.clarification);
    if(c.requestHash!==await requestHash(root))return {ready:false,phase:"invalid_clarification",error:"Clarification request binding is stale."};
    if(c.status==="awaiting_user")return {ready:false,phase:"needs_user_input",needsUserInput:true,questions:c.questions??[]};
    if(c.status!=="resolved")return {ready:false,phase:"invalid_clarification"};
    if(!(await exists(p.videoBrief)))return {ready:false,phase:"needs_video_brief"};
    const brief=await loadVideoBrief(root);
    const availableRenderers=rendererOptionsForBrief(await rendererAvailability(root),brief.rendererRecommendation);
    if(brief.status!=="approved")return {ready:false,phase:"needs_brief_review",needsUserInput:true,brief,rendererOptions:availableRenderers};
    try{await loadRendererSelection(root);}catch(error){return {ready:false,phase:"needs_renderer_selection",needsUserInput:true,brief,rendererOptions:availableRenderers,error:error instanceof Error?error.message:String(error)};}
    if(!(await exists(p.productionProfile)))return {ready:false,phase:"ready_for_profile"};
    try{await loadProductionProfile(root);}catch(error){return {ready:false,phase:"profile_rebind_required",profileStatus:{error:error instanceof Error?error.message:String(error)},next:`Run video profile rebind for duration-only Brief changes or revise profile after a production-intent change.`};}
    if(!(await exists(p.scriptReview)))return {ready:false,phase:"needs_script_draft"};
    const scriptReview=await readMeta(root,p.scriptReview,"Script review");
    const assessment=await import("./duration-decision.js").then(m=>m.durationAssessment(root)),narration=assessment.manifest,fit=assessment.fit;
    if(fit.status==="over_ceiling"){
      const {durationDecisionIsCurrent}=await import("./duration-decision.js");
      if(!(await durationDecisionIsCurrent(root)))return {ready:false,phase:"needs_duration_fit",needsUserInput:true,fit,narrationManifestHash:narration.manifestHash,briefHash:sha256(JSON.stringify(await loadVideoBrief(root))),choices:["shorten_script","revise_brief"]};
      const decision=await readJson<Record<string,unknown>>(p.durationDecision);
      if(decision.choice==="shorten_script")return {ready:false,phase:"duration_revise_script",decision,fit,scriptPath:p.scriptDraft};
    }
    if(scriptReview.status!=="approved")return {ready:false,phase:"needs_script_review",needsUserInput:true,meta:scriptReview,scriptPath:p.scriptDraft};
    const script=await assertScriptApproved(root);
    if(!(await exists(p.storyboardReview)))return {ready:false,phase:"needs_storyboard_draft"};
    const storyboard=await readMeta(root,p.storyboardReview,"Storyboard review");
    if(storyboard.status!=="approved"){
      // Bind Backlot change requests to the exact pending Storyboard revision.
      return {ready:false,phase:"needs_storyboard_review",needsUserInput:true,meta:storyboard,storyboard:p.storyboardDraft};
    }
    await assertStoryboardApproved(root);
    const canonical=await readJson<VideoProject>(p.video);
    const state=await loadProjectState(root,canonical);
    const canonicalCheck=await validateCanonicalProject(root,canonical);
    if(!canonicalCheck.valid)throw new Error("Canonical semantic project or semantic preflight is no longer valid.");
    if(!(await exists(p.preflight)))throw new Error("Canonical semantic preflight report is missing.");
    const storedPreflight=await readJson<unknown>(p.preflight);
    if(JSON.stringify(storedPreflight)!==JSON.stringify(canonicalCheck.preflight))throw new Error("Canonical semantic preflight report is stale.");
    await assertReconciliationCurrent(root);
    return {ready:true,phase:"ready_to_render",project:"video.json",revision:state.revision,scriptHash:script.contentHash};
  }catch(error){
    return {ready:false,phase:"invalid_state",error:error instanceof Error?error.message:String(error)};
  }
}
