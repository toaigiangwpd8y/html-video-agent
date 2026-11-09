import {createHash,randomUUID} from "node:crypto";
import {execFile,spawn} from "node:child_process";
import {createServer} from "node:net";
import {copyFile,cp,mkdir,readFile,readdir,realpath,rename,rm,stat,writeFile} from "node:fs/promises";
import {basename,relative,resolve,sep} from "node:path";
import {promisify} from "node:util";
import {readJson,writeJson} from "../core/io.js";
import {sha256} from "../core/hash.js";
import {normalizeHyperFramesReport} from "../lint/hyperframes.js";
import {mergeLintReports} from "../lint/merge.js";
import {runLint} from "../lint/registry.js";
import {formatLintSummary} from "../lint/report.js";
import type {LintContext,LintReport} from "../lint/types.js";
import type {VideoProject} from "../core/types.js";
import {exists,requireFile} from "./fs.js";
import {harnessPaths} from "./paths.js";
import {assertProductionAssetPreflightApproved} from "./production-preflight-hitl.js";
import {stopLocalPlayer} from "./local-player.js";
import {loadProjectState,videoProjectHash} from "./project-state.js";
import {assertStoryboardApproved} from "./preproduction-hitl.js";
import {productionProfileHash,loadProductionProfile} from "./production-profile.js";
import type {AssetManifest} from "./assets.js";
import {createHyperFramesProject,ensureHyperFramesNativeAudio,resolveHyperFramesAudioClips,snapshotApprovedAssets,validateCanonicalText,type HyperFramesProjectManifest} from "./hyperframes-project.js";
import {runHyperFramesLayoutProbe} from "./hyperframes-lint.js";
import {cliEntrypoint,cliEnvironment,findAvailablePort,waitForLocalStudio} from "./hyperframes-preview.js";
import {frameToSeconds,plannedHyperFramesBoundaries,resolveHyperFramesTimeline} from "./hyperframes-timeline.js";
import {assertApprovedNarrationBindings} from "./narration-bindings.js";
import {assertCheckpointCurrent,markCheckpointReapproved,withHostApprovalLock} from "./reopen.js";
import {assertReconciliationCurrent} from "./reconciliation.js";
import {archiveCurrentVideo} from "./archive.js";

const execFileAsync=promisify(execFile);
const RENDERER_VERSION="0.8.50" as const;

export type HyperFramesPhase="AUTHORING"|"VISUAL_REVIEW"|"RENDERED"|"FINALIZED";
export interface RendererApproval {status:"approved";approvedBy:"HUMAN";sourceHash:string;approvedAt:string;}
export interface HyperFramesState {
  version:"1";
  phase:HyperFramesPhase;
  projectId:string;
  revision:number;
  projectHash:string;
  productionProfileHash:string;
  assetManifestHash:string;
  projectDir:string;
  sourceHash?:string;
  previewUrl?:string;
  previewPid?:number;
  previewPort?:number;
  visualApproval?:RendererApproval;
  renderedHash?:string;
  evidencePath?:string;
  updatedAt:string;
}

export interface HyperFramesCommandResult {ok:boolean;command:string;exitCode:number;stdout:string;stderr:string;}
export interface HyperFramesImplementationManifest {
  version:"2";renderer:"hyperframes";rendererVersion:"0.8.50";renderMode:"native-mp4";projectId:string;revision:number;
  projectHash:string;productionProfileHash:string;assetManifestHash:string;sourceHash:string;projectDir:string;
  width:number;height:number;fps:number;durationInFrames:number;durationSeconds:number;
  generatedFiles:string[];sceneBindings:HyperFramesProjectManifest["scenes"];
  visualApproval:RendererApproval;check:{command:string;passed:true};
  evidence:{index:string;files:string[]};output:{file:string;sha256:string;probe:Record<string,unknown>};
}

interface HyperFramesBoundaryEvidence {
  version:"2";renderer:"hyperframes";rendererVersion:"0.8.50";renderMode:"native-mp4";projectHash:string;sourceHash:string;videoSha256:string;
  frames:Array<{frame:number;timeSeconds:number;file:string;kind:"opening"|"boundary"|"ending";sha256:string}>;
  snapshotDirectory:string;checkCommand:string;renderCommand:string;snapshotCommand:string;createdAt:string;
}

/** Runs the exact lockfile-installed CLI without npx or a global binary. */
export async function runHyperFrames(root:string,projectDir:string,args:string[],timeout=300_000):Promise<HyperFramesCommandResult> {
  const entry=cliEntrypoint(root);await requireFile(entry,"Pinned HyperFrames CLI entrypoint");
  const command=`hyperframes ${args.join(" ")}`;
  try {
    const result=await execFileAsync(process.execPath,[entry,...args],{cwd:projectDir,env:cliEnvironment(),timeout,maxBuffer:32_000_000});
    return {ok:true,command,exitCode:0,stdout:result.stdout??"",stderr:result.stderr??""};
  } catch(error) {
    const value=error as {code?:number|string;stdout?:string;stderr?:string;message?:string};
    return {ok:false,command,exitCode:typeof value.code==="number"?value.code:1,stdout:value.stdout??"",stderr:value.stderr??value.message??"HyperFrames command failed."};
  }
}

async function readState(root:string):Promise<HyperFramesState> {
  const p=harnessPaths(root),path=p.rendererState;await requireFile(path,"HyperFrames renderer state");
  const state=await readJson<HyperFramesState>(path);
  if(state.version!=="1"||!(["AUTHORING","VISUAL_REVIEW","RENDERED","FINALIZED"] as string[]).includes(state.phase)||!state.projectDir)throw new Error("HyperFrames renderer state is invalid.");
  const projectDir=resolve(root,state.projectDir),fromRoot=relative(root,projectDir),fromProjects=relative(p.hyperframesProjects,projectDir);
  if(fromRoot===".."||fromRoot.startsWith(`..${sep}`)||fromRoot.startsWith(sep)||fromProjects===".."||fromProjects.startsWith(`..${sep}`)||fromProjects.startsWith(sep))throw new Error("HyperFrames renderer project path is outside hyperframes/projects.");
  const realRoot=await realpath(root),realProject=await realpath(projectDir),realFromRoot=relative(realRoot,realProject);
  if(realFromRoot===".."||realFromRoot.startsWith(`..${sep}`)||realFromRoot.startsWith(sep))throw new Error("HyperFrames renderer project resolves outside the repository.");
  return state;
}

