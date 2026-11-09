import {existsSync,readdirSync} from "node:fs";
import {readFile,realpath} from "node:fs/promises";
import {spawn} from "node:child_process";
import {resolve,relative,basename} from "node:path";
import {chromium,type Browser} from "playwright-core";
import type {CaptureAppConfig,CaptureSession} from "./types.js";
import {WebCaptureError} from "./types.js";
import {isAllowedCaptureUrl} from "./validate.js";
import {agentBrowserCapability} from "../browser-session/registry.js";

function within(base:string,target:string):boolean{const from=relative(base,target);return from===""||(!from.startsWith("..")&&!from.startsWith("/")&&!from.startsWith("\\"));}
function browserCandidates(root:string,app:CaptureAppConfig):string[]{
  const env=process.env,candidates:string[]=[];
  if(app.browserExecutablePath)candidates.push(resolve(root,app.browserExecutablePath));
  for(const key of ["CHROME_PATH","CHROMIUM_PATH","PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"])if(env[key])candidates.push(env[key]!);
  try{candidates.push(chromium.executablePath());}catch{}
  const pf=env.PROGRAMFILES??"C:/Program Files",pf86=env["PROGRAMFILES(X86)"]??"C:/Program Files (x86)",local=env.LOCALAPPDATA??"";
  candidates.push(resolve(pf,"Google/Chrome/Application/chrome.exe"),resolve(pf86,"Google/Chrome/Application/chrome.exe"),resolve(pf,"Microsoft/Edge/Application/msedge.exe"));
  if(local){
    candidates.push(resolve(local,"Google/Chrome/Application/chrome.exe"));
    const playwrightRoot=resolve(local,"ms-playwright");
    try{const dirs=readdirSync(playwrightRoot,{withFileTypes:true}).filter((entry:any)=>entry.isDirectory()&&/^chromium-\d+$/.test(entry.name)).sort((a:any,b:any)=>Number(b.name.slice(9))-Number(a.name.slice(9)));
      for(const entry of dirs)candidates.push(resolve(playwrightRoot,entry.name,"chrome-win64/chrome.exe"),resolve(playwrightRoot,entry.name,"chrome-win/chrome.exe"));
    }catch{}
  }
  candidates.push("/usr/bin/chromium","/usr/bin/chromium-browser","/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  return [...new Set(candidates)];
}

export function findBrowserExecutable(root:string,app:CaptureAppConfig):string|undefined{return browserCandidates(root,app).find((path)=>existsSync(path)&&!path.endsWith("ms-playwright"));}

async function assertLocalFile(root:string,path:string,label:string):Promise<string>{
  const base=await realpath(root),candidate=resolve(root,path),actual=await realpath(candidate);
  if(!within(base,actual))throw new WebCaptureError("INVALID_RECIPE",`${label} must resolve to a file inside the project workspace.`);
  if(label==="app.auth.storageStatePath"&&!relative(base,actual).replaceAll("\\","/").startsWith(".video/"))throw new WebCaptureError("INVALID_RECIPE","Auth storage state must live under the gitignored .video/ directory.");
  if(!existsSync(actual))throw new WebCaptureError("INVALID_RECIPE",`${label} was not found.`);
  return actual;
}

async function healthy(url:string):Promise<boolean>{try{const response=await fetch(url,{signal:AbortSignal.timeout(1000)});return response.ok;}catch{return false;}}
async function stopOwnedServer(child:any):Promise<void>{
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise<void>((resolveStop)=>{
    let settled=false;const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);resolveStop();};
    const timer=setTimeout(finish,5000);child.once("exit",finish);try{child.kill();}catch{finish();}
  });
}
async function startConfiguredServer(root:string,app:CaptureAppConfig):Promise<any|undefined>{
  const config=app.server;if(!config||await healthy(config.healthUrl))return undefined;
  const rootReal=await realpath(root),cwd=await realpath(resolve(root,config.cwd));
  if(!within(rootReal,cwd))throw new WebCaptureError("INVALID_RECIPE","app.server.cwd must resolve inside the project workspace.");
  const child=spawn(config.command,config.args,{cwd,stdio:"ignore",shell:false,windowsHide:true});
  let exited=false;child.once("exit",()=>{exited=true;});
  const deadline=Date.now()+(config.startTimeoutMs??15000);
  while(Date.now()<deadline){
    if(exited)throw new WebCaptureError("APP_START_FAILED","Configured app server exited before its health URL became ready.");
    if(await healthy(config.healthUrl))return child;
    await new Promise((resolvePromise)=>setTimeout(resolvePromise,250));
  }
  await stopOwnedServer(child);
  throw new WebCaptureError("APP_START_FAILED","Configured app server did not become healthy before the start timeout.");
}

