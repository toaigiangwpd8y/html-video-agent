import {readJson,readText,writeJson} from "../core/io.js";
import {sha256} from "../core/hash.js";
import type {VideoProject} from "../core/types.js";
import {exists,requireFile} from "./fs.js";
import {harnessPaths} from "./paths.js";

export interface ProjectState {
  version: "1";
  projectId: string;
  revision: number;
  requestHash: string;
  projectHash: string;
}

export const videoProjectHash=(project:VideoProject):string=>sha256(JSON.stringify(project));

async function capturedRequestHash(root:string):Promise<string>{const p=harnessPaths(root);await requireFile(p.request,"Captured user request");return sha256(await readText(p.request));}

function validateState(value:unknown):ProjectState{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Project state must be an object.");
  const x=value as Record<string,unknown>;
  if(x.version!=="1"||typeof x.projectId!=="string"||!x.projectId||!Number.isInteger(x.revision)||Number(x.revision)<1||typeof x.requestHash!=="string"||typeof x.projectHash!=="string")throw new Error("Project state is invalid.");
  return {version:"1",projectId:x.projectId,revision:Number(x.revision),requestHash:x.requestHash,projectHash:x.projectHash};
}

export async function createProjectState(root:string,project:VideoProject):Promise<ProjectState>{
  const p=harnessPaths(root);if(await exists(p.projectState))throw new Error("Project state already exists.");
  const projectHash=videoProjectHash(project),state:ProjectState={version:"1",projectId:`project-${projectHash.slice(7,19)}`,revision:1,requestHash:await capturedRequestHash(root),projectHash};
  await writeJson(p.projectState,state);return state;
}

export async function loadProjectState(root:string,project?:VideoProject):Promise<ProjectState>{
  const p=harnessPaths(root);await requireFile(p.projectState,"Project revision state");
  const state=validateState(await readJson(p.projectState));
  if(state.requestHash!==await capturedRequestHash(root))throw new Error("Project state belongs to a different request or the request was modified.");
  const canonical=project??await readJson<VideoProject>(p.video);
  if(state.projectHash!==videoProjectHash(canonical))throw new Error("Canonical video.json changed outside the revision workflow.");
  return state;
}

export async function advanceProjectState(root:string,current:VideoProject,next:VideoProject):Promise<ProjectState>{
  const p=harnessPaths(root),state=await loadProjectState(root,current);
  const updated:ProjectState={...state,revision:state.revision+1,projectHash:videoProjectHash(next)};
  await writeJson(p.projectState,updated);return updated;
}

