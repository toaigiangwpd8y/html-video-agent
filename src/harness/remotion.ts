import {execFile,spawn} from "node:child_process";
import ts from "typescript";
import {createServer} from "node:net";
import {copyFile,mkdir,readdir,readFile,rm,writeFile} from "node:fs/promises";
import {dirname,join,relative,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {readJson,writeJson,writeText} from "../core/io.js";
import {sha256,sha256Hex} from "../core/hash.js";
import type {VideoProject} from "../core/types.js";
import {cleanDir,exists,requireFile} from "./fs.js";
import {harnessPaths} from "./paths.js";
import {preserveRemotionWorkspace} from "./canonical-promotion.js";
import {stopLocalPlayer} from "./local-player.js";
import {loadProjectState,videoProjectHash} from "./project-state.js";
import type {AssetManifest,CommandResult,HarnessManifestReadiness,RemotionImplementationManifest} from "./remotion-manifest.js";
import {validateHarnessManifest} from "./remotion-manifest.js";
import {generatedHash,plannedBoundaryEvidence,validateBoundaryEvidence,type RemotionBoundaryEvidence} from "./remotion-evidence.js";
import {validateRemotionTimeline,type RemotionTimelineEvidence} from "./remotion-timeline.js";
import {loadProductionProfile,productionProfileHash,type ProductionProfile} from "./production-profile.js";
import {assertStoryboardApproved} from "./preproduction-hitl.js";
import {assertProductionAssetPreflightApproved} from "./production-preflight-hitl.js";
import {snapshotApprovedAssets} from "./hyperframes-project.js";
import {deriveTheme,renderFontsModule,renderMotionModule,renderThemeModule,themeFontBindingWarning,type ThemeWarning} from "./theme.js";
import {readPinnedRemotionVersion} from "./remotion-version.js";
import {assertApprovedNarrationBindings} from "./narration-bindings.js";
import {assertCheckpointCurrent,markCheckpointReapproved,withHostApprovalLock} from "./reopen.js";
import {assertReconciliationCurrent} from "./reconciliation.js";

export interface RemotionInstructionHashes {remotionHandoff:string;remotionSkill:string;editorialMotion?:string;rendererGuidance:string;}
export interface RemotionVisualApproval {status:"approved";approvedBy:"HUMAN";sourceHash:string;approvedAt:string;}
export interface RemotionRendererState {version:"1";renderer:"remotion";phase:"AUTHORING"|"VISUAL_REVIEW"|"RENDERED"|"FINALIZED";projectId:string;revision:number;projectHash:string;productionProfileHash:string;assetManifestHash:string;sourceHash?:string;previewUrl?:string;previewPid?:number;visualApproval?:RemotionVisualApproval;updatedAt:string;}

function run(cwd:string,args:string[],timeout?:number):Promise<CommandResult>{
  const command=`npm ${args.join(" ")}`;
  const file=process.platform==="win32"?(process.env.ComSpec||"cmd.exe"):"npm";
  const finalArgs=process.platform==="win32"?["/d","/s","/c","npm",...args]:args;
  return new Promise(done=>execFile(file,finalArgs,{cwd,timeout,maxBuffer:4_000_000},(error:any,stdout:string,stderr:string)=>done({ok:!error,command,exitCode:typeof error?.code==="number"?error.code:error?1:0,stdout:stdout??"",stderr:stderr??error?.message??""})));
}
export async function readRemotionState(root:string):Promise<RemotionRendererState>{const path=harnessPaths(root).remotionRendererState;await requireFile(path,"Remotion renderer state");const state=await readJson<RemotionRendererState>(path);if(state.version!=="1"||state.renderer!=="remotion"||!["AUTHORING","VISUAL_REVIEW","RENDERED","FINALIZED"].includes(state.phase)||!state.projectId||!state.projectHash||!state.productionProfileHash||!state.assetManifestHash)throw new Error("Remotion renderer state is invalid or predates the immutable-input contract. Preserve its workspace, then prepare a fresh renderer revision.");return state;}
async function writeRemotionState(root:string,state:RemotionRendererState):Promise<void>{await writeJson(harnessPaths(root).remotionRendererState,{...state,updatedAt:new Date().toISOString()});}
async function availablePort():Promise<number>{return await new Promise((resolvePort,reject)=>{const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const address=server.address();if(!address||typeof address==="string"){server.close();reject(new Error("Could not allocate a local Remotion Studio port."));return;}const port=address.port;server.close(error=>error?reject(error):resolvePort(port));});});}
async function openLocalUrl(url:string):Promise<void>{const command=process.platform==="darwin"?"open":process.platform==="win32"?"cmd.exe":"xdg-open",args=process.platform==="win32"?["/d","/s","/c","start","",url]:[url];await new Promise<void>((resolveOpen,reject)=>execFile(command,args,{timeout:10_000},error=>error?reject(error):resolveOpen()));}
async function waitForRemotionStudio(url:string,child:{exitCode:number|null;signalCode:string|null},timeoutMs=30_000):Promise<void>{const until=Date.now()+timeoutMs;while(Date.now()<until){if(child.exitCode!==null||child.signalCode!==null)throw new Error("Remotion Studio exited before its local preview became ready.");try{const response=await fetch(url,{signal:AbortSignal.timeout(1_500)});if(response.ok)return;}catch{}await new Promise(resolveWait=>setTimeout(resolveWait,250));}throw new Error("Remotion Studio did not become ready on its local preview port.");}
/** Stops the local Remotion Studio child process recorded by the renderer state. */
export function stopRemotionStudio(state:Partial<RemotionRendererState>|undefined):void{stopLocalPlayer(state);}

