import assert from "node:assert/strict";
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {createServer} from "node:http";
import {relative,resolve} from "node:path";
import test from "node:test";
import {findBrowserExecutable,findExecutable} from "../src/web-capture/app-session.js";
import {materializeCaptureArtifact} from "../src/web-capture/materialize.js";
import {probeCaptureApp} from "../src/web-capture/probe.js";
import {runCaptureRecipe} from "../src/web-capture/run.js";
import {WebCaptureError,type CaptureRunResult} from "../src/web-capture/types.js";
import {handleWebCaptureCli} from "../src/web-capture/cli.js";
import {validateCaptureRecipe} from "../src/web-capture/validate.js";
import {productionAssetPreflight} from "../src/authoring/preflight.js";
import {resolveSceneAsset} from "../src/core/asset-resolution.js";
import {sha256} from "../src/core/hash.js";
import type {AssetManifest} from "../src/harness/assets.js";
import {snapshotApprovedAssets} from "../src/harness/hyperframes-project.js";
import {materializeRemotionPublicAssets} from "../src/harness/remotion.js";
import {archiveCurrentVideo,resetVideoWorkspace} from "../src/harness/archive.js";
import type {VideoProject} from "../src/core/types.js";

const repoRoot=resolve(process.cwd()),fixtureServer=resolve(repoRoot,"tests/fixtures/web-capture/server.mjs");
const browser=findBrowserExecutable(repoRoot,{url:"http://127.0.0.1"}),ffmpeg=findExecutable("ffmpeg",repoRoot),ffprobe=findExecutable("ffprobe",repoRoot);
const missingPrerequisite=!browser?"Local Chromium/Chrome is unavailable.":!ffmpeg?"Local FFmpeg is unavailable.":!ffprobe?"Local ffprobe is unavailable.":false;

function validRecipe():unknown{return {version:"1",name:"test",app:{url:"http://127.0.0.1:44001",clock:false},steps:[{action:"assertVisible",target:{role:"button",name:"Save"}}],outputs:{video:false}};}
function project():VideoProject{return {meta:{title:"Task capture fixture",width:1280,height:720,durationsInFrames:90,fps:30,theme:{palette:["#111827","#2563EB","#F8FAFC"],font:"Arial"},constraints:{style:"local-fixture",disallowed:[],motionTone:"direct"}},scenes:[{id:"scene-1",durationInFrames:90,screenText:"Task library: Demo task",visualConcept:"A local interface changes from an empty list to one saved task."}]};}
async function temporaryRoot():Promise<string>{return mkdtemp(resolve(repoRoot,"tests/.tmp-web-capture-"));}
async function removeTemporaryRoot(path:string):Promise<void>{const fromTests=relative(resolve(repoRoot,"tests"),path);if(!fromTests||fromTests===".."||fromTests.startsWith(`..${process.platform==="win32"?"\\":"/"}`)||fromTests.startsWith(process.platform==="win32"?"\\":"/"))throw new Error("Refusing to remove a path outside tests/.");await rm(path,{recursive:true,force:true});}
async function freePort():Promise<number>{return new Promise((resolvePort,reject)=>{const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const address=server.address();if(!address||typeof address==="string"){server.close();reject(new Error("Could not reserve a local fixture port."));return;}server.close((error)=>error?reject(error):resolvePort(address.port));});});}
async function waitHealth(url:string,expected:boolean,timeoutMs=8000):Promise<void>{const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){let healthy=false;try{healthy=(await fetch(url,{signal:AbortSignal.timeout(500)})).ok;}catch{}if(healthy===expected)return;await new Promise((resolveWait)=>setTimeout(resolveWait,100));}throw new Error(`Fixture health check did not reach expected=${expected}.`);}
async function stopTestProcess(child:any):Promise<void>{if(!child||child.exitCode!==null||child.signalCode!==null)return;await new Promise<void>((resolveStop)=>{let settled=false,timer:any;const finish=()=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);resolveStop();};timer=setTimeout(finish,5000);child.once("exit",finish);try{child.kill();}catch{finish();}});}
async function runCaptureCli(root:string,args:string[],timeoutMs=90000):Promise<{payload:any;stdout:string}>{return new Promise((resolveCli,rejectCli)=>{const child=spawn(process.execPath,[resolve(repoRoot,"dist/src/cli.js"),"web-capture",...args],{cwd:root,stdio:["ignore","pipe","pipe"],shell:false,windowsHide:true}),stdout:string[]=[],stderr:string[]=[];let settled=false;const finish=(error?:Error,value?:{payload:any;stdout:string})=>{if(settled)return;settled=true;clearTimeout(timer);if(error)rejectCli(error);else resolveCli(value!);};const timer=setTimeout(()=>{try{child.kill();}catch{}finish(new Error("web-capture CLI exceeded its test timeout."));},timeoutMs);child.stdout.on("data",(chunk:Uint8Array)=>stdout.push(Buffer.from(chunk).toString("utf8")));child.stderr.on("data",(chunk:Uint8Array)=>stderr.push(Buffer.from(chunk).toString("utf8")));child.once("error",(error:Error)=>finish(error));child.once("close",(code:number|null)=>{const output=stdout.join("");if(code!==0){finish(new Error(`web-capture CLI exited ${code}: ${stderr.join("")||output}`));return;}try{finish(undefined,{payload:JSON.parse(output),stdout:output});}catch{finish(new Error(`web-capture CLI returned invalid JSON: ${output}`));}});});}
function recipe(port:number,video:boolean,options:{browser:string;server?:boolean;clock?:boolean}):any{
  const origin=`http://127.0.0.1:${port}`;
  return {version:"1",name:"Create one local demo task",app:{url:`${origin}/`,browserExecutablePath:options.browser,viewport:{width:1280,height:720},dpr:1,fps:30,clock:options.clock??false,headless:true,navigationTimeoutMs:15000,actionTimeoutMs:8000,maxFrames:300,maxDurationSeconds:10,maxArtifactBytes:52428800,maxRunBytes:268435456,...(options.server?{server:{command:process.execPath,args:[fixtureServer,String(port)],cwd:".",healthUrl:`${origin}/health`,startTimeoutMs:8000}}:{})},steps:[{action:"waitFor",target:{role:"heading",name:"Task library"}},{action:"screenshot",name:"empty-state",mode:"viewport"},{action:"screenshot",name:"title",mode:"element",target:{role:"heading",name:"Task library"}},{action:"screenshot",name:"whole-page",mode:"fullPage"},{action:"marker",name:"before-create"},{action:"fill",target:{role:"textbox",name:"Task name"},value:{env:"WEB_CAPTURE_TEST_VALUE"},holdFrames:5},{action:"click",target:{role:"button",name:"Create task"},travelFrames:8,holdFrames:30},{action:"assertText",target:{role:"list",name:"Saved tasks"},text:"Demo task"},{action:"hold",frames:10},{action:"marker",name:"task-created"}],outputs:{video},postconditions:[{action:"assertText",target:{role:"list",name:"Saved tasks"},text:"Demo task"}]};
}

