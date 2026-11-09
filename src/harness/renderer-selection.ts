import {resolve} from "node:path";
import {readdir} from "node:fs/promises";
import {sha256} from "../core/hash.js";
import {readJson,writeJson} from "../core/io.js";
import {exists,requireFile} from "./fs.js";
import {harnessPaths} from "./paths.js";
import {requestHash} from "./request.js";
import {readPinnedRemotionVersion} from "./remotion-version.js";

export type RendererId="remotion"|"hyperframes";
export interface RendererAvailability {
  id:RendererId;
  label:string;
  available:boolean;
  version?:string;
  reason?:string;
  bestFor:string;
  tradeoff:string;
  recommended?:boolean;
  recommendationRationale?:string;
  alternativeTradeoff?:string;
}
export interface RendererSelection {
  version:"1";
  requestHash:string;
  briefHash:string;
  selected:RendererId;
  selectedBy:"HUMAN";
  selectedAt:string;
  rationale:string;
  optionsConsidered:RendererAvailability[];
  history:Array<{selected:RendererId;selectedAt:string;rationale:string}>;
}
const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==="object"&&value!==null&&!Array.isArray(value);
function validAvailability(value:unknown):value is RendererAvailability{
  if(!isRecord(value)||!(value.id==="remotion"||value.id==="hyperframes")||typeof value.label!=="string"||typeof value.available!=="boolean"||typeof value.bestFor!=="string"||typeof value.tradeoff!=="string")return false;
  return ["version","reason","recommendationRationale","alternativeTradeoff"].every(key=>value[key]===undefined||typeof value[key]==="string")&&(value.recommended===undefined||typeof value.recommended==="boolean");
}

const descriptions:Record<RendererId,{label:string;bestFor:string;tradeoff:string}>={
  remotion:{label:"Remotion",bestFor:"React/TypeScript compositions, reusable React scenes, and frame-addressed animation.",tradeoff:"Requires the nested Remotion packages and a local Chromium-based browser; its generated TSX needs its own authoring and review pass."},
  hyperframes:{label:"HyperFrames",bestFor:"HTML/CSS compositions edited in HyperFrames Studio, with native DOM layers and seekable motion.",tradeoff:"Requires the pinned HyperFrames CLI, local browser, and the repository's HTML/CSS authoring contract."},
};

const HYPERFRAMES_VERSION="0.8.50" as const;

/** Adds the brief-specific recommendation to otherwise runtime-only options. */
export function rendererOptionsForBrief(options:RendererAvailability[],recommendation?:{renderer?:unknown;rationale?:string;alternativeTradeoff?:string}):RendererAvailability[]{
  return options.map(option=>({
    ...option,
    ...(recommendation?{recommended:recommendation.renderer===option.id}:{}),
    ...(recommendation&&recommendation.renderer===option.id&&recommendation.rationale?{recommendationRationale:recommendation.rationale}:{}),
    ...(recommendation&&recommendation.renderer!==option.id&&recommendation.alternativeTradeoff?{alternativeTradeoff:recommendation.alternativeTradeoff}:{}),
  }));
}

/** Reads an installed package version without resolving remote packages. */
async function packageVersion(path:string):Promise<string|undefined>{
  try{const pkg=await readJson<{version?:unknown}>(path);return typeof pkg.version==="string"?pkg.version:undefined;}catch{return undefined;}
}

/** Finds an installed Chrome-family browser without downloading one. */
async function localBrowserAvailable():Promise<boolean>{
  const configured=[process.env.REMOTION_BROWSER_EXECUTABLE,process.env.CHROME_PATH,process.env.CHROMIUM_PATH].filter((value):value is string=>Boolean(value));
  const macCandidates=process.platform==="darwin"?[
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ...(await readdir("/Applications").catch(()=>[] as string[])).flatMap((app:string)=>{
      if(!/^(Google Chrome|Chromium|Microsoft Edge)(?: .*)?\.app$/i.test(app))return [];
      const binary=/^google chrome/i.test(app)?"Google Chrome":/^microsoft edge/i.test(app)?"Microsoft Edge":"Chromium";
      return [resolve("/Applications",app,"Contents","MacOS",binary)];
    }),
  ]:[];
  const candidates=process.platform==="darwin"?macCandidates:process.platform==="win32"?[process.env.PROGRAMFILES,process.env["PROGRAMFILES(X86)"],process.env.LOCALAPPDATA].filter(Boolean).flatMap(base=>[resolve(base!,"Google/Chrome/Application/chrome.exe"),resolve(base!,"Microsoft/Edge/Application/msedge.exe")]):["/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser","/usr/bin/microsoft-edge"];
  for(const path of [...configured,...candidates])if(await exists(path))return true;
  return false;
}

