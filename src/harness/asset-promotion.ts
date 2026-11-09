import {sha256} from "../core/hash.js";
import type {VideoProject} from "../core/types.js";
import {loadProjectState} from "./project-state.js";
import {storyboardReviewStatus} from "./preproduction-hitl.js";
import {universalHitlStatus} from "./hitl-protocol.js";

export interface AssetPromotionRights {rights?:string;license?:string;permittedUse:string;notes?:string;}
export class AssetPromotionError extends Error {
  readonly code:string;
  constructor(code:string,message:string){super(message);this.name="AssetPromotionError";this.code=code;}
}
const nonempty=(value:unknown):value is string=>typeof value==="string"&&value.trim().length>0;

/** Shared mutation boundary for every workflow that registers an asset against canonical video state. */
export async function assertAssetMutationHITLAllowed(root:string):Promise<void>{
  const hitl=await universalHitlStatus(root);
  if(hitl.status==="INPUT_REQUIRED"||hitl.status==="REVIEW_REQUIRED")throw new AssetPromotionError("NEEDS_USER_ACTION","Asset materialization is blocked by the active host-owned HITL checkpoint.");
}

export async function assertCanonicalAssetMutationAllowed(root:string,project:VideoProject):Promise<void>{
  await assertAssetMutationHITLAllowed(root);
  const review=await storyboardReviewStatus(root),meta=review.meta as Record<string,unknown>|undefined;
  if(review.ready!==true||meta?.status!=="approved"||meta.approvedBy!=="HUMAN"||meta.contentHash!==sha256(JSON.stringify(project)))throw new AssetPromotionError("CANONICAL_NOT_APPROVED","Asset materialization requires the current canonical project to come from the host-approved Storyboard.");
  await loadProjectState(root,project);
  if(!Array.isArray(project.scenes))throw new AssetPromotionError("CANONICAL_INVALID","Canonical video.json has no scenes array.");
}

/** Shared value validation extracted from capture materialization. */
export function validateAssetPromotion(assetId:unknown,sceneId:unknown,role:unknown,rightsValue:unknown):{assetId:string;sceneId:string;role:string;rights:AssetPromotionRights}{
  if(typeof assetId!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(assetId))throw new AssetPromotionError("INVALID_ASSET_ID","asset-id must be 1–100 letters, numbers, dots, underscores, or hyphens.");
  if(typeof role!=="string"||!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(role))throw new AssetPromotionError("INVALID_ROLE","role must be a plain manifest role name.");
  if(!nonempty(sceneId))throw new AssetPromotionError("INVALID_SCENE","scene-id is required.");
  if(!rightsValue||typeof rightsValue!=="object"||Array.isArray(rightsValue))throw new AssetPromotionError("INVALID_RIGHTS","Rights must be a JSON object.");
  const data=rightsValue as Record<string,unknown>;
  if((!nonempty(data.rights)&&!nonempty(data.license))||!nonempty(data.permittedUse))throw new AssetPromotionError("INVALID_RIGHTS","Rights must include a factual rights or license statement and permittedUse.");
  if(data.notes!==undefined&&!nonempty(data.notes))throw new AssetPromotionError("INVALID_RIGHTS","Rights notes must be a non-empty string when provided.");
  return {assetId,sceneId:sceneId.trim(),role,rights:{...(nonempty(data.rights)?{rights:data.rights.trim()}:{}),...(nonempty(data.license)?{license:data.license.trim()}:{}),permittedUse:data.permittedUse.trim(),...(nonempty(data.notes)?{notes:data.notes.trim()}:{})}};
}

