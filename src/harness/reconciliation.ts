import {readdir,readFile,stat} from "node:fs/promises";
import {resolve} from "node:path";
import {readJson,writeJson} from "../core/io.js";
import {sha256} from "../core/hash.js";
import {exists} from "./fs.js";
import {harnessPaths} from "./paths.js";
import {reopenStatus,type ReopenCheckpoint} from "./reopen.js";
import type {NarrationManifest} from "../tts/types.js";

export type ReconciliationAction="reuse"|"modify"|"remove"|"add";
export interface ReconciliationEntry {artifactId:string;action:ReconciliationAction;reason:string;priorHash?:string;currentHash?:string;}
export interface ReconciliationReport {version:"1";generation:number;reason:string;entries:ReconciliationEntry[];}
interface Artifact {id:string;priorHash?:string;currentHash?:string;}

function semantic(value:unknown):unknown{if(Array.isArray(value))return value.map(semantic);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([key])=>!(["status","approvedBy","approvedAt","createdAt","updatedAt","phase","previewUrl","previewPid","previewPort"].includes(key))).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,semantic(v)]));return value;}
function canonicalHash(value:unknown):string{return sha256(JSON.stringify(semantic(value)));}
async function parseIfExists(path:string):Promise<unknown>{if(!(await exists(path)))return undefined;try{return await readJson(path);}catch{return await readFile(path,"utf8");}}
async function artifactHash(path:string):Promise<string|undefined>{if(!(await exists(path)))return undefined;const metadata=await stat(path);if(metadata.isDirectory()){const files:Array<[string,string]>=[];async function visit(dir:string,prefix:string){for(const entry of await readdir(dir,{withFileTypes:true})){const name=prefix?`${prefix}/${entry.name}`:entry.name,file=resolve(dir,entry.name);if(entry.isSymbolicLink())throw new Error(`Reconciliation artifact contains a symbolic link: ${file}`);if(entry.isDirectory())await visit(file,name);else if(entry.isFile())files.push([name,sha256(await readFile(file))]);}}await visit(path,"");return sha256(JSON.stringify(files.sort(([a],[b])=>a.localeCompare(b))));}const value=await parseIfExists(path);return typeof value==="string"?sha256(value):canonicalHash(value);}
async function artifact(_root:string,id:string,snapshot?:string,current?:string):Promise<Artifact>{const [priorHash,currentHash]=await Promise.all([snapshot?artifactHash(snapshot):undefined,current?artifactHash(current):undefined]);return {id,...(priorHash===undefined?{}:{priorHash}),...(currentHash===undefined?{}:{currentHash})};}
function validateEntry(entry:ReconciliationEntry,source:Artifact):void{
  if(!["reuse","modify","remove","add"].includes(entry.action)||entry.priorHash!==source.priorHash||entry.currentHash!==source.currentHash||entry.reason.trim().length<4)throw new Error(`Reconciliation item ${entry.artifactId} has invalid action, hashes, or reason.`);
  if(entry.action==="reuse"&&(source.priorHash===undefined||source.currentHash===undefined||source.priorHash!==source.currentHash))throw new Error(`Cannot reuse changed or missing artifact ${entry.artifactId}.`);
  if(entry.action==="modify"&&(source.priorHash===undefined||source.currentHash===undefined||source.priorHash===source.currentHash))throw new Error(`Modified artifact ${entry.artifactId} must exist and differ from its baseline.`);
  if(entry.action==="remove"&&(source.priorHash===undefined||source.currentHash!==undefined))throw new Error(`Removed artifact ${entry.artifactId} must have a baseline and no current value.`);
  if(entry.action==="add"&&(source.priorHash!==undefined||source.currentHash===undefined))throw new Error(`Added artifact ${entry.artifactId} must have a current value and no baseline.`);
}