test("web capture recipe validation rejects unsafe URLs, ambiguous selectors, and screenshot paths",()=>{
  assert.doesNotThrow(()=>validateCaptureRecipe(validRecipe()));
  const ambiguous:any=validRecipe();ambiguous.steps[0].target={role:"button",css:"button"};assert.throws(()=>validateCaptureRecipe(ambiguous),(error:any)=>error.code==="INVALID_RECIPE");
  const traversal:any=validRecipe();traversal.steps=[{action:"screenshot",name:"../outside"}];assert.throws(()=>validateCaptureRecipe(traversal),(error:any)=>error.code==="INVALID_RECIPE");
  const remote:any=validRecipe();remote.app.url="https://example.org";assert.throws(()=>validateCaptureRecipe(remote),(error:any)=>error.code==="INVALID_RECIPE");
  const remoteGoto:any=validRecipe();remoteGoto.steps.push({action:"goto",url:"https://example.org/"});assert.throws(()=>validateCaptureRecipe(remoteGoto),(error:any)=>error.code==="INVALID_RECIPE");
  const fps:any=validRecipe();fps.app.fps=0;assert.throws(()=>validateCaptureRecipe(fps),(error:any)=>error.code==="INVALID_RECIPE");
  const frameBudget:any=validRecipe();frameBudget.outputs.video=true;frameBudget.app.maxFrames=8;frameBudget.steps=[{action:"fill",target:{role:"textbox",name:"Task name"},value:"demo",holdFrames:4}];assert.throws(()=>validateCaptureRecipe(frameBudget),(error:any)=>error.code==="INVALID_RECIPE");
});

