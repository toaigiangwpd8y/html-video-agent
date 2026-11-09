import {mkdir,rm} from "node:fs/promises";
import {relative,resolve} from "node:path";
import {semanticPreflight} from "./authoring/preflight.js";
import {getContractSchemaPayload} from "./authoring/contract-schema.js";
import {validateProject} from "./authoring/validator.js";
import {readJson,readText,writeJson,writeText} from "./core/io.js";
import type {VideoProject} from "./core/types.js";
import {exists} from "./harness/fs.js";
import {archiveCurrentVideo,listArchivedVideos,resetVideoWorkspace} from "./harness/archive.js";
import {applyHarnessPatch,parsePatchDocument} from "./harness/patch.js";
import {harnessPaths} from "./harness/paths.js";
import {DEFAULT_TTS_CONFIG,publicTtsConfig,ttsConfig} from "./tts/config.js";
import {probeTts,createTtsProvider} from "./tts/provider.js";
import {synthesizeNarration,validateNarrationManifest} from "./tts/cache.js";
import {getReconciliationContext,submitReconciliation} from "./harness/reconciliation.js";
import {advanceProjectState,loadProjectState,type ProjectState} from "./harness/project-state.js";
import {invalidateProjectDerived,persistRevision,preserveRemotionWorkspace,validateCanonicalProject} from "./harness/canonical-promotion.js";
import {commitProductionProfile,productionProfileStatus,productionProfileTemplate,profileCatalogForCli,rebindProductionProfile,reviseProductionProfile} from "./harness/production-profile.js";
import {clarificationStatus,clarificationTemplate,commitClarification} from "./harness/clarification.js";
import {commitScriptReview,commitStoryboardReview,commitVideoBrief,reviseScriptReview,reviseStoryboardReview,reviseVideoBrief,scriptReviewStatus,storyboardReviewStatus,videoBriefStatus,videoBriefTemplate} from "./harness/preproduction-hitl.js";
import {assertRequestMutable} from "./harness/request.js";
import {universalHitlStatus} from "./harness/hitl-protocol.js";
import {runProductionAssetPreflight} from "./harness/production-preflight-hitl.js";
import {stopHyperFramesPlayer,type HyperFramesState} from "./harness/hyperframes.js";
import {stopRemotionStudio,type RemotionRendererState} from "./harness/remotion.js";
import {checkSelectedRenderer,finalizeSelectedRenderer,prepareSelectedRenderer,renderSelectedRenderer,rendererOptions as rendererOptionsForCli,reviewSelectedRenderer,reviseSelectedRenderer} from "./harness/renderer.js";
import {startBacklotServer} from "./backlot/server.js";
import {loadNormalizedSources} from "./sources/source-loader.js";
import {materializeNormalizedSourceAsset} from "./sources/source-materializer.js";
import {cropSlideRegion,extractDeck,listDecks,SOURCES_DIR} from "./sources/extract.js";
import {bindNarrationScript} from "./sources/narration.js";
import {checkAssessment,writeAssessmentTemplate} from "./sources/assessment.js";
const root=process.cwd(),p=harnessPaths(root);function print(v:unknown){console.log(JSON.stringify(v,null,2));}
function option(args:string[],name:string):string|undefined{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;}
async function sources(args:string[]){const action=args[0];if(action==="extract"){const file=args[1];if(!file||file.startsWith("--"))throw new Error("Usage: video sources extract <deck.pdf|deck.pptx> [--id <deck-id>] [--dpi <n>] [--no-contact-sheets]");const dpi=option(args,"--dpi"),id=option(args,"--id"),{deck,directory}=await extractDeck(root,file,{...(id?{id}:{}),...(dpi?{dpi:Number(dpi)}:{}),contactSheets:!args.includes("--no-contact-sheets")});print({ok:true,id:deck.id,format:deck.format,slideCount:deck.slideCount,directory:relative(root,directory),deckIndex:relative(root,resolve(directory,"deck.json")),images:deck.images.length,chromeImages:deck.images.filter(i=>i.chrome).length,contactSheets:deck.files.contactSheets,limitations:deck.limitations,warnings:deck.warnings,slidesWithWarnings:deck.slides.filter(s=>s.warnings>0).map(s=>s.slide)});return;}if(action==="list"){print({decks:await listDecks(root)});return;}if(action==="script"){const[id,file]=args.slice(1);if(!id||!file)throw new Error("Usage: video sources script <deck-id> <script.md>");const binding=await bindNarrationScript(root,id,file);print({ok:binding.errors.length===0,output:`${SOURCES_DIR}/${id}/narration.json`,totals:binding.totals,skipped:binding.skipped,errors:binding.errors,warnings:binding.warnings});if(binding.errors.length)process.exitCode=1;return;}if(action==="crop"){const[id,slide,x,y,w,h,name]=args.slice(1);if(!name)throw new Error("Usage: video sources crop <deck-id> <slide> <x> <y> <width> <height> <name>");const out=await cropSlideRegion(root,id,Number(slide),{x:Number(x),y:Number(y),width:Number(w),height:Number(h)},name,option(args,"--dpi")?Number(option(args,"--dpi")):undefined);print({ok:true,path:out});return;}if(action==="assess"){const[sub,id,file]=args.slice(1);if(sub==="template"&&id){const out=await writeAssessmentTemplate(root,id,file);print({ok:true,path:relative(root,out),next:`Fill in judgments, save as ${SOURCES_DIR}/${id}/assessment.json, then run: video sources assess check ${id}`});return;}if(sub==="check"&&id){const result=await checkAssessment(root,id,file);print(result);if(!result.ok)process.exitCode=1;return;}}throw new Error("Usage: video sources [extract <file>|list|script <deck-id> <script.md>|crop <deck-id> <slide> <x> <y> <w> <h> <name>|assess template|check <deck-id>]");}
async function init(){const archived=await archiveCurrentVideo(root);let previousRenderer:HyperFramesState|undefined,previousRemotion:RemotionRendererState|undefined;try{if(await exists(p.rendererState))previousRenderer=await readJson<HyperFramesState>(p.rendererState);}catch{}try{if(await exists(p.remotionRendererState))previousRemotion=await readJson<RemotionRendererState>(p.remotionRendererState);}catch{}stopHyperFramesPlayer(previousRenderer);stopRemotionStudio(previousRemotion);await preserveRemotionWorkspace(root);await resetVideoWorkspace(root);await rm(p.video,{force:true});await rm(p.manifest,{force:true});await rm(p.remotionManifest,{force:true});await rm(p.finalManifest,{force:true});await rm(p.output,{recursive:true,force:true});await mkdir(resolve(root,"assets"),{recursive:true});await writeJson(p.assetManifest,{version:"1",assets:[]});await mkdir(resolve(root,".video/candidates"),{recursive:true});print({ok:true,mode:"HARNESS_PREPRODUCTION_HITL",archived,message:archived?`Previous completed video archived at ${archived.video}. Workspace reset for a new video.`:"Workspace reset. No completed video needed archiving. Capture request, approve Video Brief and choose a renderer, freeze the Production Profile, write and approve Script, approve Storyboard to promote video.json, then prepare, review, approve, and render with the selected renderer."});}
async function status(){let project:VideoProject|undefined,state:ProjectState|undefined,projectError:string|null=null,renderer:unknown=null,rendererSelection:unknown=null;try{project=await readJson<VideoProject>(p.video);state=await loadProjectState(root,project);}catch(error){projectError=error instanceof Error?error.message:String(error);}try{if(await exists(p.rendererState))renderer=await readJson<HyperFramesState>(p.rendererState);else if(await exists(p.remotionRendererState))renderer=await readJson<RemotionRendererState>(p.remotionRendererState);}catch{}try{rendererSelection=await readJson(p.rendererSelection);}catch{}print({mode:"HARNESS_PREPRODUCTION_HITL",hitl:await universalHitlStatus(root),request:await exists(p.request),productionProfile:await productionProfileStatus(root),project:project&&state?{id:state.projectId,revision:state.revision,title:project.meta.title,scenes:project.scenes.length}:null,projectError,rendererSelection,renderer,boundaryEvidence:await exists(p.boundaryEvidenceIndex),productionPreflight:await exists(p.productionPreflight),manifest:await exists(p.finalManifest)||await exists(p.manifest)||await exists(p.remotionManifest),preview:await exists(p.preview),finalVideo:await exists(p.finalVideo)});}
async function commandResult(r:{ok:boolean;command:string;exitCode:number;stdout:string;stderr:string}){print(r);if(!r.ok)process.exitCode=1;}
async function validateCanonical(project:VideoProject){return validateCanonicalProject(root,project);}
async function main(){const[area,...args]=process.argv.slice(2);
 if(area==="explore"){const {handleExplorerCli}=await import("./app-explorer/cli.js");const code=await handleExplorerCli(root,args,value=>typeof value==="string"?console.log(value):print(value));if(code!==0)process.exitCode=code;return;}
 if(area==="app-research"){
  const {bindResearch,readResearchBinding,assertResearchBindingCurrent}=await import("./app-explorer/research-binding.js"),action=args[0];
  if(action==="inspect"&&args.length===1){const binding=await readResearchBinding(root);if(binding)await assertResearchBindingCurrent(root);print({binding});return;}
  if((action==="bind"||action==="rebind")&&args[1]){
   const file=args[1],input=await readJson(resolve(root,file));
   if(action==="bind"&&await readResearchBinding(root))throw new Error("A research binding already exists. Use `video app-research rebind <selection.json>` to explicitly invalidate and replace it.");
   print({ok:true,binding:await bindResearch(root,input as import("./app-explorer/research-binding.js").BindResearchInput)});return;
  }
  throw new Error("Usage: video app-research bind <selection.json>|inspect|rebind <selection.json>");
 }
 if(area==="web-capture"){const {handleWebCaptureCli}=await import("./web-capture/cli.js");await handleWebCaptureCli(root,args,print);return;}
 if(area==="init"){await init();return;}
 if(area==="backlot"){const port=args[0]&&!args[0].startsWith("-")?Number(args[0]):4200;const instance=await startBacklotServer({root,port,openBrowser:!args.includes("--no-open")});console.log(`Backlot Dashboard is running at ${instance.url}`);return;}
 if(area==="request"&&args[0]==="set"){const file=args[1];if(!file)throw new Error("Usage: video request set <file>");await assertRequestMutable(root);const text=await readText(resolve(root,file));if(!text.trim())throw new Error("Request file is empty.");await writeText(p.request,text);print({ok:true,path:relative(root,p.request),characters:text.length});return;}
 if(area==="status"){await status();return;}
 if(area==="sources"){await sources(args);return;}
 if(area==="archive"&&args[0]==="list"){const videos=await listArchivedVideos(root);print({count:videos.length,videos});return;}
 if(area==="source"){
  const action=args[0];
  if(action==="inspect"){print(await loadNormalizedSources(root));return;}
  if(action==="materialize"){
   const [sourceId,assetId,sceneId,role]=args.slice(1);
   if(!sourceId||!assetId||!sceneId||!role)throw new Error("Usage: video source materialize <source-id> <asset-id> <scene-id> <role>");
   print({ok:true,asset:await materializeNormalizedSourceAsset(root,sourceId,assetId,sceneId,role)});return;
  }
  if(action==="import-input"){
   const {importInputPackage}=await import("./sources/input-package.js"),directory=args[1]?resolve(root,args[1]):p.videoInput;print(await importInputPackage(root,directory));return;
  }
  if(action==="import"||action==="import-pptx"){
   const file=args[1];if(!file)throw new Error("A PPTX/PDF file path is required.");
   let scriptFile:string|undefined,narrationFile:string|undefined,policy:"preserve"|"light"|undefined;
   for(let i=2;i<args.length;i++){
    if(args[i]==="--script"){scriptFile=args[++i];if(!scriptFile)throw new Error("--script requires a file path.");continue;}
    if(args[i]==="--narration"){narrationFile=args[++i];if(!narrationFile)throw new Error("--narration requires a file path.");continue;}
    if(args[i]==="--rewrite-policy"){const value=args[++i];if(value!=="preserve"&&value!=="light")throw new Error("--rewrite-policy must be preserve or light.");policy=value;continue;}
    throw new Error("Unknown source import option: "+args[i]);
   }
   if(scriptFile&&narrationFile)throw new Error("Use either --script or --narration, not both.");
   if(policy&&!narrationFile&&!scriptFile)throw new Error("--rewrite-policy requires a narration or script file.");
   const inputPath=resolve(root,file),{importSlideSource,countSlideSourcePages}=await import("./sources/input-package.js"),{parseSlideNarration}=await import("./sources/narration-map.js");
   const narrationPath=scriptFile??narrationFile,relativeNarration=narrationPath?relative(root,resolve(root,narrationPath)).replaceAll("\\","/"):undefined;
   let narrationBySection=scriptFile?parseSlideNarration(await readText(resolve(root,scriptFile)),await countSlideSourcePages(inputPath),relativeNarration):undefined;
   if(policy&&narrationBySection)narrationBySection=Object.fromEntries(Object.entries(narrationBySection).map(([id,narration])=>[id,{...narration,rewritePolicy:policy}]));
   const narrationText=narrationFile?await readText(resolve(root,narrationFile)):undefined;
   const source=await importSlideSource(root,inputPath,{...(narrationBySection?{narrationBySection}:{}),...(narrationText!==undefined?{narrationText}:{}),...(relativeNarration?{narrationPath:relativeNarration}:{}),...(policy?{rewritePolicy:policy}:{})});
   print({ok:true,sourceId:source.id,sourcePath:relative(root,resolve(root,".video/sources",source.id,"source.json")).replaceAll("\\","/"),sections:source.sections?.length??0});return;
  }
  throw new Error("Usage: video source [inspect|materialize <source-id> <asset-id> <scene-id> <role>|import-input [directory]|import <presentation.pptx|slides.pdf> [--script <per-slide-script.md>]]");
 }
 if(area==="clarify"){const action=args[0];if(action==="template"){print(await clarificationTemplate(root));return;}if(action==="commit"){const file=args[1];if(!file)throw new Error("Usage: video clarify commit <clarification.json>");print({ok:true,...await commitClarification(root,file)});return;}if(action==="status"){print(await clarificationStatus(root));return;}throw new Error("Usage: video clarify [template|commit <clarification.json>|status]");}
 if(area==="hitl"&&args[0]==="status"){print(await universalHitlStatus(root));return;}
 if(area==="tts"){
  const action=args[0];
  if(action==="options"){print({provider:"VieNeu-TTS v3 Turbo",quality:"Current highest-quality self-hostable OSS VieNeu model; 48 kHz bilingual English/Vietnamese",config:publicTtsConfig(ttsConfig(root)),available:false,note:"Run `video tts doctor` to check local Python/dependency/model readiness. Setup is explicit and does not run during bootstrap."});return;}
  if(action==="doctor"){const result=await probeTts(root);print(result);if(!result.ready)process.exitCode=1;return;}
  if(action==="synthesize"){const file=args[1];if(!file)throw new Error("Usage: video tts synthesize <narration-input.json>");const manifest=await synthesizeNarration(root,file);print({ok:true,manifest,validation:await validateNarrationManifest(root,manifest)});return;}
  if(action==="status"){const result=await validateNarrationManifest(root);print({ok:result.valid,manifest:result.valid?await readJson(p.narrationManifest):undefined,validation:result});if(!result.valid)process.exitCode=1;return;}
  throw new Error("Usage: video tts [options|doctor|synthesize <narration-input.json>|status]");
 }
 if(area==="revision"){
  const action=args[0];if(action==="status"){print(await getReconciliationContext(root));return;}
  if(action==="reconcile"){const file=args[1];if(!file)throw new Error("Usage: video revision reconcile <report.json>");print(await submitReconciliation(root,await readJson(resolve(root,file))));return;}
  throw new Error("Usage: video revision [status|reconcile <report.json>]");
 }
 if(area==="brief"){const action=args[0];if(action==="template"){print(await videoBriefTemplate(root));return;}if(action==="commit"){const file=args[1];if(!file)throw new Error("Usage: video brief commit <brief.json>");print({ok:true,...await commitVideoBrief(root,file)});return;}if(action==="revise"){const file=args[1];if(!file)throw new Error("Usage: video brief revise <brief.json>");print({ok:true,...await reviseVideoBrief(root,file)});return;}if(action==="status"){print(await videoBriefStatus(root));return;}throw new Error("Usage: video brief [template|commit <brief.json>|revise <brief.json>|status]");}
 if(area==="script"){const action=args[0];if(action==="commit"){const file=args[1];if(!file)throw new Error("Usage: video script commit <script.md>");print({ok:true,review:await commitScriptReview(root,file)});return;}if(action==="revise"){const file=args[1];if(!file)throw new Error("Usage: video script revise <script.md>");print({ok:true,review:await reviseScriptReview(root,file)});return;}if(action==="status"){print(await scriptReviewStatus(root));return;}throw new Error("Usage: video script [commit <script.md>|revise <script.md>|status]");}
 if(area==="storyboard"){const action=args[0];if(action==="commit"||action==="revise"){const file=args[1];if(!file)throw new Error(`Usage: video storyboard ${action} <project.json>`);const project=await readJson<VideoProject>(resolve(root,file));const result=await validateCanonical(project);if(!result.valid){print(result);process.exitCode=1;return;}const review=action==="commit"?await commitStoryboardReview(root,file):await reviseStoryboardReview(root,file);print({ok:true,review,validation:result.validation,preflight:result.preflight});return;}if(action==="status"){print(await storyboardReviewStatus(root));return;}throw new Error("Usage: video storyboard [commit <project.json>|revise <project.json>|status]");}
 if(area==="profile"){const action=args[0];if(action==="catalog"){print(await profileCatalogForCli(root));return;}if(action==="template"){print(await productionProfileTemplate(root));return;}if(action==="commit"){const file=args[1];if(!file)throw new Error("Usage: video profile commit <profile.json>");print({ok:true,profile:await commitProductionProfile(root,file)});return;}if(action==="revise"){const file=args[1];if(!file)throw new Error("Usage: video profile revise <profile.json>");print({ok:true,profile:await reviseProductionProfile(root,file)});return;}if(action==="rebind"){print({ok:true,profile:await rebindProductionProfile(root)});return;}if(action==="status"){print(await productionProfileStatus(root));return;}throw new Error("Usage: video profile [catalog|template|commit <profile.json>|revise <profile.json>|rebind|status]");}
 if(area==="schema"){
  const which=args[0]??"project";
  if(which==="project")print(getContractSchemaPayload());
  else if(which==="manifest")print({name:"HyperFramesImplementationManifest",jsonSchema:{type:"object",properties:{version:{const:"2"},renderer:{const:"hyperframes"},rendererVersion:{const:"0.8.50"},renderMode:{const:"native-mp4"},projectId:{type:"string"},revision:{type:"integer"},projectHash:{type:"string"},productionProfileHash:{type:"string"},assetManifestHash:{type:"string"},sourceHash:{type:"string"},projectDir:{type:"string"},width:{type:"integer"},height:{type:"integer"},fps:{type:"number"},durationInFrames:{type:"integer"},durationSeconds:{type:"number"},generatedFiles:{type:"array",items:{type:"string"}},sceneBindings:{type:"array"},visualApproval:{type:"object"},check:{type:"object"},evidence:{type:"object"},output:{type:"object"}},required:["version","renderer","rendererVersion","renderMode","projectId","revision","projectHash","productionProfileHash","assetManifestHash","sourceHash","projectDir","width","height","fps","durationInFrames","durationSeconds","generatedFiles","sceneBindings","visualApproval","check","evidence","output"],additionalProperties:false}});
  else throw new Error("Usage: video schema [project|manifest]");return;
 }
 if(area==="assets"&&args[0]==="inspect"){print(await readJson(p.assetManifest));return;}
 if(area==="project"){const action=args[0];
  if(action==="validate"){const report=await validateProject(await readJson(p.video));print(report);process.exitCode=report.valid?0:1;return;}
 if(action==="preflight"){const project=await readJson<VideoProject>(p.video);if(args[1]==="production"){const result=await runProductionAssetPreflight(root);print(result.report);process.exitCode=result.report.valid?0:1;return;}const result=await semanticPreflight(project);await writeJson(p.preflight,result.report);print(result.report);process.exitCode=result.report.valid?0:1;return;}
  if(action==="patch"){const file=args[1];if(!file)throw new Error("Usage: video project patch <patch.json>");const current=await readJson<VideoProject>(p.video),state=await loadProjectState(root,current);const next=applyHarnessPatch(current,parsePatchDocument(await readJson(resolve(root,file))),state.revision);const result=await validateCanonical(next);if(!result.valid){print(result);process.exitCode=1;return;}let rendererState:HyperFramesState|undefined;try{if(await exists(p.rendererState))rendererState=await readJson<HyperFramesState>(p.rendererState);}catch{}stopHyperFramesPlayer(rendererState);await writeJson(p.video,next);const nextState=await advanceProjectState(root,current,next);await persistRevision(root,next,nextState);await writeJson(p.preflight,result.preflight);await invalidateProjectDerived(root);print({ok:true,revision:nextState.revision,rendererDerivedStateInvalidated:true,validation:result.validation,preflight:result.preflight});return;}
  throw new Error("Usage: video project [validate|preflight|patch <patch>]");
 }
 if(area==="renderer"){
  const action=args[0];if(action==="options"||action==="status"){const result=await rendererOptionsForCli(root);print(result);if(args.includes("--require-all")&&result.options.some(option=>!option.available))process.exitCode=1;return;}if(action==="prepare"){print(await prepareSelectedRenderer(root));return;}if(action==="revise"){print(await reviseSelectedRenderer(root));return;}if(action==="check"){const sceneId=option(args,"--scene"),strict=args.includes("--strict");const result=await checkSelectedRenderer(root,{...(sceneId?{sceneId}:{}),strict});print(result);if(result.lint.status!=="PASS")process.exitCode=1;return;}
  if(action==="review"){print(await reviewSelectedRenderer(root));return;}
  if(action==="render"){const result=await renderSelectedRenderer(root);if("ok" in result){await commandResult(result);return;}print(result);if(result.commands.some(command=>!command.ok))process.exitCode=1;return;}
  if(action==="finalize"){print(await finalizeSelectedRenderer(root));return;}
  throw new Error("Usage: video renderer [options [--require-all]|prepare|revise|check [--scene <scene-id>] [--strict]|review|render|finalize]");
 }
 console.log(`Agent Video Harness CLI

Commands:
  video init
  video app-research bind <selection.json>|inspect|rebind <selection.json>
  video backlot [port] [--no-open]
  video archive list
  video request set <file>
  video source inspect|materialize <source-id> <asset-id> <scene-id> <role>|import-input [directory]|import <presentation.pptx|slides.pdf> [--script <per-slide-script.md>]
  video sources extract <deck.pdf|deck.pptx>|list|script <id> <script.md>|crop <id> <slide> <x> <y> <w> <h> <name>|assess template|check <id>
  video hitl status
  video clarify template|commit <file>|status
  video brief template|commit <file>|revise <file>|status
  video profile catalog|template|commit <file>|revise <file>|rebind|status
  video revision status|reconcile <report.json>
  video script commit <file>|revise <file>|status
  video tts options|doctor|synthesize <narration-input.json>|status
  video storyboard commit <file>|revise <file>|status
  video project validate|preflight [production]|patch
  video web-capture doctor|probe <recipe.json>|validate <recipe.json>|run <recipe.json>|inspect <run-id>|materialize <run-id> <artifact-id> <asset-id> <scene-id> <role> --rights-file <rights.json>
  Shared capture requires app.session.networkPolicy=capture; strict WebSocket host containment is unsupported. agent-browser 0.39.1 native binary is independent of Node; npm wrapper requires Node >=24.
  video renderer options [--require-all]|prepare|check [--scene <scene-id>] [--strict]|review|render|finalize`);
}
main().catch(e=>{console.error(e instanceof Error?e.stack:e);process.exitCode=1;});