export async function launchCaptureSession(root:string,app:CaptureAppConfig):Promise<CaptureSession>{
  const storageState=app.auth?.storageStatePath?await assertLocalFile(root,app.auth.storageStatePath,"app.auth.storageStatePath"):undefined;
  const executable=findBrowserExecutable(root,app);
  if(!executable)throw new WebCaptureError("BROWSER_UNAVAILABLE","No local Chromium/Chrome executable was found. Set app.browserExecutablePath or CHROME_PATH; browser downloads are disabled.");
  const server=await startConfiguredServer(root,app);let browser:Browser|undefined;
  let context:CaptureSession["context"]|undefined;
  try{
    const launchOptions:{headless:boolean;executablePath:string;timeout:number}={headless:app.headless??true,executablePath:executable,timeout:20000};
    browser=await chromium.launch(launchOptions);
    context=await browser.newContext({viewport:app.viewport??{width:1280,height:720},deviceScaleFactor:app.dpr??1,locale:"en-US",extraHTTPHeaders:{"Accept-Language":"en-US,en;q=0.9"},...(storageState?{storageState}:{})});
    await context.route("**/*",async(route)=>{
      const request=route.request();
      if(request.isNavigationRequest()&&!isAllowedCaptureUrl(request.url(),app)){await route.abort("blockedbyclient");return;}
      await route.continue();
    });
    const page=await context.newPage();page.setDefaultTimeout(app.actionTimeoutMs??10000);page.setDefaultNavigationTimeout(app.navigationTimeoutMs??20000);
    await navigateAndReady(page,app.url,app);
    let clockEnabled=false;
    if(app.clock??false){
      try{
        await page.clock.install();clockEnabled=true;
        const probe=page.evaluate(()=>new Promise<boolean>((resolveProbe)=>setTimeout(()=>resolveProbe(true),50)));
        await page.clock.runFor(51);
        if(!(await probe))throw new Error("timer did not advance");
      }catch{throw new WebCaptureError("CLOCK_UNAVAILABLE","Configured fake clock could not be verified.");}
    }
    const close=async()=>{try{await context?.close();}catch{}try{await browser?.close();}catch{}await stopOwnedServer(server);};
    return {browser,context,page,clockEnabled,ownership:"owned",viewport:app.viewport??{width:1280,height:720},deviceScaleFactor:app.dpr??1,close};
  }catch(error){try{await context?.close();}catch{}try{await browser?.close();}catch{}await stopOwnedServer(server);throw error;}
}

export async function navigateAndReady(page:CaptureSession["page"],url:string,app:CaptureAppConfig):Promise<void>{
  if(!isAllowedCaptureUrl(url,app))throw new WebCaptureError("INVALID_RECIPE","Navigation target is outside the configured host allowlist.");
  let timer:any;
  try{
    const timeout=app.navigationTimeoutMs??20000;
    await page.goto(new URL(url,app.url).href,{waitUntil:"domcontentloaded",timeout});
    await Promise.race([page.evaluate(()=>document.fonts.ready.then(()=>true)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("font readiness timeout")),timeout);})]);
    if(!isAllowedCaptureUrl(page.url(),app))throw new WebCaptureError("APP_NOT_READY","The app redirected to a host outside the configured allowlist.");
  }catch(error){if(error instanceof WebCaptureError)throw error;throw new WebCaptureError("APP_NOT_READY","App navigation or font readiness failed.");}
  finally{if(timer)clearTimeout(timer);}
}

export async function waitForCapturePageReady(page:CaptureSession["page"],app:CaptureAppConfig):Promise<void>{
  let timer:any;
  try{
    const timeout=app.navigationTimeoutMs??20000;
    await page.waitForLoadState("domcontentloaded",{timeout});
    await Promise.race([page.evaluate(()=>document.fonts.ready.then(()=>true)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("font readiness timeout")),timeout);})]);
    if(!isAllowedCaptureUrl(page.url(),app))throw new WebCaptureError("APP_NOT_READY","The app redirected to a host outside the configured allowlist.");
  }catch(error){if(error instanceof WebCaptureError)throw error;throw new WebCaptureError("APP_NOT_READY","App navigation or font readiness failed.");}
  finally{if(timer)clearTimeout(timer);}
}

