import {spawn} from "node:child_process";
import {mkdir,realpath,rm,stat,writeFile} from "node:fs/promises";
import {relative,resolve} from "node:path";
import type {CaptureTimeline} from "./types.js";
import {findBrowserExecutable,findExecutable} from "./app-session.js";
import {inspectH264Video,type EncodedVideo} from "./encode.js";
import {WebCaptureError} from "./types.js";

interface ProcessResult {code:number|null;stderr:string;}

function inside(base:string,target:string):boolean{
  const from=relative(base,target);return from===""||(!from.startsWith("..")&&!from.startsWith("/")&&!from.startsWith("\\"));
}

function runProcess(file:string,args:string[],cwd:string,timeoutMs=600000):Promise<ProcessResult>{
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(file,args,{cwd,shell:false,windowsHide:true,stdio:["ignore","ignore","pipe"]});let stderr="",settled=false;
    const timer=setTimeout(()=>{if(settled)return;settled=true;try{child.kill();}catch{}reject(new WebCaptureError("CURSOR_RENDER_FAILED","Cutroom cursor rendering exceeded its execution timeout."));},timeoutMs);
    child.stderr?.on("data",(chunk:Uint8Array)=>{if(stderr.length<100000)stderr+=Buffer.from(chunk).toString("utf8");});
    child.once("error",()=>{if(settled)return;settled=true;clearTimeout(timer);reject(new WebCaptureError("CUTROOM_UNAVAILABLE","Could not start Cutroom's local Remotion renderer."));});
    child.once("close",(code:number|null)=>{if(settled)return;settled=true;clearTimeout(timer);resolvePromise({code,stderr});});
  });
}

function playbackTimeline(timeline:CaptureTimeline):Record<string,unknown>{
  const dpr=timeline.deviceScaleFactor;
  return {
    fps:timeline.fps,
    viewport:{width:timeline.outputWidth,height:timeline.outputHeight},
    deviceScaleFactor:1,
    comp:{width:timeline.outputWidth,height:timeline.outputHeight},
    frames:timeline.frames,
    cameraKeys:timeline.cameraKeys.map((key)=>({...key,fx:key.fx*dpr,fy:key.fy*dpr})),
    cursorKeys:timeline.cursorKeys.map((key)=>({...key,x:key.x*dpr,y:key.y*dpr})),
    clicks:timeline.clicks.map((click)=>({...click,x:click.x*dpr,y:click.y*dpr})),
    markers:timeline.markers,
  };
}

