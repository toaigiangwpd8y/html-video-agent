import {createHash,randomUUID} from "node:crypto";
import {mkdir,readFile,realpath,rename,rm,stat,writeFile} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {resolve,relative} from "node:path";
import {writeJson} from "../core/io.js";
import {sha256Hex} from "../core/hash.js";
import type {CaptureArtifact,CaptureAppConfig,CaptureDirector,CaptureRecipe,CaptureRunResult,CaptureStep,LocatorSpec,SkippedStep} from "./types.js";
import {WebCaptureError} from "./types.js";
import {launchCaptureSession,navigateAndReady,waitForCapturePageReady} from "./app-session.js";
import {attachBorrowedSession,assertCaptureIdentity} from "../browser-session/attach.js";
import {readSessionBinding,resolveSession} from "../browser-session/registry.js";
import {writeCaptureProgress} from "./progress.js";
import {createCaptureDirector} from "./director.js";
import {encodePngSequence} from "./encode.js";
import {renderCutroomCursorOverlay} from "./cutroom-renderer.js";
import {isAllowedCaptureUrl,validateCaptureRecipe} from "./validate.js";

function samePath(a:string,b:string):boolean{return process.platform==="win32"?a.toLowerCase()===b.toLowerCase():a===b;}
async function createSafeRunDirectory(root:string):Promise<{id:string;path:string}>{
  const rootReal=await realpath(root);let cursor=rootReal;
  for(const segment of [".video","web-capture","runs"]){
    const next=resolve(cursor,segment);try{await mkdir(next);}catch(error){if((error as {code?:string}).code!=="EEXIST")throw error;}
    const actual=await realpath(next);if(!samePath(next,actual))throw new WebCaptureError("UNSAFE_OUTPUT_PATH","Web capture output path contains a symlink or resolves outside its expected directory.");cursor=actual;
  }
  for(let attempt=0;attempt<4;attempt++){
    const id=randomUUID(),path=resolve(cursor,id);try{await mkdir(path);return {id,path};}catch(error){if((error as {code?:string}).code!=="EEXIST")throw error;}
  }
  throw new WebCaptureError("CAPTURE_FAILED","Could not allocate a unique web capture run directory.");
}