test("production materialization requires the host-approved canonical Storyboard",async()=>{
  const root=await temporaryRoot();
  try{
    await mkdir(resolve(root,".video"),{recursive:true});await writeFile(resolve(root,"video.json"),JSON.stringify(project()),"utf8");
    await assert.rejects(()=>materializeCaptureArtifact(root,"b598b6c4-77f1-4a2b-9158-d125c7a6f6b0","screenshot-1","task-image","scene-1","product-ui-still",{rights:"Synthetic local fixture",permittedUse:"Automated tests"}),(error:any)=>error instanceof WebCaptureError&&error.code==="CANONICAL_NOT_APPROVED");
    await assert.rejects(()=>materializeCaptureArtifact(root,"b598b6c4-77f1-4a2b-9158-d125c7a6f6b0","screenshot-1","task-image","scene-1","product-ui-still",{permittedUse:"Automated tests"}),(error:any)=>error instanceof WebCaptureError&&error.code==="INVALID_RIGHTS");
    await assert.rejects(()=>materializeCaptureArtifact(root,"b598b6c4-77f1-4a2b-9158-d125c7a6f6b0","screenshot-1","invalid id","scene-1","product-ui-still",{rights:"Synthetic local fixture",permittedUse:"Automated tests"}),(error:any)=>error instanceof WebCaptureError&&error.code==="INVALID_ASSET_ID");
    await writeFile(resolve(root,"rights.json"),JSON.stringify({permittedUse:"Automated tests"}),"utf8");const cliOutput:any[]=[],previousExitCode=process.exitCode;await handleWebCaptureCli(root,["materialize","b598b6c4-77f1-4a2b-9158-d125c7a6f6b0","screenshot-1","task-image","scene-1","product-ui-still","--rights-file","rights.json"],value=>cliOutput.push(value));assert.equal((cliOutput[0] as any).error.code,"INVALID_RIGHTS");process.exitCode=previousExitCode;
    const request="Pending clarification fixture";await writeFile(resolve(root,".video/request.txt"),request,"utf8");
    await writeFile(resolve(root,".video/clarification.json"),JSON.stringify({version:"2",requestHash:sha256(request),status:"awaiting_user",questions:[{id:"q1",prompt:"Select a demo state."}]}),"utf8");
    await assert.rejects(()=>materializeCaptureArtifact(root,"b598b6c4-77f1-4a2b-9158-d125c7a6f6b0","screenshot-1","task-image","scene-1","product-ui-still",{rights:"Synthetic local fixture",permittedUse:"Automated tests"}),(error:any)=>error instanceof WebCaptureError&&error.code==="NEEDS_USER_ACTION");
  }finally{await removeTemporaryRoot(root);}
});

test("capture runs survive video init and are included in completed video archives",async()=>{
  const root=await temporaryRoot(),runFile=resolve(root,".video/web-capture/runs/fixture-run/result.json");
  try{
    await mkdir(resolve(root,".video/web-capture/runs/fixture-run"),{recursive:true});await writeFile(runFile,"{\"status\":\"succeeded\"}","utf8");
    await mkdir(resolve(root,".video/candidates"),{recursive:true});await writeFile(resolve(root,".video/candidates/old.json"),"{}","utf8");
    await resetVideoWorkspace(root);assert.equal(await readFile(runFile,"utf8"),"{\"status\":\"succeeded\"}");
    await mkdir(resolve(root,"output"),{recursive:true});await writeFile(resolve(root,"output/final.mp4"),"fixture video","utf8");
    const archived=await archiveCurrentVideo(root,new Date("2026-10-03T00:00:00.000Z"));assert.ok(archived);
    assert.equal(await readFile(resolve(root,archived!.path,"web-capture-runs/fixture-run/result.json"),"utf8"),"{\"status\":\"succeeded\"}");
  }finally{await removeTemporaryRoot(root);}
});