async function readProjectManifest(root:string,state:HyperFramesState):Promise<HyperFramesProjectManifest> {
  const path=resolve(root,state.projectDir,"hyperframes-manifest.json"),manifest=await readJson<HyperFramesProjectManifest>(path);
  if(manifest.version!=="1"||manifest.renderer!=="hyperframes"||manifest.rendererVersion!==RENDERER_VERSION)throw new Error("HyperFrames project manifest version is unsupported.");
  if(manifest.projectId!==state.projectId||manifest.revision!==state.revision||manifest.projectHash!==state.projectHash||manifest.productionProfileHash!==state.productionProfileHash||manifest.assetManifestHash!==state.assetManifestHash)throw new Error("HyperFrames project manifest does not match the frozen renderer state.");
  return manifest;
}

function safeRelativeFile(projectDir:string,file:string):string {
  if(!file||file.includes("\\")||file.startsWith("/")||file.split("/").some((part)=>part===".."||part==="."||!part))throw new Error(`Unsafe renderer source path '${file}'.`);
  const resolved=resolve(projectDir,file),from=relative(projectDir,resolved);
  if(from===".."||from.startsWith(`..${sep}`)||from.startsWith(sep))throw new Error(`Renderer source '${file}' escapes its project directory.`);
  return resolved;
}

/** Lists durable renderer inputs while excluding generated snapshots and preview caches. */
async function rendererSourceFiles(projectDir:string):Promise<string[]> {
  const root=await realpath(projectDir),files:string[]=[];
  async function visit(directory:string,prefix:string):Promise<void>{
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const relativeFile=prefix?`${prefix}/${entry.name}`:entry.name,path=safeRelativeFile(root,relativeFile);
      if(entry.isSymbolicLink())throw new Error(`Renderer source '${relativeFile}' must not be a symbolic link.`);
      if(!prefix&&entry.name==="snapshots"){if(!entry.isDirectory())throw new Error("Renderer snapshots path must be a regular directory.");continue;}
      if(!prefix&&entry.name===".waveform-cache"){if(!entry.isDirectory())throw new Error("Renderer waveform cache path must be a regular directory.");continue;}
      if(!prefix&&entry.name===".thumbnails"){if(!entry.isDirectory())throw new Error("Renderer thumbnail cache path must be a regular directory.");continue;}
      if(entry.name===".DS_Store"||entry.name==="Thumbs.db")continue;
      if(entry.isDirectory())await visit(path,relativeFile);else if(entry.isFile())files.push(relativeFile);
    }
  }
  await visit(root,"");return files.sort();
}

/** Hashes all authored source and local media while excluding generated evidence. */
export async function hyperFramesSourceHash(projectDir:string,_manifest:HyperFramesProjectManifest):Promise<string> {
  const root=await realpath(projectDir),files=await rendererSourceFiles(root),parts:Array<[string,string]> = [];
  for(const file of files){const path=safeRelativeFile(root,file),resolved=await realpath(path),from=relative(root,resolved);if(from===".."||from.startsWith(`..${sep}`)||from.startsWith(sep))throw new Error(`Renderer source '${file}' resolves outside its project.`);const contents=await readFile(resolved);parts.push([file,createHash("sha256").update(contents).digest("hex")]);}
  return sha256(JSON.stringify(parts));
}

async function currentHashes(root:string,state:HyperFramesState,manifest:HyperFramesProjectManifest):Promise<{projectHash:string;profileHash:string;assetManifestHash:string;sourceHash:string}> {
  const p=harnessPaths(root),project=await readJson<VideoProject>(p.video),canonicalHash=videoProjectHash(project),profileHash=await productionProfileHash(root),assetManifest=await readJson<AssetManifest>(p.assetManifest),assetSnapshot=await snapshotApprovedAssets(root,assetManifest),assetManifestHash=assetSnapshot.hash;
  if(canonicalHash!==state.projectHash||manifest.projectHash!==canonicalHash)throw new Error("Canonical video.json changed after this renderer version was created. Run `video renderer prepare` for a new version.");
  if(profileHash!==state.productionProfileHash||manifest.productionProfileHash!==profileHash)throw new Error("Production Profile changed after this renderer version was created. Start a new renderer version.");
  if(assetManifestHash!==state.assetManifestHash||manifest.assetManifestHash!==assetManifestHash)throw new Error("assets/manifest.json changed after this renderer version was created. Return to canonical asset review and prepare a new renderer version.");
  if(manifest.assets.length!==assetManifest.assets.length)throw new Error("Renderer assets do not match the approved assets/manifest.json.");
  const projectDir=resolve(root,state.projectDir);
  for(const asset of assetManifest.assets){
    const frozen=manifest.assets.find((item)=>item.id===asset.id),snapshot=assetSnapshot.assets.get(asset.id);
    const sceneIds=asset.sceneIds??[],role=asset.role??"unspecified";
    if(!frozen||!snapshot||frozen.publicPath!==asset.publicPath||frozen.sha256!==snapshot.sha256||frozen.type!==asset.type||frozen.role!==role||JSON.stringify(frozen.sceneIds)!==JSON.stringify(sceneIds)||frozen.license!==asset.license||frozen.rights!==asset.rights||frozen.permittedUse!==asset.permittedUse||frozen.source!==asset.source||frozen.sourceUrl!==asset.sourceUrl||frozen.provenance!==asset.provenance||frozen.derivedFrom!==asset.derivedFrom||frozen.width!==asset.width||frozen.height!==asset.height||frozen.hasAlpha!==asset.hasAlpha||frozen.notes!==asset.notes)throw new Error(`Renderer asset '${asset.id}' differs from the approved asset manifest.`);
    const copied=await readFile(safeRelativeFile(projectDir,frozen.file)),copiedHash=createHash("sha256").update(copied).digest("hex");
    if(copiedHash!==snapshot.sha256)throw new Error(`Renderer asset '${asset.id}' bytes differ from the approved source asset.`);
  }
  const expectedAudio=resolveHyperFramesAudioClips(project,assetManifest,resolveHyperFramesTimeline(project),manifest.assets);
  if(JSON.stringify(expectedAudio)!==JSON.stringify(manifest.audioClips))throw new Error("Renderer audio timing differs from canonical video.json or assets/manifest.json.");
  return {projectHash:canonicalHash,profileHash,assetManifestHash,sourceHash:await hyperFramesSourceHash(resolve(root,state.projectDir),manifest)};
}

