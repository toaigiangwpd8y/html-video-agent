import {mkdir,readFile,rename,rm} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {isAbsolute,relative,resolve} from "node:path";
import {readJson,writeJson} from "../core/io.js";
import {sha256} from "../core/hash.js";
import {harnessPaths} from "../harness/paths.js";
import {createTtsProvider} from "./provider.js";
import {publicTtsConfig,ttsConfig} from "./config.js";
import type {NarrationManifest,NarrationSegment,SilentNarrationSegment,TtsConfig} from "./types.js";

export interface NarrationInput {version:"1";scriptFile:string;language:"vi"|"en"|"vi-en";segments:Array<{id:string;text:string;gapAfterSeconds?:number}|{id:string;silent:true;durationSeconds:number;gapAfterSeconds?:number}>;config?:Partial<TtsConfig>;}

function inside(root:string,path:string){const rel=relative(resolve(root),resolve(path));return rel!==".."&&!rel.startsWith(`..\\`)&&!rel.startsWith(`../`)&&!isAbsolute(rel);}
function manifestDigest(value:Omit<NarrationManifest,"manifestHash">):string{return sha256(JSON.stringify(value));}
function activeConfig(config:TtsConfig){const {pythonExecutable:_,timeoutMs:__,...effective}=publicTtsConfig(config);return effective;}

export async function synthesizeNarration(root:string,inputOrFile:string|NarrationInput):Promise<NarrationManifest>{
  const p=harnessPaths(root),input=typeof inputOrFile==="string"?await readJson<NarrationInput>(resolve(root,inputOrFile)):inputOrFile;
  if(input.version!=="1"||!Array.isArray(input.segments))throw new Error("Narration input must use version 1 and include explicit segments.");
  if(!["vi","en","vi-en"].includes(input.language))throw new Error("Narration input language must be vi, en, or vi-en; unsupported languages fail without fallback.");
  const scriptPath=resolve(root,input.scriptFile);if(!inside(root,scriptPath))throw new Error("Narration Script must be inside the project root.");
  const script=await readFile(scriptPath,"utf8"),scriptHash=sha256(script),config=ttsConfig(root,{...input.config,language:input.language}),configHash=sha256(JSON.stringify(activeConfig(config))),provider=createTtsProvider(root,{...input.config,language:input.language});
  const ids=new Set<string>(),segments:Array<NarrationSegment|SilentNarrationSegment|undefined>=[],pending:Array<{index:number;id:string;text:string;textHash:string;audioPath:string;gapAfterSeconds?:number}>=[];
  await mkdir(p.narrationCache,{recursive:true});
  for(const item of input.segments){
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(item.id)||ids.has(item.id))throw new Error(`Narration segment id is unsafe or duplicated: ${item.id}`);ids.add(item.id);
    if(item.gapAfterSeconds!==undefined&&(!Number.isFinite(item.gapAfterSeconds)||item.gapAfterSeconds<0))throw new Error(`Narration segment ${item.id} gapAfterSeconds must be finite and nonnegative.`);
    if("silent" in item&&item.silent){if(!Number.isFinite(item.durationSeconds)||item.durationSeconds<=0)throw new Error(`Silent beat ${item.id} requires positive explicit durationSeconds.`);segments.push({id:item.id,silent:true,durationSeconds:item.durationSeconds,...(item.gapAfterSeconds?{gapAfterSeconds:item.gapAfterSeconds}:{})});continue;}
    if(!("text" in item)||typeof item.text!=="string"||!item.text.trim())throw new Error(`Narration segment ${item.id} requires exact text or an explicit silent beat.`);
    const text=item.text, textHash=sha256(text),cacheKey=sha256(JSON.stringify({textHash,config:activeConfig(config)})).slice(7),audioPath=resolve(p.narrationCache,`${cacheKey}.wav`);
    const index=segments.length;let measured:{sampleRate:number;sampleCount:number;durationSeconds:number;audioHash:string}|undefined;
    try{const bytes=await readFile(audioPath);const {inspectWav}=await import("./provider.js");const m=await inspectWav(audioPath);measured={...m,audioHash:sha256(bytes)};}catch{}
    if(!measured){await rm(audioPath,{force:true});pending.push({index,id:item.id,text,textHash,audioPath,...(item.gapAfterSeconds?{gapAfterSeconds:item.gapAfterSeconds}:{})});segments.push(undefined);continue;}
    segments.push({id:item.id,text,textHash,audioFile:relative(root,audioPath).replaceAll("\\","/"),audioHash:measured.audioHash,sampleCount:measured.sampleCount,sampleRate:measured.sampleRate,durationSeconds:measured.durationSeconds,...(item.gapAfterSeconds?{gapAfterSeconds:item.gapAfterSeconds}:{})});
  }
  let synthesisElapsedMs=0,peakRssBytes=0;
  if(pending.length){const result=await provider.synthesizeSegments(pending.map(({id,text,audioPath})=>({id,text,outputPath:audioPath})));synthesisElapsedMs=result.elapsedMs;peakRssBytes=result.peakRssBytes;const {inspectWav}=await import("./provider.js");for(const item of pending){const bytes=await readFile(item.audioPath),measured=await inspectWav(item.audioPath),segment:NarrationSegment={id:item.id,text:item.text,textHash:item.textHash,audioFile:relative(root,item.audioPath).replaceAll("\\","/"),audioHash:sha256(bytes),sampleCount:measured.sampleCount,sampleRate:measured.sampleRate,durationSeconds:measured.durationSeconds,...(item.gapAfterSeconds?{gapAfterSeconds:item.gapAfterSeconds}:{})};segments[item.index]=segment;}}
  const completeSegments=segments as Array<NarrationSegment|SilentNarrationSegment>;
  const totalAudioSeconds=completeSegments.reduce((n,s)=>n+("silent" in s?0:s.durationSeconds),0),totalTimelineSeconds=input.segments.reduce((n,s)=>n+("silent" in s?s.durationSeconds:completeSegments.find(x=>x.id===s.id)?.durationSeconds??0)+(s.gapAfterSeconds??0),0);
  const core={version:"1" as const,scriptFile:relative(root,scriptPath).replaceAll("\\","/"),scriptHash,synthesisConfigHash:configHash,createdAt:new Date().toISOString(),segments:completeSegments,totalAudioSeconds,totalTimelineSeconds,synthesisMetrics:{elapsedMs:synthesisElapsedMs,peakRssBytes}};
  const manifest={...core,manifestHash:manifestDigest(core)};
  const temp=`${p.narrationManifest}.${randomUUID()}.tmp`;await writeJson(temp,manifest);const validation=await validateNarrationManifest(root,manifest);if(!validation.valid){await rm(temp,{force:true});throw new Error(`Refusing to publish invalid narration manifest: ${validation.errors.join(" ")}`);}await rename(temp,p.narrationManifest);return manifest;
}