function resolveLocator(page:any,spec:LocatorSpec):any{
  let scope=spec.within?resolveLocator(page,spec.within):page;
  if(spec.role)return scope.getByRole(spec.role,{...(spec.name!==undefined?{name:spec.name}:{}),...(spec.exact!==undefined?{exact:spec.exact}:{})});
  if(spec.text)return scope.getByText(spec.text,{...(spec.exact!==undefined?{exact:spec.exact}:{})});
  if(spec.testId)return scope.getByTestId(spec.testId);
  return scope.locator(spec.css);
}
async function checkedLocator(page:any,spec:LocatorSpec,timeout:number):Promise<any>{
  let locator=resolveLocator(page,spec);
  if(spec.first)locator=locator.first();
  else if(spec.index!==undefined)locator=locator.nth(spec.index);
  try{await locator.waitFor({state:"visible",timeout});}catch{throw new WebCaptureError("TARGET_NOT_FOUND","Capture selector did not match a visible element.");}
  const count=await locator.count();
  if(spec.first===undefined&&spec.index===undefined&&count>1)throw new WebCaptureError("AMBIGUOUS_TARGET","Capture selector matched more than one element.");
  if(count===0)throw new WebCaptureError("TARGET_NOT_FOUND","Capture selector did not match an element.");
  return locator;
}
function slug(value:string):string{return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,50)||"asset";}
function pngDimensions(bytes:Uint8Array):{width:number;height:number}{
  if(bytes.length<24||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71)throw new WebCaptureError("INVALID_ARTIFACT","Screenshot is not a valid PNG file.");
  return {width:(bytes[16]<<24)|(bytes[17]<<16)|(bytes[18]<<8)|bytes[19],height:(bytes[20]<<24)|(bytes[21]<<16)|(bytes[22]<<8)|bytes[23]};
}
async function hashFile(path:string):Promise<string>{const hash=createHash("sha256");for await(const chunk of createReadStream(path))hash.update(chunk as Uint8Array);return hash.digest("hex");}
function sanitizedUrl(raw:string):string{try{const url=new URL(raw);url.username="";url.password="";url.search="";url.hash="";return url.href;}catch{return "[invalid-url]";}}
function publicConfig(app:CaptureAppConfig):Record<string,unknown>{
  return {url:sanitizedUrl(app.url),allowedHosts:app.allowedHosts??[],...(app.viewport?{viewport:app.viewport}:{}),...(app.dpr!==undefined?{dpr:app.dpr}:{}),fps:app.fps??30,clock:app.session?false:app.clock??false,headless:app.headless??true,navigationTimeoutMs:app.navigationTimeoutMs??20000,actionTimeoutMs:app.actionTimeoutMs??10000,maxFrames:app.maxFrames??1800,maxDurationSeconds:app.maxDurationSeconds??60,maxArtifactBytes:app.maxArtifactBytes??262144000,maxRunBytes:app.maxRunBytes??1073741824,...(app.session?{session:{configured:true,networkPolicy:app.session.networkPolicy}}:{}),...(app.identity?{identity:{required:app.identity.required??false,account:Boolean(app.identity.account),role:Boolean(app.identity.role)}}:{}),...(app.server?{server:{command:app.server.command.split(/[\\/]/).pop(),healthUrl:sanitizedUrl(app.server.healthUrl)}}:{}),...(app.auth?{auth:{configured:Boolean(app.auth.storageStatePath)}}:{})};
}
function genericFailure(error:unknown,stepIndex?:number,action?:string):{code:string;message:string;stepIndex?:number;action?:string}{
  const known=error instanceof WebCaptureError?error:undefined;
  return {code:known?.code??(stepIndex===undefined?"CAPTURE_FAILED":"TARGET_NOT_FOUND"),message:known?.message??(stepIndex===undefined?"Web capture failed. Check the app, browser, and local prerequisites.":"Capture action failed. Check the selector, app state, and recipe."),...(stepIndex!==undefined?{stepIndex}:{}),...(action?{action}:{})};
}
function sessionFailure(error:unknown):WebCaptureError{
  const message=error instanceof Error?error.message:"",known=new Set(["SESSION_HANDLE_INVALID","SESSION_BINDING_MISSING","SESSION_DESCRIPTOR_INVALID","SESSION_OWNER_UNAVAILABLE","SESSION_TARGET_UNAVAILABLE","SESSION_TARGET_AMBIGUOUS","SESSION_BINDING_INVALID","SESSION_OWNER_TIMEOUT","SESSION_OWNER_COMMAND_FAILED","SESSION_OWNER_OUTPUT_LIMIT"]);
  const code=known.has(message)?message:"SESSION_OWNER_UNAVAILABLE";
  return new WebCaptureError(code,"The registered owner browser session is missing, expired, or unavailable. Reauthenticate the intended app in agent-browser, then register that exact context again; saved App Explorer knowledge and checkpoints are preserved.");
}
function needsReauthentication(error:unknown):boolean{return error instanceof WebCaptureError&&new Set(["SESSION_BINDING_MISSING","SESSION_OWNER_UNAVAILABLE","SESSION_OWNER_TIMEOUT","SESSION_OWNER_COMMAND_FAILED","SESSION_TARGET_UNAVAILABLE","SESSION_TARGET_AMBIGUOUS","SESSION_IDENTITY_MISMATCH"]).has(error.code);}
function borrowedSessionLoss(session:NonNullable<Awaited<ReturnType<typeof launchCaptureSession>>>,page:any):WebCaptureError|undefined{
  if(session.ownership!=="borrowed")return undefined;
  let disconnected=false;try{disconnected=!session.browser.isConnected();}catch{disconnected=true;}
  if(!page.isClosed?.()&&!disconnected)return undefined;
  return new WebCaptureError("SESSION_OWNER_UNAVAILABLE","The borrowed owner tab or browser disconnected during capture. Reauthenticate the intended app in agent-browser, rebind that exact context, then resume; saved Explorer knowledge and checkpoints are preserved.");
}

