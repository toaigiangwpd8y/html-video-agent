import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {realpath,stat} from "node:fs/promises";
import {relative,resolve} from "node:path";
import {productionAssetPreflightFromDisk} from "../authoring/preflight.js";
import {readJson,writeJson} from "../core/io.js";
import {sha256} from "../core/hash.js";
import type {AuthorPreflightReport,VideoProject} from "../core/types.js";
import {exists,requireFile} from "./fs.js";
import type {AssetManifest} from "./assets.js";
import {harnessPaths} from "./paths.js";
import {videoProjectHash} from "./project-state.js";
import {assertCheckpointCurrent,markCheckpointReapproved,withHostApprovalLock} from "./reopen.js";
import {assertReconciliationCurrent} from "./reconciliation.js";
import {registerApprovedNarrationBindings,validateApprovedNarrationBindings} from "./narration-bindings.js";

export interface ProductionPreflightState {
  version:"1";
  valid:boolean;
  projectHash:string;
  assetSnapshotHash?:string;
  reportHash:string;
  inputSignature?:string;
  createdAt:string;
}

export interface ProductionPreflightApproval {
  version:"1";
  status:"approved";
  approvedBy:"HUMAN";
  approvedAt:string;
  projectHash:string;
  assetSnapshotHash:string;
  reportHash:string;
}

export type ProductionPreflightStatus="NOT_RUN"|"FAILED"|"STALE"|"REVIEW_REQUIRED"|"APPROVED"|"LEGACY_FINALIZED";
export interface ProductionPreflightStatusResult {
  status:ProductionPreflightStatus;
  report:AuthorPreflightReport|null;
  projectHash?:string;
  assetSnapshotHash?:string;
  reportHash?:string;
  approvedAt?:string;
  approvedBy?:"HUMAN";
  message:string;
}

function issue(message:string){return {code:"ASSET_SNAPSHOT_FAILED",severity:"error" as const,blocking:true,message,path:"/assets/manifest.json"};}

async function assetSource(root:string,publicPath:string):Promise<string>{
  if(!publicPath.startsWith("/assets/")||publicPath.includes("\\")||publicPath.includes("\0"))throw new Error(`Asset path '${publicPath}' is not a local /assets/ path.`);
  const segments=publicPath.slice("/assets/".length).split("/");
  if(segments.some(segment=>!segment||segment==="."||segment===".."))throw new Error(`Asset path '${publicPath}' contains unsafe path segments.`);
  const repositoryReal=await realpath(root),rootReal=await realpath(resolve(root,"assets")),assetRootFromRepository=relative(repositoryReal,rootReal);
  if(assetRootFromRepository===".."||assetRootFromRepository.startsWith(`..${process.platform==="win32"?"\\":"/"}`)||assetRootFromRepository.startsWith(process.platform==="win32"?"\\":"/"))throw new Error("The local assets directory resolves outside the repository.");
  const sourceReal=await realpath(resolve(rootReal,...segments)),fromRoot=relative(rootReal,sourceReal);
  if(fromRoot===".."||fromRoot.startsWith(`..${process.platform==="win32"?"\\":"/"}`)||fromRoot.startsWith(process.platform==="win32"?"\\":"/"))throw new Error(`Asset path '${publicPath}' resolves outside the local assets directory.`);
  if(!(await stat(sourceReal)).isFile())throw new Error(`Asset path '${publicPath}' is not a regular file.`);
  return sourceReal;
}

async function fingerprintAssets(root:string,manifest:AssetManifest):Promise<string>{
  if(!Array.isArray(manifest.assets))throw new Error("assets/manifest.json must contain an assets array.");
  const files:Array<{id:string;publicPath:string;sha256:string}>=[];
  for(const asset of manifest.assets){
    const source=await assetSource(root,asset.publicPath),digest=createHash("sha256");
    for await(const chunk of createReadStream(source))digest.update(chunk as Uint8Array);
    files.push({id:asset.id,publicPath:asset.publicPath,sha256:digest.digest("hex")});
  }
  return sha256(JSON.stringify({manifest,files}));
}

async function quickInputSignature(root:string,projectHash:string,manifest:AssetManifest):Promise<string>{
  const inputs:Array<{id:string;publicPath:string;realPath:string;size:number;mtimeMs:number;ctimeMs:number;ino:number;dev:number}>=[];
  for(const asset of manifest.assets){
    const source=await assetSource(root,asset.publicPath),metadata=await stat(source) as Awaited<ReturnType<typeof stat>>&{mtimeMs:number;ctimeMs:number;ino:number;dev:number};
    inputs.push({id:asset.id,publicPath:asset.publicPath,realPath:relative(resolve(root,"assets"),source).replaceAll("\\","/"),size:metadata.size,mtimeMs:metadata.mtimeMs,ctimeMs:metadata.ctimeMs,ino:metadata.ino,dev:metadata.dev});
  }
  return sha256(JSON.stringify({projectHash,manifest,inputs}));
}