/** Runs a bounded Remotion check and refreshes boundary still evidence. */
export async function checkRemotion(root=process.cwd(),timeout?:number):Promise<{typecheck:CommandResult;evidence:{index:string;boundaries:number;images:string[]};sourceHash:string}>{
  const p=harnessPaths(root),state=await readRemotionState(root);if(state.phase!=="AUTHORING"&&state.phase!=="VISUAL_REVIEW")throw new Error("Remotion project is not in an authoring or review phase.");
  await assertRemotionInputsFresh(root,state);
  const typecheck=await typecheckRemotion(root,timeout);if(!typecheck.ok)throw failure("Remotion typecheck",typecheck);
  const evidence=await renderBoundaryEvidence(root,timeout),sourceHash=await generatedHash(p.remotionGenerated);
  return {typecheck,evidence,sourceHash};
}

/** Opens the local Remotion Studio and freezes the exact generated source hash for human review. */
export async function startRemotionVisualReview(root=process.cwd(),timeout?:number):Promise<{url:string;sourceHash:string;approvalRequired:true}>{
  const p=harnessPaths(root),state=await readRemotionState(root);if(state.phase!=="AUTHORING"&&state.phase!=="VISUAL_REVIEW")throw new Error("Remotion project is not ready for visual review.");
  await checkRemotion(root,timeout);stopRemotionStudio(state);const sourceHash=await generatedHash(p.remotionGenerated),port=await availablePort(),url=`http://127.0.0.1:${port}`;
  const cli=resolve(p.remotion,"node_modules/@remotion/cli/remotion-cli.js"),preload=pathToFileURL(resolve(p.remotion,"scripts/loopback-only.mjs")).href;
  await requireFile(cli,"Pinned Remotion CLI entrypoint");
  const nodeOptions=[process.env.NODE_OPTIONS,`--import=${preload}`].filter(Boolean).join(" ");
  const child=spawn(process.execPath,[cli,"studio","index.ts","--port",String(port),"--no-open"],{cwd:p.remotion,stdio:"ignore",env:{...process.env,NODE_OPTIONS:nodeOptions},detached:process.platform!=="win32",windowsHide:true});child.unref();
  try{await waitForRemotionStudio(url,child);await openLocalUrl(url);}catch(error){child.kill("SIGTERM");await writeRemotionState(root,{...state,phase:"AUTHORING",previewUrl:undefined,previewPid:undefined,sourceHash:undefined,visualApproval:undefined});throw new Error(`Remotion Studio launch failed: ${error instanceof Error?error.message:String(error)}`);}
  await writeRemotionState(root,{...state,phase:"VISUAL_REVIEW",sourceHash,previewUrl:url,previewPid:child.pid,visualApproval:undefined});
  return {url,sourceHash,approvalRequired:true};
}

/** Records host-authorized approval for the current Remotion source hash. */
async function approveRemotionVisualReviewLocked(root=process.cwd()):Promise<{approved:true;sourceHash:string;approvedAt:string}>{
  await assertReconciliationCurrent(root);
  const p=harnessPaths(root),state=await readRemotionState(root);if(state.phase!=="VISUAL_REVIEW"||!state.sourceHash)throw new Error("Remotion visual review is not ready for approval.");
  const sourceHash=await generatedHash(p.remotionGenerated);if(sourceHash!==state.sourceHash)throw new Error("Remotion source changed after review. Re-run renderer check and review before approval.");
  const approvedAt=new Date().toISOString(),visualApproval:RemotionVisualApproval={status:"approved",approvedBy:"HUMAN",sourceHash,approvedAt};await writeRemotionState(root,{...state,visualApproval});await markCheckpointReapproved(root,"VISUAL_REVIEW");return {approved:true,sourceHash,approvedAt};
}
export async function approveRemotionVisualReview(root=process.cwd()){return withHostApprovalLock(root,()=>approveRemotionVisualReviewLocked(root));}

