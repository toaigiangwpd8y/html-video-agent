import {stat} from "node:fs/promises";
import {resolve} from "node:path";
import type {VideoProject} from "../core/types.js";
import type {AssetManifest,AssetManifestItem} from "./assets.js";
import {videoProjectHash} from "./project-state.js";

export type {AssetManifest,AssetManifestItem} from "./assets.js";
export interface CommandResult {ok: boolean; command: string; exitCode: number; stdout: string; stderr: string;}
export interface RemotionManifestCandidate {
  version: string;
  projectHash: string;
  skillId: string;
  generatedFiles: string[];
  sceneBindings: Array<{sceneId: string; sourceFile: string; assets: string[]}>;
  validation: {typecheck: "passed" | "failed"; stills: "passed" | "failed"; render: "passed" | "failed"};
}
export interface RemotionImplementationManifest extends RemotionManifestCandidate {
  renderer:"remotion";
  rendererVersion:string;
  projectId:string;
  revision:number;
  productionProfileHash:string;
  assetManifestHash:string;
  sourceHash:string;
  width:number;
  height:number;
  fps:number;
  durationInFrames:number;
  durationSeconds:number;
  visualApproval:{status:"approved";approvedBy:"HUMAN";sourceHash:string;approvedAt:string};
  check:{command:string;passed:true};
  evidence:{index:string;files:string[]};
  output:{file:string;sha256:string;probe:Record<string,unknown>};
}
export interface ManifestDiagnostic {code: string; path: string; message: string; expected?: string; actual?: unknown;}
export interface HarnessManifestReadiness {
  projectAvailable: boolean;
  skillAvailable: boolean;
  assetManifestAvailable: boolean;
  ruleFilesAvailable: number;
  officialSkillFilesAvailable?: number;
  generatedFilesAvailable: number;
  typecheckPassed: boolean;
  stillPassed: boolean;
  renderPassed: boolean;
  availableAssetPaths: string[];
  availableAssets?: AssetManifestItem[];
  remotionRoot: string;
}
export interface ManifestValidationResult {valid: boolean; diagnostics: ManifestDiagnostic[]; manifest?: RemotionManifestCandidate;}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({type: "object", properties, required, additionalProperties: false});
const stringArraySchema = {type: "array", items: {type: "string"}};
export const REMOTION_IMPLEMENTATION_MANIFEST_SCHEMA: Record<string, unknown> = objectSchema({
  version: {type: "string", minLength: 1},
  projectHash: {type: "string", pattern: "^sha256:[0-9a-f]{64}$"},
  skillId: {type: "string", minLength: 1},
  generatedFiles: stringArraySchema,
  sceneBindings: {type: "array", items: objectSchema({sceneId:{type:"string",minLength:1},sourceFile:{type:"string",minLength:1},assets:stringArraySchema}, ["sceneId","sourceFile","assets"])},
}, ["version","projectHash","skillId","generatedFiles","sceneBindings"]);