async function finalizedDeliveryExists(root:string):Promise<boolean>{
  const p=harnessPaths(root);if(!(await exists(p.finalVideo))||!(await exists(p.finalManifest)))return false;
  for(const path of [p.rendererState,p.remotionRendererState])if(await exists(path))try{const state=await readJson<{phase?:string}>(path);if(state.phase==="FINALIZED")return true;}catch{}
  return false;
}

/** Runs production asset validation and freezes its project and media inputs. */
export async function runProductionAssetPreflight(root:string):Promise<{report:AuthorPreflightReport;state:ProductionPreflightState}>{
  await assertReconciliationCurrent(root);
  const p=harnessPaths(root);await requireFile(p.video,"Canonical video.json");const project=await readJson<VideoProject>(p.video),projectHash=videoProjectHash(project);
  if(await exists(p.narrationManifest))await registerApprovedNarrationBindings(root,project);
  else if(project.scenes.some(scene=>Boolean(scene.audio?.voiceoverText.trim())))throw new Error("Approved narration manifest is missing. Renderer asset preflight cannot synthesize or fabricate voice assets.");
  const assets=await readJson<AssetManifest>(p.assetManifest);if(await exists(p.narrationManifest)){const narration=await validateApprovedNarrationBindings(root,project,assets);if(!narration.valid)throw new Error(`Approved narration bindings failed: ${narration.errors.join(" ")}`);}
  const result=await productionAssetPreflightFromDisk(project,root);let report=result.report,assetSnapshotHash:string|undefined,inputSignature:string|undefined;
  if(report.valid){
    try{const manifest=await readJson<AssetManifest>(p.assetManifest);assetSnapshotHash=await fingerprintAssets(root,manifest);inputSignature=await quickInputSignature(root,projectHash,manifest);}
    catch(error){assetSnapshotHash=undefined;inputSignature=undefined;report={valid:false,issues:[...report.issues,issue(error instanceof Error?error.message:String(error))]};}
  }
  const state:ProductionPreflightState={version:"1",valid:report.valid,projectHash,...(assetSnapshotHash?{assetSnapshotHash}:{}),reportHash:sha256(JSON.stringify(report)),...(inputSignature?{inputSignature}:{}),createdAt:new Date().toISOString()};
  await writeJson(p.productionPreflight,report);await writeJson(p.productionPreflightState,state);
  return {report,state};
}