/** Prepares an immutable versioned working tree from the approved storyboard. */
export async function prepareHyperFrames(root=process.cwd()):Promise<{projectDir:string;projectHash:string;revision:number;profileHash:string;instructions:string[]}> {
  const p=harnessPaths(root);await assertStoryboardApproved(root);
  const project=await readJson<VideoProject>(p.video),projectState=await loadProjectState(root,project),profile=await loadProductionProfile(root),profileHash=await productionProfileHash(root);
  const assets=await readJson<AssetManifest>(p.assetManifest),assetManifestHash=(await snapshotApprovedAssets(root,assets)).hash;await assertApprovedNarrationBindings(root,project);
  await assertProductionAssetPreflightApproved(root);
  const active=await exists(p.rendererState)?await readState(root):undefined;
  if(active&&active.projectHash===projectState.projectHash&&active.productionProfileHash===profileHash&&active.assetManifestHash===assetManifestHash)throw new Error("This canonical revision already has a HyperFrames project. Edit it in place; prepare does not overwrite authoring work.");
  let copyForwardFrom:string|undefined;
  let consumedCarryForward=false;
  try{const carry=await readJson<{version:string;renderer:string;projectDir:string;projectId:string;revision:number}>(p.rendererCarryForward);if(carry.version==="1"&&carry.renderer==="hyperframes"&&carry.projectId===projectState.projectId&&carry.revision===projectState.revision-1){copyForwardFrom=resolve(root,carry.projectDir);consumedCarryForward=true;}}catch{}
  const prepared=await createHyperFramesProject({root,project,projectId:projectState.projectId,revision:projectState.revision,productionProfileHash:profileHash,assetManifestHash,assetManifest:assets,...(copyForwardFrom?{copyForwardFrom}:{})});
  stopHyperFramesPlayer(active);
  const state:HyperFramesState={version:"1",phase:"AUTHORING",projectId:projectState.projectId,revision:projectState.revision,projectHash:projectState.projectHash,productionProfileHash:profileHash,assetManifestHash,projectDir:prepared.relativeProjectDir,updatedAt:new Date().toISOString()};
  await writeJson(p.rendererState,state);
  if(consumedCarryForward)await rm(p.rendererCarryForward,{force:true});
  return {projectDir:prepared.relativeProjectDir,projectHash:state.projectHash,revision:state.revision,profileHash,instructions:["Author HTML/CSS only inside the versioned project directory.","Keep every visible text node inside its generated data-canonical-text-id element and preserve its exact video.json text.","Use only local assets listed in assets/manifest.json; no CDN scripts, fonts, catalogs, or remote media.","Do not call prepare again after visual review begins.",`Active profiles: ${profile.primary.id}${profile.supporting?.length?`, ${profile.supporting.map((item)=>item.id).join(", ")}`:""}.`]};
}

/** Copies an immutable HyperFrames source into a fresh renderer revision folder. */
async function cloneHyperFramesRevision(root:string,sourceProjectDir:string):Promise<string>{
  const p=harnessPaths(root),source=resolve(root,sourceProjectDir),base=basename(sourceProjectDir).replace(/-renderer-r\d+$/g,"");await mkdir(p.hyperframesProjects,{recursive:true});
  let index=2,target=resolve(p.hyperframesProjects,`${base}-renderer-r${index}`);while(await exists(target))target=resolve(p.hyperframesProjects,`${base}-renderer-r${++index}`);
  const staging=resolve(p.hyperframesProjects,`.${basename(target)}.building-${randomUUID()}`);
  try{await cp(source,staging,{recursive:true,force:false});await rename(staging,target);return relative(root,target).replaceAll("\\","/");}
  catch(error){await rm(staging,{recursive:true,force:true});throw error;}
}

/** Reopens a rendered HyperFrames delivery with a fresh source hash and review gate. */
export async function reviseHyperFrames(root=process.cwd()):Promise<{projectId:string;revision:number;projectDir:string;archivedDelivery:string|null;phase:"AUTHORING"}>{
  const p=harnessPaths(root),state=await readState(root);
  if(state.phase!=="RENDERED"&&state.phase!=="FINALIZED")throw new Error("Only a rendered or finalized HyperFrames project can start a renderer revision.");
  const manifest=await readProjectManifest(root,state),hashes=await currentHashes(root,state,manifest);
  if(!state.visualApproval||state.visualApproval.approvedBy!=="HUMAN"||state.visualApproval.sourceHash!==hashes.sourceHash||state.renderedHash!==hashes.sourceHash)throw new Error("HyperFrames revision requires a rendered output whose source still matches its human approval.");
  await requireFile(p.finalVideo,"Rendered HyperFrames MP4");
  const projectDir=await cloneHyperFramesRevision(root,state.projectDir);
  let archivedDelivery:string|null=null;
  try{const archived=await archiveCurrentVideo(root);archivedDelivery=archived?.path??null;}
  catch(error){await rm(resolve(root,projectDir),{recursive:true,force:true});throw error;}
  stopHyperFramesPlayer(state);
  for(const target of [p.manifest,p.finalManifest,p.boundaryEvidenceIndex,p.boundaryEvidenceDir,p.finalVideo,p.preview,resolve(p.output,"frames")])await rm(target,{recursive:true,force:true});
  const nextState:HyperFramesState={...state,phase:"AUTHORING",projectDir,sourceHash:undefined,previewUrl:undefined,previewPid:undefined,previewPort:undefined,visualApproval:undefined,renderedHash:undefined,evidencePath:undefined,updatedAt:new Date().toISOString()};
  await writeJson(p.rendererState,nextState);
  return {projectId:state.projectId,revision:state.revision,projectDir,archivedDelivery,phase:"AUTHORING"};
}

function atSampleFrames(manifest:HyperFramesProjectManifest):number[] {
  const timeline=resolveHyperFramesTimeline({meta:{title:"",width:manifest.width,height:manifest.height,durationsInFrames:manifest.durationInFrames,fps:manifest.fps,theme:{palette:[],font:""},constraints:{style:"",disallowed:[],motionTone:""}},scenes:manifest.scenes.map((scene)=>({id:scene.sceneId,durationInFrames:scene.durationInFrames,screenText:scene.screenText,visualConcept:""}))});
  const frames=new Set<number>([0,Math.max(0,manifest.durationInFrames-1)]);
  for(const boundary of plannedHyperFramesBoundaries(timeline))for(const frame of boundary.frames)frames.add(frame);
  return [...frames].sort((a,b)=>a-b);
}