function isRecord(value: unknown): value is Record<string, unknown> {return typeof value === "object" && value !== null && !Array.isArray(value);}
function safeGeneratedPath(value: string): boolean {return value.startsWith("generated/") && !value.includes("..") && !value.includes("\\") && !value.startsWith("/");}
function normalizeAssetPath(value:string):string{return `/${value.replaceAll("\\","/").replace(/^\.\//,"").replace(/^\//,"")}`;}
function diagnostic(list: ManifestDiagnostic[], code:string, path:string, message:string, expected?:string, actual?:unknown) {list.push({code,path,message,...(expected?{expected}:{}),...(actual!==undefined?{actual}:{})});}
function requireString(record:Record<string,unknown>, key:string, base:string, list:ManifestDiagnostic[]):string|undefined {
  const value=record[key], path=`${base}/${key}`;
  if(value===undefined){diagnostic(list,"MANIFEST_FIELD_REQUIRED",path,`Required field '${key}' is missing.`,"non-empty string");return;}
  if(typeof value!=="string"||!value){diagnostic(list,"MANIFEST_FIELD_TYPE",path,`Field '${key}' must be a non-empty string.`,"non-empty string",value);return;}
  return value;
}
function requireStringArray(record:Record<string,unknown>, key:string, base:string, list:ManifestDiagnostic[]):string[]|undefined {
  const value=record[key],path=`${base}/${key}`;
  if(value===undefined){diagnostic(list,"MANIFEST_FIELD_REQUIRED",path,`Required field '${key}' is missing.`,"string[]");return;}
  if(!Array.isArray(value)){diagnostic(list,"MANIFEST_FIELD_TYPE",path,`Field '${key}' must be an array of strings.`,"string[]",value);return;}
  let ok=true; const out:string[]=[];
  value.forEach((v,i)=>{if(typeof v!=="string"){diagnostic(list,"MANIFEST_FIELD_TYPE",`${path}/${i}`,"Array item must be a string.","string",v);ok=false;} else out.push(v);});
  return ok?out:undefined;
}
function parseBindings(record:Record<string,unknown>, list:ManifestDiagnostic[]):RemotionManifestCandidate["sceneBindings"]|undefined {
  const value=record.sceneBindings;
  if(value===undefined){diagnostic(list,"MANIFEST_FIELD_REQUIRED","/manifest/sceneBindings","Required field 'sceneBindings' is missing.","array");return;}
  if(!Array.isArray(value)){diagnostic(list,"MANIFEST_FIELD_TYPE","/manifest/sceneBindings","Field 'sceneBindings' must be an array.","array",value);return;}
  let ok=true;const out:RemotionManifestCandidate["sceneBindings"]=[];
  value.forEach((item,i)=>{const base=`/manifest/sceneBindings/${i}`;if(!isRecord(item)){diagnostic(list,"MANIFEST_FIELD_TYPE",base,"Scene binding must be an object.","object",item);ok=false;return;}const sceneId=requireString(item,"sceneId",base,list);const sourceFile=requireString(item,"sourceFile",base,list);const assets=requireStringArray(item,"assets",base,list);if(!sceneId||!sourceFile||!assets){ok=false;return;}out.push({sceneId,sourceFile,assets});});
  return ok?out:undefined;
}
async function fileExists(path:string):Promise<boolean>{try{return (await stat(path)).isFile();}catch{return false;}}

