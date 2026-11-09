import {cp,mkdir,rm} from "node:fs/promises";
import {resolve,relative} from "node:path";
import {semanticPreflight} from "../authoring/preflight.js";
import {validateProject} from "../authoring/validator.js";
import {readJson,writeJson} from "../core/io.js";
import type {AuthorPreflightReport,ValidationReport,VideoProject} from "../core/types.js";
import {exists,requireFile} from "./fs.js";
import {harnessPaths} from "./paths.js";
import {stopLocalPlayer} from "./local-player.js";
import {createProjectState,loadProjectState,videoProjectHash,type ProjectState} from "./project-state.js";

export interface CanonicalPromotionResult {
  project:string;
  revision:number;
  projectHash:string;
  validation:ValidationReport;
  preflight:AuthorPreflightReport;
  rendererDerivedStateInvalidated:boolean;
}

export async function persistRevision(root:string,project:VideoProject,state:ProjectState):Promise<void>{
  const p=harnessPaths(root);await mkdir(p.revisions,{recursive:true});await writeJson(resolve(p.revisions,`video-r${state.revision}.json`),project);
}

export async function rollbackCanonicalPromotion(root:string):Promise<void>{
  const p=harnessPaths(root);await rm(p.video,{force:true});await rm(p.projectState,{force:true});await rm(resolve(p.revisions,"video-r1.json"),{force:true});await rm(p.preflight,{force:true});
}

export async function preserveRemotionWorkspace(root:string):Promise<string|null>{
  const p=harnessPaths(root);if(!(await exists(p.remotionRendererState)))return null;
  let label=`unbound-${Date.now()}`;
  try{const state=await readJson<{projectId?:string;revision?:number}>(p.remotionRendererState);if(state.projectId&&Number.isInteger(state.revision))label=`${state.projectId}-r${state.revision}`;}catch{}
  await mkdir(p.remotionProjects,{recursive:true});let target=resolve(p.remotionProjects,label),index=2;
  while(await exists(target))target=resolve(p.remotionProjects,`${label}-${index++}`);
  await mkdir(target,{recursive:true});
  if(await exists(p.remotionGenerated))await cp(p.remotionGenerated,resolve(target,"generated"),{recursive:true});
  if(await exists(p.remotionPublicAssets))await cp(p.remotionPublicAssets,resolve(target,"public-assets"),{recursive:true});
  if(await exists(p.finalVideo))await cp(p.finalVideo,resolve(target,"final.mp4"));
  for(const[source,name]of [[p.remotionRendererState,"renderer-state.json"],[p.remotionManifest,"implementation-manifest.json"],[p.boundaryEvidenceIndex,"boundary-evidence.json"]] as const)if(await exists(source))await cp(source,resolve(target,name));
  if(await exists(p.boundaryEvidenceDir))await cp(p.boundaryEvidenceDir,resolve(target,"evidence"),{recursive:true});
  return target;
}

export async function invalidateProjectDerived(root:string):Promise<void>{
  const p=harnessPaths(root);
  try{stopLocalPlayer(await readJson<{previewPid?:number}>(p.rendererState));}catch{}
  try{stopLocalPlayer(await readJson<{previewPid?:number}>(p.remotionRendererState));}catch{}
  await preserveRemotionWorkspace(root);
  for(const file of [p.manifest,p.remotionManifest,p.finalManifest,p.boundaryEvidenceIndex,p.productionPreflight,p.rendererState,p.remotionRendererState])await rm(file,{force:true});
  await rm(p.remotionGenerated,{recursive:true,force:true});
  await rm(p.remotionPublicAssets,{recursive:true,force:true});
  await writeJson(p.assetManifest,{version:"1",assets:[]});
  await rm(p.output,{recursive:true,force:true});
}

export async function validateCanonicalProject(root:string,project:VideoProject):Promise<{validation:ValidationReport;preflight:AuthorPreflightReport;valid:boolean}>{
  const validation=await validateProject(project),preflight=(await semanticPreflight(project)).report;return {validation,preflight,valid:validation.valid&&preflight.valid};
}

