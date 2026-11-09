import {createHash,randomUUID} from "node:crypto";
import {mkdir,realpath,rename,rm,stat,writeFile} from "node:fs/promises";
import {basename,extname,relative,resolve,sep} from "node:path";
import * as appExplorerCore from "../../packages/app-explorer/index.mjs";
import {readConfinedFile} from "./safe-file.js";
import {resolveAppWorkspace} from "./registry.js";
import {assertResearchBindingCurrent,readResearchBinding} from "./research-binding.js";
import {readJson} from "../core/io.js";
import {sha256} from "../core/hash.js";
import {resolveSceneAsset} from "../core/asset-resolution.js";
import type {VideoProject} from "../core/types.js";
import {harnessPaths} from "../harness/paths.js";
import {exists} from "../harness/fs.js";
import {assertAssetMutationHITLAllowed,assertCanonicalAssetMutationAllowed,AssetPromotionError,validateAssetPromotion} from "../harness/asset-promotion.js";
import {withAssetStorageLock} from "../harness/asset-storage-lock.js";
import {isValidExplorerAssetOrigin,type AssetManifest,type AssetManifestItem, type ExplorerAssetOrigin} from "../harness/assets.js";

const core:any=appExplorerCore;
export type PromoteExplorerEvidenceInput={appId:string;revision:string;contextId:string;featureId:string;scenarioId:string;executionId:string;evidenceRef:string;expectedSourceSha256?:string;assetId:string;sceneId:string;role:string;rights:unknown};
export type ExplorerPromotionResult={asset:AssetManifestItem;idempotent:boolean;preflightMayBeStale:boolean};
function digest(bytes:Uint8Array):string{return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;}
function safeRelative(value:string):string{
  const normalized=value.replaceAll("\\","/"),parts=normalized.split("/");
  if(!normalized||normalized.includes("\0")||parts.some((part)=>!part||part==="."||part===".."||part.startsWith(".")))throw new AssetPromotionError("INVALID_EVIDENCE","Unsafe Explorer evidence reference.");
  return parts.join(sep);
}
function inside(base:string,target:string):boolean{const rel=relative(base,target);return rel===""||(!rel.startsWith("..")&&!rel.startsWith(sep));}
function sha256Hex(value:string):string{return value.replace(/^sha256:/,"");}
async function ensureDirectory(parent:string,name:string):Promise<string>{
  const child=resolve(parent,name);try{await mkdir(child);}catch(error){if((error as {code?:string}).code!=="EEXIST")throw error;}
  const actual=await realpath(child);if(actual!==child||!inside(parent,actual)||(await stat(actual)).isDirectory()!==true)throw new AssetPromotionError("UNSAFE_OUTPUT_PATH","Explorer promotion asset path contains a symlink or leaves assets/.");return actual;
}
function imageType(bytes:Uint8Array,extension:string):string|undefined{
  if(extension===".png"&&bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return "image/png";
  if((extension===".jpg"||extension===".jpeg")&&bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return "image/jpeg";
  if(extension===".webp"&&bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP")return "image/webp";
  return undefined;
}
async function readRevision(workspace:string,revision:string):Promise<{revisionDir:string;data:any}>{
  if(!/^r\d{6,}$/.test(revision))throw new AssetPromotionError("INVALID_REVISION","Explorer promotion requires an immutable V2 knowledge revision.");
  const revisionDir=resolve(workspace,"revisions",revision),manifest=core.readRevisionManifest(revisionDir,revision);
  if(!manifest)throw new AssetPromotionError("INVALID_REVISION",`Immutable revision ${revision} has no core manifest.`);
  core.verifyRevisionHashes(revisionDir,manifest);
  const read=async(path:string)=>JSON.parse((await readConfinedFile(revisionDir,path)).toString("utf8"));
  const [catalog,inventory,frontier,runs,activity]=await Promise.all(["catalog.json","inventory.json","frontier.json","runs.json","activity.json"].map(read));
  const featureNames=await (await import("node:fs/promises")).readdir(resolve(revisionDir,"features"));
  const features=await Promise.all(featureNames.filter(name=>name.endsWith(".json")).sort().map(name=>read(`features/${name}`)));
  const data={schemaVersion:2,revision,app:catalog.app,features,contexts:inventory.contexts||[],scenarios:inventory.scenarios||[],frontier,runs,activity};
  if(data.schemaVersion!==2)throw new AssetPromotionError("INVALID_REVISION","Explorer evidence must come from a V2 immutable revision.");
  return {revisionDir,data};
}
function validateOriginSelection(data:any,input:PromoteExplorerEvidenceInput):void{
  const context=data.contexts.find((item:any)=>item.id===input.contextId);if(!context)throw new AssetPromotionError("CONTEXT_NOT_FOUND",`Context '${input.contextId}' is absent from the selected revision.`);
  const feature=data.features.find((item:any)=>item.id===input.featureId);if(!feature)throw new AssetPromotionError("FEATURE_NOT_FOUND",`Feature '${input.featureId}' is absent from the selected revision.`);
  const scenario=data.scenarios.find((item:any)=>item.id===input.scenarioId);if(!scenario||scenario.featureId!==input.featureId||scenario.contextId!==input.contextId)throw new AssetPromotionError("SCENARIO_MISMATCH","Scenario does not belong to the selected feature and context in this revision.");
  if(scenario.testedContext?.contextId!==context.id||scenario.testedContext?.role!==context.role)throw new AssetPromotionError("CONTEXT_MISMATCH","Scenario tested role/context does not match the selected context.");
  const execution=(scenario.history||[]).find((item:any)=>item.executionId===input.executionId);
  if(!execution||execution.scenarioId!==scenario.id||execution.outcome!=="success"&&execution.outcome!=="expected_denial"||execution.testedContext?.contextId!==context.id||execution.testedContext?.role!==context.role)throw new AssetPromotionError("EXECUTION_MISMATCH","Execution must be verified and belong to the selected scenario and context in this revision.");
  const linked=new Set([...(execution.evidenceRefs||[]),...(execution.steps||[]).flatMap((step:any)=>step.evidenceRefs||[]),...(execution.completionCriteria||[]).flatMap((criterion:any)=>criterion.evidenceRefs||[])]);
  if(!linked.has(input.evidenceRef))throw new AssetPromotionError("EVIDENCE_MISMATCH","Image evidence is not linked to the selected execution in this revision.");
}
function sameOrigin(a:ExplorerAssetOrigin|undefined,b:ExplorerAssetOrigin):boolean{return Boolean(a&&JSON.stringify(a)===JSON.stringify(b));}
async function atomicManifest(path:string,current:AssetManifest,next:AssetManifest):Promise<void>{
  const parent=resolve(path,".."),latest=JSON.parse((await readConfinedFile(parent,basename(path))).toString("utf8")) as AssetManifest;
  if(sha256(JSON.stringify(latest))!==sha256(JSON.stringify(current)))throw new AssetPromotionError("ASSET_CONFLICT","Asset manifest changed during Explorer promotion; registry update was not written.");
  const temporary=`${path}.${randomUUID()}.tmp`;try{await writeFile(temporary,JSON.stringify(next,null,2)+"\n",{encoding:"utf8",flag:"wx"});await rename(temporary,path);}catch(error){await rm(temporary,{force:true});throw error;}
}

/** Promote one exact, linked Explorer image into the canonical production asset registry. */
async function promoteExplorerEvidenceLocked(root:string,input:PromoteExplorerEvidenceInput):Promise<ExplorerPromotionResult>{
  if(!input||typeof input!=="object")throw new AssetPromotionError("INVALID_SELECTION","Explorer promotion selection must be an object.");
  await assertAssetMutationHITLAllowed(root);
  const selection=validateAssetPromotion(input.assetId,input.sceneId,input.role,input.rights);input={...input,...selection};
  if(!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(input.appId)||!/^r\d{6,}$/.test(input.revision))throw new AssetPromotionError("INVALID_SELECTION","Explorer promotion requires a valid app ID and immutable revision.");
  const binding=await readResearchBinding(root);if(!binding)throw new AssetPromotionError("RESEARCH_BINDING_REQUIRED","Bind selected App Explorer research before promoting its evidence.");
  await assertResearchBindingCurrent(root);if(binding.appId!==input.appId)throw new AssetPromotionError("RESEARCH_BINDING_MISMATCH","Explorer promotion app does not match the request-bound research app.");
  const revisionNumber=(value:string)=>Number(value.slice(1));
  if(revisionNumber(input.revision)<revisionNumber(binding.knowledgeRevision)||!binding.selection.contextIds.includes(input.contextId)||!binding.selection.scenarioIds.includes(input.scenarioId))throw new AssetPromotionError("RESEARCH_BINDING_MISMATCH","Promotion context and scenario must belong to the frozen research selection and its revision or a later one.");
  if(input.revision===binding.knowledgeRevision&&(!binding.selection.executionIds.includes(input.executionId)||!binding.selection.evidenceRefs.includes(input.evidenceRef)))throw new AssetPromotionError("RESEARCH_BINDING_MISMATCH","Promotion execution and evidence must be selected in the exact bound research revision.");
  const p=harnessPaths(root),project=await readJson<VideoProject>(p.video);await assertCanonicalAssetMutationAllowed(root,project);
  if(!project.scenes.some(scene=>scene.id===input.sceneId))throw new AssetPromotionError("SCENE_NOT_FOUND",`Scene '${input.sceneId}' does not exist in approved canonical video.json.`);
  const workspace=await resolveAppWorkspace(root,input.appId),{data}=await readRevision(workspace,input.revision);
  const relativeEvidence=safeRelative(input.evidenceRef);validateOriginSelection(data,input);
  const sourceBytes=await readConfinedFile(resolve(workspace,"evidence"),relativeEvidence),type=imageType(sourceBytes,extname(relativeEvidence).toLowerCase());
  if(!type)throw new AssetPromotionError("INVALID_EVIDENCE","Explorer evidence bytes do not match a PNG, JPEG, or WebP file signature and extension.");
  const sourceHash=digest(sourceBytes);
  const boundHash=input.revision===binding.knowledgeRevision?binding.evidenceHashes[input.evidenceRef]:undefined;
  const selectedHash=boundHash??input.expectedSourceSha256;
  if(!selectedHash)throw new AssetPromotionError("EXPECTED_SOURCE_HASH_REQUIRED","This evidence has no frozen binding hash; supply expectedSourceSha256 for the image bytes selected from the current workspace.");
  if(input.expectedSourceSha256!==undefined&&!/^sha256:[a-f0-9]{64}$/.test(input.expectedSourceSha256))throw new AssetPromotionError("INVALID_EXPECTED_SOURCE_HASH","expectedSourceSha256 must be sha256: followed by 64 lowercase hexadecimal digits.");
  if(input.expectedSourceSha256!==undefined&&input.expectedSourceSha256!==sourceHash)throw new AssetPromotionError("INVALID_EVIDENCE","Explorer evidence bytes no longer match the selected expectedSourceSha256.");
  if(selectedHash!==sourceHash)throw new AssetPromotionError("INVALID_EVIDENCE","Explorer evidence bytes changed after the source hash was selected.");
  const origin:ExplorerAssetOrigin={appId:input.appId,knowledgeRevision:input.revision,contextId:input.contextId,featureId:input.featureId,scenarioId:input.scenarioId,executionId:input.executionId,evidenceRef:input.evidenceRef,sha256:sourceHash};
  if(!isValidExplorerAssetOrigin(origin))throw new AssetPromotionError("INVALID_ORIGIN","Explorer asset origin failed runtime validation.");
  let manifest:AssetManifest;try{manifest=JSON.parse((await readConfinedFile(resolve(root,"assets"),"manifest.json")).toString("utf8")) as AssetManifest;}catch(error){throw new AssetPromotionError("ASSET_MANIFEST_INVALID",`Could not read confined assets/manifest.json: ${error instanceof Error?error.message:String(error)}`);}
  if(!manifest||!Array.isArray(manifest.assets))throw new AssetPromotionError("ASSET_MANIFEST_INVALID","assets/manifest.json must contain an assets array.");
  for(const entry of manifest.assets)if(entry.researchEvidence!==undefined&&!isValidExplorerAssetOrigin(entry.researchEvidence))throw new AssetPromotionError("ASSET_MANIFEST_INVALID",`Asset '${entry.id}' has invalid researchEvidence origin metadata.`);
  const promotionId=`${input.assetId}-${sha256Hex(sourceHash).slice(0,12)}`;
  const publicPath=`/assets/app-explorer/${promotionId}/${basename(relativeEvidence)}`;
  const item:AssetManifestItem={id:input.assetId,publicPath,type,source:"app-explorer",...selection.rights,sceneIds:[input.sceneId],role:input.role,researchEvidence:origin};
  const existing=manifest.assets.find((entry)=>entry.id===input.assetId);
  if(existing){
    let sameBytes=false;try{sameBytes=digest(await readConfinedFile(resolve(root,"assets"),existing.publicPath.slice("/assets/".length)))===sourceHash;}catch{}
    if(existing.publicPath===publicPath&&existing.type===type&&existing.source==="app-explorer"&&sameOrigin(existing.researchEvidence,origin)&&sameBytes&&existing.role===input.role&&JSON.stringify(existing.sceneIds??[])===JSON.stringify([input.sceneId])&&existing.rights===item.rights&&existing.license===item.license&&existing.permittedUse===item.permittedUse&&existing.notes===item.notes)return {asset:existing,idempotent:true,preflightMayBeStale:await exists(p.productionPreflight)};
    throw new AssetPromotionError("ASSET_CONFLICT",`Asset ID '${input.assetId}' already exists with different bytes, origin, or scene/role binding.`);
  }
  const collision=manifest.assets.find((entry)=>entry.role===input.role&&entry.sceneIds?.includes(input.sceneId));if(collision)throw new AssetPromotionError("ASSET_CONFLICT",`Scene '${input.sceneId}' already has an asset bound to role '${input.role}'.`);
  resolveSceneAsset(input.sceneId,input.role,[...manifest.assets,item]);
  const rootReal=await realpath(root),assetsPath=resolve(root,"assets"),assetsReal=await realpath(assetsPath);if(!inside(rootReal,assetsReal)||relative(rootReal,assetsReal).replaceAll("\\","/")!=="assets")throw new AssetPromotionError("UNSAFE_OUTPUT_PATH","assets/ must be a real directory inside the project workspace.");
  const explorerAssets=await ensureDirectory(assetsReal,"app-explorer"),parent=await ensureDirectory(explorerAssets,promotionId);if(relative(assetsReal,parent).replaceAll("\\","/")!==`app-explorer/${promotionId}`)throw new AssetPromotionError("UNSAFE_OUTPUT_PATH","Explorer asset path leaves its immutable promotion directory.");
  const target=resolve(parent,basename(relativeEvidence));let created=false;
  try{await writeFile(target,sourceBytes,{flag:"wx"});created=true;if(await digest(await readConfinedFile(parent,basename(target)))!==sourceHash)throw new AssetPromotionError("INVALID_EVIDENCE","Copied Explorer asset digest did not match its source evidence.");await atomicManifest(p.assetManifest,manifest,{...manifest,assets:[...manifest.assets,item]});}
  catch(error){if(created)await rm(target,{force:true});throw error;}
  return {asset:item,idempotent:false,preflightMayBeStale:await exists(p.productionPreflight)};
}

export async function promoteExplorerEvidence(root:string,input:PromoteExplorerEvidenceInput):Promise<ExplorerPromotionResult>{
  return withAssetStorageLock(root,()=>promoteExplorerEvidenceLocked(root,input));
}

/** Copy promoted Explorer bytes plus their machine-readable manifest references into a completed archive. */
export async function copyPromotedExplorerAssetsArchive(root:string,target:string):Promise<void>{
  const p=harnessPaths(root),manifest=await readJson<AssetManifest>(p.assetManifest).catch(()=>null);if(!manifest||!Array.isArray(manifest.assets))return;
  const promoted=manifest.assets.filter((item)=>item.source==="app-explorer");if(!promoted.length)return;
  const sourceRoot=resolve(root,"assets"),archiveAssets=resolve(target,"assets"),archived:AssetManifestItem[]=[];await mkdir(archiveAssets,{recursive:true});
  for(const item of promoted){
    if(!isValidExplorerAssetOrigin(item.researchEvidence))throw new AssetPromotionError("ASSET_MANIFEST_INVALID",`Explorer asset '${item.id}' has invalid research origin metadata.`);
    if(!item.publicPath.startsWith("/assets/")||item.publicPath.includes("\\")||item.publicPath.includes("\0"))throw new AssetPromotionError("UNSAFE_OUTPUT_PATH",`Explorer asset '${item.id}' has an unsafe archive path.`);
    const relativePath=safeRelative(item.publicPath.slice("/assets/".length)),bytes=await readConfinedFile(sourceRoot,relativePath);
    if(digest(bytes)!==item.researchEvidence.sha256)throw new AssetPromotionError("ASSET_HASH_MISMATCH",`Explorer asset '${item.id}' no longer matches its research origin hash.`);
    const destination=resolve(archiveAssets,relativePath);if(!inside(archiveAssets,destination))throw new AssetPromotionError("UNSAFE_OUTPUT_PATH","Explorer archive asset path escapes the archive.");
    await mkdir(resolve(destination,".."),{recursive:true});await writeFile(destination,bytes,{flag:"wx"});archived.push(item);
  }
  await writeFile(resolve(archiveAssets,"manifest.json"),JSON.stringify({version:manifest.version,assets:archived},null,2)+"\n","utf8");
}