/** Exposes the Remotion visual-review checkpoint to the universal HITL host. */
export async function remotionHitlStatus(root=process.cwd()):Promise<{status:"WORKING"|"REVIEW_REQUIRED"|"READY";phase:string;checkpoint?:"VISUAL_REVIEW";payload?:unknown;message:string}|undefined>{
  const p=harnessPaths(root);if(!(await exists(p.remotionRendererState)))return undefined;
  try{const state=await readRemotionState(root);if(state.phase==="AUTHORING")return {status:"WORKING",phase:"renderer_authoring",payload:{renderer:"remotion",generatedDir:relative(root,p.remotionGenerated)},message:"Remotion source is being authored; run renderer check and open Remotion Studio when ready."};if(state.phase==="RENDERED")return {status:"READY",phase:"renderer_rendered",payload:{renderer:"remotion",finalVideo:p.finalVideo},message:"The approved Remotion output is ready for finalization."};if(state.phase==="FINALIZED")return {status:"READY",phase:"renderer_finalized",payload:{renderer:"remotion",finalVideo:p.finalVideo},message:"The approved Remotion MP4 and evidence are finalized."};const sourceHash=await generatedHash(p.remotionGenerated);if(sourceHash!==state.sourceHash)return {status:"REVIEW_REQUIRED",phase:"renderer_source_changed",checkpoint:"VISUAL_REVIEW",payload:{renderer:"remotion",previewUrl:state.previewUrl,sourceHash,reviewedSourceHash:state.sourceHash,approvalInvalidated:true},message:"Remotion source changed after visual review. Re-run check and review, then ask the host to approve the new source hash."};if(state.visualApproval?.status==="approved"&&state.visualApproval.approvedBy==="HUMAN"&&state.visualApproval.sourceHash===sourceHash)return {status:"READY",phase:"visual_review_approved",payload:{renderer:"remotion",sourceHash,approvedAt:state.visualApproval.approvedAt},message:"Human visual review is approved for the current Remotion source."};return {status:"REVIEW_REQUIRED",phase:"needs_visual_review",checkpoint:"VISUAL_REVIEW",payload:{renderer:"remotion",previewUrl:state.previewUrl,sourceHash},message:"Remotion Studio is open for human review. Approve this exact source through the host checkpoint."};}catch(error){return {status:"REVIEW_REQUIRED",phase:"invalid_renderer_review",checkpoint:"VISUAL_REVIEW",payload:{renderer:"remotion",error:error instanceof Error?error.message:String(error)},message:"Remotion renderer state is invalid; inspect it before approval or rendering."};}
}
async function listFiles(root:string):Promise<string[]>{if(!(await exists(root)))return[];const out:string[]=[];async function walk(dir:string){for(const e of await readdir(dir,{withFileTypes:true})){const f=join(dir,e.name);if(e.isDirectory())await walk(f);else if(e.isFile())out.push(f);}}await walk(root);return out;}
export async function countRuleFiles(root:string):Promise<number>{return (await listFiles(root)).filter(p=>p.endsWith(".md")&&!p.endsWith("SKILL.md")&&!p.endsWith("SOURCE.md")).length;}
const CURRENT_OFFICIAL_SKILL_NAMES=["3d","mediabunny","remotion","remotion-best-practices","remotion-captions","remotion-create","remotion-docs","remotion-interactivity","remotion-maps","remotion-markup","remotion-multimedia","remotion-render","remotion-saas","remotion-studio","remotion-upgrade"];
function isOfficialSkillsSource(value:unknown):boolean{if(typeof value!=="string")return false;const normalized=value.replace(/\.git$/i,"").replace(/\/$/,"");return normalized==="remotion-dev/skills"||normalized.endsWith("/remotion-dev/skills");}
async function officialSkillNames(root:string):Promise<string[]>{
  const names=new Set<string>(["remotion-best-practices"]);
  try{
    const lock=await readJson<{skills?:Record<string,unknown>}>(resolve(root,"skills-lock.json"));
    for(const [name,entry] of Object.entries(lock.skills??{})){
      if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(name)||typeof entry!=="object"||entry===null)continue;
      const record=entry as Record<string,unknown>;
      if(isOfficialSkillsSource(record.source)||isOfficialSkillsSource(record.sourceUrl))names.add(name);
    }
  }catch{}
  if(names.size===1){
    const skillsRoot=resolve(root,".agents/skills");
    if(await exists(skillsRoot))for(const entry of await readdir(skillsRoot,{withFileTypes:true}))if(entry.isDirectory()&&CURRENT_OFFICIAL_SKILL_NAMES.includes(entry.name))names.add(entry.name);
  }
  return [...names].sort();
}
async function officialSkillFiles(root:string):Promise<string[]>{const out:string[]=[];for(const name of await officialSkillNames(root)){const directory=resolve(root,".agents/skills",name);if(!(await exists(resolve(directory,"SKILL.md"))))continue;out.push(...(await listFiles(directory)).filter(path=>path.endsWith(".md")));}return [...new Set(out)].sort();}
export async function countOfficialSkillFiles(root:string):Promise<number>{return (await officialSkillFiles(root)).filter(path=>{const normalized=path.replaceAll("\\","/");return normalized.endsWith("/SKILL.md")&&!normalized.endsWith("/remotion-best-practices/SKILL.md");}).length;}
async function syncProjectAndAssets(root:string,cleanGenerated:boolean,requireProductionAssets=false):Promise<VideoProject>{
  const p=harnessPaths(root);await requireFile(p.video,"Canonical video.json");await requireFile(p.assetManifest,"Asset manifest");
  const project=await readJson<VideoProject>(p.video),assetManifest=await readJson<AssetManifest>(p.assetManifest);await loadProjectState(root,project);
  if(requireProductionAssets)await assertProductionAssetPreflightApproved(root);
  await assertApprovedNarrationBindings(root,project);
  const approvedSnapshot=await snapshotApprovedAssets(root,assetManifest);
  if(cleanGenerated)await cleanDir(p.remotionGenerated);else await mkdir(p.remotionGenerated,{recursive:true});
  await writeJson(p.remotionProject,project);await writeJson(p.remotionAssetManifest,assetManifest);
  await writeText(resolve(p.remotionGenerated,"fonts.ts"),renderFontsModule(project,assetManifest.assets));
  await writeText(resolve(p.remotionGenerated,"theme.ts"),renderThemeModule(project,deriveTheme(project)));
  await writeText(resolve(p.remotionGenerated,"motion.ts"),renderMotionModule(project));
  await materializeRemotionPublicAssets(root,assetManifest,approvedSnapshot.assets);
  return project;
}
async function initializeGeneratedCompositionsForNewProject(root:string):Promise<void>{
  const generated=harnessPaths(root).remotionGenerated,path=resolve(generated,"Compositions.tsx");
  await mkdir(generated,{recursive:true});
  try{await writeFile(path,'import React from "react";\n\nexport const GeneratedCompositions:React.FC=()=> <></>;\n',{encoding:"utf8",flag:"wx"});}
  catch(error){if((error as {code?:string}).code!=="EEXIST")throw error;}
}
async function requireGeneratedCompositionsForExistingProject(root:string):Promise<void>{
  const path=resolve(harnessPaths(root).remotionGenerated,"Compositions.tsx");
  if(!(await exists(path)))throw new Error("Existing Remotion workspace is missing remotion/generated/Compositions.tsx; automatic migration is not supported.");
}
function themeWarnings(project:VideoProject,assetManifest:AssetManifest):ThemeWarning[]{const warnings=deriveTheme(project).warnings,fontWarning=themeFontBindingWarning(project,assetManifest.assets);return fontWarning?[...warnings,fontWarning]:warnings;}
async function clearRendererState(root:string){const p=harnessPaths(root);for(const file of [p.remotionManifest,p.finalManifest,p.boundaryEvidenceIndex,p.remotionRendererState])await rm(file,{force:true});await rm(p.output,{recursive:true,force:true});}