/** Reports locally installed renderer runtimes without invoking package managers. */
export async function rendererAvailability(root=process.cwd()):Promise<RendererAvailability[]>{
  const p=harnessPaths(root),nodeMajor=Number(process.versions.node.split(".")[0]);
  const remotionPackage=resolve(p.remotion,"node_modules/remotion/package.json"),remotionCli=resolve(p.remotion,"node_modules/.bin",process.platform==="win32"?"remotion.cmd":"remotion");
  const pinnedRemotionVersion=await readPinnedRemotionVersion(p.remotion).catch(()=>undefined),remotionVersion=await packageVersion(remotionPackage),remotionInstalled=Boolean(pinnedRemotionVersion&&remotionVersion===pinnedRemotionVersion&&await exists(remotionCli));
  const hyperframesPackage=resolve(p.hyperframes,"node_modules/hyperframes/package.json"),hyperframesBin=resolve(p.hyperframes,"node_modules/.bin",process.platform==="win32"?"hyperframes.cmd":"hyperframes");
  const hyperframesVersion=await packageVersion(hyperframesPackage),hyperframesInstalled=Boolean(hyperframesVersion===HYPERFRAMES_VERSION&&await exists(hyperframesBin));
  const remotionContractReady=await exists(resolve(p.remotion,"AUTHORING.md"))&&await exists(resolve(p.remotion,"scripts/loopback-only.mjs"))&&await exists(resolve(p.agentVideoSkill,"references/remotion-handoff.md"));
  const browserAvailable=await localBrowserAvailable();
  const remotionReady=remotionInstalled&&nodeMajor>=22&&remotionContractReady&&browserAvailable;
  const hyperframesReady=hyperframesInstalled&&nodeMajor>=22&&browserAvailable;
  return [
    {...descriptions.remotion,id:"remotion",available:remotionReady,...(remotionVersion?{version:remotionVersion}:{}),...(!remotionInstalled?{reason:pinnedRemotionVersion?`Install the pinned Remotion ${pinnedRemotionVersion} packages with repository setup.`:"remotion/package.json must pin an exact Remotion version in dependencies.remotion."}:nodeMajor<22?{reason:"Node.js 22 or later is required by the harness."}:!remotionContractReady?{reason:"The repository-owned Remotion handoff or loopback contract is missing."}:!browserAvailable?{reason:"Install Chrome/Chromium or set REMOTION_BROWSER_EXECUTABLE to a local browser."}:{})},
    {...descriptions.hyperframes,id:"hyperframes",available:hyperframesReady,...(hyperframesVersion?{version:hyperframesVersion}:{}),...(!hyperframesInstalled?{reason:`Install the pinned HyperFrames ${HYPERFRAMES_VERSION} CLI with repository setup.`}:nodeMajor<22?{reason:"Node.js 22 or later is required by HyperFrames."}:!browserAvailable?{reason:"Install Chrome/Chromium or set CHROME_PATH to a local browser."}:{})},
  ];
}