/** Parses the pinned check envelope and keeps its findings, even when the gate failed. */
function parseCheckReport(result:HyperFramesCommandResult):Record<string,unknown> {
  let output:unknown;try{output=JSON.parse(result.stdout);}catch{throw new Error("HyperFrames check did not return the pinned --json output shape.");}
  if(!output||typeof output!=="object"||Array.isArray(output)||typeof (output as Record<string,unknown>).ok!=="boolean")throw new Error("HyperFrames check JSON schema changed; refusing to interpret it.");
  return output as Record<string,unknown>;
}
function parseCheckJson(result:HyperFramesCommandResult):Record<string,unknown> {
  if(!result.ok)throw new Error(`HyperFrames check failed (exit ${result.exitCode}).\n${result.stderr||result.stdout}`);
  const output=parseCheckReport(result);
  if(output.ok!==true)throw new Error(`HyperFrames check rejected the composition.\n${JSON.stringify(output,null,2)}`);
  return output;
}

export interface HyperFramesCheckResult {
  command:HyperFramesCommandResult;
  lint:LintReport;
  summary:string;
  sourceHash:string;
  probeError?:string;
}

/** Runs HyperFrames' lint/runtime/layout/motion gate plus the harness rule engine on the current authored project. */
export async function checkHyperFrames(root=process.cwd(),options:{sceneId?:string;strict?:boolean;timeout?:number}={}):Promise<HyperFramesCheckResult> {
  const state=await readState(root),manifest=await readProjectManifest(root,state),projectDir=resolve(root,state.projectDir);await ensureHyperFramesNativeAudio(projectDir,manifest);
  const hashes=await currentHashes(root,state,manifest),project=await readJson<VideoProject>(harnessPaths(root).video);
  const textErrors=await validateCanonicalText(projectDir,manifest,project);if(textErrors.length)throw new Error(`Canonical copy validation failed:\n${textErrors.map((item)=>`- ${item}`).join("\n")}`);
  const command=await runHyperFrames(root,projectDir,["check","--json"]);
  const vendor=normalizeHyperFramesReport(parseCheckReport(command),{fps:manifest.fps,width:manifest.width,height:manifest.height});
  const scopedScenes = options.sceneId ? project.scenes.filter((scene) => scene.id === options.sceneId) : project.scenes;
  const ctx:LintContext={canvasWidth:manifest.width,canvasHeight:manifest.height,sceneIds:scopedScenes.map((scene)=>scene.id),minFontPx:manifest.width*0.0145,tolerancePx:2,canonicalText:scopedScenes.map((scene)=>scene.screenText)};
  const probed=await runHyperFramesLayoutProbe(root,{projectDir:state.projectDir,manifest,...(options.sceneId?{sceneId:options.sceneId}:{}),...(options.timeout?{timeout:options.timeout}:{})});
  const harness=runLint({frames:probed.frames,ctx,strict:options.strict,measurement:probed.measurement});
  const vendorReport:LintReport={version:"1",status:vendor.status,strict:options.strict??false,frames:[],sceneIds:ctx.sceneIds,issues:vendor.issues,checks:vendor.checks,coverage:{observedScenes:[],unobservedScenes:[],fontsReady:true,failedImages:[]},measurement:"hyperframes-cli"};
  const lint=mergeLintReports([vendorReport,harness],options.strict??false);
  await writeJson(harnessPaths(root).layoutLint,lint);
  const summary=[formatLintSummary(lint),...(probed.error?[`Harness probe error: ${probed.error}`]:[])].join("\n");
  return {command,lint,summary,sourceHash:hashes.sourceHash,...(probed.error?{probeError:probed.error}:{})};
}

/** Opens the local Studio project URL in the platform's default browser. */
async function openDefaultBrowser(url:string):Promise<void> {
  const command=process.platform==="darwin"?{app:"open",args:[url]}:process.platform==="linux"?{app:"xdg-open",args:[url]}:process.platform==="win32"?{app:"rundll32.exe",args:["url.dll,FileProtocolHandler",url]}:undefined;
  if(!command)throw new Error(`Cannot automatically open HyperFrames Studio on platform '${process.platform}'.`);
  try{await execFileAsync(command.app,command.args,{timeout:10_000,maxBuffer:1_000_000});}catch(error){throw new Error(`Could not open HyperFrames Studio in the default browser: ${error instanceof Error?error.message:String(error)}`);}
}

/** Stops the detached HyperFrames review server without touching its HTML project. */
export function stopHyperFramesPlayer(state:HyperFramesState|undefined):void {
  stopLocalPlayer(state);
}

/** Starts the pinned Studio preview server and opens its project deep link. */
async function startStudio(root:string,state:HyperFramesState):Promise<{url:string;pid:number;port:number}> {
  const port=await findAvailablePort(),baseUrl=`http://127.0.0.1:${port}`,projectName=basename(resolve(root,state.projectDir)),url=`${baseUrl}/#project/${encodeURIComponent(projectName)}`,entry=cliEntrypoint(root);
  const child=spawn(process.execPath,[entry,"preview",state.projectDir,"--port",String(port),"--no-open","--foreground"],{cwd:root,env:cliEnvironment(),detached:true,stdio:"ignore",windowsHide:true});
  try{await waitForLocalStudio(baseUrl,child);await openDefaultBrowser(url);}catch(error){stopLocalPlayer({previewPid:child.pid});throw error;}
  child.on("error",()=>{});child.unref();
  return {url,pid:child.pid??0,port};
}

/** Persists HyperFrames' stable DOM IDs before freezing review source. */
async function persistStudioSourceIds(root:string,state:HyperFramesState,previewUrl:string):Promise<void> {
  const projectDir=resolve(root,state.projectDir),projectId=encodeURIComponent(basename(projectDir)),baseUrl=new URL(previewUrl).origin;
  const sourceFiles=await rendererSourceFiles(projectDir),htmlFiles=["index.html",...sourceFiles.filter((file)=>file!=="index.html"&&/\.html?$/i.test(file))];
  for(const file of htmlFiles){
    const path=file==="index.html"?`/api/projects/${projectId}/preview`:`/api/projects/${projectId}/preview/comp/${file.split("/").map(encodeURIComponent).join("/")}`;
    const response=await fetch(new URL(path,baseUrl),{signal:AbortSignal.timeout(30_000)}),body=await response.arrayBuffer();
    if(!response.ok)throw new Error(`HyperFrames could not prepare stable IDs for '${file}' (HTTP ${response.status}; ${body.byteLength} response bytes).`);
  }
}

