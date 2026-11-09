import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {mkdtemp,readdir,readFile,rm} from "node:fs/promises";
import test from "node:test";
import {registerSession,resolveSession} from "../src/browser-session/registry.js";
import {attachBorrowedSession} from "../src/browser-session/attach.js";
import {launchCaptureSession} from "../src/web-capture/app-session.js";
import {registerApp} from "../src/app-explorer/registry.js";
import {chromium} from "playwright-core";
import {probeCaptureApp} from "../src/web-capture/probe.js";
import {runCaptureRecipe} from "../src/web-capture/run.js";
import {readCaptureProgress} from "../src/web-capture/progress.js";
import {validateCaptureRecipe} from "../src/web-capture/validate.js";

async function commandVersion(command:string):Promise<string|undefined>{
  return new Promise(resolveVersion=>{
    let stdout="",settled=false;
    const child=spawn(command,["--version"],{stdio:["ignore","pipe","ignore"],shell:false,windowsHide:true});
    const finish=(value?:string)=>{if(settled)return;settled=true;clearTimeout(timer);resolveVersion(value);};
    const timer=setTimeout(()=>{try{child.kill();}catch{}finish();},5000);
    child.stdout.on("data",(chunk:Uint8Array)=>{stdout+=Buffer.from(chunk).toString("utf8").slice(0,200);});
    child.once("error",()=>finish());
    child.once("exit",(code:number|null)=>finish(code===0?stdout.trim():undefined));
  });
}
async function findNative():Promise<string|undefined>{
  const configured=process.env.AGENT_BROWSER_NATIVE??process.env.AGENT_BROWSER_EXECUTABLE;
  if(configured)return await commandVersion(configured)?configured:undefined;
  const version=await commandVersion("agent-browser");
  return version&&/agent-browser\s+\d+\.\d+\.\d+/i.test(version)?"agent-browser":undefined;
}
const native=await findNative();
const nativeExecutable=native??"agent-browser";

async function cli(session:string,args:string[],timeout=20000):Promise<string>{
  return new Promise((resolveCli,rejectCli)=>{
    const child=spawn(nativeExecutable,["--session",session,...args],{cwd:tmpdir(),stdio:["ignore","pipe","pipe"],shell:false,windowsHide:true});
    const out:string[]=[],err:string[]=[];let settled=false;
    const finish=(error?:Error,value?:string)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)rejectCli(error);else resolveCli(value??"");};
    let killTimer:any;const timer=setTimeout(()=>{try{child.kill();}catch{}killTimer=setTimeout(()=>finish(new Error("Synthetic owner CLI timed out.")),3000);},timeout);
    child.stdout.on("data",(chunk:Uint8Array)=>out.push(Buffer.from(chunk).toString("utf8")));
    child.stderr.on("data",(chunk:Uint8Array)=>err.push(Buffer.from(chunk).toString("utf8")));
    child.once("error",finish);
    child.once("exit",(code:number|null)=>{if(killTimer)clearTimeout(killTimer);const stdout=out.join("").trim(),stderr=err.join("").slice(0,300);setTimeout(()=>{child.stdout.destroy();child.stderr.destroy();child.unref();},0);code===0?finish(undefined,stdout):finish(new Error(`Synthetic owner CLI ${args.join(" ")} failed (${code}). ${stderr}`));});
  });
}

