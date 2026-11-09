import {cp,mkdir,readFile,rm} from "node:fs/promises";
import {dirname,relative,resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {readJson,writeJson} from "../core/io.js";
import {harnessPaths} from "./paths.js";
import {exists} from "./fs.js";

export type ReopenCheckpoint="VIDEO_BRIEF"|"SCRIPT"|"STORYBOARD"|"ASSET_PREFLIGHT"|"VISUAL_REVIEW";
const ORDER:ReopenCheckpoint[]=["VIDEO_BRIEF","SCRIPT","STORYBOARD","ASSET_PREFLIGHT","VISUAL_REVIEW"];
export interface ReopenRecord {operationId:string;checkpoint:ReopenCheckpoint;reason:string;previousGeneration:number;generation:number;expectedRevision:number;createdAt:string;staleDescendants:ReopenCheckpoint[];snapshots:Record<string,string>;state:"pending"|"applied";}
export interface ReopenResult {ok:true;idempotent:boolean;generation:number;record:ReopenRecord;}
interface ReopenLedger {version:"1";records:ReopenRecord[];pending:ReopenCheckpoint[];}

function affected(checkpoint:ReopenCheckpoint):ReopenCheckpoint[]{return ORDER.slice(ORDER.indexOf(checkpoint));}
function isApproved(value:any):boolean{return value?.status==="approved"&&value?.approvedBy==="HUMAN";}
async function generation(root:string):Promise<number>{const p=harnessPaths(root);try{const value=await readJson<{generation?:number}>(p.editGeneration);return Number.isInteger(value.generation)?Number(value.generation):0;}catch{return 0;}}
async function ledger(root:string):Promise<ReopenLedger>{const p=harnessPaths(root);try{const value=await readJson<ReopenLedger>(p.reopenLedger);if(value.version!=="1"||!Array.isArray(value.records)||!Array.isArray(value.pending))throw new Error("Invalid reopen ledger.");return value;}catch(error){if(await exists(p.reopenLedger))throw error;return {version:"1",records:[],pending:[]};}}
function activeApprovalPaths(root:string):Array<[string,string]>{const p=harnessPaths(root);return [[p.videoBrief,"video-brief.json"],[p.researchBinding,"research-binding.json"],[p.productionProfile,"production-profile.json"],[p.scriptReview,"script-review.json"],[p.scriptDraft,"script.md"],[p.storyboardReview,"storyboard-review.json"],[p.storyboardDraft,"storyboard.json"],[p.productionPreflight,"production-preflight.json"],[p.productionPreflightState,"production-preflight-state.json"],[p.productionPreflightApproval,"production-preflight-approval.json"],[p.remotionRendererState,"remotion-state.json"],[p.rendererState,"hyperframes-state.json"],[p.remotionManifest,"remotion-manifest.json"],[p.manifest,"hyperframes-manifest.json"],[p.remotionGenerated,"remotion-generated"],[p.remotionPublicAssets,"remotion-public-assets"],[p.finalManifest,"final-manifest.json"],[p.projectState,"project-state.json"],[p.video,"video.json"],[p.assetManifest,"asset-manifest.json"],[p.narrationManifest,"narration-manifest.json"]];}

async function assertApprovedTarget(root:string,checkpoint:ReopenCheckpoint):Promise<void>{const p=harnessPaths(root);
  if(checkpoint==="VIDEO_BRIEF"){if(!isApproved(await safeJson(p.videoBrief)))throw new Error("VIDEO_BRIEF is not currently approved.");return;}
  if(checkpoint==="SCRIPT"){if(!isApproved(await safeJson(p.scriptReview)))throw new Error("SCRIPT is not currently approved.");return;}
  if(checkpoint==="STORYBOARD"){if(!isApproved(await safeJson(p.storyboardReview)))throw new Error("STORYBOARD is not currently approved.");return;}
  if(checkpoint==="ASSET_PREFLIGHT"){
    const approval=await safeJson(p.productionPreflightApproval),finalized=await exists(p.finalVideo)&&await exists(p.finalManifest);
    if(!isApproved(approval)&&!finalized)throw new Error("ASSET_PREFLIGHT has no current human approval or finalized delivery.");
    return;
  }
  const states=[await safeJson(p.remotionRendererState),await safeJson(p.rendererState)];if(!states.some(s=>isApproved(s?.visualApproval)))throw new Error("VISUAL_REVIEW is not currently approved.");
}
async function safeJson(path:string):Promise<any>{try{return await readJson<any>(path);}catch{return undefined;}}

/** Serializes host checkpoint approval commits against reopen transactions. */
export async function withHostApprovalLock<T>(root:string,operation:()=>Promise<T>):Promise<T>{
  const lock=resolve(root,".video/reopen.lock");await mkdir(resolve(root,".video"),{recursive:true});
  try{await mkdir(lock);}catch{
    let stale=false;try{const owner=await readJson<{pid?:number}>(resolve(lock,"owner.json"));if(Number.isInteger(owner.pid)){try{process.kill(owner.pid!,"0");}catch{stale=true;}}}catch{}
    if(!stale)throw new Error("Another host checkpoint transaction is active; retry after it finishes.");
    await rm(lock,{recursive:true,force:true});await mkdir(lock);
  }
  try{await writeJson(resolve(lock,"owner.json"),{pid:process.pid,createdAt:new Date().toISOString()});return await operation();}
  finally{await rm(lock,{recursive:true,force:true});}
}
async function archiveSnapshot(root:string,operationId:string):Promise<Record<string,string>>{const directory=resolve(root,".video/reopen-history",operationId);await mkdir(directory,{recursive:true});const copied:Record<string,string>={};const sources=activeApprovalPaths(root);const renderer=await safeJson(harnessPaths(root).rendererState);if(typeof renderer?.projectDir==="string"){const p=harnessPaths(root),project=resolve(root,renderer.projectDir),from=relative(p.hyperframesProjects,project);if(from!==".."&&!from.startsWith(`..${process.platform==="win32"?"\\":"/"}`)&&!from.startsWith(process.platform==="win32"?"\\":"/"))sources.push([project,"hyperframes-project-source"]);}
  for(const[source,name]of sources){if(!(await exists(source)))continue;const target=resolve(directory,name);await mkdir(dirname(target),{recursive:true});await cp(source,target,{recursive:true});copied[source]=target;}return copied;}
async function resetApprovals(root:string,stale:ReopenCheckpoint[]):Promise<void>{const p=harnessPaths(root),hits=new Set(stale);
  if(hits.has("VIDEO_BRIEF")){const b=await safeJson(p.videoBrief);if(b){b.status="awaiting_user_review";delete b.approvedBy;await writeJson(p.videoBrief,b);}}
  if(hits.has("SCRIPT")){const m=await safeJson(p.scriptReview);if(m){m.status="awaiting_user_review";delete m.approvedBy;await writeJson(p.scriptReview,m);}}
  if(hits.has("STORYBOARD")){const m=await safeJson(p.storyboardReview);if(m){m.status="awaiting_user_review";delete m.approvedBy;await writeJson(p.storyboardReview,m);}}
  if(hits.has("ASSET_PREFLIGHT"))await rm(p.productionPreflightApproval,{force:true});
  if(hits.has("VIDEO_BRIEF")||hits.has("SCRIPT")||hits.has("STORYBOARD")){
    await (await import("./canonical-promotion.js")).preserveRemotionWorkspace(root);
    for(const path of [p.remotionRendererState,p.rendererState])await rm(path,{force:true});
  }else if(hits.has("VISUAL_REVIEW"))for(const path of [p.remotionRendererState,p.rendererState]){const state=await safeJson(path);if(!state)continue;state.phase="AUTHORING";delete state.visualApproval;delete state.previewUrl;delete state.previewPid;delete state.previewPort;delete state.renderedHash;await writeJson(path,state);}
  if(stale.length)await rm(p.finalManifest,{force:true});
}

async function preserveHyperFramesCarryForward(root:string,snapshots:Record<string,string>,stale:ReopenCheckpoint[]):Promise<void>{
  if(!stale.some(checkpoint=>checkpoint==="VIDEO_BRIEF"||checkpoint==="SCRIPT"||checkpoint==="STORYBOARD"))return;
  const p=harnessPaths(root),statePath=snapshots[p.rendererState];if(!statePath)return;
  let state:{projectDir?:string;projectId?:string;revision?:number};try{state=await readJson(statePath);}catch{return;}
  if(!state.projectDir||!state.projectId||!Number.isInteger(state.revision))return;
  const projectDir=resolve(root,state.projectDir),from=relative(p.hyperframesProjects,projectDir);
  if(from===".."||from.startsWith(`..${process.platform==="win32"?"\\":"/"}`)||from.startsWith(process.platform==="win32"?"\\":"/"))return;
  await writeJson(p.rendererCarryForward,{version:"1",renderer:"hyperframes",projectDir:state.projectDir,projectId:state.projectId,revision:state.revision});
}

/** Reopens an approved checkpoint under a serialized, idempotent host transaction. */
export async function reopenCheckpoint(root:string,input:{checkpoint:ReopenCheckpoint;reason:string;expectedRevision:number;operationId?:string}):Promise<ReopenResult>{
  if(!ORDER.includes(input.checkpoint))throw new Error("Unknown approved checkpoint.");
  if(typeof input.reason!=="string"||input.reason.trim().length<8)throw new Error("Reopen requires concrete feedback of at least eight characters.");
  if(!Number.isInteger(input.expectedRevision)||input.expectedRevision<0)throw new Error("Reopen expectedRevision must be the current nonnegative edit generation.");
  const p=harnessPaths(root),operationId=input.operationId??randomUUID(),lock=resolve(root,".video/reopen.lock");await mkdir(resolve(root,".video"),{recursive:true});
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(operationId))throw new Error("Reopen operationId must be a safe 1-100 character identifier.");
  try{await mkdir(lock);}catch{
    let stale=false;try{const owner=await readJson<{pid?:number;createdAt?:string}>(resolve(lock,"owner.json"));if(Number.isInteger(owner.pid)){try{process.kill(owner.pid!,"0");}catch{stale=true;}}}catch{}
    if(!stale)throw new Error("Another reopen transaction is active; retry with the same operation ID after it finishes.");
    await rm(lock,{recursive:true,force:true});await mkdir(lock);
  }
  try{
    await writeJson(resolve(lock,"owner.json"),{pid:process.pid,createdAt:new Date().toISOString()});
    const current=await ledger(root),existing=current.records.find(r=>r.operationId===operationId);if(existing){if(existing.checkpoint!==input.checkpoint||existing.reason!==input.reason.trim()||existing.expectedRevision!==input.expectedRevision)throw new Error("Reopen operationId was already used for a different checkpoint, reason, or expected generation.");if(existing.state==="applied")return {ok:true,idempotent:true,generation:existing.generation,record:existing};const live=await generation(root);if(live!==existing.previousGeneration&&live!==existing.generation)throw new Error(`Cannot resume reopen operation: expected generation ${existing.previousGeneration} or ${existing.generation}, current generation is ${live}.`);if(live===existing.previousGeneration)await writeJson(p.editGeneration,{version:"1",generation:existing.generation,operationId,checkpoint:existing.checkpoint,updatedAt:existing.createdAt});await resetApprovals(root,existing.staleDescendants);await preserveHyperFramesCarryForward(root,existing.snapshots,existing.staleDescendants);existing.state="applied";await writeJson(p.reopenLedger,current);return {ok:true,idempotent:true,generation:existing.generation,record:existing};}
    const previous=await generation(root);if(previous!==input.expectedRevision)throw new Error(`Stale reopen request: expected edit generation ${input.expectedRevision}, current generation is ${previous}.`);
    await assertApprovedTarget(root,input.checkpoint);
    const snapshots=await archiveSnapshot(root,operationId),stale=affected(input.checkpoint),next=previous+1;
    const record:ReopenRecord={operationId,checkpoint:input.checkpoint,reason:input.reason.trim(),previousGeneration:previous,generation:next,expectedRevision:input.expectedRevision,createdAt:new Date().toISOString(),staleDescendants:stale,snapshots,state:"pending"};
    current.records.push(record);current.pending=[...new Set([...current.pending,...stale])];
    await writeJson(p.reopenLedger,current);await writeJson(p.editGeneration,{version:"1",generation:next,operationId,checkpoint:input.checkpoint,updatedAt:record.createdAt});
    await resetApprovals(root,stale);await preserveHyperFramesCarryForward(root,snapshots,stale);record.state="applied";await writeJson(p.reopenLedger,current);
    return {ok:true,idempotent:false,generation:next,record};
  }finally{await rm(lock,{recursive:true,force:true});}
}

export async function assertCheckpointCurrent(root:string,checkpoint:ReopenCheckpoint):Promise<void>{const current=await ledger(root);if(current.pending.includes(checkpoint))throw new Error(`${checkpoint} approval is stale after a host reopen. Reconcile the affected artifacts and obtain a new human approval.`);}
export async function markCheckpointReapproved(root:string,checkpoint:ReopenCheckpoint):Promise<void>{const p=harnessPaths(root),current=await ledger(root);if(!current.pending.includes(checkpoint))return;current.pending=current.pending.filter(item=>item!==checkpoint);await writeJson(p.reopenLedger,current);}
export async function reopenStatus(root:string):Promise<{generation:number;pending:ReopenCheckpoint[];records:ReopenRecord[]}>{const current=await ledger(root);return {generation:await generation(root),pending:current.pending,records:current.records};}
