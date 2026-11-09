import {createHash} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import {relative,resolve} from "node:path";
import type {VideoProject} from "../core/types.js";
import {readJson} from "../core/io.js";
import {exists} from "./fs.js";
import {videoProjectHash} from "./project-state.js";
import type {RemotionTimelineEvidence} from "./remotion-timeline.js";

export interface BoundaryEvidenceEntry {
  fromSceneId: string;
  toSceneId: string;
  frames: number[];
  files: string[];
}
export interface RemotionBoundaryEvidence {
  version: "1";
  projectHash: string;
  generatedHash: string;
  opening: {frame:number;file:string};
  boundaries: BoundaryEvidenceEntry[];
  ending: {frame:number;file:string};
}

async function listFiles(root:string):Promise<string[]>{
  if(!(await exists(root)))return[];
  const out:string[]=[];
  async function walk(dir:string){for(const e of await readdir(dir,{withFileTypes:true})){const f=resolve(dir,e.name);if(e.isSymbolicLink())throw new Error(`Generated Remotion source '${f}' must not be a symbolic link.`);if(e.isDirectory())await walk(f);else if(e.isFile()&&e.name!==".gitkeep")out.push(f);}}
  await walk(root);return out.sort();
}

export async function generatedHash(generatedRoot:string):Promise<string>{
  const h=createHash("sha256"),files=await listFiles(generatedRoot);
  for(const file of files){h.update(relative(generatedRoot,file).replaceAll("\\","/"));h.update("\0");h.update(await readFile(file,"utf8"));h.update("\0");}
  return `sha256:${h.digest("hex")}`;
}

function uniq(values:number[]):number[]{return [...new Set(values.filter(v=>Number.isInteger(v)&&v>=0))].sort((a,b)=>a-b);}
/**
 * Evidence is derived from actual resolved scene occupancy. For overlaps we inspect
 * the outgoing-only frame, overlap start/middle/end, and first incoming-only frame.
 * This observes temporal topology without prescribing a transition component.
 */
export function plannedBoundaryEvidence(timeline:RemotionTimelineEvidence,project:VideoProject):Array<{fromSceneId:string;toSceneId:string;frames:number[]}>{
  const byId=new Map(timeline.scenes.map(s=>[s.sceneId,s]));
  const out:Array<{fromSceneId:string;toSceneId:string;frames:number[]}>=[];
  const maxFrame=Math.max(0,timeline.durationInFrames-1);
  for(let i=0;i<project.scenes.length-1;i++){
    const from=project.scenes[i],to=project.scenes[i+1],a=byId.get(from.id),b=byId.get(to.id);
    if(!a||!b)continue;
    const overlapStart=Math.max(a.startFrame,b.startFrame),overlapEnd=Math.min(a.endFrame,b.endFrame);
    let frames:number[];
    if(overlapEnd>overlapStart){
      const mid=Math.floor((overlapStart+overlapEnd-1)/2);
      frames=uniq([Math.max(0,overlapStart-1),overlapStart,mid,overlapEnd-1,Math.min(maxFrame,overlapEnd)]);
    }else{
      frames=uniq([Math.max(0,a.endFrame-1),Math.min(maxFrame,b.startFrame)]);
    }
    out.push({fromSceneId:from.id,toSceneId:to.id,frames});
  }
  return out;
}

export async function validateBoundaryEvidence(
  evidencePath:string,
  evidenceRoot:string,
  generatedRoot:string,
  project:VideoProject,
  timeline:RemotionTimelineEvidence,
):Promise<string[]>{
  const errors:string[]=[];
  if(!(await exists(evidencePath)))return ["Boundary evidence index is missing. Run `video remotion evidence` and inspect the generated boundary frames before finalize."];
  let raw:RemotionBoundaryEvidence;try{raw=await readJson<RemotionBoundaryEvidence>(evidencePath);}catch{return ["Boundary evidence index is not valid JSON."];}
  if(raw.version!=="1")errors.push("Boundary evidence version must be 1.");
  if(raw.projectHash!==videoProjectHash(project))errors.push("Boundary evidence projectHash is stale.");
  const currentHash=await generatedHash(generatedRoot);
  if(raw.generatedHash!==currentHash)errors.push("Generated Remotion source changed after boundary evidence was rendered. Re-run `video remotion evidence` and inspect it again.");
  if(!raw.opening||raw.opening.frame!==0)errors.push("Opening evidence must inspect frame 0.");
  else if(typeof raw.opening.file!=="string"||raw.opening.file.includes("..")||!(await exists(resolve(evidenceRoot,raw.opening.file))))errors.push("Opening evidence image is missing.");
  const expected=plannedBoundaryEvidence(timeline,project);
  if(!Array.isArray(raw.boundaries)||raw.boundaries.length!==expected.length)errors.push("Boundary evidence must cover every adjacent scene boundary.");
  else for(let i=0;i<expected.length;i++){
    const got=raw.boundaries[i],want=expected[i];
    if(got.fromSceneId!==want.fromSceneId||got.toSceneId!==want.toSceneId)errors.push(`Boundary evidence ${i+1} scene pair is stale.`);
    if(JSON.stringify(got.frames)!==JSON.stringify(want.frames))errors.push(`Boundary evidence ${want.fromSceneId} -> ${want.toSceneId} uses stale frames.`);
    if(!Array.isArray(got.files)||got.files.length!==want.frames.length)errors.push(`Boundary evidence ${want.fromSceneId} -> ${want.toSceneId} is missing rendered files.`);
    else for(const file of got.files){if(typeof file!=="string"||file.includes("..")||!(await exists(resolve(evidenceRoot,file))))errors.push(`Boundary evidence file '${String(file)}' is missing or unsafe.`);}
  }
  const finalFrame=Math.max(0,timeline.durationInFrames-1);
  if(!raw.ending||raw.ending.frame!==finalFrame)errors.push(`Ending evidence must inspect final frame ${finalFrame}.`);
  else if(typeof raw.ending.file!=="string"||raw.ending.file.includes("..")||!(await exists(resolve(evidenceRoot,raw.ending.file))))errors.push("Ending evidence image is missing.");
  return errors;
}
