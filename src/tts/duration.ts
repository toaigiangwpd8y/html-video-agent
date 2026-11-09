import type {NarrationManifest} from "./types.js";

export interface DurationPolicy {targetSeconds?:number;maxSeconds?:number;}
export interface DurationFit {status:"within_ceiling"|"over_ceiling";measuredSeconds:number;targetSeconds?:number;maxSeconds?:number;overrunSeconds?:number;targetDeltaSeconds?:number;}

export function durationPolicy(value:unknown,legacyDurationSeconds?:unknown):DurationPolicy {
  let targetSeconds:number|undefined,maxSeconds:number|undefined;
  if(value&&typeof value==="object"&&!Array.isArray(value)){const policy=value as Record<string,unknown>;if(policy.version!==undefined&&policy.version!=="1")throw new Error("Duration policy version must be 1.");targetSeconds=policy.targetSeconds as number|undefined;maxSeconds=policy.maxSeconds as number|undefined;}
  else if(typeof legacyDurationSeconds==="number")targetSeconds=legacyDurationSeconds;
  for(const [label,n] of [["targetSeconds",targetSeconds],["maxSeconds",maxSeconds]] as const)if(n!==undefined&&(!Number.isFinite(n)||n<=0))throw new Error(`Duration ${label} must be finite and positive.`);
  if(targetSeconds===undefined&&maxSeconds===undefined)throw new Error("Duration policy requires targetSeconds or maxSeconds.");
  if(targetSeconds!==undefined&&maxSeconds!==undefined&&targetSeconds>maxSeconds)throw new Error("Duration targetSeconds cannot exceed maxSeconds.");
  return { ...(targetSeconds===undefined?{}:{targetSeconds}),...(maxSeconds===undefined?{}:{maxSeconds}) };
}

export function assessNarrationFit(manifest:NarrationManifest,policy:DurationPolicy,_pacing?:string):DurationFit {
  const measuredSeconds=manifest.totalTimelineSeconds,maxSeconds=policy.maxSeconds,targetSeconds=policy.targetSeconds;
  return {status:maxSeconds!==undefined&&measuredSeconds>maxSeconds?"over_ceiling":"within_ceiling",measuredSeconds,...(targetSeconds===undefined?{}:{targetSeconds,targetDeltaSeconds:measuredSeconds-targetSeconds}),...(maxSeconds===undefined?{}:{maxSeconds,...(measuredSeconds>maxSeconds?{overrunSeconds:measuredSeconds-maxSeconds}:{})})};
}