export async function promoteCanonicalProject(root:string,project:VideoProject):Promise<CanonicalPromotionResult>{
  const p=harnessPaths(root),revisionPath=resolve(p.revisions,"video-r1.json");await requireFile(p.request,"Captured user request");
  if(await exists(p.video))throw new Error("Canonical video.json already exists. Use `video project patch` for revisions.");
  for(const [path,label] of [[p.projectState,"project state"],[p.preflight,"preflight report"],[revisionPath,"revision 1"]] as const)if(await exists(path))throw new Error(`Canonical promotion target already exists: ${label}. Run \`video init\` to start a new request.`);
  const {validation,preflight,valid}=await validateCanonicalProject(root,project);
  if(!valid)throw new Error(`Canonical project validation failed; promotion was not performed. ${JSON.stringify({validation,preflight})}`);
  await invalidateProjectDerived(root);
  let state:ProjectState;
  try{await writeJson(p.video,project);state=await createProjectState(root,project);await persistRevision(root,project,state);await writeJson(p.preflight,preflight);}catch(error){await rollbackCanonicalPromotion(root);throw error;}
  return {project:relative(root,p.video).replaceAll("\\","/"),revision:state.revision,projectHash:state.projectHash,validation,preflight,rendererDerivedStateInvalidated:true};
}

/** Promotes a re-approved Storyboard as the next canonical revision without replacing revision 1. */
export async function promoteCanonicalRevision(root:string,project:VideoProject):Promise<CanonicalPromotionResult>{
  const p=harnessPaths(root),current=await readJson<VideoProject>(p.video),currentState=await loadProjectState(root,current),{validation,preflight,valid}=await validateCanonicalProject(root,project);
  if(!valid)throw new Error(`Canonical revision validation failed; promotion was not performed. ${JSON.stringify({validation,preflight})}`);
  const revision=currentState.revision+1,revisionPath=resolve(p.revisions,`video-r${revision}.json`);
  if(await exists(revisionPath))throw new Error(`Canonical revision target already exists: ${revisionPath}`);
  const priorState=await readJson(p.projectState),priorPreflight=await exists(p.preflight)?await readJson(p.preflight):undefined;
  const deliveryArchive=resolve(p.revisions,"deliveries",`final-r${currentState.revision}.mp4`);
  try{
    let carry: {projectDir?:string;projectId?:string;revision?:number}|undefined;
    if(await exists(p.rendererState))carry=await readJson(p.rendererState);
    else if(await exists(p.rendererCarryForward)){try{const prior=await readJson<{version?:string;renderer?:string;projectDir?:string;projectId?:string;revision?:number}>(p.rendererCarryForward);if(prior.version==="1"&&prior.renderer==="hyperframes")carry=prior;}catch{}}
    if(carry?.projectDir&&carry.projectId===currentState.projectId&&carry.revision===currentState.revision)await writeJson(p.rendererCarryForward,{version:"1",renderer:"hyperframes",projectDir:carry.projectDir,projectId:carry.projectId,revision:carry.revision});
    if(await exists(p.finalVideo)){await mkdir(resolve(p.revisions,"deliveries"),{recursive:true});await cp(p.finalVideo,deliveryArchive);}
    await stopLocalPlayer((await exists(p.rendererState)?await readJson<{previewPid?:number}>(p.rendererState):{}) as {previewPid?:number});
    await stopLocalPlayer((await exists(p.remotionRendererState)?await readJson<{previewPid?:number}>(p.remotionRendererState):{}) as {previewPid?:number});
    await preserveRemotionWorkspace(root);
    for(const path of [p.manifest,p.remotionManifest,p.finalManifest,p.boundaryEvidenceIndex,p.productionPreflight,p.productionPreflightState,p.productionPreflightApproval,p.rendererState,p.remotionRendererState])await rm(path,{force:true});
    const state:ProjectState={...currentState,revision,projectHash:videoProjectHash(project)};
    await writeJson(p.video,project);await writeJson(p.projectState,state);await persistRevision(root,project,state);await writeJson(p.preflight,preflight);
    return {project:relative(root,p.video).replaceAll("\\","/"),revision,projectHash:state.projectHash,validation,preflight,rendererDerivedStateInvalidated:true};
  }catch(error){
    await writeJson(p.video,current);await writeJson(p.projectState,priorState);await rm(revisionPath,{force:true});
    if(priorPreflight!==undefined)await writeJson(p.preflight,priorPreflight);else await rm(p.preflight,{force:true});
    throw error;
  }
}
