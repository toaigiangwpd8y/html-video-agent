import {randomUUID,createHash} from "node:crypto";
import {mkdir,realpath,rename,rm,stat,writeFile} from "node:fs/promises";
import {createReadStream,createWriteStream} from "node:fs";
import {pipeline} from "node:stream/promises";
import {relative,resolve,basename} from "node:path";
import {readJson} from "../core/io.js";
import {sha256} from "../core/hash.js";
import {resolveSceneAsset} from "../core/asset-resolution.js";
import type {VideoProject} from "../core/types.js";
import type {AssetManifest,AssetManifestItem} from "../harness/assets.js";
import {harnessPaths} from "../harness/paths.js";
import {assertAssetMutationHITLAllowed,assertCanonicalAssetMutationAllowed as assertHumanCanonical,AssetPromotionError,validateAssetPromotion} from "../harness/asset-promotion.js";
import {withAssetStorageLock} from "../harness/asset-storage-lock.js";
import type {CaptureArtifact,CaptureRunResult} from "./types.js";
import {WebCaptureError} from "./types.js";

export type CaptureRights=ReturnType<typeof validateAssetPromotion>["rights"];
function inside(root:string,path:string):boolean{const from=relative(root,path);return from===""||(!from.startsWith("..")&&!from.startsWith("/")&&!from.startsWith("\\"));}
function samePath(a:string,b:string):boolean{return process.platform==="win32"?a.toLowerCase()===b.toLowerCase():a===b;}
function validRunId(id:string):boolean{return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);}
function digest(bytes:Uint8Array):string{return createHash("sha256").update(bytes).digest("hex");}
function artifactTypeValid(bytes:Uint8Array,type:string):boolean{
  if(type==="image/png")return bytes.length>=8&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10;
  if(type==="video/mp4")return bytes.length>=12&&String.fromCharCode(...bytes.slice(4,8))==="ftyp";
  return false;
}

async function safeRunDirectory(root:string,runId:string):Promise<{runsReal:string;runDirectory:string}>{
  if(!validRunId(runId))throw new WebCaptureError("INVALID_RUN_ID","Run ID must be a UUID returned by web-capture run.");
  const rootReal=await realpath(root),runs=resolve(root,".video/web-capture/runs"),runsReal=await realpath(runs),runDirectory=await realpath(resolve(runsReal,runId));
  if(!inside(rootReal,runsReal)||relative(rootReal,runsReal).replaceAll("\\","/")!==".video/web-capture/runs"||relative(runsReal,runDirectory)!==runId)throw new WebCaptureError("INVALID_ARTIFACT","Capture run path resolves outside its expected workspace directory.");
  return {runsReal,runDirectory};
}
async function safeArtifactPath(root:string,runId:string,artifact:CaptureArtifact):Promise<{runDirectory:string;source:string}>{
  if(!/^(?:screenshots\/[A-Za-z0-9._-]+\.png|capture\.mp4)$/.test(artifact.file)||artifact.file.split("/").some((part)=>part===".."||part==="."))throw new WebCaptureError("INVALID_ARTIFACT","Run manifest contains an unsafe artifact path.");
  const {runDirectory}=await safeRunDirectory(root,runId);
  const source=resolve(runDirectory,...artifact.file.split("/")),actual=await realpath(source);
  if(!inside(runDirectory,actual)||relative(runDirectory,actual).replaceAll("\\","/")!==artifact.file)throw new WebCaptureError("INVALID_ARTIFACT","Capture artifact resolves outside its run directory or through a symlink.");
  if(!(await stat(actual)).isFile())throw new WebCaptureError("INVALID_ARTIFACT","Capture artifact is not a regular file.");
  return {runDirectory,source:actual};
}
async function ensureRealDirectoryChild(parent:string,name:string):Promise<string>{
  const child=resolve(parent,name);
  try{await mkdir(child);}catch(error){if((error as {code?:string}).code!=="EEXIST")throw error;}
  const actual=await realpath(child),childRelative=relative(parent,actual).replaceAll("\\","/");
  if(!samePath(child,actual)||!inside(parent,actual)||!samePath(childRelative,name)||!(await stat(actual)).isDirectory())throw new WebCaptureError("UNSAFE_OUTPUT_PATH","Capture asset path contains a symlink or resolves outside its expected directory.");
  return actual;
}
async function fileHash(path:string):Promise<string>{const hash=createHash("sha256");for await(const chunk of createReadStream(path))hash.update(chunk as Uint8Array);return hash.digest("hex");}
async function copyExclusively(source:string,target:string):Promise<void>{
  const output=createWriteStream(target,{flags:"wx"});let created=false;
  output.once("open",()=>{created=true;});
  try{await pipeline(createReadStream(source),output);}
  catch(error){if(created)await rm(target,{force:true});throw error;}
}
async function prefix(path:string,size:number):Promise<Uint8Array>{const chunks:Uint8Array[]=[];for await(const chunk of createReadStream(path,{start:0,end:size-1}))chunks.push(chunk as Uint8Array);return Buffer.concat(chunks);}
async function existingAssetHash(root:string,publicPath:string):Promise<string>{
  if(!publicPath.startsWith("/assets/")||publicPath.includes("\\")||publicPath.includes("\0"))return "";
  const segments=publicPath.slice("/assets/".length).split("/");if(!segments.length||segments.some((segment)=>!segment||segment==="."||segment===".."))return "";
  try{const base=await realpath(resolve(root,"assets")),candidate=resolve(base,...segments),actual=await realpath(candidate);if(!inside(base,actual))return "";return await fileHash(actual);}catch{return "";}
}