/** Checks copied Remotion media bytes against the approved source registry. */
async function verifyRemotionPublicAssets(root:string,manifest:AssetManifest,snapshot:Map<string,{bytes:Uint8Array;sha256:string}>):Promise<void>{
  const publicRoot=harnessPaths(root).remotionPublicAssets;
  for(const asset of manifest.assets){
    const frozen=snapshot.get(asset.id);if(!frozen)throw new Error(`Approved asset '${asset.id}' is missing from the frozen asset snapshot.`);
    const relativePath=asset.publicPath.slice("/assets/".length),copied=await readFile(resolve(publicRoot,...relativePath.split("/"))),digest=sha256Hex(copied);
    if(digest!==frozen.sha256)throw new Error(`Copied Remotion asset '${asset.id}' differs from the approved source bytes.`);
  }
}

/** Copy only the frozen local asset snapshot into Remotion's public media folder and verify every byte. */
export async function materializeRemotionPublicAssets(root:string,manifest:AssetManifest,snapshot:Map<string,{bytes:Uint8Array;sha256:string}>):Promise<void>{
  const p=harnessPaths(root);await cleanDir(p.remotionPublicAssets);
  for(const asset of manifest.assets){const relativePath=asset.publicPath.slice("/assets/".length),source=resolve(root,"assets",relativePath),destination=resolve(p.remotionPublicAssets,relativePath);await mkdir(dirname(destination),{recursive:true});await copyFile(source,destination);}
  await verifyRemotionPublicAssets(root,manifest,snapshot);
}

/** Rejects canonical, profile, or asset changes after Remotion preparation. */
export async function assertRemotionInputsFresh(root:string,state:RemotionRendererState):Promise<void>{
  const p=harnessPaths(root),project=await readJson<VideoProject>(p.video),projectState=await loadProjectState(root,project);
  if(projectState.projectHash!==state.projectHash||projectState.revision!==state.revision)throw new Error("Canonical video.json changed after Remotion preparation. Re-approve the Storyboard and prepare a new renderer revision.");
  if((await productionProfileHash(root))!==state.productionProfileHash)throw new Error("Production Profile changed after Remotion preparation. Prepare a new renderer revision.");
  const manifest=await readJson<AssetManifest>(p.assetManifest),snapshot=await snapshotApprovedAssets(root,manifest);
  if(snapshot.hash!==state.assetManifestHash)throw new Error("Approved asset registry or source file bytes changed after Remotion preparation. Re-run production preflight and prepare a new renderer revision.");
  await verifyRemotionPublicAssets(root,manifest,snapshot.assets);
}

