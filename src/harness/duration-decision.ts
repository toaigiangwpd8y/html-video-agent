import {readJson,writeJson} from "../core/io.js";
import {sha256} from "../core/hash.js";
import {harnessPaths} from "./paths.js";
import {loadVideoBrief} from "./preproduction-hitl.js";
import {validateNarrationManifest} from "../tts/cache.js";
import {assessNarrationFit} from "../tts/duration.js";
import type {NarrationManifest} from "../tts/types.js";
import {reopenCheckpoint,reopenStatus,type ReopenCheckpoint} from "./reopen.js";
import type {VideoProject} from "../core/types.js";
import {exists} from "./fs.js";

export type DurationChoice="shorten_script"|"revise_brief";
export interface DurationDecision {version:"1";choice:DurationChoice;reason:string;briefHash:string;scriptHash:string;narrationManifestHash:string;timingPlanHash:string;createdAt:string;reopenGeneration?:number;}

export async function durationAssessment(root:string){const p=harnessPaths(root),brief=await loadVideoBrief(root),validation=await validateNarrationManifest(root);if(!validation.valid)throw new Error(`Narration is not ready for duration assessment: ${validation.errors.join(" ")}`);const manifest=await readJson<NarrationManifest>(p.narrationManifest),base=assessNarrationFit(manifest,brief.durationPolicy,brief.pacing);let measuredSeconds=base.measuredSeconds,timingPlanHash=sha256(JSON.stringify({narrationManifestHash:manifest.manifestHash,measuredSeconds}));if(await exists(p.storyboardDraft)&&await exists(p.storyboardReview)){const review=await readJson<Record<string,unknown>>(p.storyboardReview),script=await readJson<Record<string,unknown>>(p.scriptReview).catch(()=>({} as Record<string,unknown>));if(review.upstreamHash===script.contentHash){const project=await readJson<VideoProject>(p.storyboardDraft),projectSeconds=project.meta.durationsInFrames/project.meta.fps;measuredSeconds=Math.max(measuredSeconds,projectSeconds);timingPlanHash=sha256(JSON.stringify({project,measuredSeconds}));}}const maxSeconds=brief.durationPolicy.maxSeconds,fit={...base,measuredSeconds,status:maxSeconds!==undefined&&measuredSeconds>maxSeconds?"over_ceiling" as const:"within_ceiling" as const,...(maxSeconds!==undefined&&measuredSeconds>maxSeconds?{overrunSeconds:measuredSeconds-maxSeconds}:{})};return {brief,briefHash:sha256(JSON.stringify(brief)),manifest,fit,timingPlanHash};}

export async function durationDecisionIsCurrent(root:string):Promise<boolean>{const p=harnessPaths(root);try{const saved=await readJson<DurationDecision>(p.durationDecision),current=await durationAssessment(root);return saved.version==="1"&&saved.briefHash===current.briefHash&&saved.scriptHash===current.manifest.scriptHash&&saved.narrationManifestHash===current.manifest.manifestHash&&saved.timingPlanHash===current.timingPlanHash;}catch{return false;}}

export async function chooseDurationAction(root:string,choice:DurationChoice,reason:string,expectedGeneration:number):Promise<DurationDecision>{
  if(choice!=="shorten_script"&&choice!=="revise_brief")throw new Error("Duration choice must be shorten_script or revise_brief.");
  if(reason.trim().length<8)throw new Error("Provide concrete duration revision guidance of at least eight characters.");
  const p=harnessPaths(root),assessment=await durationAssessment(root);if(assessment.fit.status!=="over_ceiling")throw new Error("Duration ceiling is not exceeded; no host decision is active.");
  const prior=await reopenStatus(root);if(prior.generation!==expectedGeneration)throw new Error(`Stale duration decision: expected generation ${expectedGeneration}, current generation is ${prior.generation}.`);
  let reopenGeneration:number|undefined;
  const reviews=await Promise.all([readJson<Record<string,unknown>>(p.scriptReview).catch(()=>({} as Record<string,unknown>)),readJson<Record<string,unknown>>(p.videoBrief).catch(()=>({} as Record<string,unknown>))]);
  if(choice==="revise_brief"&&assessment.brief.status==="approved"){
    const result=await reopenCheckpoint(root,{checkpoint:"VIDEO_BRIEF" as ReopenCheckpoint,reason,expectedRevision:expectedGeneration});reopenGeneration=result.generation;
  }else if(choice==="shorten_script"&&reviews[0].status==="approved"){
    const result=await reopenCheckpoint(root,{checkpoint:"SCRIPT" as ReopenCheckpoint,reason,expectedRevision:expectedGeneration});reopenGeneration=result.generation;
  }
  const result:DurationDecision={version:"1",choice,reason:reason.trim(),briefHash:assessment.briefHash,scriptHash:assessment.manifest.scriptHash,narrationManifestHash:assessment.manifest.manifestHash,timingPlanHash:assessment.timingPlanHash,createdAt:new Date().toISOString(),...(reopenGeneration===undefined?{}:{reopenGeneration})};
  await writeJson(p.durationDecision,result);return result;
}
