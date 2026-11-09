import {copyFile,mkdir,readFile} from "node:fs/promises";
import {relative,resolve} from "node:path";
import {readJson,writeJson} from "../core/io.js";
import {sha256} from "../core/hash.js";
import type {VideoProject} from "../core/types.js";
import {harnessPaths} from "./paths.js";
import {withAssetStorageLock} from "./asset-storage-lock.js";
import {exists} from "./fs.js";
import type {AssetManifest,AssetManifestItem} from "./assets.js";
import type {NarrationManifest,NarrationSegment} from "../tts/types.js";
import {validateNarrationManifest} from "../tts/cache.js";
import {inspectWav} from "../tts/provider.js";

function isNarrated(segment:NarrationManifest["segments"][number]):segment is NarrationSegment{return !("silent" in segment&&segment.silent===true);}
function sceneStartFrames(project:VideoProject):Map<string,number>{let start=0;return new Map(project.scenes.map(scene=>{const pair:[string,number]=[scene.id,start];start+=scene.durationInFrames;return pair;}));}

export async function validateStoryboardNarrationMapping(root:string,project:VideoProject):Promise<{valid:boolean;errors:string[];durationSeconds:number}>{
  const p=harnessPaths(root),errors:string[]=[],narration=await readJson<NarrationManifest>(p.narrationManifest),segments=new Map(narration.segments.filter(isNarrated).map(segment=>[segment.id,segment])),seen=new Set<string>();
  for(const scene of project.scenes){if(!scene.audio?.voiceoverText.trim())continue;const id=scene.audio.voiceSegmentId,segment=id?segments.get(id):undefined;if(!id||!segment){errors.push(`Narrated scene '${scene.id}' requires a valid voiceSegmentId from the approved Script.`);continue;}if(seen.has(id)){errors.push(`Narration segment '${id}' is duplicated across Storyboard scenes.`);continue;}seen.add(id);if(scene.audio.voiceoverText!==segment.text)errors.push(`Narrated scene '${scene.id}' copy must exactly match approved Script segment '${id}'.`);const required=Math.ceil(segment.sampleCount/segment.sampleRate*project.meta.fps);if(scene.durationInFrames<required)errors.push(`Scene '${scene.id}' has ${scene.durationInFrames} frames; measured narration needs ${required} at ${project.meta.fps} fps.`);}
  for(const segment of segments.values())if(!seen.has(segment.id))errors.push(`Approved spoken segment '${segment.id}' is not assigned to a Storyboard scene.`);
  return {valid:errors.length===0,errors,durationSeconds:project.meta.durationsInFrames/project.meta.fps};
}

export async function registerApprovedNarrationBindings(root:string,project:VideoProject):Promise<AssetManifest>{
  const p=harnessPaths(root),validation=await validateNarrationManifest(root);if(!validation.valid)throw new Error(`Approved narration is incomplete or stale: ${validation.errors.join(" ")}`);
  const narration=await readJson<NarrationManifest>(p.narrationManifest),voiced=project.scenes.filter(scene=>scene.audio?.voiceoverText.trim()),starts=sceneStartFrames(project),segments=new Map(narration.segments.filter(isNarrated).map(segment=>[segment.id,segment]));
  return withAssetStorageLock(root,async()=>{
  const assets=await readJson<AssetManifest>(p.assetManifest);
  const used=new Set<string>(),sceneUsed=new Set<string>();
  for(const scene of voiced){const segmentId=scene.audio?.voiceSegmentId;if(!segmentId)throw new Error(`Narrated scene '${scene.id}' must map explicitly to a Script narration segment with audio.voiceSegmentId.`);const segment=segments.get(segmentId);if(!segment)throw new Error(`Narrated scene '${scene.id}' references missing narration segment '${segmentId}'.`);if(scene.audio?.voiceoverText!==segment.text)throw new Error(`Canonical narration text for scene '${scene.id}' differs from the exact approved TTS text.`);if(used.has(segmentId)||sceneUsed.has(scene.id))throw new Error(`Narration segment '${segmentId}' is mapped more than once.`);used.add(segmentId);sceneUsed.add(scene.id);
    const audioFile=`narration/${segment.id}.wav`,publicPath=`/assets/${audioFile}`,destination=resolve(root,"assets",...audioFile.split("/")),source=resolve(root,segment.audioFile);await mkdir(resolve(destination,".."),{recursive:true});const bytes=await readFile(source);if(sha256(bytes)!==segment.audioHash)throw new Error(`Approved audio segment '${segment.id}' bytes changed before registration.`);await copyFile(source,destination);
    const durationInFrames=Math.ceil(segment.sampleCount/segment.sampleRate*project.meta.fps),startFrame=starts.get(scene.id)!;if(durationInFrames>scene.durationInFrames)throw new Error(`Scene '${scene.id}' has ${scene.durationInFrames} frames but its approved natural-rate narration needs ${durationInFrames} frames.`);
    const item:AssetManifestItem={id:`narration-${segment.id}`,publicPath,type:"audio/wav",source:"local-vieneu-tts",provenance:`Approved Script narration segment ${segment.id}; manifest ${narration.manifestHash}`,permittedUse:"voiceover for the mapped scene in this educational video",role:"voiceover",sceneIds:[scene.id],audioTiming:{startFrame,durationInFrames,mediaStartSeconds:0,gain:1,fadeInInFrames:0,fadeOutInFrames:0},notes:`sha256 ${segment.audioHash}; ${segment.sampleCount} samples at ${segment.sampleRate} Hz; playback rate 1.0.`};
    const index=assets.assets.findIndex(asset=>asset.id===item.id);if(index<0)assets.assets.push(item);else assets.assets[index]=item;
  }
  for(const segment of segments.values())if(!used.has(segment.id))throw new Error(`Approved spoken segment '${segment.id}' is not mapped to an explicit canonical scene.`);
  const activeAssetIds=new Set([...used].map(id=>`narration-${id}`));assets.assets=assets.assets.filter(asset=>!asset.id.startsWith("narration-")||activeAssetIds.has(asset.id));
  await writeJson(p.assetManifest,assets);return assets;
  });
}