async function assertText(locator:any,text:string,exact:boolean,timeoutMs:number):Promise<void>{
  await locator.waitFor({state:"visible",timeout:timeoutMs});const actual=await locator.innerText({timeout:timeoutMs});
  if(exact?actual!==text:!actual.includes(text))throw new WebCaptureError("POSTCONDITION_FAILED","Expected text was not present in the visible target.");
}
async function runStep(page:any,director:CaptureDirector,step:CaptureStep,index:number,app:CaptureAppConfig,runDirectory:string,artifacts:CaptureArtifact[],recordVideo:boolean):Promise<void>{
  const timeout=step.timeoutMs??app.actionTimeoutMs??10000;
  try{
    switch(step.action){
      case "goto":await navigateAndReady(page,new URL(step.url,app.url).href,app);if(recordVideo)await director.shot();return;
      case "back":{await page.goBack({waitUntil:"domcontentloaded",timeout});await waitForCapturePageReady(page,app).catch(()=>{});if(recordVideo)await director.shot();if(step.holdFrames??10)await director.hold(step.holdFrames??10);return;}
      case "waitFor":{const locator=resolveLocator(page,step.target),state=step.state??"visible";if(state==="hidden"||state==="detached"){if(await locator.count()>1)throw new WebCaptureError("AMBIGUOUS_TARGET","Capture selector matched more than one element.");await locator.waitFor({state,timeout});return;}await checkedLocator(page,step.target,timeout);return;}
      case "assertVisible":await checkedLocator(page,step.target,timeout);return;
      case "assertText":await assertText(await checkedLocator(page,step.target,timeout),step.text,step.exact??false,timeout);return;
      case "hover":{
        const locator=await checkedLocator(page,step.target,timeout);
        await director.moveTo(locator,step.travelFrames??8);
        if(step.holdFrames??15)await director.hold(step.holdFrames??15);return;
      }
      case "click":{
        if("target" in step && step.target?.css?.includes("ytp-")){
          await page.mouse.move(640, 360).catch(()=>{});
        }
        const locator=await checkedLocator(page,step.target,timeout);
        const point=await director.moveTo(locator,step.travelFrames??8);director.click(point.x,point.y);await page.mouse.click(point.x,point.y);
        if(step.holdFrames??4)await director.hold(step.holdFrames??4);return;
      }
      case "fill":{
        const locator=await checkedLocator(page,step.target,timeout);
        await director.moveTo(locator,step.travelFrames??8);
        let value:string;if(typeof step.value==="string")value=step.value;else{const secret=process.env[step.value.env];if(secret===undefined)throw new WebCaptureError("MISSING_ENV_VALUE",`Environment variable '${step.value.env}' is not set.`);value=secret;}
        await locator.fill(value,{timeout});if(step.holdFrames??3)await director.hold(step.holdFrames??3);return;
      }
      case "press":{
        if(step.target){const locator=await checkedLocator(page,step.target,timeout);const point=await director.moveTo(locator,step.travelFrames??8);await page.mouse.click(point.x,point.y);}
        await page.keyboard.press(step.key,{timeout});if(step.holdFrames??3)await director.hold(step.holdFrames??3);return;
      }
      case "scroll":{
        if(step.target)await (await checkedLocator(page,step.target,timeout)).scrollIntoViewIfNeeded({timeout});await director.scroll(step.deltaY,step.frames??12);return;
      }
      case "hold":await director.hold(step.frames);return;
      case "marker":director.marker(step.name);return;
      case "screenshot":{
        const name=`${String(index+1).padStart(3,"0")}-${slug(step.name)}.png`,file=resolve(runDirectory,"screenshots",name),mode=step.mode??"viewport";
        const options={path:file,fullPage:mode==="fullPage"};
        if(mode==="element")await (await checkedLocator(page,step.target!,timeout)).screenshot(options);else await page.screenshot(options);
        const bytes=await readFile(file),dimensions=pngDimensions(bytes),info=await stat(file),maxBytes=app.maxArtifactBytes??262144000;
        if(info.size>maxBytes)throw new WebCaptureError("ARTIFACT_LIMIT","Screenshot exceeds app.maxArtifactBytes.");
        if(info.size+artifacts.reduce((sum,artifact)=>sum+artifact.sizeBytes,0)>(app.maxRunBytes??1073741824))throw new WebCaptureError("CAPTURE_LIMIT","Screenshot artifacts exceeded app.maxRunBytes.");
        artifacts.push({id:`screenshot-${index+1}`,type:"image/png",file:relative(runDirectory,file).replaceAll("\\","/"),...dimensions,sizeBytes:info.size,sha256:await hashFile(file)});return;
      }
    }
  }catch(error){
    if(error instanceof WebCaptureError)throw new WebCaptureError(error.code,error.message,index,step.action);
    throw new WebCaptureError("CAPTURE_ACTION_FAILED","Capture action failed. Check the selector, app state, and recipe.",index,step.action);
  }
}