/** Runs checks, freezes the source revision, then opens local HyperFrames Studio for human review. */
export async function startHyperFramesVisualReview(root=process.cwd()):Promise<{url:string;sourceHash:string;sampleFrames:number[];sampleTimesSeconds:number[];snapshotDir:string;approvalRequired:true}> {
  const p=harnessPaths(root),state=await readState(root);if(state.phase==="RENDERED"||state.phase==="FINALIZED")throw new Error("Rendered projects cannot re-enter visual review; run `video renderer revise` first.");
  const manifest=await readProjectManifest(root,state),projectDir=resolve(root,state.projectDir);await ensureHyperFramesNativeAudio(projectDir,manifest);
  const hashes=await currentHashes(root,state,manifest),project=await readJson<VideoProject>(p.video),textErrors=await validateCanonicalText(projectDir,manifest,project);
  if(textErrors.length)throw new Error(`Canonical copy validation failed:\n${textErrors.map((item)=>`- ${item}`).join("\n")}`);
  const sampleFrames=atSampleFrames(manifest),sampleTimesSeconds=sampleFrames.map((frame)=>frameToSeconds(frame,manifest.fps));
  const command=await runHyperFrames(root,projectDir,["check","--json","--snapshots","--at",sampleTimesSeconds.join(",")]);parseCheckJson(command);
  const afterCheck=await currentHashes(root,state,manifest);if(afterCheck.sourceHash!==hashes.sourceHash)throw new Error("Renderer source changed during review checks. Run `video renderer review` again.");
  stopHyperFramesPlayer(state);let preview:{url:string;pid:number;port:number}|undefined,reviewHashes:Awaited<ReturnType<typeof currentHashes>>|undefined;
  try{preview=await startStudio(root,state);await persistStudioSourceIds(root,state,preview.url);reviewHashes=await currentHashes(root,state,manifest);}catch(error){if(preview)stopLocalPlayer({previewPid:preview.pid});await writeJson(p.rendererState,{...state,phase:"AUTHORING",sourceHash:undefined,previewUrl:undefined,previewPid:undefined,previewPort:undefined,visualApproval:undefined,updatedAt:new Date().toISOString()});throw error;}
  if(!preview||!reviewHashes)throw new Error("HyperFrames visual review did not produce a stable source revision.");
  const updated:HyperFramesState={...state,phase:"VISUAL_REVIEW",sourceHash:reviewHashes.sourceHash,previewUrl:preview.url,previewPid:preview.pid,previewPort:preview.port,visualApproval:undefined,evidencePath:relative(root,p.boundaryEvidenceIndex).replaceAll("\\","/"),updatedAt:new Date().toISOString()};
  await writeJson(p.rendererState,updated);
  const evidence={version:"1",projectHash:state.projectHash,sourceHash:reviewHashes.sourceHash,frames:sampleFrames.map((frame,index)=>({frame,timeSeconds:sampleTimesSeconds[index]})),snapshotDirectory:relative(root,resolve(projectDir,"snapshots")).replaceAll("\\","/"),checkCommand:command.command};
  await writeJson(p.boundaryEvidenceIndex,evidence);
  return {url:preview.url,sourceHash:reviewHashes.sourceHash,sampleFrames,sampleTimesSeconds,snapshotDir:evidence.snapshotDirectory,approvalRequired:true};
}

/** Records human visual approval only through the host-owned checkpoint. */
async function approveHyperFramesVisualReviewLocked(root=process.cwd()):Promise<{approved:true;sourceHash:string;approvedAt:string}> {
  await assertReconciliationCurrent(root);
  const state=await readState(root);if(state.phase!=="VISUAL_REVIEW"||!state.sourceHash)throw new Error("HyperFrames visual review is not ready for approval.");
  const manifest=await readProjectManifest(root,state),hashes=await currentHashes(root,state,manifest);
  if(hashes.sourceHash!==state.sourceHash)throw new Error("Renderer source changed during visual review. Run `video renderer review` and review the new revision before approval.");
  const project=await readJson<VideoProject>(harnessPaths(root).video),textErrors=await validateCanonicalText(resolve(root,state.projectDir),manifest,project);if(textErrors.length)throw new Error(`Canonical copy validation failed:\n${textErrors.map((item)=>`- ${item}`).join("\n")}`);
  const approvedAt=new Date().toISOString(),approval:RendererApproval={status:"approved",approvedBy:"HUMAN",sourceHash:hashes.sourceHash,approvedAt};
  await writeJson(harnessPaths(root).rendererState,{...state,visualApproval:approval,updatedAt:approvedAt});await markCheckpointReapproved(root,"VISUAL_REVIEW");
  return {approved:true,sourceHash:hashes.sourceHash,approvedAt};
}
export async function approveHyperFramesVisualReview(root=process.cwd()){return withHostApprovalLock(root,()=>approveHyperFramesVisualReviewLocked(root));}

interface HyperFramesEvidenceFrame {frame:number;kind:"opening"|"boundary"|"ending";name:string;}

/** Plans sparse opening, transition, and ending frame evidence. */
function plannedBoundaryEvidenceFrames(manifest:HyperFramesProjectManifest):HyperFramesEvidenceFrame[]{
  const selected:HyperFramesEvidenceFrame[]=[{frame:0,kind:"opening",name:"opening-f000000.png"}];let nextStart=0;
  for(let index=1;index<manifest.scenes.length;index++){nextStart+=manifest.scenes[index-1].durationInFrames;for(const frame of [nextStart-1,nextStart])if(frame>=0&&frame<manifest.durationInFrames)selected.push({frame,kind:"boundary",name:`boundary-${String(index).padStart(2,"0")}-f${String(frame).padStart(6,"0")}.png`});}
  selected.push({frame:manifest.durationInFrames-1,kind:"ending",name:`ending-f${String(manifest.durationInFrames-1).padStart(6,"0")}.png`});return selected;
}