export async function getReconciliationContext(root:string):Promise<Record<string,unknown>>{
  const p=harnessPaths(root),status=await reopenStatus(root),latest=status.records.at(-1);if(!latest)return {generation:status.generation,pending:status.pending,latest:null,artifacts:[]};
  const snapshot=latest.snapshots,entries:Artifact[]=[];
  const priorHfState=snapshot[p.rendererState]?await parseIfExists(snapshot[p.rendererState]) as any:undefined,currentHfState=await parseIfExists(p.rendererState) as any;
  const priorHfProject=typeof priorHfState?.projectDir==="string"?resolve(root,priorHfState.projectDir):undefined,currentHfProject=typeof currentHfState?.projectDir==="string"?resolve(root,currentHfState.projectDir):undefined;
  const defs:Array<[string,string|undefined,string|undefined]>=[["video-brief",p.videoBrief,p.videoBrief],["production-profile",p.productionProfile,p.productionProfile],["script",p.scriptDraft,p.scriptDraft],["storyboard",p.storyboardDraft,p.storyboardDraft],["assets",p.assetManifest,p.assetManifest],["renderer-hyperframes",p.manifest,p.manifest],["renderer-remotion",p.remotionManifest,p.remotionManifest],["renderer-state-hyperframes",p.rendererState,p.rendererState],["renderer-state-remotion",p.remotionRendererState,p.remotionRendererState],["remotion-generated",p.remotionGenerated,p.remotionGenerated],["remotion-public-assets",p.remotionPublicAssets,p.remotionPublicAssets]];
  if(priorHfProject||currentHfProject)defs.push(["hyperframes-project-source",currentHfProject,priorHfProject]);
  const scope:Record<ReopenCheckpoint,Set<string>>={
    VIDEO_BRIEF:new Set(["video-brief","production-profile","script","storyboard"]),
    SCRIPT:new Set(["script","storyboard"]),
    STORYBOARD:new Set(["storyboard"]),
    ASSET_PREFLIGHT:new Set(["assets"]),
    VISUAL_REVIEW:new Set(["renderer-hyperframes","renderer-remotion","renderer-state-hyperframes","renderer-state-remotion","remotion-generated","remotion-public-assets","hyperframes-project-source"]),
  };
  const required=new Set(status.pending.flatMap(checkpoint=>[...scope[checkpoint]]));
  for(const[id,current,priorSource]of defs){if(!required.has(id))continue;const item=await artifact(root,id,priorSource?snapshot[priorSource]:undefined,current);if(item.priorHash!==undefined||item.currentHash!==undefined)entries.push(item);}
  const priorNarrationPath=snapshot[p.narrationManifest];
  const narrationItems=new Map<string,Artifact>();
  if(latest.checkpoint==="VIDEO_BRIEF"||latest.checkpoint==="SCRIPT"){
    for(const[path,prior]of [[priorNarrationPath,true],[p.narrationManifest,false]] as const){if(path&&await exists(path)){try{const m=await readJson<NarrationManifest>(path);for(const segment of m.segments){const id=`narration:${segment.id}`,item=narrationItems.get(id)??{id};if(prior)item.priorHash="audioHash"in segment?segment.audioHash:canonicalHash(segment);else item.currentHash="audioHash"in segment?segment.audioHash:canonicalHash(segment);narrationItems.set(id,item);}}catch{}}}
    entries.push(...[...narrationItems.values()].filter(item=>item.priorHash!==undefined||item.currentHash!==undefined));
  }
  const oldProject=snapshot[p.video]?await parseIfExists(snapshot[p.video]):undefined,currentProject=await parseIfExists(p.video) as any;
  const oldScenes=new Map((Array.isArray((oldProject as any)?.scenes)?(oldProject as any).scenes:[]).map((s:any)=>[s.id,s])),newScenes=new Map((Array.isArray(currentProject?.scenes)?currentProject.scenes:[]).map((s:any)=>[s.id,s]));
  const sceneIds=[...new Set([...oldScenes.keys(),...newScenes.keys()])].map(String).filter(id=>!oldScenes.has(id)||!newScenes.has(id)||canonicalHash(oldScenes.get(id))!==canonicalHash(newScenes.get(id)));
  return {generation:status.generation,pending:status.pending,latest,artifacts:entries,changedArtifactIds:entries.filter(e=>e.priorHash!==e.currentHash).map(e=>e.id),affectedSceneIds:sceneIds,narrationManifest:await parseIfExists(p.narrationManifest),assetReferences:(await parseIfExists(p.assetManifest) as any)?.assets??[],rendererReferences:{hyperframes:await parseIfExists(p.manifest),remotion:await parseIfExists(p.remotionManifest)}};
}
export async function submitReconciliation(root:string,report:ReconciliationReport):Promise<{ok:true;generation:number;entries:number;hash:string}>{
  const p=harnessPaths(root),context=await getReconciliationContext(root),generation=Number(context.generation),expected=new Map((context.artifacts as Artifact[]).map(item=>[item.id,item]));
  if(report.version!=="1"||report.generation!==generation||!report.reason.trim()||!Array.isArray(report.entries))throw new Error("Reconciliation report must bind the current edit generation and include a concrete reason.");
  const seen=new Set<string>();for(const entry of report.entries){if(seen.has(entry.artifactId))throw new Error(`Duplicate reconciliation item: ${entry.artifactId}`);seen.add(entry.artifactId);const source=expected.get(entry.artifactId);if(!source)throw new Error(`Unknown reconciliation artifact: ${entry.artifactId}`);validateEntry(entry,source);
  }
  const required=new Set((context.artifacts as Artifact[]).map(x=>x.id));for(const id of required)if(!seen.has(id))throw new Error(`Reconciliation is missing artifact ${id}.`);
  const saved={...report,createdAt:new Date().toISOString()},hash=sha256(JSON.stringify(saved));await writeJson(p.reconciliation,{...saved,hash});return {ok:true,generation,entries:report.entries.length,hash};
}

export async function assertReconciliationCurrent(root:string):Promise<void>{const p=harnessPaths(root),state=await reopenStatus(root);if(!state.pending.length)return;let report:ReconciliationReport&{createdAt?:string;hash?:string};try{report=await readJson(p.reconciliation);}catch{throw new Error("Host reopened an approved checkpoint. Inspect `video revision status` and submit a complete reconciliation before downstream review.");}if(report.generation!==state.generation||!report.createdAt||!report.hash)throw new Error("Reconciliation is stale or missing its report hash; regenerate it from current artifact hashes before resubmission.");const{hash,...body}=report;if(hash!==sha256(JSON.stringify(body)))throw new Error("Reconciliation report was changed after submission.");const context=await getReconciliationContext(root),expected=new Map((context.artifacts as Artifact[]).map(item=>[item.id,item])),seen=new Set<string>();for(const entry of report.entries){const item=expected.get(entry.artifactId);if(!item)continue;validateEntry(entry,item);seen.add(entry.artifactId);}for(const id of expected.keys())if(!seen.has(id))throw new Error(`Reconciliation is missing artifact ${id}.`);}