async function runPostconditions(page:any,recipe:CaptureRecipe):Promise<CaptureRunResult["postconditions"]>{
  const results:CaptureRunResult["postconditions"]=[];
  for(let index=0;index<(recipe.postconditions??[]).length;index++){
    const condition=recipe.postconditions![index],timeout=condition.timeoutMs??recipe.app.actionTimeoutMs??10000;
    try{if(condition.action==="assertVisible")await checkedLocator(page,condition.target,timeout);else await assertText(await checkedLocator(page,condition.target,timeout),condition.text,condition.exact??false,timeout);results.push({index,passed:true,action:condition.action});}
    catch{results.push({index,passed:false,action:condition.action});throw new WebCaptureError("POSTCONDITION_FAILED",`Postcondition ${index+1} did not pass.`);}
  }
  return results;
}

export async function runCaptureRecipe(root:string,raw:unknown,recipeSourceBytes?:Uint8Array):Promise<CaptureRunResult>{
  const recipe=validateCaptureRecipe(raw),{id,path:runDirectory}=await createSafeRunDirectory(root),recordVideo=recipe.outputs.video??false;
  if(recordVideo)await mkdir(resolve(runDirectory,"frames"));await mkdir(resolve(runDirectory,"screenshots"));
  const result:CaptureRunResult={version:"1",id,status:"failed",createdAt:new Date().toISOString(),recipeHash:sha256Hex(recipeSourceBytes??JSON.stringify(recipe)),config:publicConfig(recipe.app),outputs:{video:recordVideo,cursorOverlay:recordVideo&&recipe.outputs.cursorOverlay===true},artifacts:[],postconditions:[]};
  let progressBinding:{appId:string;contextId:string}|undefined;
  if(recipe.app.session)try{progressBinding=await readSessionBinding(recipe.app.session.handle);}catch{}
  const saveProgress=async(stepId:string|null,state:"starting"|"running"|"waiting_for_reauthentication"|"succeeded"|"failed",errorCode?:string)=>{try{await writeCaptureProgress(runDirectory,{runId:id,stepId,state,timestamp:new Date().toISOString(),...(errorCode?{errorCode}:{}),...(progressBinding??{})});}catch{}};
  await saveProgress(null,"starting");
  let session:Awaited<ReturnType<typeof launchCaptureSession>>|undefined,activePage:any,stepIndex:number|undefined,stepAction:string|undefined;
  try{
    if(recipe.app.session){let resolved;try{resolved=await resolveSession(recipe.app.session.handle);}catch(error){throw sessionFailure(error);}session=await attachBorrowedSession(resolved,recipe.app);}else session=await launchCaptureSession(root,recipe.app);
    let page=session.page;activePage=page;const knownPages=new Set(session.context.pages()),viewport=session.viewport,fps=recipe.app.fps??30,dpr=session.deviceScaleFactor;
    result.session={ownership:session.ownership,...(session.sessionBinding?{appId:session.sessionBinding.appId,contextId:session.sessionBinding.contextId,role:session.sessionBinding.role}:{}),viewport:session.viewport,deviceScaleFactor:session.deviceScaleFactor,...(session.borrowedViewport?{borrowedViewport:{...session.borrowedViewport,restored:false}}:{})};
    session.assertPolicy?.();
    const director=createCaptureDirector(page,{root:runDirectory,fps,viewport,dpr,recordVideo,clockEnabled:session.clockEnabled,maxFrames:recipe.app.maxFrames??1800,maxRunBytes:recipe.app.maxRunBytes??1073741824});
    if(recordVideo)await director.shot();
    let executedInteractions=0;
    const skippedSteps:SkippedStep[]=[];
    for(let index=0;index<recipe.steps.length;index++){
      session.assertPolicy?.();
      stepIndex=index;stepAction=recipe.steps[index].action;await saveProgress(`step-${index+1}`,"running");
      const step=recipe.steps[index];
      try{
        await runStep(page,director,step,index,recipe.app,runDirectory,result.artifacts,recordVideo);
        if(new Set(["click","fill","press","scroll","hover"]).has(step.action)){
          executedInteractions++;
        }
      }catch(err){
        const lost=borrowedSessionLoss(session,page);
        if(lost)throw lost;
        if(step.optional){
          const reason=err instanceof Error?err.message:"Step skipped";
          skippedSteps.push({index,action:step.action,reason,...("target" in step&&step.target?{target:step.target}:{}),...((step as any).name?{name:(step as any).name}:{})});
          director.marker(`skipped:${step.action}`);
          continue;
        }
        throw err;
      }
      if(step.action==="goto"&&session.ownership==="borrowed")await assertCaptureIdentity(page,recipe.app);
      if(stepAction==="click"||stepAction==="press")await page.waitForTimeout(500);
      const openedPages:typeof page[]=[];
      for(const candidate of session.context.pages())if(!knownPages.has(candidate)){knownPages.add(candidate);try{if(await candidate.opener()===page)openedPages.push(candidate);}catch{}}
      if(openedPages.length>1)throw new WebCaptureError("CAPTURE_FAILED","More than one app tab opened during a single action.",index,stepAction);
      if(openedPages.length===1){
        page=openedPages[0];
        activePage=page;
        if(page.url()==="about:blank")try{await page.waitForURL((url)=>url.href!=="about:blank",{timeout:recipe.app.navigationTimeoutMs??20000});}catch{throw new WebCaptureError("APP_NOT_READY","A newly opened app tab did not navigate to its destination.",index,stepAction);}
        if(!isAllowedCaptureUrl(page.url(),recipe.app))throw new WebCaptureError("NAVIGATION_BLOCKED","The new tab navigated outside the configured host allowlist.",index,stepAction);
        page.setDefaultTimeout(recipe.app.actionTimeoutMs??10000);page.setDefaultNavigationTimeout(recipe.app.navigationTimeoutMs??20000);await waitForCapturePageReady(page,recipe.app);director.setPage(page);
      }
      if(!isAllowedCaptureUrl(page.url(),recipe.app))throw new WebCaptureError("NAVIGATION_BLOCKED","The page navigated outside the configured host allowlist.",index,stepAction);
      session.assertPolicy?.();
    }
    stepIndex=undefined;stepAction=undefined;
    result.skippedSteps=skippedSteps;
    result.executedInteractions=executedInteractions;
    result.finalUrl=sanitizedUrl(page.url());
    result.authGated=Boolean(result.authGated);
    if(!result.authGated){
      result.postconditions=await runPostconditions(page,recipe);
    }
    if(recordVideo){
      const fpsNow=recipe.app.fps??30,maxFrames=recipe.app.maxFrames??1800,maxDuration=recipe.app.maxDurationSeconds??60,maxBytes=recipe.app.maxArtifactBytes??262144000;
      if(director.frame>maxFrames||director.frame/fpsNow>maxDuration)throw new WebCaptureError("CAPTURE_LIMIT","Capture exceeded configured frame or duration limits.");
      const firstFrame=pngDimensions(await readFile(resolve(runDirectory,"frames","frame-00000.png"))),sourceWidth=firstFrame.width,sourceHeight=firstFrame.height;
      if(sourceWidth%2!==0||sourceHeight%2!==0)throw new WebCaptureError("INVALID_ARTIFACT","Captured viewport PNG dimensions are odd; choose an even viewport × dpr for H.264.");
      const outputWidth=sourceWidth,outputHeight=sourceHeight;
      const withCursor=recipe.outputs.cursorOverlay===true;
      let encoded=await encodePngSequence(root,runDirectory,director.frame,fpsNow,maxBytes,withCursor?"capture-source.mp4":"capture.mp4");
      result.timeline=director.timeline(sourceWidth,sourceHeight,outputWidth,outputHeight,withCursor);
      if(session.borrowedViewport&&result.timeline)result.timeline.borrowedViewport={...session.borrowedViewport,restored:false};
      await writeJson(resolve(runDirectory,"timeline.json"),result.timeline);
      if(withCursor){
        const overlay=await renderCutroomCursorOverlay(root,runDirectory,id,encoded,result.timeline,maxBytes);
        const rawFile=encoded.file,finalFile=resolve(runDirectory,"capture.mp4");
        await rm(rawFile,{force:true});await rename(overlay.file,finalFile);encoded={...overlay,file:finalFile};
      }
      if(encoded.width!==outputWidth||encoded.height!==outputHeight)throw new WebCaptureError("INVALID_ARTIFACT","Encoded frame dimensions differ from the captured viewport PNGs.");
      if(director.frameBytes+result.artifacts.reduce((sum,artifact)=>sum+artifact.sizeBytes,0)+encoded.sizeBytes>(recipe.app.maxRunBytes??1073741824))throw new WebCaptureError("CAPTURE_LIMIT","Capture artifacts exceeded app.maxRunBytes.");
      result.artifacts.push({id:"video",type:"video/mp4",file:relative(runDirectory,encoded.file).replaceAll("\\","/"),width:encoded.width,height:encoded.height,sizeBytes:encoded.sizeBytes,sha256:await hashFile(encoded.file),frames:encoded.frames,fps:encoded.fps,durationSeconds:encoded.durationSeconds});
    }
    await saveProgress(null,"succeeded");
    result.status="succeeded";
  }catch(error){
    const failure=session?borrowedSessionLoss(session,activePage??session.page)??error:error;
    const safe=genericFailure(failure,stepIndex,stepAction);result.error={...safe};
    if(failure instanceof WebCaptureError&&failure.stepIndex!==undefined){result.error.stepIndex=failure.stepIndex;result.error.action=failure.action;}
    const sessionLost=needsReauthentication(failure);
    await saveProgress(stepIndex===undefined?null:`step-${stepIndex+1}`,sessionLost?"waiting_for_reauthentication":"failed",safe.code);
    result.postconditions=result.postconditions.map((entry)=>entry);
  }finally{
    try{await session?.close();}
    catch(error){
      const loss=session?borrowedSessionLoss(session,activePage??session.page):undefined;
      if(result.error){
        if(needsReauthentication(new WebCaptureError(result.error.code,result.error.message)))await saveProgress(stepIndex===undefined?null:`step-${stepIndex+1}`,"waiting_for_reauthentication",result.error.code);
        else if(loss)await saveProgress(stepIndex===undefined?null:`step-${stepIndex+1}`,"waiting_for_reauthentication",loss.code);
      }else{
        const failure=loss??error,safe=genericFailure(failure);result.status="failed";result.error=safe;await saveProgress(null,needsReauthentication(failure)?"waiting_for_reauthentication":"failed",safe.code);
      }
    }
    if(session?.borrowedViewport){const restored=session.borrowedViewportRestored?.()??false;if(result.session?.borrowedViewport)result.session.borrowedViewport.restored=restored;if(result.timeline)result.timeline.borrowedViewport={...session.borrowedViewport,restored};}
    if(result.timeline)await writeJson(resolve(runDirectory,"timeline.json"),result.timeline);
  }
  for(const artifact of result.artifacts)artifact.file=artifact.file.replaceAll("\\","/");
  await writeJson(resolve(runDirectory,"result.json"),result);return result;
}

export async function readCaptureRecipe(root:string,path:string):Promise<{recipe:CaptureRecipe;bytes:Buffer}>{
  const file=resolve(root,path),bytes=await readFile(file);let json:unknown;try{json=JSON.parse(bytes.toString("utf8"));}catch{throw new WebCaptureError("INVALID_RECIPE","Recipe file is not valid JSON.");}
  return {recipe:validateCaptureRecipe(json),bytes};
}