export interface ValidationResult {valid:boolean;errors:string[];}
export async function validateNarrationManifest(root:string,value?:NarrationManifest):Promise<ValidationResult>{
  const p=harnessPaths(root),errors:string[]=[];let manifest=value;
  try{manifest??=await readJson<NarrationManifest>(p.narrationManifest);}catch(error){return {valid:false,errors:[`Narration manifest is unavailable: ${error instanceof Error?error.message:String(error)}`]};}
  if(manifest.version!=="1")errors.push("Unsupported narration manifest version.");
  const {manifestHash,...core}=manifest;if(manifestHash!==manifestDigest(core))errors.push("Narration manifest hash does not match its contents.");
  const scriptPath=resolve(root,manifest.scriptFile);if(!inside(root,scriptPath))errors.push("Narration Script path escapes the project root.");else try{if(sha256(await readFile(scriptPath,"utf8"))!==manifest.scriptHash)errors.push("Narration Script changed after synthesis.");}catch{errors.push("Narration Script is missing.");}
  const ids=new Set<string>();let audio=0,timeline=0;
  for(const segment of manifest.segments??[]){if(ids.has(segment.id))errors.push(`Duplicate active narration segment ${segment.id}.`);ids.add(segment.id);
    if("silent" in segment&&segment.silent){if(!Number.isFinite(segment.durationSeconds)||segment.durationSeconds<=0)errors.push(`Silent segment ${segment.id} has invalid duration.`);timeline+=segment.durationSeconds+(segment.gapAfterSeconds??0);continue;}
    const path=resolve(root,segment.audioFile);if(!inside(root,path)){errors.push(`Audio path for ${segment.id} escapes the project root.`);continue;}
    try{const data=await readFile(path),hash=sha256(data);if(hash!==segment.audioHash)errors.push(`Audio bytes for ${segment.id} changed after approval.`);const {inspectWav}=await import("./provider.js"),measured=await inspectWav(path,segment.sampleRate,segment.sampleCount);if(measured.audioHash!==segment.audioHash)errors.push(`Audio hash for ${segment.id} is inconsistent.`);audio+=measured.durationSeconds;timeline+=measured.durationSeconds+(segment.gapAfterSeconds??0);}catch(error){errors.push(`Audio for ${segment.id} is invalid or missing: ${error instanceof Error?error.message:String(error)}`);}
  }
  if(Math.abs(audio-manifest.totalAudioSeconds)>1e-6)errors.push("Narration audio total differs from measured segment durations.");
  if(Math.abs(timeline-manifest.totalTimelineSeconds)>1e-6)errors.push("Narration timeline total differs from measured audio, silent beats, and declared gaps.");
  return {valid:errors.length===0,errors};
}