async function fixture(host="127.0.0.1",partialPolicy=false):Promise<{url:string;wsUrl:string;popupHits:()=>number;requestCount:()=>number;close:()=>Promise<void>}>{
  const upgradedSockets=new Set<any>();let popupRequests=0,requests=0;
  const server=createServer((request,response)=>{
    requests++;
    if(request.url?.startsWith("/popup"))popupRequests++;
    if(request.url==="/sw.js"){response.writeHead(200,{"Content-Type":"text/javascript","Service-Worker-Allowed":"/","Cache-Control":"no-store"}).end("self.addEventListener('fetch',()=>{});");return;}
    if(request.url==="/favicon.ico"){response.writeHead(204).end();return;}
    response.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
    response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>synthetic handoff</title><main><h1>Capture fixture</h1><p id="account">Account: fixture-account</p><p id="role">Role: fixture-role</p><button id="popup" onclick="window.open(window.gra39PopupUrl||'/popup','gra39-popup')">Open fixture popup</button></main><script>sessionStorage.setItem('gra39-session','fixture');window.gra39Memory='preserved';${partialPolicy?"window.__fixtureNativeRTCPeerConnection=window.RTCPeerConnection;Object.defineProperty(navigator.serviceWorker,'register',{configurable:false,writable:false,value:navigator.serviceWorker.register});":""}</script>`);
  });
  server.on("upgrade",(request,socket)=>{
    const key=request.headers["sec-websocket-key"];
    if(typeof key!=="string"){socket.destroy();return;}
    const accept=createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    upgradedSockets.add(socket);socket.once("close",()=>upgradedSockets.delete(socket));
    socket.on("data",()=>{});
  });
  await new Promise<void>(resolveServer=>server.listen(0,host,resolveServer));
  const address=server.address();if(!address||typeof address==="string")throw new Error("Synthetic fixture did not bind a TCP port.");
  return {url:`http://${host}:${address.port}/`,wsUrl:`ws://${host}:${address.port}/socket`,popupHits:()=>popupRequests,requestCount:()=>requests,close:()=>new Promise<void>((resolveServer,reject)=>{for(const socket of upgradedSockets)socket.destroy();(server as any).closeAllConnections?.();server.close(error=>error?reject(error):resolveServer());})};
}

async function targets(session:string):Promise<string[]>{
  const json=JSON.parse(await cli(session,["tab","list","--json"]));
  const tabs=Array.isArray(json)?json:(json.tabs??json.data?.tabs??[]);
  return tabs.map((tab:any)=>tab.targetId).filter((id:unknown)=>typeof id==="string");
}

async function pageForTarget(contexts:any[],targetId:string):Promise<any|undefined>{
  for(const context of contexts)for(const page of context.pages()){
    const cdp=await context.newCDPSession(page);
    try{const info=await cdp.send("Target.getTargetInfo");if(info.targetInfo.targetId===targetId)return page;}
    finally{await cdp.detach().catch(()=>{});}
  }
}

async function borrowedFixture(label:string):Promise<{app:Awaited<ReturnType<typeof fixture>>;root:string;page:any;config:any;cleanup:()=>Promise<void>}>{
  const app=await fixture(),sessionName=`gra39-${label}-${randomUUID().replaceAll("-","").slice(0,16)}`,root=await mkdtemp(join(tmpdir(),"gra39-owner-loss-phase-")),previousNative=process.env.AGENT_BROWSER_NATIVE,previousPrivate=process.env.APP_EXPLORER_SESSION_DIR;
  let ownerStarted=false,owner:any;
  const cleanup=async()=>{if(ownerStarted)await cli(sessionName,["close"]).catch(()=>{});try{await owner?.close();}catch{}await app.close();await rm(root,{recursive:true,force:true});if(previousNative===undefined)delete process.env.AGENT_BROWSER_NATIVE;else process.env.AGENT_BROWSER_NATIVE=previousNative;if(previousPrivate===undefined)delete process.env.APP_EXPLORER_SESSION_DIR;else process.env.APP_EXPLORER_SESSION_DIR=previousPrivate;};
  try{
    process.env.AGENT_BROWSER_NATIVE=nativeExecutable;process.env.APP_EXPLORER_SESSION_DIR=join(root,"private-sessions");await registerApp(root,{id:"fixture-app",name:"Synthetic browser fixture",url:app.url});await cli(sessionName,["open",app.url]);ownerStarted=true;
    const registered=await registerSession(root,{appId:"fixture-app",contextId:"fixture-context",sessionName,role:"fixture-role"}),resolved=await resolveSession(registered.handle);owner=await chromium.connectOverCDP(resolved.endpoint,{timeout:10000});
    const page=owner.contexts().flatMap((context:any)=>context.pages()).find((candidate:any)=>candidate.url()===app.url);assert.ok(page);
    const config={url:app.url,allowedHosts:["127.0.0.1"],session:{handle:registered.handle,networkPolicy:"capture"},identity:{required:true,account:{target:{css:"#account"},text:"Account: fixture-account"},role:{target:{css:"#role"},text:"Role: fixture-role"}}};
    return {app,root,page,config,cleanup};
  }catch(error){await cleanup();throw error;}
}

test("borrowed owner exit during the initial recording shot becomes a reauthentication wait",{timeout:90000,skip:native?false:"Requires AGENT_BROWSER_NATIVE or agent-browser executable on PATH."},async()=>{
  const fixtureState=await borrowedFixture("initial-shot"),{app,root,page,config}=fixtureState,prototype:any=Object.getPrototypeOf(page),original=prototype.screenshot;
  let announce!:()=>void,release!:()=>void;const reached=new Promise<void>(resolveReached=>{announce=resolveReached;}),gate=new Promise<void>(resolveGate=>{release=resolveGate;});let fired=false;
  prototype.screenshot=function(options:any){if(!fired&&String(options?.path).includes("frame-00000.png")){fired=true;announce();return gate.then(()=>original.apply(this,[options]));}return original.apply(this,[options]);};
  try{
    const recipe:any={version:"1",name:"Synthetic initial-shot owner exit",app:config,steps:[{action:"marker",name:"shot-boundary"}],outputs:{video:true}},running=runCaptureRecipe(root,recipe,Buffer.from(JSON.stringify(recipe)));
    await reached;await page.close();release();const result=await running;assert.equal(result.status,"failed");assert.equal(result.error?.code,"SESSION_OWNER_UNAVAILABLE");
    const progress=await readCaptureProgress(resolve(root,".video","web-capture","runs",result.id));assert.equal(progress?.state,"waiting_for_reauthentication");assert.equal(progress?.errorCode,"SESSION_OWNER_UNAVAILABLE");
  }finally{prototype.screenshot=original;release();await fixtureState.cleanup();}
});

test("borrowed owner exit during postconditions becomes a reauthentication wait",{timeout:90000,skip:native?false:"Requires AGENT_BROWSER_NATIVE or agent-browser executable on PATH."},async()=>{
  const fixtureState=await borrowedFixture("postcondition"),{root,page,config}=fixtureState,locatorPrototype:any=Object.getPrototypeOf(page.locator("#postcondition-sentinel")),original=locatorPrototype.waitFor;
  let announce!:()=>void,release!:()=>void;const reached=new Promise<void>(resolveReached=>{announce=resolveReached;}),gate=new Promise<void>(resolveGate=>{release=resolveGate;});let fired=false;
  locatorPrototype.waitFor=function(options:any){if(!fired&&String(this?._selector).includes("#postcondition-sentinel")){fired=true;announce();return gate.then(()=>original.apply(this,[options]));}return original.apply(this,[options]);};
  try{
    const ordinaryRecipe:any={version:"1",name:"Synthetic ordinary postcondition failure",app:config,steps:[{action:"marker",name:"ordinary-postcondition"}],postconditions:[{action:"assertVisible",target:{css:"#ordinary-failure-sentinel"}}],outputs:{video:false}},ordinary=await runCaptureRecipe(root,ordinaryRecipe,Buffer.from(JSON.stringify(ordinaryRecipe)));
    assert.equal(ordinary.status,"failed");assert.equal(ordinary.error?.code,"POSTCONDITION_FAILED");
    const ordinaryProgress=await readCaptureProgress(resolve(root,".video","web-capture","runs",ordinary.id));assert.equal(ordinaryProgress?.state,"failed");
    const recipe:any={version:"1",name:"Synthetic postcondition owner exit",app:config,steps:[{action:"marker",name:"postcondition-boundary"}],postconditions:[{action:"assertVisible",target:{css:"#postcondition-sentinel"}}],outputs:{video:false}},running=runCaptureRecipe(root,recipe,Buffer.from(JSON.stringify(recipe)));
    await reached;await page.close();release();const result=await running;assert.equal(result.status,"failed");assert.equal(result.error?.code,"SESSION_OWNER_UNAVAILABLE");
    const progress=await readCaptureProgress(resolve(root,".video","web-capture","runs",result.id));assert.equal(progress?.state,"waiting_for_reauthentication");assert.equal(progress?.errorCode,"SESSION_OWNER_UNAVAILABLE");
  }finally{locatorPrototype.waitFor=original;release();await fixtureState.cleanup();}
});

test("borrowed handoff attaches the exact synthetic owner target and disconnects without closing it",{timeout:90000,skip:native?false:"Requires AGENT_BROWSER_NATIVE or agent-browser executable on PATH."},async()=>{
  const app=await fixture(),disallowed=await fixture("127.0.0.2"),sessionName=`gra39-fixture-${randomUUID().replaceAll("-","").slice(0,16)}`,root=await mkdtemp(join(tmpdir(),"gra39-browser-session-")),previousNative=process.env.AGENT_BROWSER_NATIVE,previousPrivate=process.env.APP_EXPLORER_SESSION_DIR;
  let ownerStarted=false;
  try{
    process.env.AGENT_BROWSER_NATIVE=nativeExecutable;process.env.APP_EXPLORER_SESSION_DIR=join(root,"private-sessions");
    await registerApp(root,{id:"fixture-app",name:"Synthetic browser fixture",url:app.url});
    await cli(sessionName,["open",app.url]);ownerStarted=true;await new Promise(resolveReady=>setTimeout(resolveReady,500));
    const listed=await targets(sessionName);assert.equal(listed.length,1,"fixture must start with one browser target");
    const registered=await registerSession(root,{appId:"fixture-app",contextId:"fixture-context",sessionName,role:"fixture-role"});
    const resolved=await resolveSession(registered.handle);
    const inspect=await chromium.connectOverCDP(resolved.endpoint,{timeout:10000}),ownerContexts=inspect.contexts(),ownerPage=ownerContexts.flatMap(context=>context.pages()).find(page=>page.url()===app.url);assert.ok(ownerPage);const beforeViewport=await ownerPage!.evaluate(()=>({width:innerWidth,height:innerHeight}));const beforePageCount=ownerContexts.flatMap(context=>context.pages()).length;await inspect.close();
    assert.equal(resolved.descriptor.targetId,listed[0]);
    assert.equal((await readFile(join(root,"private-sessions",`${registered.handle}.json`),"utf8")).includes("endpoint"),false);
    const config:any={url:app.url,allowedHosts:["127.0.0.1"],session:{handle:registered.handle,networkPolicy:"capture"},viewport:{width:1000,height:600},dpr:1,clock:false,identity:{required:true,account:{target:{css:"#account"},text:"Account: fixture-account"},role:{target:{css:"#role"},text:"Role: fixture-role"}}};
    const policyRecipe:any={version:"1",name:"Synthetic policy validation",app:config,steps:[],outputs:{}};
    assert.throws(()=>validateCaptureRecipe({...policyRecipe,app:{...config,session:{handle:registered.handle}}}),(error:any)=>error.code==="SHARED_SESSION_POLICY_UNSUPPORTED");
    assert.throws(()=>validateCaptureRecipe({...policyRecipe,app:{...config,session:{handle:registered.handle,networkPolicy:"strict"}}}),(error:any)=>error.code==="SHARED_SESSION_POLICY_UNSUPPORTED");
    await assert.rejects(()=>attachBorrowedSession(resolved,{...config,session:{handle:registered.handle}}),(error:any)=>error.code==="SHARED_SESSION_POLICY_UNSUPPORTED");
    await assert.rejects(()=>attachBorrowedSession(resolved,{...config,session:{handle:registered.handle,networkPolicy:"strict"}}),(error:any)=>error.code==="SHARED_SESSION_POLICY_UNSUPPORTED");
    await assert.rejects(()=>attachBorrowedSession(resolved,{...config,dpr:2}),(error:any)=>error.code==="SESSION_DPR_MISMATCH"&&!String(error.message).includes("ws://"));
    await assert.rejects(()=>attachBorrowedSession(resolved,{...config,identity:{...config.identity,account:{...config.identity.account,text:"Account: another-account"}}}),(error:any)=>error.code==="SESSION_IDENTITY_MISMATCH"&&!String(error.message).includes("fixture-account"));
    await assert.rejects(()=>attachBorrowedSession(resolved,{...config,identity:{...config.identity,role:{...config.identity.role,text:"Role: administrator"}}}),(error:any)=>error.code==="SESSION_IDENTITY_MISMATCH"&&!String(error.message).includes("fixture-role"));
    const unrelatedOwner=await chromium.connectOverCDP(resolved.endpoint,{timeout:10000}),unrelatedPage=await unrelatedOwner.contexts()[0].newPage();await unrelatedPage.goto(disallowed.url);
    const capture=await attachBorrowedSession(resolved,config);
    assert.equal(capture.ownership,"borrowed");
    assert.equal((await capture.page.evaluate(()=>({width:innerWidth,height:innerHeight}))).width,1000);
    assert.equal(await capture.page.evaluate(()=>sessionStorage.getItem("gra39-session")),"fixture");
    assert.equal(await capture.page.evaluate(()=>String((window as any).gra39Memory)),"preserved");
    assert.equal(await capture.page.locator("#account").innerText(),"Account: fixture-account");
    assert.equal(await capture.page.locator("#role").innerText(),"Role: fixture-role");
    assert.equal(capture.context.pages().length,beforePageCount+1,"attachment must not create a page beyond the unrelated owner tab fixture");
    assert.equal(capture.browser.contexts().length,ownerContexts.length,"attachment must reuse the owner's context");
    assert.equal(capture.page.url(),app.url,"attachment must not navigate or reload the owner target");
    const allowedSocket=await capture.page.evaluate((url)=>new Promise<boolean>((resolveSocket,rejectSocket)=>{const socket=new WebSocket(url);const timer=setTimeout(()=>{socket.close();rejectSocket(new Error("allowed WebSocket did not open"));},3000);socket.addEventListener("open",()=>{clearTimeout(timer);socket.close();resolveSocket(true);},{once:true});socket.addEventListener("error",()=>{clearTimeout(timer);rejectSocket(new Error("allowed WebSocket was blocked"));},{once:true});}),app.wsUrl);assert.equal(allowedSocket,true,"allowlisted WebSocket connections must remain usable");
    const disallowedSocketOpened=await capture.page.evaluate((url)=>new Promise<boolean>((resolveSocket)=>{const socket=new WebSocket(url);const timer=setTimeout(()=>{socket.close();resolveSocket(false);},3000);socket.addEventListener("error",()=>{clearTimeout(timer);resolveSocket(false);},{once:true});socket.addEventListener("open",()=>{clearTimeout(timer);socket.close();resolveSocket(true);},{once:true});}),disallowed.wsUrl);assert.equal(disallowedSocketOpened,true,"explicit capture policy does not claim to filter WebSockets on the already-loaded page");
    let disallowedResourceBlocked=false;capture.context.on("requestfailed",request=>{try{if(new URL(request.url()).hostname==="gra39-disallowed.invalid")disallowedResourceBlocked=true;}catch{}});
    await capture.page.evaluate(()=>fetch("http://gra39-disallowed.invalid/resource").catch(()=>undefined));assert.equal(disallowedResourceBlocked,true,"page subresources outside the host allowlist must be blocked");
    const beforeUnrelatedRequest=disallowed.requestCount();await unrelatedPage.goto(`${disallowed.url}unrelated-owner-request`);assert.equal(unrelatedPage.url(),`${disallowed.url}unrelated-owner-request`);assert.ok(disallowed.requestCount()>beforeUnrelatedRequest,"unrelated owner tab navigation remains available during capture");
    await capture.page.evaluate((url)=>{(window as any).gra39PopupUrl=url;},`${disallowed.url}popup-first-request`);
    const blockedPopupEvent=capture.context.waitForEvent("page"),openedBlockedPopup=await capture.page.evaluate(()=>Boolean(window.open((window as any).gra39PopupUrl,"gra39-popup")));assert.equal(openedBlockedPopup,true);
    const blockedPopup=await blockedPopupEvent;await blockedPopup.waitForLoadState("domcontentloaded").catch(()=>{});assert.equal(disallowed.popupHits(),0,"the capture boundary must abort a popup's initial disallowed navigation before the server receives it");
    await blockedPopup.close();
    await capture.page.evaluate((url)=>{(window as any).gra39PopupUrl=url;},`${app.url}popup-allowed`);
    const popupEvent=capture.context.waitForEvent("page"),openedAllowedPopup=await capture.page.evaluate(()=>Boolean(window.open((window as any).gra39PopupUrl,"gra39-popup")));assert.equal(openedAllowedPopup,true);
    const popupPage=await popupEvent;await popupPage.waitForLoadState("domcontentloaded");assert.equal(popupPage.url(),`${app.url}popup-allowed`);assert.equal(await popupPage.opener(),capture.page,"popup lineage must map to the selected source page");assert.ok(app.popupHits()>0,"allowlisted popup navigation remains available");
    const beforeUnattributedPopup=disallowed.popupHits(),unrelatedPopupEvent=capture.context.waitForEvent("page");await unrelatedPage.evaluate((url)=>window.open(url,"gra39-unrelated-popup"),`${disallowed.url}unrelated-popup-first-request`);const unattributedPopup=await unrelatedPopupEvent;await new Promise(resolveDelay=>setTimeout(resolveDelay,150));assert.equal(disallowed.popupHits(),beforeUnattributedPopup,"a frame-less disallowed new-target request fails closed, including an unrelated manual popup");await unattributedPopup.close();
    await capture.close();
    const restoredPage=await pageForTarget(unrelatedOwner.contexts(),listed[0]);assert.ok(restoredPage);assert.deepEqual(await restoredPage!.evaluate(()=>({width:innerWidth,height:innerHeight})),beforeViewport,"borrowed viewport must restore immediately when the capture session closes");
    await capture.close();
    assert.ok((await targets(sessionName)).includes(listed[0]),"borrower disconnect must leave the original owner target present");
    const probe=await probeCaptureApp(root,config);assert.equal(probe.ok,true);assert.equal((probe.session as any).ownership,"borrowed");assert.deepEqual((probe.session as any).borrowedViewport,{before:beforeViewport,after:{width:1000,height:600},restored:true});
    const recipe:any={version:"1",name:"Synthetic borrowed session check",app:config,steps:[{action:"assertText",target:{css:"#account"},text:"Account: fixture-account"}],outputs:{video:false}};
    const run=await runCaptureRecipe(root,recipe,Buffer.from(JSON.stringify(recipe)));assert.equal(run.status,"succeeded",JSON.stringify(run.error));assert.equal(run.session?.ownership,"borrowed");assert.deepEqual((run.session as any)?.borrowedViewport,{before:beforeViewport,after:{width:1000,height:600},restored:true});
    const readFilteredProgress=readCaptureProgress as unknown as (directory:string,filter:{appId:string})=>Promise<any>,progress=await readFilteredProgress(resolve(root,".video","web-capture","runs",run.id),{appId:"fixture-app"});assert.deepEqual(progress&&Object.keys(progress).sort(),["appId","contextId","runId","state","stepId","timestamp"]);assert.equal(progress?.state,"succeeded");assert.equal(progress?.appId,"fixture-app");assert.equal(progress?.contextId,"fixture-context");assert.equal(await readFilteredProgress(resolve(root,".video","web-capture","runs",run.id),{appId:"other-app"}),undefined);
    assert.equal(JSON.stringify(progress).includes("fixture-account"),false);assert.equal(JSON.stringify(run).includes("fixture-account"),false);
    const failedRecipe={...recipe,app:{...config,identity:{...config.identity,account:{...config.identity.account,text:"Account: wrong-fixture"}}}},failedRun=await runCaptureRecipe(root,failedRecipe,Buffer.from(JSON.stringify(failedRecipe)));assert.equal(failedRun.status,"failed");assert.equal(failedRun.error?.code,"SESSION_IDENTITY_MISMATCH");const failedProgress=await readFilteredProgress(resolve(root,".video","web-capture","runs",failedRun.id),{appId:"fixture-app"});assert.equal(failedProgress?.state,"waiting_for_reauthentication");assert.equal(failedProgress?.contextId,"fixture-context");
    const unboundRecipe={...recipe,app:{...config,session:{handle:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",networkPolicy:"capture"}}},unboundRun=await runCaptureRecipe(root,unboundRecipe,Buffer.from(JSON.stringify(unboundRecipe)));const unboundProgress=await readCaptureProgress(resolve(root,".video","web-capture","runs",unboundRun.id));assert.equal(unboundProgress?.appId,undefined);assert.equal(await readFilteredProgress(resolve(root,".video","web-capture","runs",unboundRun.id),{appId:"fixture-app"}),undefined);
    const verify=await chromium.connectOverCDP(resolved.endpoint,{timeout:10000});const verifiedPage=verify.contexts().flatMap(context=>context.pages()).find(page=>page.url()===app.url);assert.ok(verifiedPage);assert.deepEqual(await verifiedPage!.evaluate(()=>({width:innerWidth,height:innerHeight})),beforeViewport,"borrowed viewport must be restored");
    assert.match(await cli(sessionName,["get","title"]),/synthetic handoff/);
    const runRoot=resolve(root,".video","web-capture","runs"),existingRuns=new Set(await readdir(runRoot));
    const interruptedRecipe={...recipe,name:"Borrowed owner exit",steps:[{action:"waitFor",target:{css:"#never-appears"},timeoutMs:5000}]};
    const interruptedRunPromise=runCaptureRecipe(root,interruptedRecipe,Buffer.from(JSON.stringify(interruptedRecipe)));
    let interruptedRunId:string|undefined;
    for(let attempt=0;attempt<200&&!interruptedRunId;attempt++){
      for(const candidate of await readdir(runRoot))if(!existingRuns.has(candidate)){
        const state=await readCaptureProgress(resolve(runRoot,candidate));
        if(state?.state==="running"&&state.stepId==="step-1")interruptedRunId=candidate;
      }
      if(!interruptedRunId)await new Promise(resolveDelay=>setTimeout(resolveDelay,50));
    }
    assert.ok(interruptedRunId,"capture must reach its first action before the owner tab exits");
    await verifiedPage!.close();
    const interruptedRun=await interruptedRunPromise;
    assert.equal(interruptedRun.id,interruptedRunId);assert.equal(interruptedRun.status,"failed");assert.equal(interruptedRun.error?.code,"SESSION_OWNER_UNAVAILABLE");
    const interruptedProgress=await readFilteredProgress(resolve(root,".video","web-capture","runs",interruptedRun.id),{appId:"fixture-app"});
    assert.equal(interruptedProgress?.state,"waiting_for_reauthentication");assert.match(String(interruptedProgress?.errorCode),/SESSION_OWNER_UNAVAILABLE/);
    await unrelatedPage.close();await unrelatedOwner.close();await verify.close();
    await assert.rejects(()=>resolveSession(registered.handle),(error:any)=>error.message==="SESSION_TARGET_UNAVAILABLE");
  }finally{
    if(ownerStarted)await cli(sessionName,["close"]).catch(()=>{});await app.close();await disallowed.close();await rm(root,{recursive:true,force:true});
    if(previousNative===undefined)delete process.env.AGENT_BROWSER_NATIVE;else process.env.AGENT_BROWSER_NATIVE=previousNative;
    if(previousPrivate===undefined)delete process.env.APP_EXPLORER_SESSION_DIR;else process.env.APP_EXPLORER_SESSION_DIR=previousPrivate;
  }
});

test("borrowed handoff fails closed when an existing HTTP service worker comes from a disallowed host",{timeout:90000,skip:native?false:"Requires AGENT_BROWSER_NATIVE or agent-browser executable on PATH."},async()=>{
  const app=await fixture(),workerOrigin=await fixture("127.0.0.2"),sessionName=`gra39-worker-${randomUUID().replaceAll("-","").slice(0,16)}`,root=await mkdtemp(join(tmpdir(),"gra39-browser-worker-")),previousNative=process.env.AGENT_BROWSER_NATIVE,previousPrivate=process.env.APP_EXPLORER_SESSION_DIR;
  let ownerStarted=false;
  try{
    process.env.AGENT_BROWSER_NATIVE=nativeExecutable;process.env.APP_EXPLORER_SESSION_DIR=join(root,"private-sessions");
    await registerApp(root,{id:"fixture-app",name:"Synthetic browser fixture",url:app.url});
    await cli(sessionName,["open",app.url]);ownerStarted=true;
    const bound=await registerSession(root,{appId:"fixture-app",contextId:"fixture-context",sessionName}),resolved=await resolveSession(bound.handle);
    const resolvedOwner=await chromium.connectOverCDP(resolved.endpoint,{timeout:10000});
    try{const context=resolvedOwner.contexts()[0],workerPage=await context.newPage();await workerPage.goto(workerOrigin.url);await workerPage.evaluate(async()=>{await navigator.serviceWorker.register("/sw.js");await navigator.serviceWorker.ready;});await workerPage.close();assert.ok(context.serviceWorkers().length>0,"synthetic HTTP worker must be active before adapter attach");}
    finally{await resolvedOwner.close();}
    await assert.rejects(()=>attachBorrowedSession(resolved,{url:app.url,allowedHosts:["127.0.0.1"],session:{handle:bound.handle,networkPolicy:"capture"}}),(error:any)=>error.code==="SHARED_SESSION_POLICY_UNSUPPORTED");
  }finally{
    if(ownerStarted)await cli(sessionName,["close"]).catch(()=>{});await app.close();await workerOrigin.close();await rm(root,{recursive:true,force:true});
    if(previousNative===undefined)delete process.env.AGENT_BROWSER_NATIVE;else process.env.AGENT_BROWSER_NATIVE=previousNative;
    if(previousPrivate===undefined)delete process.env.APP_EXPLORER_SESSION_DIR;else process.env.APP_EXPLORER_SESSION_DIR=previousPrivate;
  }
});

test("failed page-policy installation restores the owner page and removes the future-document script",{timeout:90000,skip:native?false:"Requires AGENT_BROWSER_NATIVE or agent-browser executable on PATH."},async()=>{
  const app=await fixture("127.0.0.1",true),sessionName=`gra39-policy-rollback-${randomUUID().replaceAll("-","").slice(0,16)}`,root=await mkdtemp(join(tmpdir(),"gra39-policy-rollback-")),previousNative=process.env.AGENT_BROWSER_NATIVE,previousPrivate=process.env.APP_EXPLORER_SESSION_DIR;
  let ownerStarted=false;
  try{
    process.env.AGENT_BROWSER_NATIVE=nativeExecutable;process.env.APP_EXPLORER_SESSION_DIR=join(root,"private-sessions");
    await registerApp(root,{id:"fixture-app",name:"Synthetic browser fixture",url:app.url});
    await cli(sessionName,["open",`${app.url}?partial-policy=1`]);ownerStarted=true;
    const bound=await registerSession(root,{appId:"fixture-app",contextId:"fixture-context",sessionName}),resolved=await resolveSession(bound.handle);
    const config:any={url:app.url,allowedHosts:["127.0.0.1"],session:{handle:bound.handle,networkPolicy:"capture"}};
    await assert.rejects(()=>attachBorrowedSession(resolved,config),(error:any)=>error.code==="SHARED_SESSION_POLICY_UNSUPPORTED");
    const owner=await chromium.connectOverCDP(resolved.endpoint,{timeout:10000});
    try{
      const page=owner.contexts().flatMap(context=>context.pages()).find(candidate=>candidate.url().startsWith(`${app.url}?partial-policy=1`));assert.ok(page);
      const state=()=>page!.evaluate(()=>({restorationHook:typeof (window as any).__gra39CapturePolicyRestore,nativeConstructor:(window as any).__fixtureNativeRTCPeerConnection===RTCPeerConnection,constructible:(()=>{try{new RTCPeerConnection();return true;}catch{return false;}})()}));
      assert.deepEqual(await state(),{restorationHook:"undefined",nativeConstructor:true,constructible:true},"failed installation must restore the currently loaded owner page");
      await page!.reload();
      assert.deepEqual(await state(),{restorationHook:"undefined",nativeConstructor:true,constructible:true},"failed installation must remove its new-document hook before disconnecting");
    }finally{await owner.close();}
  }finally{
    if(ownerStarted)await cli(sessionName,["close"]).catch(()=>{});await app.close();await rm(root,{recursive:true,force:true});
    if(previousNative===undefined)delete process.env.AGENT_BROWSER_NATIVE;else process.env.AGENT_BROWSER_NATIVE=previousNative;
    if(previousPrivate===undefined)delete process.env.APP_EXPLORER_SESSION_DIR;else process.env.APP_EXPLORER_SESSION_DIR=previousPrivate;
  }
});

test("owned capture session still owns and closes its local browser resources",{timeout:60000},async()=>{
  const app=await fixture(),root=await mkdtemp(join(tmpdir(),"gra39-owned-session-"));
  try{const capture=await launchCaptureSession(root,{url:app.url,allowedHosts:["127.0.0.1"],viewport:{width:1280,height:720},clock:false});assert.equal(capture.ownership,"owned");assert.match(await capture.page.title(),/synthetic handoff/);await capture.close();await capture.close();assert.equal(capture.browser.isConnected(),false);}
  finally{await app.close();await rm(root,{recursive:true,force:true});}
});