/** Binds sparse HyperFrames snapshots to the direct MP4 output. */
async function captureBoundaryEvidence(root:string,state:HyperFramesState,manifest:HyperFramesProjectManifest,sourceHash:string,videoSha256:string,checkCommand:string,renderCommand:string,snapshotCommand:string,snapshotDir:string):Promise<HyperFramesBoundaryEvidence> {
  const p=harnessPaths(root),selected=plannedBoundaryEvidenceFrames(manifest),captureNames=(await readdir(snapshotDir)).filter((name)=>/^frame-\d+-at-\d+(?:\.\d+)?s\.png$/.test(name)).sort();
  if(captureNames.length!==selected.length)throw new Error(`HyperFrames snapshot produced ${captureNames.length} boundary images; expected ${selected.length}.`);
  await rm(p.boundaryEvidenceDir,{recursive:true,force:true});await mkdir(p.boundaryEvidenceDir,{recursive:true});const records:HyperFramesBoundaryEvidence["frames"]=[];
  for(let index=0;index<selected.length;index++){
    const item=selected[index],name=captureNames[index],match=/^frame-(\d+)-at-(\d+(?:\.\d+)?)s\.png$/.exec(name);
    if(!match||Number(match[1])!==index||Math.abs(Number(match[2])-frameToSeconds(item.frame,manifest.fps))>0.0011)throw new Error(`HyperFrames snapshot '${name}' does not match requested frame ${item.frame}.`);
    const source=resolve(snapshotDir,name);if(!(await stat(source)).isFile())throw new Error(`HyperFrames snapshot '${name}' is not a regular file.`);
    const destination=resolve(p.boundaryEvidenceDir,item.name);await copyFile(source,destination);const digest=createHash("sha256").update(await readFile(destination)).digest("hex");
    records.push({frame:item.frame,timeSeconds:frameToSeconds(item.frame,manifest.fps),file:item.name,kind:item.kind,sha256:digest});if(item.kind==="opening")await copyFile(destination,p.preview);
  }
  const evidence:HyperFramesBoundaryEvidence={version:"2",renderer:"hyperframes",rendererVersion:RENDERER_VERSION,renderMode:"native-mp4",projectHash:state.projectHash,sourceHash,videoSha256,frames:records,snapshotDirectory:relative(root,p.boundaryEvidenceDir).replaceAll("\\","/"),checkCommand,renderCommand,snapshotCommand,createdAt:new Date().toISOString()};
  await writeJson(p.boundaryEvidenceIndex,evidence);return evidence;
}