/** Checks whether the saved preflight report and host approval still match current inputs. */
export async function productionAssetPreflightStatus(root:string,forceFresh=false):Promise<ProductionPreflightStatusResult>{
  const p=harnessPaths(root);
  if(await finalizedDeliveryExists(root))return {status:"LEGACY_FINALIZED",report:await exists(p.productionPreflight)?await readJson<AuthorPreflightReport>(p.productionPreflight):null,message:"This finalized delivery predates the asset approval gate; no retroactive approval is required."};
  if(!(await exists(p.productionPreflight)))return {status:"NOT_RUN",report:null,message:"Run production asset preflight after registering the project's production assets."};
  let report:AuthorPreflightReport,state:ProductionPreflightState,approval:ProductionPreflightApproval|undefined;
  try{report=await readJson<AuthorPreflightReport>(p.productionPreflight);}catch{return {status:"STALE",report:null,message:"Production preflight report is unreadable. Run it again before renderer preparation."};}
  if(!report.valid)return {status:"FAILED",report,message:"Production asset preflight has blocking issues. Resolve them and run preflight again."};
  try{state=await readJson<ProductionPreflightState>(p.productionPreflightState);}catch{return {status:"STALE",report,message:"Preflight has no input binding. Run production asset preflight again before approval."};}
  if(state.version!=="1"||!state.valid||!state.projectHash||!state.assetSnapshotHash||!state.reportHash||!state.inputSignature)return {status:"STALE",report,message:"Preflight input binding is invalid. Run production asset preflight again."};
  if(sha256(JSON.stringify(report))!==state.reportHash)return {status:"STALE",report,message:"Production preflight report differs from its saved input binding. Run it again before approval."};
  try{approval=await readJson<ProductionPreflightApproval>(p.productionPreflightApproval);}catch{}
  try{
    const project=await readJson<VideoProject>(p.video),projectHash=videoProjectHash(project),manifest=await readJson<AssetManifest>(p.assetManifest);
    if(forceFresh){
      const assetSnapshotHash=await fingerprintAssets(root,manifest),inputSignature=await quickInputSignature(root,projectHash,manifest);
      if(projectHash!==state.projectHash||assetSnapshotHash!==state.assetSnapshotHash||inputSignature!==state.inputSignature)return {status:"STALE",report,projectHash,assetSnapshotHash,reportHash:state.reportHash,message:"Canonical project, asset registry, or asset bytes changed after preflight. Rerun preflight and obtain a new approval."};
    }else{
      const inputSignature=await quickInputSignature(root,projectHash,manifest);
      if(projectHash!==state.projectHash||inputSignature!==state.inputSignature)return {status:"STALE",report,projectHash,assetSnapshotHash:state.assetSnapshotHash,reportHash:state.reportHash,message:"Canonical project, asset registry, or asset files changed after preflight. Rerun preflight and obtain a new approval."};
    }
    if(approval?.version==="1"&&approval.status==="approved"&&approval.approvedBy==="HUMAN"&&approval.projectHash===state.projectHash&&approval.assetSnapshotHash===state.assetSnapshotHash&&approval.reportHash===state.reportHash)return {status:"APPROVED",report,projectHash:state.projectHash,assetSnapshotHash:state.assetSnapshotHash,reportHash:state.reportHash,approvedAt:approval.approvedAt,approvedBy:"HUMAN",message:"Production assets are approved for the current canonical project and asset bytes."};
    return {status:"REVIEW_REQUIRED",report,projectHash:state.projectHash,assetSnapshotHash:state.assetSnapshotHash,reportHash:state.reportHash,message:"Production asset preflight passed and requires human approval before renderer preparation."};
  }catch(error){return {status:"STALE",report,projectHash:state.projectHash,assetSnapshotHash:state.assetSnapshotHash,reportHash:state.reportHash,message:`Could not verify the preflight inputs: ${error instanceof Error?error.message:String(error)}. Rerun preflight.`};}
}

/** Records human approval only for a fresh, valid production preflight. */
async function approveProductionAssetPreflightLocked(root:string):Promise<{approved:true;approvedBy:"HUMAN";approvedAt:string;projectHash:string;assetSnapshotHash:string;reportHash:string}>{
  await assertReconciliationCurrent(root);
  const p=harnessPaths(root),status=await productionAssetPreflightStatus(root,true);
  if(status.status==="LEGACY_FINALIZED")throw new Error("This delivery is already finalized; retroactive asset approval is not recorded.");
  if(status.status==="APPROVED")return {approved:true,approvedBy:"HUMAN",approvedAt:status.approvedAt!,projectHash:status.projectHash!,assetSnapshotHash:status.assetSnapshotHash!,reportHash:status.reportHash!};
  if(status.status!=="REVIEW_REQUIRED")throw new Error(`${status.message} Current preflight status: ${status.status}.`);
  const approval:ProductionPreflightApproval={version:"1",status:"approved",approvedBy:"HUMAN",approvedAt:new Date().toISOString(),projectHash:status.projectHash!,assetSnapshotHash:status.assetSnapshotHash!,reportHash:status.reportHash!};
  await writeJson(p.productionPreflightApproval,approval);await markCheckpointReapproved(root,"ASSET_PREFLIGHT");return {approved:true,approvedBy:approval.approvedBy,approvedAt:approval.approvedAt,projectHash:approval.projectHash,assetSnapshotHash:approval.assetSnapshotHash,reportHash:approval.reportHash};
}
export async function approveProductionAssetPreflight(root:string){return withHostApprovalLock(root,()=>approveProductionAssetPreflightLocked(root));}

/** Blocks renderer work until the host approves the exact current asset snapshot. */
export async function assertProductionAssetPreflightApproved(root:string):Promise<void>{
  await assertCheckpointCurrent(root,"ASSET_PREFLIGHT");
  const status=await productionAssetPreflightStatus(root,true);
  if(status.status==="APPROVED"||status.status==="LEGACY_FINALIZED")return;
  if(status.status==="REVIEW_REQUIRED")throw new Error("NEEDS_USER_REVIEW: Production asset preflight passed and is awaiting host approval. Surface checkpoint ASSET_PREFLIGHT and stop; the host can approve with `npm run video:host -- assets approve`.");
  throw new Error(`Production asset preflight is ${status.status}: ${status.message}`);
}
