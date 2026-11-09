import {readJson,writeJson} from "../core/io.js";
import {sha256} from "../core/hash.js";
import type {UniversalHitlEvent} from "./hitl-protocol.js";
import {harnessPaths} from "./paths.js";
import {requestHash} from "./request.js";

export type ReviewChangeCheckpoint="VIDEO_BRIEF"|"SCRIPT"|"STORYBOARD"|"ASSET_PREFLIGHT"|"VISUAL_REVIEW";

export interface ReviewChangeRequest {
  version:"1";
  requestId:string;
  requestHash:string;
  checkpoint:ReviewChangeCheckpoint;
  targetHash:string;
  feedback:string;
  requestedAt:string;
}

interface ReviewChangeLedger {version:"1";requests:ReviewChangeRequest[];}

const REVIEW_CHECKPOINTS=new Set<ReviewChangeCheckpoint>(["VIDEO_BRIEF","SCRIPT","STORYBOARD","ASSET_PREFLIGHT","VISUAL_REVIEW"]);
const REVIEW_PHASES:Record<ReviewChangeCheckpoint,string>={VIDEO_BRIEF:"needs_brief_review",SCRIPT:"needs_script_review",STORYBOARD:"needs_storyboard_review",ASSET_PREFLIGHT:"needs_asset_preflight_approval",VISUAL_REVIEW:"needs_visual_review"};
/** Removes a redundant hash prefix written by the first ledger version. */
const normalizeHash=(value:string):string=>value.startsWith("sha256:sha256:")?value.slice("sha256:".length):value;
/** Narrow untrusted HITL JSON payloads before reading checkpoint fields. */
const asRecord=(value:unknown):Record<string,unknown>|undefined=>typeof value==="object"&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
/** Require a concrete checkpoint binding before persisting review feedback. */
const requiredString=(value:unknown,label:string):string=>{if(typeof value!=="string"||!value.trim())throw new Error(`Active review is missing ${label}.`);return value;};

/** Bind feedback to the exact review subject, so edits automatically create a fresh review. */
export function reviewChangeTargetHash(event:UniversalHitlEvent):string{
  if(event.status!=="REVIEW_REQUIRED"||!event.checkpoint||!REVIEW_CHECKPOINTS.has(event.checkpoint as ReviewChangeCheckpoint))throw new Error("Request changes is available only for an active review checkpoint.");
  const payload=asRecord(event.payload)??{};
  let target:unknown;
  switch(event.checkpoint){
    case "VIDEO_BRIEF":
      target=payload.brief;
      if(!asRecord(target))throw new Error("Active Video Brief review payload is missing the brief.");
      break;
    case "SCRIPT":
      target={contentHash:requiredString(asRecord(payload.scriptReview)?.contentHash,"Script contentHash"),upstreamHash:requiredString(asRecord(payload.scriptReview)?.upstreamHash,"Script upstreamHash")};
      break;
    case "STORYBOARD":
      target={contentHash:requiredString(asRecord(payload.storyboardReview)?.contentHash,"Storyboard contentHash"),upstreamHash:requiredString(asRecord(payload.storyboardReview)?.upstreamHash,"Storyboard upstreamHash")};
      break;
    case "ASSET_PREFLIGHT":
      target={projectHash:requiredString(payload.projectHash,"projectHash"),assetSnapshotHash:requiredString(payload.assetSnapshotHash,"assetSnapshotHash"),reportHash:requiredString(payload.reportHash,"reportHash")};
      break;
    case "VISUAL_REVIEW":
      target={sourceHash:requiredString(event.phase==="renderer_source_changed"?payload.reviewedSourceHash:payload.sourceHash,"renderer sourceHash")};
      break;
  }
  return sha256(JSON.stringify({checkpoint:event.checkpoint,target}));
}