export async function validateHarnessManifest(value:unknown, project:VideoProject, readiness:HarnessManifestReadiness):Promise<ManifestValidationResult>{
  const d:ManifestDiagnostic[]=[];
  if(!isRecord(value)){diagnostic(d,"MANIFEST_OBJECT_REQUIRED","/manifest","Manifest must be an object.","object",value);return {valid:false,diagnostics:d};}
  const version=requireString(value,"version","/manifest",d);
  const projectHash=requireString(value,"projectHash","/manifest",d);
  const skillId=requireString(value,"skillId","/manifest",d);
  const generatedFiles=requireStringArray(value,"generatedFiles","/manifest",d);
  const bindings=parseBindings(value,d);
  const readinessChecks:Array<[boolean,string,string]>=[
    [readiness.projectAvailable,"/$readiness/project","Canonical video.json must exist before finalization."],
    [readiness.skillAvailable,"/$readiness/skill","Repository-owned Remotion authoring contract must exist."],
    [readiness.assetManifestAvailable,"/$readiness/assets","assets/manifest.json must exist before finalization."],
    [readiness.ruleFilesAvailable>0,"/$readiness/rules","Remotion handoff guidance must be available."],
    [readiness.generatedFilesAvailable>0,"/$readiness/generatedFiles","Codex must create at least one file under remotion/generated/."],
    [readiness.typecheckPassed,"/$readiness/typecheck","Remotion typecheck must pass."],
    [readiness.stillPassed,"/$readiness/still","Representative still must render successfully."],
    [readiness.renderPassed,"/$readiness/render","Final video render must pass."],
  ];
  for(const [ok,path,message] of readinessChecks) if(!ok) diagnostic(d,"REMOTION_READINESS_FAILED",path,message);
  if(readiness.officialSkillFilesAvailable!==undefined&&readiness.officialSkillFilesAvailable<1)diagnostic(d,"REMOTION_READINESS_FAILED","/$readiness/officialSkills","At least one official Remotion implementation skill must be installed.");
  const expectedProjectHash=videoProjectHash(project);
  if(projectHash&&projectHash!==expectedProjectHash)diagnostic(d,"MANIFEST_PROJECT_MISMATCH","/manifest/projectHash","Manifest is not bound to the current canonical video.json.",expectedProjectHash,projectHash);
  if(skillId&&skillId!=="mvp-remotion-contract")diagnostic(d,"MANIFEST_SKILL_MISMATCH","/manifest/skillId","Harness implementation must declare the repository-owned Remotion contract.","mvp-remotion-contract",skillId);
  if(generatedFiles){if(!generatedFiles.includes("generated/timeline.json"))diagnostic(d,"MANIFEST_TIMELINE_NOT_LISTED","/manifest/generatedFiles","generated/timeline.json must be listed because finalize validates renderer timing evidence.");if(!generatedFiles.includes("generated/Compositions.tsx"))diagnostic(d,"MANIFEST_COMPOSITIONS_NOT_LISTED","/manifest/generatedFiles","generated/Compositions.tsx must be listed so connected composition registrations participate in the reviewed source manifest.");const seen=new Set<string>();for(let i=0;i<generatedFiles.length;i++){const f=generatedFiles[i],path=`/manifest/generatedFiles/${i}`;if(!safeGeneratedPath(f))diagnostic(d,"MANIFEST_GENERATED_PATH_UNSAFE",path,"Generated file must be a safe path under generated/.","generated/...",f);if(seen.has(f))diagnostic(d,"MANIFEST_GENERATED_FILE_DUPLICATE",path,`Generated file '${f}' is listed more than once.`);seen.add(f);if(safeGeneratedPath(f)&&!(await fileExists(resolve(readiness.remotionRoot,f))))diagnostic(d,"MANIFEST_GENERATED_FILE_MISSING",path,`Generated file '${f}' does not exist on disk.`);}}
  if(bindings){
    const sceneById=new Map(project.scenes.map(scene=>[scene.id,scene])),manifestAssets=new Set(readiness.availableAssetPaths.map(normalizeAssetPath)),bound=new Set<string>();
    for(let i=0;i<bindings.length;i++){
      const b=bindings[i],base=`/manifest/sceneBindings/${i}`,scene=sceneById.get(b.sceneId);
      if(!scene)diagnostic(d,"MANIFEST_SCENE_UNKNOWN",`${base}/sceneId`,`Scene '${b.sceneId}' does not exist in the project.`);
      if(bound.has(b.sceneId))diagnostic(d,"MANIFEST_SCENE_DUPLICATE",`${base}/sceneId`,`Scene '${b.sceneId}' is bound more than once.`);bound.add(b.sceneId);
      if(!safeGeneratedPath(b.sourceFile))diagnostic(d,"MANIFEST_SOURCE_PATH_UNSAFE",`${base}/sourceFile`,"Scene sourceFile must be a safe path under generated/.","generated/...",b.sourceFile);
      if(generatedFiles&&!generatedFiles.includes(b.sourceFile))diagnostic(d,"MANIFEST_SOURCE_NOT_LISTED",`${base}/sourceFile`,`Scene sourceFile '${b.sourceFile}' is not listed in generatedFiles.`);
      if(safeGeneratedPath(b.sourceFile)&&!(await fileExists(resolve(readiness.remotionRoot,b.sourceFile))))diagnostic(d,"MANIFEST_SOURCE_FILE_MISSING",`${base}/sourceFile`,`Scene sourceFile '${b.sourceFile}' does not exist on disk.`);
      const declared=b.assets.map(normalizeAssetPath);
      declared.forEach((path,j)=>{
        if(!manifestAssets.has(path))diagnostic(d,"MANIFEST_ASSET_UNKNOWN",`${base}/assets/${j}`,`Asset '${b.assets[j]}' is not available in the production asset manifest.`);
        const item=readiness.availableAssets?.find(candidate=>normalizeAssetPath(candidate.publicPath)===path);
        if(item?.sceneIds&&!item.sceneIds.includes(b.sceneId))diagnostic(d,"MANIFEST_ASSET_SCENE_MISMATCH",`${base}/assets/${j}`,`Asset '${b.assets[j]}' is not bound to scene '${b.sceneId}' in the production registry.`);
      });
    }
    project.scenes.forEach(s=>{if(!bound.has(s.id))diagnostic(d,"MANIFEST_SCENE_BINDING_MISSING","/manifest/sceneBindings",`Manifest is missing a binding for scene '${s.id}'.`);});
  }
  if(d.length||!version||!projectHash||!skillId||!generatedFiles||!bindings)return {valid:false,diagnostics:d};
  return {valid:true,diagnostics:[],manifest:{version,projectHash,skillId,generatedFiles,sceneBindings:bindings,validation:{typecheck:"passed",stills:"passed",render:"passed"}}};
}
