import {readFile,stat} from "node:fs/promises";
import {resolve} from "node:path";
import type {AuthorPreflightIssue,AuthorPreflightReport,VideoProject} from "../core/types.js";
import type {AssetManifest,AssetManifestItem} from "../harness/assets.js";
import {isValidExplorerAssetOrigin} from "../harness/assets.js";
import {sha256} from "../core/hash.js";
import {resolveSceneVoiceover,SceneAssetResolutionError} from "../core/asset-resolution.js";
import {validateProject} from "./validator.js";

function problem(code:string,message:string,path:string):AuthorPreflightIssue{return {code,severity:"error",blocking:true,message,path};}
function nonempty(value:unknown):value is string{return typeof value==="string"&&value.trim().length>0;}
function normalizeAssetPath(value:string):string{return `/${value.replaceAll("\\","/").replace(/^\.\//,"").replace(/^\//,"")}`;}
function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value);}
function localAssetPath(root:string,publicPath:string):string|undefined{
  if(!publicPath.startsWith("/assets/")||publicPath.includes("\\")||publicPath.includes("\0"))return;
  const relativePath=publicPath.slice("/assets/".length),segments=relativePath.split("/");
  if(!relativePath||segments.some(segment=>!segment||segment==="."||segment===".."))return;
  const assetRoot=resolve(root,"assets"),candidate=resolve(assetRoot,relativePath),boundary=`${assetRoot}${assetRoot.includes("\\")?"\\":"/"}`;
  return candidate===assetRoot||candidate.startsWith(boundary)?candidate:undefined;
}
function plausibleType(item:AssetManifestItem):boolean{
  if(!nonempty(item.type)||!nonempty(item.publicPath))return false;
  const type=item.type.toLowerCase(),path=item.publicPath.toLowerCase();
  if(type.startsWith("font/"))return /\.(?:woff2?|ttf|otf)$/i.test(path);
  if(type.startsWith("image/"))return /\.(?:png|jpe?g|gif|webp|svg|avif)$/i.test(path);
  if(type.startsWith("audio/"))return new Set(["audio/mpeg","audio/wav","audio/x-wav","audio/mp4","audio/ogg","audio/aac","audio/flac"]).has(type)&&/\.(?:mp3|wav|m4a|ogg|aac|flac)$/i.test(path);
  if(type.startsWith("video/"))return /\.(?:mp4|webm|mov|m4v)$/i.test(path);
  if(type.includes("pdf"))return path.endsWith(".pdf");
  if(type.includes("html"))return /\.(?:html?|mhtml?)$/i.test(path);
  if(type.startsWith("text/"))return /\.(?:txt|md|csv|json|xml|html?)$/i.test(path);
  return true;
}
function directlyRenderable(item:AssetManifestItem):boolean{const type=item.type.toLowerCase();return nonempty(item.type)&&(type.startsWith("image/")||type.startsWith("audio/")||type.startsWith("video/")||type.startsWith("font/"));}
async function imageDimensions(path:string,type:string):Promise<{width:number;height:number}|undefined>{
  if(type==="image/png"){
    const bytes=await readFile(path);
    if(bytes.length>=24&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return {width:(bytes[16]<<24)|(bytes[17]<<16)|(bytes[18]<<8)|bytes[19],height:(bytes[20]<<24)|(bytes[21]<<16)|(bytes[22]<<8)|bytes[23]};
  }
  return undefined;
}
function matchesImageSignature(bytes:Uint8Array,type:string):boolean{
  if(type==="image/png")return bytes.length>=8&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10;
  if(type==="image/jpeg")return bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(type==="image/webp")return bytes.length>=12&&startsAt(bytes,0,0x52,0x49,0x46,0x46)&&startsAt(bytes,8,0x57,0x45,0x42,0x50);
  return true;
}
function matchesAudioSignature(bytes:Uint8Array,type:string):boolean{
  const starts=(...values:number[])=>values.every((value,index)=>bytes[index]===value);
  if(type==="audio/mpeg")return starts(0x49,0x44,0x33)||(bytes.length>=2&&bytes[0]===0xFF&&(bytes[1]&0xE0)===0xE0);
  if(type==="audio/wav"||type==="audio/x-wav")return starts(0x52,0x49,0x46,0x46)&&bytes.length>=12&&startsAt(bytes,8,0x57,0x41,0x56,0x45);
  if(type==="audio/ogg")return starts(0x4F,0x67,0x67,0x53);
  if(type==="audio/flac")return starts(0x66,0x4C,0x61,0x43);
  if(type==="audio/mp4")return bytes.length>=12&&startsAt(bytes,4,0x66,0x74,0x79,0x70);
  if(type==="audio/aac")return bytes.length>=2&&bytes[0]===0xFF&&(bytes[1]&0xF6)===0xF0;
  return false;
}
function startsAt(bytes:Uint8Array,offset:number,...values:number[]):boolean{return values.every((value,index)=>bytes[offset+index]===value);}
function matchesFontSignature(bytes:Uint8Array,type:string):boolean{
  if(type==="font/woff2")return startsAt(bytes,0,0x77,0x4F,0x46,0x32);
  if(type==="font/woff")return startsAt(bytes,0,0x77,0x4F,0x46,0x46);
  if(type==="font/otf")return startsAt(bytes,0,0x4F,0x54,0x54,0x4F);
  if(type==="font/ttf")return startsAt(bytes,0,0x00,0x01,0x00,0x00)||startsAt(bytes,0,0x74,0x72,0x75,0x65);
  return false;
}
const FONT_ASSET_TYPES: Record<string, true> = {"font/woff2": true, "font/woff": true, "font/otf": true, "font/ttf": true};

/** Semantic Storyboard approval preflight. It deliberately does not inspect production files. */
export async function semanticPreflight(project:VideoProject):Promise<{report:AuthorPreflightReport}>{
  const validation=await validateProject(project);
  const issues:AuthorPreflightIssue[]=validation.issues.filter(item=>item.severity==="error").map(item=>problem(`SEMANTIC_${item.code}`,item.message,(item.details?.path as string|undefined)??"/"));
  return {report:{valid:issues.length===0,issues}};
}

/** Production-only registry/file validation, run after Enhance materializes assets. */
export async function productionAssetPreflight(project:VideoProject,manifest:AssetManifest,root:string):Promise<{report:AuthorPreflightReport}>{
  const issues:AuthorPreflightIssue[]=[];
  if(!manifest||!Array.isArray(manifest.assets))return {report:{valid:false,issues:[problem("ASSET_MANIFEST_INVALID","assets/manifest.json must contain an assets array.","/assets")]}};
  const sceneIds=new Set(project.scenes.map(scene=>scene.id));
  const manifestItems=manifest.assets.filter(item=>isRecord(item)) as AssetManifestItem[];
  const ids=new Set<string>(),paths=new Set<string>();
  for(let i=0;i<manifest.assets.length;i++){
    const raw=manifest.assets[i],base=`/assets/${i}`;
    if(!isRecord(raw)){issues.push(problem("ASSET_ENTRY_INVALID","Each materialized asset must be an object.",base));continue;}
    const item=raw as AssetManifestItem,type=typeof item.type==="string"?item.type:"";
    if(item.source==="app-explorer"&&!isValidExplorerAssetOrigin(item.researchEvidence))issues.push(problem("ASSET_RESEARCH_ORIGIN_INVALID",`Explorer asset '${item.id||i}' requires a valid machine-readable researchEvidence origin.`,`${base}/researchEvidence`));
    else if(item.researchEvidence!==undefined&&!isValidExplorerAssetOrigin(item.researchEvidence))issues.push(problem("ASSET_RESEARCH_ORIGIN_INVALID",`Asset '${item.id||i}' has malformed researchEvidence origin metadata.`,`${base}/researchEvidence`));
    if(!nonempty(item.id))issues.push(problem("ASSET_ID_REQUIRED","Materialized assets require a stable id.",`${base}/id`));
    else if(ids.has(item.id))issues.push(problem("ASSET_ID_DUPLICATE",`Asset id '${item.id}' is duplicated.`,`${base}/id`));else ids.add(item.id);
    if(!nonempty(item.publicPath)||!item.publicPath.startsWith("/assets/"))issues.push(problem("ASSET_PATH_INVALID","Materialized assets require a safe /assets/ publicPath.",`${base}/publicPath`));
    else if(paths.has(normalizeAssetPath(item.publicPath)))issues.push(problem("ASSET_PATH_DUPLICATE",`Asset path '${item.publicPath}' is duplicated.`,`${base}/publicPath`));else paths.add(normalizeAssetPath(item.publicPath));
    if(!nonempty(item.type)||!plausibleType(item))issues.push(problem("ASSET_TYPE_INVALID",`Asset '${item.id||i}' has an implausible detected type/path pairing.`,`${base}/type`));
    if(!nonempty(item.source)&&!nonempty(item.provenance))issues.push(problem("ASSET_PROVENANCE_REQUIRED","Materialized assets must retain source or provenance.",`${base}/source`));
    if(!nonempty(item.license)&&!nonempty(item.rights))issues.push(problem("ASSET_RIGHTS_REQUIRED","Materialized assets must record a license or explicit rights basis.",`${base}/license`));
    if(!nonempty(item.permittedUse))issues.push(problem("ASSET_PERMITTED_USE_REQUIRED","Materialized assets must state their permitted use.",`${base}/permittedUse`));
    if(!nonempty(item.role))issues.push(problem("ASSET_ROLE_REQUIRED","Materialized assets require a concise semantic role.",`${base}/role`));
    if(!Array.isArray(item.sceneIds)||item.sceneIds.length===0){if(item.role!=="font")issues.push(problem("ASSET_SCENE_BINDING_REQUIRED","Materialized assets require at least one bound scene id.",`${base}/sceneIds`));}
    else item.sceneIds.forEach((id,index)=>{if(typeof id!=="string"||!sceneIds.has(id))issues.push(problem("ASSET_SCENE_UNKNOWN",`Asset '${item.id||i}' references unknown scene '${String(id)}'.`,`${base}/sceneIds/${index}`));});
    if(item.role==="voiceover"&&!type.toLowerCase().startsWith("audio/"))issues.push(problem("ASSET_VOICEOVER_TYPE_INVALID","Voiceover assets must use a recognized audio type.",`${base}/type`));
    if(item.role==="font"&&!FONT_ASSET_TYPES[type.toLowerCase()])issues.push(problem("ASSET_FONT_TYPE_INVALID","Font assets must use font/woff2, font/woff, font/otf, or font/ttf.",`${base}/type`));
    if(item.role==="font"&&!nonempty(item.family))issues.push(problem("ASSET_FONT_FAMILY_REQUIRED","Font assets must declare the CSS family name they register, matching meta.theme.font.",`${base}/family`));
    if(item.derivedFrom!==undefined&&(!nonempty(item.derivedFrom)||!manifestItems.some(candidate=>candidate.id===item.derivedFrom)))issues.push(problem("ASSET_DERIVATION_INVALID","A renderable derivative must retain provenance to a registered source asset.",`${base}/derivedFrom`));
    if(!directlyRenderable({...item,type})&&!manifestItems.some(candidate=>candidate.derivedFrom===item.id))issues.push(problem("ASSET_DERIVATIVE_REQUIRED",`Evidence asset '${item.publicPath}' is a source document and requires a truthful renderable derivative before layout.`,`${base}/derivedFrom`));
    if(!nonempty(item.publicPath))continue;
    const localPath=localAssetPath(root,item.publicPath);
    if(!localPath){issues.push(problem("ASSET_PATH_INVALID","Materialized asset publicPath must remain inside the local assets directory without traversal segments.",`${base}/publicPath`));continue;}
    try{
      const file=await stat(localPath);
      if(!file.isFile()||file.size<=0)issues.push(problem("ASSET_FILE_UNUSABLE",`Asset '${item.publicPath}' must be a non-empty local file.`,`${base}/publicPath`));
      else if(type.startsWith("image/")){const bytes=await readFile(localPath);if(!matchesImageSignature(bytes,type))issues.push(problem("ASSET_DETECTED_TYPE_MISMATCH",`Asset '${item.publicPath}' does not match its declared image type.`,`${base}/type`));if(item.source==="app-explorer"&&isValidExplorerAssetOrigin(item.researchEvidence)&&sha256(bytes)!==item.researchEvidence.sha256)issues.push(problem("ASSET_RESEARCH_HASH_MISMATCH",`Explorer asset '${item.publicPath}' no longer matches its recorded evidence hash.`,`${base}/researchEvidence/sha256`));const dimensions=await imageDimensions(localPath,type);if(dimensions&&(dimensions.width<1||dimensions.height<1))issues.push(problem("ASSET_IMAGE_DIMENSIONS_INVALID","Image dimensions must be usable.",`${base}/publicPath`));}
      else if(type.startsWith("audio/")){const bytes=await readFile(localPath);if(!matchesAudioSignature(bytes,type))issues.push(problem("ASSET_DETECTED_TYPE_MISMATCH",`Asset '${item.publicPath}' does not match its declared audio type.`,`${base}/type`));}
      else if(type.startsWith("font/")){const bytes=await readFile(localPath);if(!matchesFontSignature(bytes,type))issues.push(problem("ASSET_DETECTED_TYPE_MISMATCH",`Asset '${item.publicPath}' does not match its declared font type.`,`${base}/type`));}
    }catch{issues.push(problem("ASSET_FILE_MISSING",`Materialized asset '${item.publicPath}' does not exist locally.`,`${base}/publicPath`));}
  }
  for(const scene of project.scenes){
    if(scene.audio?.voiceoverText.trim()){
      try{resolveSceneVoiceover(scene.id,manifestItems);}
      catch(error){
        const path=`/scenes/${project.scenes.indexOf(scene)}/audio`;
        if(error instanceof SceneAssetResolutionError&&error.code==="AMBIGUOUS")issues.push(problem("VOICEOVER_ASSET_MULTIPLE",`Scene '${scene.id}' has multiple materialized voiceover assets; exactly one is required.`,path));
        else issues.push(problem("VOICEOVER_ASSET_MISSING",`Scene '${scene.id}' has approved narration but no materialized voiceover registry asset is bound to it.`,path));
      }
    }
  }
  return {report:{valid:issues.length===0,issues}};
}

export async function productionAssetPreflightFromDisk(project:VideoProject,root:string):Promise<{report:AuthorPreflightReport}>{
  const path=resolve(root,"assets/manifest.json");
  try{return productionAssetPreflight(project,JSON.parse(await readFile(path,"utf8")) as AssetManifest,root);}
  catch(error){const code=(error as {code?:string})?.code;if(code==="ENOENT")return {report:{valid:false,issues:[problem("ASSET_MANIFEST_MISSING","assets/manifest.json could not be read.","/assets/manifest.json")]}};if(error instanceof SyntaxError)return {report:{valid:false,issues:[problem("ASSET_MANIFEST_INVALID","assets/manifest.json is not valid JSON.","/assets/manifest.json")]}};return {report:{valid:false,issues:[problem("ASSET_MANIFEST_READ_FAILED","assets/manifest.json could not be validated.","/assets/manifest.json")]}};}
}