export async function validateApprovedNarrationBindings(root:string,project:VideoProject,assets?:AssetManifest):Promise<{valid:boolean;errors:string[]}>{
  const p=harnessPaths(root),errors:string[]=[],manifest=assets??await readJson<AssetManifest>(p.assetManifest),validation=await validateNarrationManifest(root);if(!validation.valid)return {valid:false,errors:validation.errors};
  const narration=await readJson<NarrationManifest>(p.narrationManifest),segments=new Map(narration.segments.filter(isNarrated).map(segment=>[segment.id,segment])),starts=sceneStartFrames(project),seen=new Set<string>();
  for(const scene of project.scenes){if(!scene.audio?.voiceoverText.trim())continue;const id=scene.audio.voiceSegmentId,segment=id?segments.get(id):undefined;if(!id||!segment){errors.push(`Scene '${scene.id}' has no valid approved narration segment binding.`);continue;}if(seen.has(id)){errors.push(`Narration segment '${id}' is played more than once.`);continue;}seen.add(id);if(scene.audio.voiceoverText!==segment.text)errors.push(`Scene '${scene.id}' narration text differs from approved segment '${id}'.`);
    const asset=manifest.assets.find(item=>item.id===`narration-${id}`),expectedDuration=Math.ceil(segment.sampleCount/segment.sampleRate*project.meta.fps),expectedStart=starts.get(scene.id);if(!asset){errors.push(`Approved narration asset for '${id}' is missing.`);continue;}if(asset.sceneIds?.length!==1||asset.sceneIds[0]!==scene.id||asset.role!=="voiceover")errors.push(`Approved narration asset '${asset.id}' is mapped to the wrong scene or role.`);if(asset.audioTiming?.startFrame!==expectedStart||asset.audioTiming?.durationInFrames!==expectedDuration||asset.audioTiming.mediaStartSeconds!==0||asset.audioTiming.gain!==1)errors.push(`Approved narration asset '${asset.id}' timing differs from measured natural-rate schedule.`);
    try{const path=resolve(root,"assets",asset.publicPath.replace(/^\/assets\//,"")),bytes=await readFile(path),measured=await inspectWav(path,segment.sampleRate,segment.sampleCount);if(sha256(bytes)!==segment.audioHash||measured.audioHash!==segment.audioHash)errors.push(`Registered voice bytes for '${id}' differ from the Script-approved WAV.`);}catch(error){errors.push(`Registered narration '${id}' is missing or invalid: ${error instanceof Error?error.message:String(error)}`);}
  }
  if(seen.size!==segments.size)errors.push("Not every approved spoken narration segment is mapped exactly once into canonical scenes.");
  return {valid:errors.length===0,errors};
}

export async function assertApprovedNarrationBindings(root:string,project:VideoProject):Promise<void>{
  const p=harnessPaths(root);if(!(await exists(p.narrationManifest))){if(project.scenes.some(scene=>Boolean(scene.audio?.voiceoverText.trim())))throw new Error("Approved Script-stage narration manifest is missing; renderer cannot use unbound voice assets.");return;}
  const result=await validateApprovedNarrationBindings(root,project);if(!result.valid)throw new Error(`Approved narration binding validation failed: ${result.errors.join(" ")}`);
}