const instructionHash=sha256;
function rendererGuidanceText(skill:string,path:string):string{
  const heading=/^##\s+Renderer Guidance\s*$/m.exec(skill);
  if(!heading||heading.index===undefined)throw new Error(`Active profile Renderer Guidance is missing or empty in ${path}.`);
  const body=skill.slice(heading.index+heading[0].length).split(/^##\s+/m,1)[0].trim();
  if(!body)throw new Error(`Active profile Renderer Guidance is missing or empty in ${path}.`);
  return body;
}
function validateRendererGuidance(text:string,path:string):void{
  const forbidden=[
    /\b(?:the\s+)?(?:profile|renderer guidance)\b[^.\n]{0,120}\b(?:owns?|controls?|overrides?|redefines?|may\s+replace|can\s+change)\b[^.\n]{0,120}\b(?:semantic|canonical|meaning|copy|narration)\b/i,
    /\b(?:semantic\s+(?:ownership|meaning)|canonical\s+(?:meaning|copy|content))\b[^.\n]{0,120}\b(?:belongs\s+to|is\s+owned\s+by|can\s+be\s+changed\s+by)\b[^.\n]{0,120}\b(?:profile|renderer\s+guidance)\b/i,
  ];
  if(forbidden.some(pattern=>pattern.test(text)))throw new Error(`Renderer Guidance in ${path} attempts to override semantic ownership. The Remotion handoff contract owns semantic preservation.`);
}
export async function loadRemotionInstructions(root:string,profile?:ProductionProfile):Promise<RemotionInstructionHashes>{
  const p=harnessPaths(root),activeProfile=profile??await loadProductionProfile(root);
  const handoffPath=resolve(p.agentVideoSkill,"references/remotion-handoff.md"),contractPath=resolve(p.remotion,"AUTHORING.md");
  await requireFile(handoffPath,"Repository Remotion handoff contract");const handoff=await readFile(handoffPath,"utf8");
  await requireFile(contractPath,"Repository Remotion authoring contract");const official=await readFile(contractPath,"utf8");
  let editorialMotion:string|undefined;
  if(activeProfile.primary.id==="illustrated-explainer"){
    const editorialMotionPath=resolve(p.editorialMotionSkill,"SKILL.md");
    await requireFile(editorialMotionPath,"Illustrated Explainer Editorial Motion helper skill");
    editorialMotion=await readFile(editorialMotionPath,"utf8");
  }
  const officialFiles=await officialSkillFiles(p.root),skillContext=[...new Set([contractPath,...officialFiles])].sort();
  const officialSkillContent=await Promise.all(skillContext.map(async path=>`${relative(p.root,path).replaceAll("\\","/")}\n${await readFile(path,"utf8")}`));
  const guidance:string[]=[];
  for(const skill of activeProfile.skills){
    const skillPath=resolve(root,skill.path);await requireFile(skillPath,`Production profile skill '${skill.id}'`);const markdown=await readFile(skillPath,"utf8");
    const renderer=rendererGuidanceText(markdown,skill.path);validateRendererGuidance(renderer,skill.path);guidance.push(`${skill.id}\n${renderer}`);
  }
  return {remotionHandoff:instructionHash(handoff),remotionSkill:instructionHash(`${official}\n---\n${officialSkillContent.join("\n---\n")}`),...(editorialMotion?{editorialMotion:instructionHash(editorialMotion)}:{}),rendererGuidance:instructionHash(guidance.join("\n---\n"))};
}

export async function prepareRemotion(root=process.cwd()):Promise<{projectId:string;revision:number;projectHash:string;generatedDir:string;phase:string;instructions:RemotionInstructionHashes;editorialMotionSkillPath?:string;productionProfile:{primary:string;supporting:string[];rendererSkillPaths:string[]};theme:{tokens:ReturnType<typeof deriveTheme>["tokens"];cssVars:Record<string,string>;warnings:ThemeWarning[]};generatedThemeFiles:string[]}>{
  const p=harnessPaths(root),existingState=await exists(p.remotionRendererState)?await readRemotionState(root):undefined;
  const hasCompositionExtension=await exists(resolve(p.remotionGenerated,"Compositions.tsx")),hasGeneratedVideo=await exists(resolve(p.remotionGenerated,"Video.tsx"));
  if(existingState||hasGeneratedVideo){
    if(!hasCompositionExtension)await requireGeneratedCompositionsForExistingProject(root);
    throw new Error("A Remotion project already exists for this workspace. Edit its generated source; prepare does not overwrite an authored version.");
  }
  await assertStoryboardApproved(root);const profile=await loadProductionProfile(root),instructions=await loadRemotionInstructions(root,profile),project=await syncProjectAndAssets(root,false,true),state=await loadProjectState(root,project);await initializeGeneratedCompositionsForNewProject(root);
  const assets=await readJson<AssetManifest>(p.assetManifest),assetSnapshot=await snapshotApprovedAssets(root,assets),theme=deriveTheme(project);
  const rendererState:RemotionRendererState={version:"1",renderer:"remotion",phase:"AUTHORING",projectId:state.projectId,revision:state.revision,projectHash:state.projectHash,productionProfileHash:await productionProfileHash(root),assetManifestHash:assetSnapshot.hash,updatedAt:new Date().toISOString()};
  await mkdir(p.output,{recursive:true});await clearRendererState(root);await writeRemotionState(root,rendererState);
  const editorialMotionSkillPath=profile.primary.id==="illustrated-explainer"?relative(root,resolve(p.editorialMotionSkill,"SKILL.md")):undefined;
  return {projectId:state.projectId,revision:state.revision,projectHash:state.projectHash,generatedDir:relative(root,p.remotionGenerated),phase:rendererState.phase,instructions,...(editorialMotionSkillPath?{editorialMotionSkillPath}:{}),theme:{tokens:theme.tokens,cssVars:theme.cssVars,warnings:themeWarnings(project,assets)},generatedThemeFiles:["generated/theme.ts","generated/fonts.ts","generated/motion.ts"],productionProfile:{primary:profile.primary.id,supporting:(profile.supporting??[]).map(x=>x.id),rendererSkillPaths:profile.skills.map(x=>x.path)}};
}

/** Reopens a finalized Remotion delivery for a fresh, hash-bound visual review. */
export async function reviseRemotion(root=process.cwd()):Promise<{projectId:string;revision:number;generatedDir:string;preservedWorkspace:string|null;phase:"AUTHORING"}>{
  const p=harnessPaths(root),state=await readRemotionState(root);
  if(state.phase!=="FINALIZED"&&state.phase!=="RENDERED")throw new Error("Only a rendered or finalized Remotion project can start a new renderer revision.");
  await requireGeneratedCompositionsForExistingProject(root);
  await assertRemotionInputsFresh(root,state);
  const preservedWorkspace=await preserveRemotionWorkspace(root);
  stopRemotionStudio(state);
  await rm(p.remotionManifest,{force:true});
  await rm(p.finalManifest,{force:true});
  await rm(p.boundaryEvidenceIndex,{force:true});
  await rm(p.boundaryEvidenceDir,{recursive:true,force:true});
  await rm(p.finalVideo,{force:true});
  await rm(p.preview,{force:true});
  const nextState:RemotionRendererState={version:"1",renderer:"remotion",phase:"AUTHORING",projectId:state.projectId,revision:state.revision,projectHash:state.projectHash,productionProfileHash:state.productionProfileHash,assetManifestHash:state.assetManifestHash,updatedAt:new Date().toISOString()};
  await writeRemotionState(root,nextState);
  return {projectId:state.projectId,revision:state.revision,generatedDir:relative(root,p.remotionGenerated),preservedWorkspace:preservedWorkspace?relative(root,preservedWorkspace):null,phase:"AUTHORING"};
}
async function runTypecheckPrepared(root:string,timeout?:number):Promise<CommandResult>{return run(harnessPaths(root).remotion,["run","typecheck"],timeout);}
async function runStillPrepared(root:string,project:VideoProject,frame?:number,timeout?:number):Promise<CommandResult>{const p=harnessPaths(root);await mkdir(p.output,{recursive:true});const target=frame??Math.max(0,Math.floor(project.meta.durationsInFrames/2));return run(p.remotion,["run","still","--",`--frame=${target}`],timeout);}
async function runRenderPrepared(root:string,timeout?:number):Promise<CommandResult>{const p=harnessPaths(root);await mkdir(p.output,{recursive:true});return run(p.remotion,["run","render"],timeout);}
export async function typecheckRemotion(root=process.cwd(),timeout?:number):Promise<CommandResult>{await syncProjectAndAssets(root,false,true);return runTypecheckPrepared(root,timeout);}
export async function stillRemotion(root=process.cwd(),frame?:number,timeout?:number):Promise<CommandResult>{const project=await syncProjectAndAssets(root,false,true);return runStillPrepared(root,project,frame,timeout);}
export async function renderRemotion(root=process.cwd(),timeout?:number):Promise<CommandResult>{await assertCheckpointCurrent(root,"VISUAL_REVIEW");const p=harnessPaths(root),state=await readRemotionState(root),retryingDiscardedOutput=state.phase==="RENDERED"&&!(await exists(p.finalVideo));if((state.phase!=="VISUAL_REVIEW"&&!retryingDiscardedOutput)||state.visualApproval?.status!=="approved"||state.visualApproval.approvedBy!=="HUMAN"||!state.sourceHash)throw new Error("Final Remotion rendering requires host-recorded human visual approval.");await assertRemotionInputsFresh(root,state);const project=await syncProjectAndAssets(root,false,true);await assertRemotionInputsFresh(root,state);await validateVoiceOverBinding(project,p.remotionGenerated);const before=await generatedHash(p.remotionGenerated);if(before!==state.visualApproval.sourceHash)throw new Error("Remotion source changed after approval; reopen visual review before rendering.");const result=await runRenderPrepared(root,timeout);if(!result.ok)return result;const after=await generatedHash(p.remotionGenerated);if(after!==before){await rm(p.finalVideo,{force:true});throw new Error("Remotion source changed during rendering; output was discarded.");}await writeRemotionState(root,{...state,phase:"RENDERED"});return result;}

async function generatedSourceText(root:string):Promise<string>{const files=(await listFiles(root)).filter(f=>/\.(tsx?|jsx?)$/.test(f));const chunks:string[]=[];for(const file of files)try{chunks.push(await readFile(file,"utf8"));}catch{}return chunks.join("\n");}
function naturalRateOnly(source:string):boolean{
  const file=ts.createSourceFile("generated.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);if((file as ts.SourceFile&{parseDiagnostics?:readonly ts.Diagnostic[]}).parseDiagnostics?.length)return false;
  const safeNames:Array<{start:number;end:number}>=[];let invalid=false;
  const isRateName=(name:ts.PropertyName|ts.JsxAttributeName):boolean=>ts.isIdentifier(name)&&name.text==="playbackRate"||ts.isStringLiteral(name)&&name.text==="playbackRate"||ts.isComputedPropertyName(name)&&ts.isStringLiteral(name.expression)&&name.expression.text==="playbackRate";
  const isAudioName=(name:ts.JsxTagNameExpression|ts.Expression|undefined):boolean=>Boolean(name&&ts.isIdentifier(name)&&name.text==="Audio");
  const isLiteralOne=(value:ts.Expression|undefined):boolean=>Boolean(value&&ts.isNumericLiteral(value)&&(/^(?:1|1\.0+)$/.test(value.text)));
  const visit=(node:ts.Node):void=>{
    if(ts.isJsxAttribute(node)&&isRateName(node.name)){
      const value=node.initializer,expression=value&&ts.isJsxExpression(value)?value.expression:undefined;
      if(isLiteralOne(expression))safeNames.push({start:node.name.getStart(file),end:node.name.getEnd()});else invalid=true;
    }else if(ts.isJsxSpreadAttribute(node)){
      const owner=node.parent.parent;if((ts.isJsxOpeningElement(owner)||ts.isJsxSelfClosingElement(owner))&&isAudioName(owner.tagName))invalid=true;
    }else if(ts.isPropertyAssignment(node)&&isRateName(node.name)){
      if(isLiteralOne(node.initializer))safeNames.push({start:node.name.getStart(file),end:node.name.getEnd()});else invalid=true;
    }else if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==="createElement"&&isAudioName(node.arguments[0])){
      const props=node.arguments[1];if(props&&props.kind!==ts.SyntaxKind.NullKeyword&&(!ts.isObjectLiteralExpression(props)||props.properties.some(ts.isSpreadAssignment)))invalid=true;
    }
    ts.forEachChild(node,visit);
  };
  visit(file);if(invalid)return false;
  let remaining=source;for(const span of safeNames.sort((a,b)=>b.start-a.start))remaining=remaining.slice(0,span.start)+remaining.slice(span.end);
  return !/\b(?:playbackRate|setPlaybackRate|atempo|timeStretch|time-stretch|pitchShift|preservesPitch|trimBefore|trimAfter|startFrom|endAt)\b/i.test(remaining);
}
export async function validateVoiceOverBinding(project:VideoProject,generatedRoot:string):Promise<void>{const voiced=project.scenes.filter(s=>Boolean(s.audio?.voiceoverText.trim()));if(!voiced.length)return;const source=await generatedSourceText(generatedRoot);const hasAudioImport=/import\s*\{[^}]*\bAudio\b[^}]*\}\s*from\s*["']@remotion\/media["']/.test(source);const hasAudioUse=/<Audio\b|React\.createElement\s*\(\s*Audio\b/.test(source);const hasManifestResolver=/\bresolveScene(?:Voiceover|Asset)\s*\(/.test(source);const hasManifestInput=/asset-manifest|assetManifest/i.test(source);if(!hasAudioImport||!hasAudioUse||!hasManifestResolver||!hasManifestInput||!naturalRateOnly(source))throw new Error(`VideoProject contains narrated audio in ${voiced.map(s=>s.id).join(", ")} but generated Remotion source must play approved manifest audio at natural rate 1.0 without trimming or rate-changing filters.`);}
async function loadValidatedTimeline(root:string,project:VideoProject):Promise<RemotionTimelineEvidence>{const p=harnessPaths(root);await requireFile(p.remotionTimeline,"Resolved Remotion timeline evidence");const result=await validateRemotionTimeline(await readJson(p.remotionTimeline),project,p.remotionGenerated);if(!result.valid||!result.timeline)throw new Error(`Resolved Remotion timeline rejected:\n${result.diagnostics.map(d=>`${d.path} [${d.code}] ${d.message}`).join("\n")}`);return result.timeline;}

export async function renderBoundaryEvidence(root=process.cwd(),timeout?:number):Promise<{index:string;boundaries:number;images:string[]}> {
  const p=harnessPaths(root),state=await readRemotionState(root),project=await syncProjectAndAssets(root,false,true);await assertRemotionInputsFresh(root,state);const timeline=await loadValidatedTimeline(root,project);
  await validateVoiceOverBinding(project,p.remotionGenerated);
  await cleanDir(p.boundaryEvidenceDir);const plan=plannedBoundaryEvidence(timeline,project),entries:RemotionBoundaryEvidence["boundaries"]=[],images:string[]=[];
  const openingResult=await runStillPrepared(root,project,0,timeout);if(!openingResult.ok)throw failure("opening still frame 0",openingResult);const openingName="opening-f00000.png";await copyFile(p.preview,resolve(p.boundaryEvidenceDir,openingName));images.push(relative(root,resolve(p.boundaryEvidenceDir,openingName)));
  for(let i=0;i<plan.length;i++){const item=plan[i],files:string[]=[];for(const frame of item.frames){const result=await runStillPrepared(root,project,frame,timeout);if(!result.ok)throw failure(`boundary still frame ${frame}`,result);const name=`boundary-${String(i+1).padStart(2,"0")}-f${String(frame).padStart(5,"0")}.png`;await copyFile(p.preview,resolve(p.boundaryEvidenceDir,name));files.push(name);images.push(relative(root,resolve(p.boundaryEvidenceDir,name)));}entries.push({fromSceneId:item.fromSceneId,toSceneId:item.toSceneId,frames:item.frames,files});}
  const finalFrame=Math.max(0,timeline.durationInFrames-1),endResult=await runStillPrepared(root,project,finalFrame,timeout);if(!endResult.ok)throw failure(`ending still frame ${finalFrame}`,endResult);const endName=`ending-f${String(finalFrame).padStart(5,"0")}.png`;await copyFile(p.preview,resolve(p.boundaryEvidenceDir,endName));images.push(relative(root,resolve(p.boundaryEvidenceDir,endName)));
  const preview=await runStillPrepared(root,project,undefined,timeout);if(!preview.ok)throw failure("representative still",preview);
  const index:RemotionBoundaryEvidence={version:"1",projectHash:videoProjectHash(project),generatedHash:await generatedHash(p.remotionGenerated),opening:{frame:0,file:openingName},boundaries:entries,ending:{frame:finalFrame,file:endName}};await writeJson(p.boundaryEvidenceIndex,index);return {index:relative(root,p.boundaryEvidenceIndex),boundaries:entries.length,images};
}

async function readiness(root:string,typecheck:CommandResult,still:CommandResult,render:CommandResult):Promise<HarnessManifestReadiness>{const p=harnessPaths(root);let assets:AssetManifest={version:"1",assets:[]};try{assets=await readJson<AssetManifest>(p.assetManifest);}catch{}const generated=(await listFiles(p.remotionGenerated)).filter(f=>!f.endsWith("project.json")&&!f.endsWith("asset-manifest.json")&&!f.endsWith(".gitkeep"));return {projectAvailable:await exists(p.video),skillAvailable:await exists(resolve(p.remotion,"AUTHORING.md")),assetManifestAvailable:await exists(p.assetManifest),ruleFilesAvailable:await exists(resolve(p.agentVideoSkill,"references/remotion-handoff.md"))?1:0,officialSkillFilesAvailable:await countOfficialSkillFiles(p.root),generatedFilesAvailable:generated.length,typecheckPassed:typecheck.ok,stillPassed:still.ok,renderPassed:render.ok,availableAssetPaths:Array.isArray(assets.assets)?assets.assets.map(a=>a.publicPath).filter(Boolean):[],availableAssets:assets.assets,remotionRoot:p.remotion};}
function failure(stage:string,result:CommandResult):Error{return new Error(`${stage} failed (exit ${result.exitCode}).\n${result.stderr||result.stdout}`);}

/** Reads final MP4 stream metadata through the configured local ffprobe binary. */
async function probeFinalRemotionVideo(root:string,path:string):Promise<Record<string,unknown>>{
  const executable=process.env.FFPROBE_PATH||"ffprobe",args=["-v","error","-show_entries","format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration","-of","json",path];
  const stdout=await new Promise<string>((resolveOutput,reject)=>execFile(executable,args,{cwd:root,env:process.env,timeout:60_000,maxBuffer:4_000_000},(error,result,stderr)=>error?reject(new Error(`ffprobe failed: ${stderr||error.message}`)):resolveOutput(result??"")));
  let parsed:unknown;try{parsed=JSON.parse(stdout);}catch{throw new Error("ffprobe did not return JSON metadata for output/final.mp4.");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("ffprobe returned an unsupported metadata schema.");
  return parsed as Record<string,unknown>;
}

/** Checks Remotion MP4 dimensions, frame rate, duration, and narration audio. */
function validateRemotionProbe(probe:Record<string,unknown>,project:VideoProject,durationSeconds:number):string[]{
  const errors:string[]=[],format=probe.format as Record<string,unknown>|undefined,streams=Array.isArray(probe.streams)?probe.streams as Array<Record<string,unknown>>:[],video=streams.find(stream=>stream.codec_type==="video"),audio=streams.some(stream=>stream.codec_type==="audio");
  if(!video)errors.push("Final MP4 has no video stream.");
  if(video&&Number(video.width)!==project.meta.width)errors.push(`Final MP4 width ${String(video.width)} does not match ${project.meta.width}.`);
  if(video&&Number(video.height)!==project.meta.height)errors.push(`Final MP4 height ${String(video.height)} does not match ${project.meta.height}.`);
  const fpsText=String(video?.avg_frame_rate??video?.r_frame_rate??"0/1"),[fpsNumerator,fpsDenominator]=fpsText.split("/").map(Number),actualFps=fpsDenominator?fpsNumerator/fpsDenominator:Number.NaN;
  if(!Number.isFinite(actualFps)||Math.abs(actualFps-project.meta.fps)>0.001)errors.push(`Final MP4 frame rate '${fpsText}' does not match ${project.meta.fps}.`);
  const durationTolerance=1/project.meta.fps+0.02,videoDuration=Number(video?.duration),frameCount=Number(video?.nb_frames),containerDuration=Number(format?.duration);
  if(video&&Number.isFinite(frameCount)&&frameCount!==project.meta.durationsInFrames)errors.push(`Final MP4 contains ${frameCount} video frames; expected ${project.meta.durationsInFrames}.`);
  if(!Number.isFinite(videoDuration)||Math.abs(videoDuration-durationSeconds)>durationTolerance)errors.push(`Final MP4 video duration ${String(video?.duration)} does not match ${durationSeconds}s.`);
  // Container duration can include codec padding; enforce exact video timing and cap padding at 100 ms.
  if(!Number.isFinite(containerDuration)||!Number.isFinite(videoDuration)||containerDuration+durationTolerance<videoDuration||containerDuration-videoDuration>0.1)errors.push(`Final MP4 container duration ${String(format?.duration)} is inconsistent with video duration ${String(video?.duration)}.`);
  if(project.scenes.some(scene=>Boolean(scene.audio?.voiceoverText.trim()))&&!audio)errors.push("Approved narration exists but the final MP4 has no audio stream.");
  return errors;
}

export async function finalizeRemotion(root=process.cwd(),candidatePath?:string,frame?:number,timeout?:number):Promise<{manifest:RemotionImplementationManifest;preview:string;video:string;boundaryEvidence:string;commands:CommandResult[]}> {
  await assertCheckpointCurrent(root,"VISUAL_REVIEW");
  const p=harnessPaths(root),candidate=resolve(root,candidatePath??relative(root,p.candidateManifest)),rendererState=await readRemotionState(root),remotionVersion=await readPinnedRemotionVersion(p.remotion);
  if(rendererState.phase!=="RENDERED"||rendererState.visualApproval?.status!=="approved"||rendererState.visualApproval.approvedBy!=="HUMAN")throw new Error("Remotion render must complete after host approval before finalization.");
  await assertRemotionInputsFresh(root,rendererState);await requireFile(candidate,"Implementation manifest candidate");const project=await syncProjectAndAssets(root,false,true);await assertRemotionInputsFresh(root,rendererState);await rm(p.remotionManifest,{force:true});
  const timeline=await loadValidatedTimeline(root,project);await validateVoiceOverBinding(project,p.remotionGenerated);const evidenceErrors=await validateBoundaryEvidence(p.boundaryEvidenceIndex,p.boundaryEvidenceDir,p.remotionGenerated,project,timeline);if(evidenceErrors.length)throw new Error(`Rendered boundary evidence is missing or stale:\n${evidenceErrors.map(x=>`- ${x}`).join("\n")}`);
  const currentHash=await generatedHash(p.remotionGenerated);if(currentHash!==rendererState.visualApproval.sourceHash)throw new Error("Remotion source changed after final rendering; repeat review and rendering.");
  const typecheck=await runTypecheckPrepared(root,timeout);if(!typecheck.ok)throw failure("Remotion typecheck",typecheck);const still=await runStillPrepared(root,project,frame,timeout);if(!still.ok)throw failure("Representative still",still);await requireFile(p.finalVideo,"Rendered Remotion MP4");const render:CommandResult={ok:true,command:"Previously completed approved Remotion render",exitCode:0,stdout:"",stderr:""};
  const afterEvidenceErrors=await validateBoundaryEvidence(p.boundaryEvidenceIndex,p.boundaryEvidenceDir,p.remotionGenerated,project,timeline);if(afterEvidenceErrors.length)throw new Error(`Generated source changed after boundary QA:\n${afterEvidenceErrors.map(x=>`- ${x}`).join("\n")}`);
  const readinessState=await readiness(root,typecheck,still,render),validation=await validateHarnessManifest(await readJson(candidate),project,readinessState);if(!validation.valid||!validation.manifest)throw new Error(`Implementation manifest rejected:\n${validation.diagnostics.map(d=>`${d.path} [${d.code}] ${d.message}`).join("\n")}`);
  const probe=await probeFinalRemotionVideo(root,p.finalVideo),probeErrors=validateRemotionProbe(probe,project,timeline.durationInFrames/project.meta.fps);
  if(probeErrors.length){await rm(p.finalVideo,{force:true});throw new Error(`Final MP4 metadata failed validation:\n${probeErrors.map(error=>`- ${error}`).join("\n")}\nOutput was discarded.`);}
  const evidence=await readJson<RemotionBoundaryEvidence>(p.boundaryEvidenceIndex),digest=sha256(await readFile(p.finalVideo)),candidateManifest=validation.manifest;
  const manifest:RemotionImplementationManifest={...candidateManifest,renderer:"remotion",rendererVersion:remotionVersion,projectId:rendererState.projectId,revision:rendererState.revision,productionProfileHash:rendererState.productionProfileHash,assetManifestHash:rendererState.assetManifestHash,sourceHash:currentHash,width:project.meta.width,height:project.meta.height,fps:project.meta.fps,durationInFrames:timeline.durationInFrames,durationSeconds:timeline.durationInFrames/project.meta.fps,visualApproval:rendererState.visualApproval,check:{command:typecheck.command,passed:true},evidence:{index:relative(root,p.boundaryEvidenceIndex).replaceAll("\\","/"),files:[evidence.opening.file,...evidence.boundaries.flatMap(boundary=>boundary.files),evidence.ending.file].map(file=>relative(root,resolve(p.boundaryEvidenceDir,file)).replaceAll("\\","/"))},output:{file:relative(root,p.finalVideo).replaceAll("\\","/"),sha256:digest,probe}};
  await writeJson(p.remotionManifest,manifest);await writeRemotionState(root,{...rendererState,phase:"FINALIZED"});stopRemotionStudio(rendererState);return {manifest,preview:relative(root,p.preview),video:relative(root,p.finalVideo),boundaryEvidence:relative(root,p.boundaryEvidenceIndex),commands:[typecheck,still,render]};
}