async function atomicWriteManifest(path:string,value:AssetManifest,expectedHash:string):Promise<void>{
  const current=await readJson<AssetManifest>(path);if(sha256(JSON.stringify(current))!==expectedHash)throw new WebCaptureError("ASSET_CONFLICT","Asset manifest changed during materialization; no registry update was written.");
  const temporary=`${path}.${randomUUID()}.tmp`;
  try{await writeFile(temporary,JSON.stringify(value,null,2)+"\n","utf8");await rename(temporary,path);}catch(error){await rm(temporary,{force:true});throw error;}
}

/** Verify a successful run and explicitly promote one artifact into the approved production asset registry. */
async function materializeCaptureArtifactLocked(root:string,runId:string,artifactId:string,assetId:string,sceneId:string,role:string,rightsValue:unknown):Promise<{asset:AssetManifestItem;idempotent:boolean;preflightMayBeStale:boolean}>{
  await assertAssetMutationHITLAllowed(root);
  const promotion=validateAssetPromotion(assetId,sceneId,role,rightsValue);assetId=promotion.assetId;sceneId=promotion.sceneId;role=promotion.role;
  const rights=promotion.rights,p=harnessPaths(root),project=await readJson<VideoProject>(p.video);await assertHumanCanonical(root,project);
  const scene=project.scenes.find((entry)=>entry.id===sceneId);if(!scene)throw new WebCaptureError("SCENE_NOT_FOUND",`Scene '${sceneId}' does not exist in the approved canonical project.`);
  const {runDirectory}=await safeRunDirectory(root,runId),runPath=resolve(runDirectory,"result.json"),run=await readJson<CaptureRunResult>(runPath);
  if(run.id!==runId||run.status!=="succeeded")throw new WebCaptureError("INVALID_RUN","Only successful capture runs can be materialized.");
  const artifact=run.artifacts.find((entry)=>entry.id===artifactId);if(!artifact)throw new WebCaptureError("INVALID_ARTIFACT","Artifact ID was not found in the successful run.");
  const {source}=await safeArtifactPath(root,runId,artifact),info=await stat(source),sha=await fileHash(source),signature=await prefix(source,artifact.type==="image/png"?24:12);
  if(info.size!==artifact.sizeBytes||info.size>524288000||sha!==artifact.sha256||!artifactTypeValid(signature,artifact.type))throw new WebCaptureError("INVALID_ARTIFACT","Artifact bytes no longer match the successful run manifest or declared media type.");
  if((artifact.type==="image/png"&&!artifact.file.endsWith(".png"))||(artifact.type==="video/mp4"&&!artifact.file.endsWith(".mp4")))throw new WebCaptureError("INVALID_ARTIFACT","Artifact media type and file extension disagree.");
  const manifest=await readJson<AssetManifest>(p.assetManifest);if(!manifest||!Array.isArray(manifest.assets))throw new WebCaptureError("ASSET_MANIFEST_INVALID","assets/manifest.json must contain an assets array.");
  const manifestHash=sha256(JSON.stringify(manifest)),artifactName=basename(artifact.file),publicPath=`/assets/web-capture/${runId}/${artifactName}`;
  const provenance=`web-capture run=${runId}; artifact=${artifactId}; recipeSha256=${run.recipeHash}; artifactSha256=${sha}`;
  const timing=artifact.type==="video/mp4"?run.outputs?.cursorOverlay===true?` Viewport capture: ${artifact.frames} frames at ${artifact.fps} fps (${artifact.durationSeconds?.toFixed(3)} seconds); Cutroom cursor and click ripples composited, no camera movement.`:` Raw viewport capture: ${artifact.frames} frames at ${artifact.fps} fps (${artifact.durationSeconds?.toFixed(3)} seconds); no cursor or camera effects are composited.`:" Screenshot captured from the configured app viewport.";
  const item:AssetManifestItem={id:assetId,publicPath,type:artifact.type,source:"web-capture",sourceUrl:typeof run.config.url==="string"?run.config.url:undefined,provenance,...rights,sceneIds:[sceneId],role,width:artifact.width,height:artifact.height,notes:[rights.notes,timing].filter(Boolean).join(" ")};
  const existing=manifest.assets.find((entry)=>entry.id===assetId);
  if(existing){
    const existingHash=await existingAssetHash(root,existing.publicPath);
    const sameBinding=existing.publicPath===publicPath&&existing.type===item.type&&existing.role===role&&JSON.stringify(existing.sceneIds??[])===JSON.stringify([sceneId]);
    if(existingHash===sha&&sameBinding&&existing.source==="web-capture"&&existing.provenance===provenance&&existing.rights===item.rights&&existing.license===item.license&&existing.permittedUse===item.permittedUse&&existing.sourceUrl===item.sourceUrl&&existing.width===item.width&&existing.height===item.height&&existing.notes===item.notes)return {asset:existing,idempotent:true,preflightMayBeStale:await existsFile(p.productionPreflight)};
    throw new WebCaptureError("ASSET_CONFLICT",`Asset ID '${assetId}' already exists with different bytes or scene/role binding.`);
  }
  const collision=manifest.assets.find((entry)=>entry.role===role&&entry.sceneIds?.includes(sceneId));
  if(collision)throw new WebCaptureError("ASSET_CONFLICT",`Scene '${sceneId}' already has an asset bound to role '${role}'.`);
  resolveSceneAsset(sceneId,role,[...manifest.assets,item]);
  const rootReal=await realpath(root),assetsPath=resolve(root,"assets"),assetsReal=await realpath(assetsPath);
  if(!inside(rootReal,assetsReal)||relative(rootReal,assetsReal).replaceAll("\\","/")!=="assets")throw new WebCaptureError("UNSAFE_OUTPUT_PATH","assets/ must be a real directory inside the project workspace.");
  const captureAssets=await ensureRealDirectoryChild(assetsReal,"web-capture"),parentReal=await ensureRealDirectoryChild(captureAssets,runId),target=resolve(parentReal,artifactName);
  if(!inside(assetsReal,parentReal)||relative(assetsReal,parentReal).replaceAll("\\","/")!==`web-capture/${runId}`)throw new WebCaptureError("UNSAFE_OUTPUT_PATH","Capture asset path contains a symlink or resolves outside its expected directory.");
  let createdTarget=false;
  try{
    await copyExclusively(source,target);createdTarget=true;
    if(await fileHash(target)!==sha)throw new WebCaptureError("INVALID_ARTIFACT","Copied production asset digest did not match the verified capture artifact.");
    const updated:AssetManifest={...manifest,assets:[...manifest.assets,item]};await atomicWriteManifest(p.assetManifest,updated,manifestHash);
  }catch(error){if(createdTarget)await rm(target,{force:true});throw error;}
  return {asset:item,idempotent:false,preflightMayBeStale:await existsFile(p.productionPreflight)};
}

export async function materializeCaptureArtifact(root:string,runId:string,artifactId:string,assetId:string,sceneId:string,role:string,rightsValue:unknown):Promise<{asset:AssetManifestItem;idempotent:boolean;preflightMayBeStale:boolean}>{
  return withAssetStorageLock(root,async()=>{
    try{return await materializeCaptureArtifactLocked(root,runId,artifactId,assetId,sceneId,role,rightsValue);}
    catch(error){if(error instanceof AssetPromotionError)throw new WebCaptureError(error.code,error.message);throw error;}
  });
}

async function existsFile(path:string):Promise<boolean>{try{return (await stat(path)).isFile();}catch{return false;}}