async function readLedger(root:string):Promise<ReviewChangeLedger>{
  try{
    const path=harnessPaths(root).reviewChanges,ledger=await readJson<ReviewChangeLedger>(path);
    if(ledger.version!=="1"||!Array.isArray(ledger.requests))throw new Error("HITL review-change ledger is invalid.");
    if(ledger.requests.some((item)=>item.version!=="1"||typeof item.requestId!=="string"||typeof item.requestHash!=="string"||!REVIEW_CHECKPOINTS.has(item.checkpoint)||typeof item.targetHash!=="string"||typeof item.feedback!=="string"||typeof item.requestedAt!=="string"))throw new Error("HITL review-change ledger contains an invalid request.");
    const normalized={...ledger,requests:ledger.requests.map((item)=>({...item,requestId:normalizeHash(item.requestId),targetHash:normalizeHash(item.targetHash)}))};
    if(JSON.stringify(normalized)!==JSON.stringify(ledger))await writeJson(path,normalized);
    return normalized;
  }catch(error){
    if((error as {code?:string})?.code==="ENOENT")return {version:"1",requests:[]};
    throw error;
  }
}

/** Persist a human's requested edits without recording approval or changing the reviewed artifact. */
export async function submitReviewChange(root:string,event:UniversalHitlEvent,feedbackInput:string):Promise<ReviewChangeRequest>{
  if(event.status!=="REVIEW_REQUIRED"||!event.checkpoint||!REVIEW_CHECKPOINTS.has(event.checkpoint as ReviewChangeCheckpoint))throw new Error("Request changes is available only for an active review checkpoint.");
  if(event.phase!==REVIEW_PHASES[event.checkpoint as ReviewChangeCheckpoint])throw new Error("Request changes is available only for the current reviewable artifact, not a stale or changed preview.");
  const feedback=feedbackInput.trim();
  if(!feedback)throw new Error("Change feedback cannot be empty.");
  if(feedback.length>4000)throw new Error("Change feedback must be 4000 characters or fewer.");
  const targetHash=reviewChangeTargetHash(event),currentRequestHash=await requestHash(root),path=harnessPaths(root).reviewChanges,ledger=await readLedger(root);
  const duplicate=ledger.requests.find((item)=>item.requestHash===currentRequestHash&&item.checkpoint===event.checkpoint&&item.targetHash===targetHash);
  if(duplicate)throw new Error("Changes were already requested for this review. Wait for the revised artifact.");
  const requestedAt=new Date().toISOString();
  const request:ReviewChangeRequest={version:"1",requestId:sha256(JSON.stringify({currentRequestHash,checkpoint:event.checkpoint,targetHash,feedback,requestedAt})),requestHash:currentRequestHash,checkpoint:event.checkpoint as ReviewChangeCheckpoint,targetHash,feedback,requestedAt};
  await writeJson(path,{version:"1",requests:[...ledger.requests,request]} satisfies ReviewChangeLedger);
  return request;
}

/** Return a pending human change request only while it targets the current reviewed artifact. */
export async function applyPendingReviewChange(root:string,event:UniversalHitlEvent):Promise<UniversalHitlEvent>{
  const checkpoint=event.checkpoint??(event.status==="WORKING"&&event.phase.startsWith("asset_preflight_")?"ASSET_PREFLIGHT":undefined);
  if(!checkpoint||!REVIEW_CHECKPOINTS.has(checkpoint as ReviewChangeCheckpoint))return event;
  const currentRequestHash=await requestHash(root),ledger=await readLedger(root);
  const candidates=ledger.requests.filter((item)=>item.requestHash===currentRequestHash&&item.checkpoint===checkpoint);
  if(!candidates.length)return event;
  const request=[...candidates].reverse()[0];
  if(event.status==="WORKING"&&event.checkpoint===undefined&&event.phase.startsWith("asset_preflight_")){
    return revisionRequestedEvent(event,request);
  }
  if(event.status!=="REVIEW_REQUIRED"||!event.checkpoint||!REVIEW_CHECKPOINTS.has(event.checkpoint as ReviewChangeCheckpoint))return event;
  let targetHash:string;
  try{targetHash=reviewChangeTargetHash(event);}catch{return event;}
  const matchingRequest=[...candidates].reverse().find((item)=>item.targetHash===targetHash);
  if(!matchingRequest)return event;
  return revisionRequestedEvent(event,matchingRequest);
}

/** Keeps requested feedback visible while the Asset Preflight inputs are being repaired. */
function revisionRequestedEvent(event:UniversalHitlEvent,request:ReviewChangeRequest):UniversalHitlEvent{
  return {
    ...event,
    checkpoint:request.checkpoint,
    status:"WORKING",
    phase:"revision_requested",
    payload:{reviewChange:request,reviewedPayload:event.payload},
    message:`Human requested changes for ${event.checkpoint}. Revise the artifact, then submit a fresh review.`
  };
}
