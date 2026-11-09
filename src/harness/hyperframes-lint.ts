import {spawn} from "node:child_process";
import {basename,resolve} from "node:path";
import type {LintFrame} from "../lint/types.js";
import {startHyperFramesPreviewServer} from "./hyperframes-preview.js";
import {stopLocalPlayer} from "./local-player.js";
import type {HyperFramesProjectManifest} from "./hyperframes-project.js";

const PROBE_TIMEOUT_MS=180_000;

/** Sample frames for the harness rules: every scene's start, middle, and last frame. */
export function planHyperFramesLintFrames(manifest:HyperFramesProjectManifest,sceneId?:string):{frame:number;timeSeconds:number}[]{
  const frames=new Set<number>([0,Math.max(0,manifest.durationInFrames-1)]);
  let start=0;
  for(const scene of manifest.scenes){
    const end=start+scene.durationInFrames-1;
    if(!sceneId||scene.sceneId===sceneId){frames.add(start);frames.add(start+Math.floor(scene.durationInFrames/2));frames.add(Math.max(start,end));}
    start=end+1;
  }
  return [...frames].sort((a,b)=>a-b).map((frame)=>({frame,timeSeconds:frame/manifest.fps}));
}

function runProbe(root:string,job:unknown,timeout:number):Promise<{frames:LintFrame[];measurement:string}>{
  const {promise,resolve:resolveProbe,reject}=Promise.withResolvers<{frames:LintFrame[];measurement:string}>();
  const child=spawn(process.execPath,[resolve(root,"hyperframes/scripts/run-layout-probe.mjs")],{cwd:root,stdio:["pipe","pipe","pipe"],windowsHide:true});
  let stdout="",stderr="",settled=false;
  const timer=setTimeout(()=>{if(settled)return;settled=true;child.kill("SIGKILL");reject(new Error(`HyperFrames layout probe timed out after ${timeout}ms.`));},timeout);
  child.stdout.setEncoding("utf8").on("data",(chunk:string)=>{stdout+=chunk;});
  child.stderr.setEncoding("utf8").on("data",(chunk:string)=>{stderr+=chunk;});
  child.on("error",(error:Error)=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);});
  child.on("close",(code:number|null)=>{
    if(settled)return;settled=true;clearTimeout(timer);
    if(code!==0){reject(new Error(`HyperFrames layout probe failed (exit ${code}).\n${stderr||stdout}`));return;}
    try{const parsed=JSON.parse(stdout.trim());resolveProbe({frames:parsed.frames,measurement:parsed.measurement??"hyperframes-preview-dom"});}
    catch(error){reject(new Error(`HyperFrames layout probe did not return the expected JSON shape: ${String(error)}\n${stdout.slice(0,400)}`));}
  });
  child.stdin.end(JSON.stringify(job));
  return promise;
}

/** Measures the authored HyperFrames composition in a browser for the rules the pinned CLI does not cover. */
export async function runHyperFramesLayoutProbe(root:string,input:{projectDir:string;manifest:HyperFramesProjectManifest;sceneId?:string;timeout?:number}):Promise<{frames:LintFrame[];measurement:string;error?:string}>{
  const planned=planHyperFramesLintFrames(input.manifest,input.sceneId);
  let server:{url:string;pid:number;port:number}|undefined;
  try{
    server=await startHyperFramesPreviewServer(root,input.projectDir);
    const projectName=encodeURIComponent(basename(resolve(root,input.projectDir)));
    const probed=await runProbe(root,{
      url:`${server.url}/api/projects/${projectName}/preview`,
      frames:planned,
      width:input.manifest.width,
      height:input.manifest.height,
    },input.timeout??PROBE_TIMEOUT_MS);
    return {frames:probed.frames,measurement:probed.measurement};
  }catch(error){
    return {frames:[],measurement:"hyperframes-preview-dom",error:error instanceof Error?error.message:String(error)};
  }finally{
    if(server)stopLocalPlayer({previewPid:server.pid});
  }
}