/** Reads final MP4 stream metadata using the local ffprobe executable. */
async function probeFinalVideo(root:string,path:string):Promise<Record<string,unknown>> {
  const executable=process.env.FFPROBE_PATH||"ffprobe",args=["-v","error","-show_entries","format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration,start_time,sample_rate,channels","-of","json",path];
  const result=await execFileAsync(executable,args,{cwd:root,env:cliEnvironment(),timeout:60_000,maxBuffer:4_000_000});
  let parsed:unknown;try{parsed=JSON.parse(result.stdout);}catch{throw new Error("ffprobe did not return JSON metadata for output/final.mp4.");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("ffprobe returned an unsupported metadata schema.");
  return parsed as Record<string,unknown>;
}

/** Checks output duration, canvas, frame rate, and the expected audio stream. */
function validateFinalProbe(probe:Record<string,unknown>,manifest:HyperFramesProjectManifest):string[] {
  const errors:string[]=[],format=probe.format as Record<string,unknown>|undefined,streams=Array.isArray(probe.streams)?probe.streams as Array<Record<string,unknown>>:[],video=streams.find((stream)=>stream.codec_type==="video"),audio=streams.find((stream)=>stream.codec_type==="audio");
  if(!video)errors.push("Final MP4 has no video stream.");
  if(video&&Number(video.width)!==manifest.width)errors.push(`Final MP4 width ${String(video.width)} does not match ${manifest.width}.`);
  if(video&&Number(video.height)!==manifest.height)errors.push(`Final MP4 height ${String(video.height)} does not match ${manifest.height}.`);
  const fpsText=String(video?.avg_frame_rate??video?.r_frame_rate??"0/1"),[fpsN,fpsD]=fpsText.split("/").map(Number),actualFps=fpsD?fpsN/fpsD:Number.NaN;
  if(!Number.isFinite(actualFps)||Math.abs(actualFps-manifest.fps)>0.001)errors.push(`Final MP4 frame rate '${fpsText}' does not match ${manifest.fps}.`);
  const frameCount=Number(video?.nb_frames);if(Number.isFinite(frameCount)&&frameCount!==manifest.durationInFrames)errors.push(`Final MP4 contains ${frameCount} video frames; expected ${manifest.durationInFrames}.`);
  const duration=Number(format?.duration);if(!Number.isFinite(duration)||Math.abs(duration-manifest.durationSeconds)>1/manifest.fps+0.02)errors.push(`Final MP4 duration ${String(format?.duration)} does not match ${manifest.durationSeconds}s.`);
  if(manifest.audioClips.length&&!audio)errors.push("Approved audio clips exist but the final MP4 has no audio stream.");
  if(!manifest.audioClips.length&&audio)errors.push("Final MP4 contains audio although the renderer manifest has no approved audio clips.");
  if(audio){const expectedAudioEnd=Math.max(...manifest.audioClips.map((clip)=>(clip.startFrame+clip.durationInFrames)/manifest.fps)),audioDuration=Number(audio.duration),audioStart=Number(audio.start_time);if(Number.isFinite(audioDuration)&&audioDuration+1/manifest.fps+0.02<expectedAudioEnd)errors.push(`Final MP4 audio ends at ${audioDuration}s before the last approved clip ends at ${expectedAudioEnd}s.`);if(Number.isFinite(audioDuration)&&audioDuration>manifest.durationSeconds+1/manifest.fps+0.02)errors.push(`Final MP4 audio duration ${audioDuration}s exceeds the composition duration.`);if(Number.isFinite(audioStart)&&Math.abs(audioStart)>1/manifest.fps+0.02)errors.push(`Final MP4 audio starts at ${audioStart}s instead of the composition start.`);if(audio.sample_rate!==undefined&&Number(audio.sample_rate)!==48000)errors.push(`Final MP4 audio sample rate ${String(audio.sample_rate)} does not match 48000 Hz.`);}
  return errors;
}

/** Removes a stale or structurally invalid delivery and returns its state to visual review. */
async function invalidateRenderedDelivery(root:string,state:HyperFramesState):Promise<void> {
  const p=harnessPaths(root);for(const target of [p.finalVideo,p.manifest,p.boundaryEvidenceDir,p.boundaryEvidenceIndex,p.preview,resolve(p.output,"frames")])await rm(target,{recursive:true,force:true});await writeJson(p.rendererState,{...state,phase:"VISUAL_REVIEW",renderedHash:undefined,updatedAt:new Date().toISOString()});
}

/** Renders the approved composition directly to MP4 and captures sparse boundary snapshots. */
export async function renderHyperFrames(root=process.cwd()):Promise<{video:string;evidence:string;sourceHash:string;commands:HyperFramesCommandResult[]}> {
  await assertCheckpointCurrent(root,"VISUAL_REVIEW");
  await assertApprovedNarrationBindings(root,await readJson<VideoProject>(harnessPaths(root).video));
  const p=harnessPaths(root),state=await readState(root);
  if(state.phase!=="VISUAL_REVIEW"||state.visualApproval?.status!=="approved"||state.visualApproval.approvedBy!=="HUMAN")throw new Error("Final rendering requires host-recorded human visual approval.");
  if(state.visualApproval.sourceHash!==state.sourceHash)throw new Error("Visual approval is not bound to the current renderer source.");
  const manifest=await readProjectManifest(root,state),projectDir=resolve(root,state.projectDir);await ensureHyperFramesNativeAudio(projectDir,manifest,false);const initial=await currentHashes(root,state,manifest);
  if(initial.sourceHash!==state.sourceHash)throw new Error("Renderer source changed after approval; reopen visual review before rendering.");
  const canonical=await readJson<VideoProject>(p.video),textErrors=await validateCanonicalText(projectDir,manifest,canonical);if(textErrors.length)throw new Error(`Canonical copy validation failed:\n${textErrors.map((item)=>`- ${item}`).join("\n")}`);
  const check=await runHyperFrames(root,projectDir,["check","--json"]);parseCheckJson(check);
  const framesDir=resolve(p.output,"frames"),renderPath=resolve(p.output,`.final-${randomUUID()}.mp4`),snapshotDir=resolve(p.output,`.snapshots-${randomUUID()}`);
  for(const target of [framesDir,p.boundaryEvidenceDir,p.preview,p.boundaryEvidenceIndex])await rm(target,{recursive:true,force:true});await mkdir(p.output,{recursive:true});
  const commands:HyperFramesCommandResult[]=[check];
  try{
    const render=await runHyperFrames(root,projectDir,["render","--format","mp4","--fps",String(manifest.fps),"--quality","delivery","--low-memory-mode","--output",renderPath],3_600_000);commands.push(render);
    if(!render.ok)throw new Error(`HyperFrames native MP4 render failed (exit ${render.exitCode}).\n${render.stderr||render.stdout}`);
    await requireFile(renderPath,"Direct HyperFrames MP4 render");const renderStat=await stat(renderPath);if(renderStat.size===0)throw new Error("HyperFrames produced an empty MP4.");
    const renderProbe=await probeFinalVideo(root,renderPath),renderProbeErrors=validateFinalProbe(renderProbe,manifest);if(renderProbeErrors.length)throw new Error(`Direct HyperFrames MP4 failed metadata validation:\n${renderProbeErrors.map((item)=>`- ${item}`).join("\n")}`);
    const selected=plannedBoundaryEvidenceFrames(manifest),times=selected.map((item)=>frameToSeconds(item.frame,manifest.fps));
    const snapshot=await runHyperFrames(root,projectDir,["snapshot","--at",times.join(","),"--no-end","--describe=false","--output",snapshotDir],600_000);commands.push(snapshot);
    if(!snapshot.ok)throw new Error(`HyperFrames boundary snapshot capture failed (exit ${snapshot.exitCode}).\n${snapshot.stderr||snapshot.stdout}`);
    const after=await currentHashes(root,state,manifest);if(after.sourceHash!==state.visualApproval.sourceHash)throw new Error("Renderer source changed during final rendering; output was discarded.");
    await ensureHyperFramesNativeAudio(projectDir,manifest,false);
    const videoSha256=createHash("sha256").update(await readFile(renderPath)).digest("hex");
    await captureBoundaryEvidence(root,state,manifest,after.sourceHash,videoSha256,check.command,render.command,snapshot.command,snapshotDir);
    await rename(renderPath,p.finalVideo);
    await rm(snapshotDir,{recursive:true,force:true});const updated:HyperFramesState={...state,phase:"RENDERED",renderedHash:after.sourceHash,evidencePath:relative(root,p.boundaryEvidenceIndex).replaceAll("\\","/"),updatedAt:new Date().toISOString()};await writeJson(p.rendererState,updated);
    return {video:relative(root,p.finalVideo).replaceAll("\\","/"),evidence:relative(root,p.boundaryEvidenceIndex).replaceAll("\\","/"),sourceHash:after.sourceHash,commands};
  }catch(error){for(const target of [renderPath,snapshotDir,framesDir,p.boundaryEvidenceDir,p.preview,p.finalVideo,p.boundaryEvidenceIndex])await rm(target,{recursive:true,force:true});throw error;}
}

/** Finalizes only fresh, approved renders with matching evidence and MP4 metadata. */
export async function finalizeHyperFrames(root=process.cwd()):Promise<{manifest:HyperFramesImplementationManifest;video:string;evidence:string}> {
  await assertCheckpointCurrent(root,"VISUAL_REVIEW");
  await assertApprovedNarrationBindings(root,await readJson<VideoProject>(harnessPaths(root).video));
  const p=harnessPaths(root),state=await readState(root);if(state.phase!=="RENDERED"||!state.visualApproval||!state.renderedHash)throw new Error("HyperFrames render must complete after host approval before finalization.");
  const project=await readJson<VideoProject>(p.video),manifest=await readProjectManifest(root,state),projectDir=resolve(root,state.projectDir);let hashes:Awaited<ReturnType<typeof currentHashes>>;
  try{await ensureHyperFramesNativeAudio(projectDir,manifest,false);hashes=await currentHashes(root,state,manifest);}catch(error){await invalidateRenderedDelivery(root,state);throw error;}
  if(hashes.sourceHash!==state.renderedHash||hashes.sourceHash!==state.visualApproval.sourceHash){await invalidateRenderedDelivery(root,state);throw new Error("Renderer source changed after final rendering; output was discarded and visual review is required again.");}
  let evidence:HyperFramesBoundaryEvidence;
  try{evidence=await readJson<HyperFramesBoundaryEvidence>(p.boundaryEvidenceIndex);}catch{await invalidateRenderedDelivery(root,state);throw new Error("Frame evidence is missing or invalid; output was discarded.");}
  if(evidence.version!=="2"||evidence.renderer!=="hyperframes"||evidence.rendererVersion!==RENDERER_VERSION||evidence.renderMode!=="native-mp4"||evidence.projectHash!==state.projectHash||evidence.sourceHash!==hashes.sourceHash||!Array.isArray(evidence.frames)||typeof evidence.videoSha256!=="string"){await invalidateRenderedDelivery(root,state);throw new Error("Native MP4 evidence does not match the approved source; output was discarded.");}
  const expectedFrames=plannedBoundaryEvidenceFrames(manifest),evidenceErrors:string[]=[];
  if(evidence.frames.length!==expectedFrames.length)evidenceErrors.push(`frame count ${evidence.frames.length} (expected ${expectedFrames.length})`);
  for(let index=0;index<expectedFrames.length;index++){
    const expected=expectedFrames[index],frame=evidence.frames[index];if(!frame||frame.frame!==expected.frame||frame.kind!==expected.kind||frame.file!==expected.name||frame.timeSeconds!==frameToSeconds(expected.frame,manifest.fps)){evidenceErrors.push(`${frame?.file??`frame ${expected.frame}`} (unexpected boundary entry)`);continue;}
    try{if(frame.file!==basename(frame.file))throw new Error("unsafe evidence path");const imagePath=resolve(p.boundaryEvidenceDir,frame.file);await requireFile(imagePath,"Rendered boundary evidence");const bytes=await readFile(imagePath),imageHash=createHash("sha256").update(bytes).digest("hex");if(imageHash!==frame.sha256||bytes[0]!==0x89||bytes[1]!==0x50||bytes[2]!==0x4e||bytes[3]!==0x47)evidenceErrors.push(`${frame.file} (missing, corrupt, or hash mismatch)`);}catch{evidenceErrors.push(frame.file);}
  }
  await requireFile(p.finalVideo,"Final HyperFrames MP4");const fileHash=createHash("sha256").update(await readFile(p.finalVideo)).digest("hex");if(evidence.videoSha256!==fileHash)evidenceErrors.push("final MP4 hash mismatch");
  if(evidenceErrors.length){await invalidateRenderedDelivery(root,state);throw new Error(`Native MP4 evidence failed validation: ${evidenceErrors.join(", ")}. Output was discarded.`);}
  const probe=await probeFinalVideo(root,p.finalVideo),probeErrors=validateFinalProbe(probe,manifest);
  if(probeErrors.length){await invalidateRenderedDelivery(root,state);throw new Error(`Final MP4 metadata failed validation:\n${probeErrors.map((item)=>`- ${item}`).join("\n")}\nOutput was discarded.`);}
  const generatedFiles=await rendererSourceFiles(projectDir),implementation:HyperFramesImplementationManifest={version:"2",renderer:"hyperframes",rendererVersion:RENDERER_VERSION,renderMode:"native-mp4",projectId:state.projectId,revision:state.revision,projectHash:state.projectHash,productionProfileHash:state.productionProfileHash,assetManifestHash:state.assetManifestHash,sourceHash:hashes.sourceHash,projectDir:state.projectDir,width:manifest.width,height:manifest.height,fps:manifest.fps,durationInFrames:manifest.durationInFrames,durationSeconds:manifest.durationSeconds,generatedFiles,sceneBindings:manifest.scenes,visualApproval:state.visualApproval,check:{command:evidence.checkCommand,passed:true},evidence:{index:relative(root,p.boundaryEvidenceIndex).replaceAll("\\","/"),files:evidence.frames.map((frame)=>relative(root,resolve(p.boundaryEvidenceDir,frame.file)).replaceAll("\\","/"))},output:{file:relative(root,p.finalVideo).replaceAll("\\","/"),sha256:fileHash,probe}};
  await writeJson(p.manifest,implementation);await writeJson(p.rendererState,{...state,phase:"FINALIZED",updatedAt:new Date().toISOString()});stopHyperFramesPlayer(state);
  return {manifest:implementation,video:implementation.output.file,evidence:implementation.evidence.index};
}

/** Exposes the renderer-owned visual-review checkpoint to the HITL host. */
export async function hyperFramesHitlStatus(root=process.cwd()):Promise<{status:"WORKING"|"REVIEW_REQUIRED"|"READY";phase:string;checkpoint?:"VISUAL_REVIEW";payload?:unknown;message:string}|undefined> {
  const p=harnessPaths(root);if(!(await exists(p.rendererState)))return undefined;
  try{
    const state=await readState(root);if(state.phase==="AUTHORING")return {status:"WORKING",phase:"renderer_authoring",payload:{projectDir:state.projectDir},message:"HyperFrames source is being authored; run checks and open HyperFrames Studio when ready."};
    if(state.phase==="RENDERED")return {status:"READY",phase:"renderer_rendered",payload:{projectDir:state.projectDir,finalVideo:harnessPaths(root).finalVideo},message:"The approved renderer output is ready for metadata validation and finalization."};
    if(state.phase==="FINALIZED")return {status:"READY",phase:"renderer_finalized",payload:{projectDir:state.projectDir,finalVideo:harnessPaths(root).finalVideo},message:"The approved HyperFrames MP4 and evidence are finalized."};
    const manifest=await readProjectManifest(root,state),hashes=await currentHashes(root,state,manifest),fresh=hashes.sourceHash===state.sourceHash,approval=state.visualApproval;
    if(!fresh)return {status:"REVIEW_REQUIRED",phase:"renderer_source_changed",checkpoint:"VISUAL_REVIEW",payload:{projectDir:state.projectDir,previewUrl:state.previewUrl,sourceHash:hashes.sourceHash,reviewedSourceHash:state.sourceHash,approvalInvalidated:true},message:"Renderer source changed after visual review. Re-run `video renderer review`, inspect the new source, then ask the host to record approval."};
    if(approval?.status==="approved"&&approval.approvedBy==="HUMAN"&&approval.sourceHash===hashes.sourceHash)return {status:"READY",phase:"visual_review_approved",payload:{projectDir:state.projectDir,sourceHash:hashes.sourceHash,approvedAt:approval.approvedAt},message:"Human visual review is approved for the current renderer source."};
    return {status:"REVIEW_REQUIRED",phase:"needs_visual_review",checkpoint:"VISUAL_REVIEW",payload:{projectDir:state.projectDir,previewUrl:state.previewUrl,sourceHash:state.sourceHash},message:"HyperFrames Studio is open for human review. Approve this exact renderer source through the host checkpoint."};
  }catch(error){return {status:"REVIEW_REQUIRED",phase:"invalid_renderer_review",checkpoint:"VISUAL_REVIEW",payload:{error:error instanceof Error?error.message:String(error)},message:"HyperFrames renderer state is invalid; inspect and repair the renderer project before approving or rendering."};}
}