/** Validates and persists an explicit human renderer choice for the approved brief. */
export async function selectRenderer(root:string,id:RendererId,rationale:string,actor:"HUMAN"="HUMAN"):Promise<RendererSelection>{
  if(id!=="remotion"&&id!=="hyperframes")throw new Error("Renderer must be 'remotion' or 'hyperframes'.");
  if(!rationale.trim())throw new Error("Renderer selection requires a user-choice rationale.");
  const p=harnessPaths(root);await requireFile(p.videoBrief,"Approved Video Brief");
  const brief=await readJson<Record<string,unknown>>(p.videoBrief);
  if(brief.status!=="approved"||brief.approvedBy!=="HUMAN")throw new Error("A human-approved Video Brief is required before selecting a renderer.");
  const recommendation=brief.rendererRecommendation as Record<string,unknown>|undefined;
  if(!recommendation||(recommendation.renderer!=="remotion"&&recommendation.renderer!=="hyperframes")||typeof recommendation.rationale!=="string"||!recommendation.rationale.trim()||typeof recommendation.alternativeTradeoff!=="string"||!recommendation.alternativeTradeoff.trim())throw new Error("Video Brief must include a concrete renderer recommendation and alternative tradeoff before renderer selection.");
  if(brief.requestHash!==await requestHash(root))throw new Error("Video Brief belongs to a different request.");
  const options=rendererOptionsForBrief(await rendererAvailability(root),recommendation),chosen=options.find(option=>option.id===id);
  if(!chosen?.available)throw new Error(`${id} is unavailable: ${chosen?.reason??"runtime could not be detected"}`);
  let previous:RendererSelection|undefined;
  try{previous=await readJson<RendererSelection>(p.rendererSelection);}catch{}
  if(previous&&previous.selected!==id){
    const rendererState=await exists(p.rendererState),remotionState=await exists(p.remotionRendererState);
    if(rendererState||remotionState)throw new Error("Renderer selection is locked after renderer preparation. Preserve the current workspace and start a new project revision to switch.");
  }
  const briefHash=sha256(JSON.stringify(brief)),now=new Date().toISOString();
  const history=previous?.history??[];
  if(previous&&previous.selected!==id)history.push({selected:previous.selected,selectedAt:previous.selectedAt,rationale:previous.rationale});
  const selection:RendererSelection={version:"1",requestHash:await requestHash(root),briefHash,selected:id,selectedBy:actor,selectedAt:now,rationale:rationale.trim(),optionsConsidered:options,history};
  await writeJson(p.rendererSelection,selection);return selection;
}

/** Loads the renderer choice and rejects stale brief or request bindings. */
export async function loadRendererSelection(root:string):Promise<RendererSelection>{
  const p=harnessPaths(root);await requireFile(p.rendererSelection,"Renderer selection");
  const selection=await readJson<RendererSelection>(p.rendererSelection),brief=await readJson<Record<string,unknown>>(p.videoBrief);
  const raw=selection as unknown as Record<string,unknown>;
  if(!isRecord(raw))throw new Error("Renderer selection has an invalid schema.");
  const historyValid=Array.isArray(raw.history)&&raw.history.every(item=>isRecord(item)&&(item.selected==="remotion"||item.selected==="hyperframes")&&typeof item.selectedAt==="string"&&!Number.isNaN(Date.parse(item.selectedAt))&&typeof item.rationale==="string"&&Boolean(item.rationale.trim()));
  if(raw.version!=="1"||(raw.selected!=="remotion"&&raw.selected!=="hyperframes")||raw.selectedBy!=="HUMAN"||typeof raw.requestHash!=="string"||typeof raw.briefHash!=="string"||typeof raw.selectedAt!=="string"||Number.isNaN(Date.parse(raw.selectedAt))||typeof raw.rationale!=="string"||!raw.rationale.trim()||!Array.isArray(raw.optionsConsidered)||!raw.optionsConsidered.every(validAvailability)||new Set(raw.optionsConsidered.map(option=>option.id)).size!==raw.optionsConsidered.length||!historyValid)throw new Error("Renderer selection has an invalid schema.");
  if(selection.requestHash!==await requestHash(root)||brief.requestHash!==selection.requestHash)throw new Error("Renderer selection belongs to a different request.");
  if(selection.briefHash!==sha256(JSON.stringify(brief))||brief.status!=="approved"||brief.approvedBy!=="HUMAN")throw new Error("Renderer selection is stale or its Video Brief is not human-approved.");
  const selected=selection.optionsConsidered.find(option=>option.id===selection.selected),current=await rendererAvailability(root),runtime=current.find(option=>option.id===selection.selected);
  if(!selected?.available||!runtime?.available)throw new Error(`Selected renderer '${selection.selected}' is no longer available. ${runtime?.reason??"Re-check runtime setup before authoring."}`);
  return selection;
}

/** Reads a selection when present and returns undefined for legacy projects. */
export async function optionalRendererSelection(root:string):Promise<RendererSelection|undefined>{
  const path=harnessPaths(root).rendererSelection;if(!(await exists(path)))return undefined;return loadRendererSelection(root);
}
