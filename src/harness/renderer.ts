import {finalizeHyperFrames,hyperFramesHitlStatus,prepareHyperFrames,renderHyperFrames,startHyperFramesVisualReview,checkHyperFrames,approveHyperFramesVisualReview,reviseHyperFrames} from "./hyperframes.js";
import {approveRemotionVisualReview,checkRemotion,finalizeRemotion,prepareRemotion,remotionHitlStatus,renderRemotion,startRemotionVisualReview,reviseRemotion} from "./remotion.js";
import {loadRendererSelection,rendererAvailability,rendererOptionsForBrief,type RendererAvailability,type RendererId,type RendererSelection} from "./renderer-selection.js";
import {readJson} from "../core/io.js";
import {exists} from "./fs.js";
import {harnessPaths} from "./paths.js";
import {relative} from "node:path";
import {writeJson} from "../core/io.js";
import {normalizeFinalManifest} from "./final-manifest.js";
import {assertCheckpointCurrent} from "./reopen.js";
import {assertReconciliationCurrent} from "./reconciliation.js";
import {runRemotionLint} from "./remotion-lint.js";

/** Resolves the user's locked renderer and verifies that its runtime is installed. */
export async function selectedRenderer(root:string):Promise<RendererId>{
  const selection=await loadRendererSelection(root),available=await rendererAvailability(root),runtime=available.find(option=>option.id===selection.selected);
  if(!runtime?.available)throw new Error(`Selected renderer '${selection.selected}' is unavailable: ${runtime?.reason??"runtime could not be detected"}`);
  return selection.selected;
}

/** Returns runtime options and the current explicit selection for Backlot and CLI. */
export async function rendererOptions(root:string):Promise<{options:RendererAvailability[];selection:RendererSelection|null}>{
  let recommendation:{renderer?:unknown;rationale?:string;alternativeTradeoff?:string}|undefined;const p=harnessPaths(root);if(await exists(p.videoBrief))try{const brief=await readJson<{rendererRecommendation?:{renderer?:unknown;rationale?:string;alternativeTradeoff?:string}}>(p.videoBrief);recommendation=brief.rendererRecommendation;}catch{}
  const options=rendererOptionsForBrief(await rendererAvailability(root),recommendation);let selection=null;try{selection=await loadRendererSelection(root);}catch{}
  return {options,selection};
}

/** Prepares only the renderer explicitly selected by the human. */
export async function prepareSelectedRenderer(root:string){await assertReconciliationCurrent(root);const renderer=await selectedRenderer(root);return renderer==="hyperframes"?prepareHyperFrames(root):prepareRemotion(root);}

/** Starts a renderer-only revision for the explicitly selected adapter. */
export async function reviseSelectedRenderer(root:string){await assertReconciliationCurrent(root);const renderer=await selectedRenderer(root);return renderer==="hyperframes"?reviseHyperFrames(root):reviseRemotion(root);}

/** Runs the selected renderer's validation, evidence, and deterministic layout lint. */
export async function checkSelectedRenderer(root:string,options:{sceneId?:string;strict?:boolean}={}){
  const renderer=await selectedRenderer(root);
  if(renderer==="hyperframes")return checkHyperFrames(root,options);
  const result=await checkRemotion(root);
  const {report:lint,summary}=await runRemotionLint(root,options);
  return {...result,lint,summary};
}

/** Opens the selected renderer's local visual-review interface; a non-PASS lint blocks it. */
export async function reviewSelectedRenderer(root:string,options:{sceneId?:string;strict?:boolean}={}){
  await assertReconciliationCurrent(root);
  const renderer=await selectedRenderer(root);
  const lint=renderer==="hyperframes"?(await checkHyperFrames(root,options)).lint:(await runRemotionLint(root,options)).report;
  if(lint.status!=="PASS")throw new Error(`${renderer} layout lint is ${lint.status}. Fix the reported findings in .video/layout-lint.json before opening visual review.`);
  return renderer==="hyperframes"?startHyperFramesVisualReview(root):startRemotionVisualReview(root);
}

/** Renders only after the selected adapter has a matching human approval. */
export async function renderSelectedRenderer(root:string){await assertCheckpointCurrent(root,"VISUAL_REVIEW");const renderer=await selectedRenderer(root);return renderer==="hyperframes"?renderHyperFrames(root):renderRemotion(root);}

/** Finalizes the selected adapter and writes the renderer-neutral delivery manifest. */
export async function finalizeSelectedRenderer(root:string){
  await assertCheckpointCurrent(root,"VISUAL_REVIEW");
  const renderer=await selectedRenderer(root),result=renderer==="hyperframes"?await finalizeHyperFrames(root):await finalizeRemotion(root),source=result.manifest,p=harnessPaths(root);
  const implementationManifest=renderer==="hyperframes"?p.manifest:p.remotionManifest;
  const finalManifest=normalizeFinalManifest({renderer:source.renderer,rendererVersion:source.rendererVersion,projectId:source.projectId,revision:source.revision,projectHash:source.projectHash,productionProfileHash:source.productionProfileHash,assetManifestHash:source.assetManifestHash,sourceHash:source.sourceHash,width:source.width,height:source.height,fps:source.fps,durationInFrames:source.durationInFrames,durationSeconds:source.durationSeconds,visualApproval:source.visualApproval,check:source.check,evidence:source.evidence,output:source.output},relative(root,implementationManifest).replaceAll("\\","/"));
  await writeJson(p.finalManifest,finalManifest);return {...result,finalManifest};
}

/** Records human visual approval through the selected renderer adapter. */
export async function approveSelectedRendererReview(root:string){await assertReconciliationCurrent(root);const renderer=await selectedRenderer(root);return renderer==="hyperframes"?approveHyperFramesVisualReview(root):approveRemotionVisualReview(root);}

/** Reports review state from the selected renderer adapter. */
export async function selectedRendererHitlStatus(root:string){let renderer:RendererId;try{renderer=await selectedRenderer(root);}catch{return undefined;}return renderer==="hyperframes"?hyperFramesHitlStatus(root):remotionHitlStatus(root);}