test("local Chromium flow creates verified PNG and MP4 and both renderer asset handoffs read the bytes",{skip:missingPrerequisite||false,timeout:120000},async()=>{
  const root=await temporaryRoot(),oldFfmpeg=process.env.FFMPEG_PATH,oldFfprobe=process.env.FFPROBE_PATH,oldFillValue=process.env.WEB_CAPTURE_TEST_VALUE;
  let existingServer:any;
  try{
    process.env.FFMPEG_PATH=ffmpeg!;process.env.FFPROBE_PATH=ffprobe!;process.env.WEB_CAPTURE_TEST_VALUE="Demo task";
    const port=await freePort(),serverUrl=`http://127.0.0.1:${port}/health`;
    existingServer=spawn(process.execPath,[fixtureServer,String(port)],{cwd:root,stdio:"ignore",shell:false,windowsHide:true});
    await waitHealth(serverUrl,true);
    const configured=recipe(port,true,{browser:browser!,clock:true,server:true}),probe=await probeCaptureApp(root,configured.app);
    assert.equal(probe.ok,true);assert.ok(Array.isArray(probe.headings));assert.ok((probe.controls as Array<Record<string,unknown>>).some((control)=>control.role==="button"&&control.name==="Create task"));assert.equal(JSON.stringify(probe).includes("Demo task"),false);
    const cliRecipePath=resolve(root,"web-capture.recipe.json");await writeFile(cliRecipePath,JSON.stringify(configured,null,2),"utf8");
    const {payload:cliResult,stdout:cliStdout}=await runCaptureCli(root,["run",cliRecipePath]);assert.equal(cliResult.ok,true,JSON.stringify(cliResult.error));
    assert.equal(cliStdout.includes("Demo task"),false,"CLI output must not contain values resolved from environment variables.");
    const result=cliResult.run as CaptureRunResult;
    assert.equal(result.status,"succeeded",JSON.stringify(result.error));assert.equal(result.postconditions.length,1);assert.equal(result.postconditions[0].passed,true);
    const screenshots=result.artifacts.filter((artifact)=>artifact.type==="image/png"),video=result.artifacts.find((artifact)=>artifact.type==="video/mp4");
    assert.equal(screenshots.length,3);assert.ok(video);assert.ok((video?.width??0)%2===0);assert.ok((video?.height??0)%2===0);assert.ok((video?.frames??0)>1);assert.equal(video?.fps,30);assert.equal(result.timeline?.frames,video?.frames);assert.equal(result.timeline?.clock,"enabled");
    assert.equal(JSON.stringify(result).includes("Demo task"),false,"run result must not copy filled demo field text");
    await waitHealth(serverUrl,true,1000);
    const persisted=JSON.parse(await readFile(resolve(root,".video/web-capture/runs",result.id,"result.json"),"utf8"));assert.equal(persisted.status,"succeeded");

    const mediaDir=resolve(root,"assets/captured-fixture");await mkdir(mediaDir,{recursive:true});
    const image=screenshots[0],copyImage="/assets/captured-fixture/screen.png",copyVideo="/assets/captured-fixture/walkthrough.mp4";
    await copyFile(resolve(root,".video/web-capture/runs",result.id,image.file),resolve(root,copyImage.slice(1)));
    await copyFile(resolve(root,".video/web-capture/runs",result.id,video!.file),resolve(root,copyVideo.slice(1)));
    const manifest:AssetManifest={version:"1",assets:[
      {id:"fixture-still",publicPath:copyImage,type:"image/png",source:"web-capture",provenance:"local test run",rights:"Synthetic in-repository fixture",permittedUse:"Automated local media handoff test",sceneIds:["scene-1"],role:"product-ui-still",width:image.width,height:image.height},
      {id:"fixture-clip",publicPath:copyVideo,type:"video/mp4",source:"web-capture",provenance:"local test run",rights:"Synthetic in-repository fixture",permittedUse:"Automated local media handoff test",sceneIds:["scene-1"],role:"product-ui-demo",width:video!.width,height:video!.height},
    ]};
    const canonical=project(),preflight=await productionAssetPreflight(canonical,manifest,root);assert.equal(preflight.report.valid,true,JSON.stringify(preflight.report.issues));
    assert.equal(resolveSceneAsset("scene-1","product-ui-still",manifest.assets),copyImage);assert.equal(resolveSceneAsset("scene-1","product-ui-demo",manifest.assets),copyVideo);
    const snapshot=await snapshotApprovedAssets(root,manifest);
    assert.equal(snapshot.assets.get("fixture-still")!.bytes.length,image.sizeBytes);
    assert.equal(snapshot.assets.get("fixture-clip")!.bytes.length,video!.sizeBytes);
    await materializeRemotionPublicAssets(root,manifest,snapshot.assets);
    assert.equal((await readFile(resolve(root,"remotion/public/assets/captured-fixture/walkthrough.mp4"))).length,video!.sizeBytes);

    const secondPort=await freePort(),owned=recipe(secondPort,false,{browser:browser!,clock:false,server:true}),stillOnly=await runCaptureRecipe(root,owned,Buffer.from(JSON.stringify(owned)));
    assert.equal(stillOnly.status,"succeeded",JSON.stringify(stillOnly.error));assert.equal(stillOnly.artifacts.some((artifact)=>artifact.type==="video/mp4"),false);assert.equal(stillOnly.timeline,undefined);
    await waitHealth(`http://127.0.0.1:${secondPort}/health`,false,5000);
    assert.equal(relative(repoRoot,root).startsWith("tests"),true);
  }finally{
    await stopTestProcess(existingServer);
    if(oldFfmpeg===undefined)delete process.env.FFMPEG_PATH;else process.env.FFMPEG_PATH=oldFfmpeg;
    if(oldFfprobe===undefined)delete process.env.FFPROBE_PATH;else process.env.FFPROBE_PATH=oldFfprobe;
    if(oldFillValue===undefined)delete process.env.WEB_CAPTURE_TEST_VALUE;else process.env.WEB_CAPTURE_TEST_VALUE=oldFillValue;
    await removeTemporaryRoot(root);
  }
});