export async function browserDoctor(root:string,app:CaptureAppConfig={url:"http://127.0.0.1"}):Promise<Record<string,unknown>>{
  const browser=findBrowserExecutable(root,app),ffmpeg=findExecutable("ffmpeg",root),ffprobe=findExecutable("ffprobe",root);
  const cutroomCursorRenderer=existsSync(resolve(root,"cutroom/toolkit/node_modules/@remotion/cli/remotion-cli.js"));
  let playwrightCore:{available:boolean;expected:string|null;installed:string|null}={available:false,expected:null,installed:null};
  try{
    const manifest=JSON.parse(await readFile(resolve(root,"package.json"),"utf8")),installed=JSON.parse(await readFile(resolve(root,"node_modules/playwright-core/package.json"),"utf8"));
    const expected=manifest.dependencies?.["playwright-core"];
    playwrightCore={available:typeof expected==="string"&&/^\d+\.\d+\.\d+$/.test(expected)&&installed.version===expected,expected:typeof expected==="string"?expected:null,installed:typeof installed.version==="string"?installed.version:null};
  }catch{}
  const agentBrowser=await agentBrowserCapability(),borrowedConnectionReady=agentBrowser.available&&agentBrowser.version==="0.39.1"&&playwrightCore.available;
  return {ok:Boolean(browser&&ffmpeg&&ffprobe&&playwrightCore.available),browser:{available:Boolean(browser),executable:browser?basename(browser):null},ffmpeg:{available:Boolean(ffmpeg),executable:ffmpeg?basename(ffmpeg):null},ffprobe:{available:Boolean(ffprobe),executable:ffprobe?basename(ffprobe):null},playwrightCore,sharedBrowser:{connectionReady:borrowedConnectionReady,agentBrowser,limitations:["Shared capture requires an explicitly registered owner session, fresh target lookup, and explicit app.session.networkPolicy 'capture'. Strict host containment is unsupported and fails closed.","The pinned 0.39.1 native agent-browser binary can run independently of Node; its npm wrapper requires Node >=24.","Shared target mapping uses Playwright public context.newCDPSession(page) and Target.getTargetInfo; exact pinned-version behavior is covered by the synthetic handoff test.","An external CDP client does not inherit agent-browser allowed-domains; capture installs HTTP(S) request and navigation checks.","Capture-mode shared sessions do not filter WebSocket hosts or pre-existing network channels; a disallowed WebSocket may connect.","Loopback hosts remain implicitly allowed by the existing capture URL policy, independently of allowedHosts.","Any existing HTTP(S) service worker fails closed, including workers on hosts outside allowedHosts; browser-owned non-HTTP extension workers are distinct."]},cutroom:{cursorOverlayAvailable:cutroomCursorRenderer},downloadsDisabled:true,limitations:[...(!browser?["Local Chromium/Chrome was not found; owned launch prerequisites are unavailable; doctor does not download browsers."]:[]),...(!ffmpeg?["FFmpeg was not found on PATH; MP4 encoding is unavailable."]:[]),...(!ffprobe?["ffprobe was not found on PATH; media verification is unavailable."]:[]),...(!playwrightCore.available?["Installed playwright-core does not match an exact version pin in package.json."]:[]),...(!agentBrowser.available?["No external agent-browser executable is available for shared-session resolution."]:[]),...(agentBrowser.available&&agentBrowser.version!=="0.39.1"?["External agent-browser version differs from the researched 0.39.1 baseline; inspect compatibility before binding sessions."]:[]),...(!cutroomCursorRenderer?["Cutroom cursor overlay is unavailable; run npm ci in cutroom/toolkit to enable it."]:[])]};
}

export function findExecutable(name:string,root=process.cwd()):string|undefined{
  const windows=process.platform==="win32",binary=windows?`${name}.exe`:name,search=process.env.PATH??"",configured=process.env[`${name.toUpperCase()}_PATH`];
  if(configured&&existsSync(configured))return configured;
  for(const directory of search.split(windows?";":":").filter(Boolean)){const candidate=resolve(directory,binary);if(existsSync(candidate))return candidate;}
  try{const remotionScope=resolve(root,"remotion/node_modules/@remotion");for(const entry of readdirSync(remotionScope,{withFileTypes:true}) as any[]){if(entry.isDirectory()&&entry.name.startsWith("compositor-")&&!entry.name.includes("darwin")&&!entry.name.includes("linux")&&process.platform==="win32"){const candidate=resolve(remotionScope,entry.name,binary);if(existsSync(candidate))return candidate;}else if(entry.isDirectory()&&entry.name.startsWith("compositor-")&&entry.name.includes(process.platform)){const candidate=resolve(remotionScope,entry.name,binary);if(existsSync(candidate))return candidate;}}}catch{}
  return undefined;
}