export async function renderCutroomCursorOverlay(
  root:string,
  runDirectory:string,
  runId:string,
  source:EncodedVideo,
  timeline:CaptureTimeline,
  maxBytes:number,
):Promise<EncodedVideo>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId))throw new WebCaptureError("CURSOR_RENDER_FAILED","Capture run ID is invalid for Cutroom staging.");
  const toolkitRoot=resolve(root,"cutroom","toolkit"),propsFile=resolve(runDirectory,"cutroom-cursor-props.json"),output=resolve(runDirectory,"capture-with-cursor.mp4");
  const rootReal=await realpath(root);let toolkitReal:string;try{toolkitReal=await realpath(toolkitRoot);}catch{throw new WebCaptureError("CUTROOM_UNAVAILABLE","Cutroom toolkit workspace was not found.");}
  if(!inside(rootReal,toolkitReal)||relative(rootReal,toolkitReal).replaceAll("\\","/")!=="cutroom/toolkit")throw new WebCaptureError("UNSAFE_OUTPUT_PATH","Cutroom toolkit must stay inside the project workspace.");
  const publicRoot=resolve(toolkitReal,"public");await mkdir(publicRoot,{recursive:true});
  const publicReal=await realpath(publicRoot);if(!inside(toolkitReal,publicReal))throw new WebCaptureError("UNSAFE_OUTPUT_PATH","Cutroom public assets must stay inside the toolkit workspace.");
  const sceneParent=resolve(publicReal,"web-capture"),relativeScene=`web-capture/${runId}`;
  if(!inside(publicReal,sceneParent))throw new WebCaptureError("UNSAFE_OUTPUT_PATH","Cutroom capture staging path escapes the toolkit public directory.");
  const ffmpeg=findExecutable("ffmpeg",root),browser=findBrowserExecutable(root,{url:"http://127.0.0.1"});
  const cli=resolve(toolkitReal,"node_modules","@remotion","cli","remotion-cli.js");
  if(!ffmpeg||!browser)throw new WebCaptureError("CUTROOM_UNAVAILABLE","Cutroom cursor rendering needs the local FFmpeg and Chrome/Chromium prerequisites.");
  try{await stat(cli);}catch{throw new WebCaptureError("CUTROOM_UNAVAILABLE","Cutroom Remotion dependencies are not installed. Run npm ci in cutroom/toolkit.");}
  try{await stat(output);throw new WebCaptureError("OUTPUT_EXISTS","Cutroom cursor output already exists for this capture run.");}catch(error){if(error instanceof WebCaptureError)throw error;if((error as {code?:string}).code!=="ENOENT")throw error;}
  await mkdir(sceneParent,{recursive:true});const sceneParentReal=await realpath(sceneParent);
  if(!inside(publicReal,sceneParentReal)||relative(publicReal,sceneParentReal).replaceAll("\\","/")!=="web-capture")throw new WebCaptureError("UNSAFE_OUTPUT_PATH","Cutroom staging parent resolved outside the toolkit public directory.");
  const sceneDirectory=resolve(sceneParentReal,runId);
  try{await mkdir(sceneDirectory);}catch(error){if((error as {code?:string}).code==="EEXIST")throw new WebCaptureError("OUTPUT_EXISTS","Cutroom staging already exists for this capture run.");throw error;}
  let sceneReal:string|undefined;
  try{
    sceneReal=await realpath(sceneDirectory);if(!inside(publicReal,sceneReal)||relative(publicReal,sceneReal).replaceAll("\\","/")!==relativeScene)throw new WebCaptureError("UNSAFE_OUTPUT_PATH","Cutroom staging resolved outside its unique capture folder.");
    const stagedVideo=resolve(sceneReal,"frames.mov"),stagedTimeline=resolve(sceneReal,"timeline.json");
    const remux=await runProcess(ffmpeg,["-hide_banner","-loglevel","error","-n","-i",source.file,"-map","0:v:0","-c:v","copy","-an","-movflags","+faststart",stagedVideo],toolkitReal);
    if(remux.code!==0)throw new WebCaptureError("CURSOR_RENDER_FAILED","Cutroom could not prepare the captured video for playback.");
    await writeFile(stagedTimeline,JSON.stringify(playbackTimeline(timeline),null,2),{encoding:"utf8",flag:"wx"});
    await writeFile(propsFile,JSON.stringify({scene:relativeScene}),{encoding:"utf8",flag:"wx"});
    const rendered=await runProcess(process.execPath,[cli,"render","ScreenDemo",output,`--props=${propsFile}`,`--browser-executable=${browser}`,"--codec=h264","--pixel-format=yuv420p","--muted","--concurrency=1"],toolkitReal);
    if(rendered.code!==0)throw new WebCaptureError("CURSOR_RENDER_FAILED","Cutroom could not render the cursor and click ripples over the captured video.");
    return await inspectH264Video(root,output,timeline.frames,timeline.fps,maxBytes);
  }finally{
    try{await rm(propsFile,{force:true});}catch{}
    try{
      const currentPublic=await realpath(publicRoot),currentScene=await realpath(sceneDirectory);
      if(inside(currentPublic,currentScene)&&relative(currentPublic,currentScene).replaceAll("\\","/")===relativeScene)await rm(currentScene,{recursive:true,force:true});
    }catch{}
  }
}
