import {readFile,realpath} from "node:fs/promises";
import {relative,resolve} from "node:path";
import {universalHitlStatus} from "../harness/hitl-protocol.js";
import {browserDoctor} from "./app-session.js";
import {materializeCaptureArtifact} from "./materialize.js";
import {probeCaptureApp} from "./probe.js";
import {readCaptureRecipe,runCaptureRecipe} from "./run.js";
import {WebCaptureError} from "./types.js";

function usage():string{return "Usage: video web-capture <doctor|probe <recipe.json>|validate <recipe.json>|run <recipe.json>|inspect <run-id>|materialize <run-id> <artifact-id> <asset-id> <scene-id> <role> --rights-file <rights.json>";}
function errorPayload(error:unknown):Record<string,unknown>{return error instanceof WebCaptureError?{code:error.code,message:error.message,...(error.stepIndex!==undefined?{stepIndex:error.stepIndex}:{}),...(error.action?{action:error.action}:{})}:{code:"WEB_CAPTURE_FAILED",message:"Web capture command failed. Check its local inputs and prerequisites."};}
function safeRunId(value:string):boolean{return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}

export async function handleWebCaptureCli(root:string,args:string[],print:(value:unknown)=>void):Promise<void>{
  const [command,...rest]=args;
  try{
    if(command==="doctor"){
      const result=await browserDoctor(root);print(result);if(!result.ok)process.exitCode=1;return;
    }
    if(command==="validate"){
      const recipeFile=rest[0];if(!recipeFile)throw new WebCaptureError("USAGE",usage());
      const {recipe}=await readCaptureRecipe(root,recipeFile);print({ok:true,valid:true,name:recipe.name,steps:recipe.steps.length,postconditions:recipe.postconditions?.length??0,video:recipe.outputs.video??false,cursorOverlay:recipe.outputs.cursorOverlay??false});return;
    }
    if(command==="probe"){
      const recipeFile=rest[0];if(!recipeFile)throw new WebCaptureError("USAGE",usage());
      const {recipe}=await readCaptureRecipe(root,recipeFile);print(await probeCaptureApp(root,recipe.app));return;
    }
    if(command==="run"){
      const recipeFile=rest[0];if(!recipeFile)throw new WebCaptureError("USAGE",usage());
      const {recipe,bytes}=await readCaptureRecipe(root,recipeFile),result=await runCaptureRecipe(root,recipe,bytes);
      print({ok:result.status==="succeeded",runPath:relative(root,resolve(root,".video/web-capture/runs",result.id)).replaceAll("\\","/"),run:result});if(result.status!=="succeeded")process.exitCode=1;return;
    }
    if(command==="inspect"){
      const runId=rest[0];if(!runId||!safeRunId(runId))throw new WebCaptureError("INVALID_RUN_ID","A valid web-capture run ID is required.");
      const rootReal=await realpath(root),runsPath=resolve(root,".video/web-capture/runs"),actual=await realpath(resolve(runsPath,runId)),runsReal=await realpath(runsPath);
      if(relative(rootReal,runsReal).replaceAll("\\","/")!==".video/web-capture/runs"||relative(runsReal,actual)!==runId)throw new WebCaptureError("INVALID_RUN_ID","Run directory does not match its run ID or expected workspace path.");
      const result=JSON.parse(await readFile(resolve(actual,"result.json"),"utf8"));print({ok:true,run:result});return;
    }
    if(command==="materialize"){
      const [runId,artifactId,assetId,sceneId,role]=rest,rightsFileIndex=rest.indexOf("--rights-file"),rightsFile=rightsFileIndex>=0?rest[rightsFileIndex+1]:undefined;
      if(!runId||!artifactId||!assetId||!sceneId||!role||!rightsFile)throw new WebCaptureError("USAGE",usage());
      const hitl=await universalHitlStatus(root);
      if(hitl.status==="INPUT_REQUIRED"||hitl.status==="REVIEW_REQUIRED"){
        print({ok:false,error:{code:"NEEDS_USER_ACTION",message:"Surface the active HITL payload and stop before materializing a production asset."},hitl});process.exitCode=1;return;
      }
      let rights:unknown;try{rights=JSON.parse(await readFile(resolve(root,rightsFile),"utf8"));}catch{throw new WebCaptureError("INVALID_RIGHTS","Rights file could not be read as JSON.");}
      const result=await materializeCaptureArtifact(root,runId,artifactId,assetId,sceneId,role,rights);print({ok:true,...result});return;
    }
    throw new WebCaptureError("USAGE",usage());
  }catch(error){print({ok:false,error:errorPayload(error)});process.exitCode=1;}
}
