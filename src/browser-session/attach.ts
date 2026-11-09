import {chromium,type Browser, type BrowserContext, type CDPSession, type Page, type Route} from "playwright-core";
import type {CaptureAppConfig,CaptureSession,LocatorSpec,Viewport} from "../web-capture/types.js";
import {WebCaptureError} from "../web-capture/types.js";
import {isAllowedCaptureUrl} from "../web-capture/validate.js";
import type {ResolvedSession} from "./types.js";

function sanitized(code:string,message:string):WebCaptureError{return new WebCaptureError(code,message);}
function resolveLocator(page:Page,spec:LocatorSpec):any{
  const scope=spec.within?resolveLocator(page,spec.within):page;
  if(spec.role)return scope.getByRole(spec.role,{...(spec.name!==undefined?{name:spec.name}:{}),...(spec.exact!==undefined?{exact:spec.exact}:{})});
  if(spec.text)return scope.getByText(spec.text,{...(spec.exact!==undefined?{exact:spec.exact}:{})});
  if(spec.testId)return scope.getByTestId(spec.testId);
  return scope.locator(spec.css);
}
async function assertObservable(page:Page,assertion:{target:LocatorSpec;text:string;exact?:boolean},app:CaptureAppConfig):Promise<void>{
  const timeout=app.actionTimeoutMs??10000,locator=resolveLocator(page,assertion.target);
  try{await locator.waitFor({state:"visible",timeout});const actual=await locator.innerText({timeout});if(assertion.exact?actual!==assertion.text:!actual.includes(assertion.text))throw new Error("mismatch");}
  catch{throw sanitized("SESSION_IDENTITY_MISMATCH","The shared page did not match the configured account and role assertions. Reauthenticate in the owner browser, then rebind the intended app context.");}
}
export async function assertCaptureIdentity(page:Page,app:CaptureAppConfig):Promise<void>{
  if(app.identity?.required&&(!app.identity.account||!app.identity.role))throw sanitized("SESSION_IDENTITY_UNKNOWN","Shared capture requires observable account and role assertions. Configure both assertions before binding this session.");
  if(app.identity?.account)await assertObservable(page,app.identity.account,app);
  if(app.identity?.role)await assertObservable(page,app.identity.role,app);
}
async function pageTargetId(context:BrowserContext,page:Page):Promise<{targetId:string;session:CDPSession}>{
  const session=await context.newCDPSession(page);
  try{const info=await session.send("Target.getTargetInfo");return {targetId:info.targetInfo.targetId,session};}
  catch{try{await session.detach();}catch{}throw sanitized("SESSION_TARGET_UNAVAILABLE","The registered browser target is no longer available. Rebind the intended owner tab.");}
}
const POLICY_KEY="__gra39CapturePolicyRestore";
const POLICY_SCRIPT=`(()=>{const w=globalThis,sw=navigator.serviceWorker,define=Object.defineProperty,originals={rtc:Object.getOwnPropertyDescriptor(w,'RTCPeerConnection'),webkit:Object.getOwnPropertyDescriptor(w,'webkitRTCPeerConnection'),register:sw?Object.getOwnPropertyDescriptor(sw,'register'):undefined,registerFn:sw?.register?.bind(sw)};const restore=()=>{try{if(originals.rtc)define(w,'RTCPeerConnection',originals.rtc);else delete w.RTCPeerConnection;if(originals.webkit)define(w,'webkitRTCPeerConnection',originals.webkit);else delete w.webkitRTCPeerConnection;if(sw){if(originals.register)define(sw,'register',originals.register);else delete sw.register;}delete w['${POLICY_KEY}']}catch{}};try{define(w,'${POLICY_KEY}',{configurable:true,value:restore});if(originals.rtc)define(w,'RTCPeerConnection',{configurable:true,value:class BlockedRTCPeerConnection{constructor(){throw new Error('WebRTC is disabled during shared capture.')}}});if(originals.webkit)define(w,'webkitRTCPeerConnection',{configurable:true,value:class BlockedRTCPeerConnection{constructor(){throw new Error('WebRTC is disabled during shared capture.')}}});if(originals.registerFn)define(sw,'register',{configurable:true,value:()=>Promise.reject(new Error('Service worker registration is disabled during shared capture.'))})}catch{restore()}})()`;
async function patchPagePolicy(page:Page,sessions:Array<{page:Page;cdp:CDPSession;scriptId:string}>):Promise<void>{
  if(sessions.some(item=>item.page===page))return;
  const cdp=await page.context().newCDPSession(page);
  let scriptId:string|undefined;
  try{const result=await cdp.send("Page.addScriptToEvaluateOnNewDocument",{source:POLICY_SCRIPT});scriptId=result.identifier;const installed=await page.evaluate((value)=>{(0,eval)(value);return typeof (globalThis as any)["__gra39CapturePolicyRestore"]==="function";},POLICY_SCRIPT);if(!installed)throw new Error("capture policy script did not install");sessions.push({page,cdp,scriptId});}
  catch{try{await page.evaluate((key)=>{const restore=(globalThis as any)[key];if(typeof restore==="function")restore();},POLICY_KEY);}catch{}if(scriptId)try{await cdp.send("Page.removeScriptToEvaluateOnNewDocument",{identifier:scriptId});}catch{}try{await cdp.detach();}catch{}throw sanitized("SHARED_SESSION_POLICY_UNSUPPORTED","The shared page could not install or restore the capture network boundary. Rebind a compatible app tab.");}
}
async function assertSharedPolicy(context:BrowserContext,page:Page,sessions:Array<{page:Page;cdp:CDPSession;scriptId:string}>):Promise<{assertSafe:()=>void;securePage:(page:Page)=>Promise<void>;release:()=>Promise<void>}>{
  const pageOrigin=(()=>{try{return new URL(page.url()).origin;}catch{return "";}})();
  if(!pageOrigin)throw sanitized("SHARED_SESSION_POLICY_UNSUPPORTED","The owner page has no supported HTTP(S) origin. Rebind the intended app tab.");
  const isWebWorker=(worker:{url():string})=>{try{const workerUrl=new URL(worker.url());return workerUrl.protocol==="http:"||workerUrl.protocol==="https:";}catch{return true;}};
  if(context.serviceWorkers().some(isWebWorker))throw sanitized("SHARED_SESSION_POLICY_UNSUPPORTED","An existing web service worker cannot be contained by this shared capture boundary. Use the authorized app tab without active web service workers.");
  try{await patchPagePolicy(page,sessions);}catch(error){throw error;}
  let appWorkerDetected=false;
  const onWorker=(worker:{url():string})=>{if(isWebWorker(worker))appWorkerDetected=true;};context.on("serviceworker",onWorker);
  const onPage=(candidate:Page)=>{void patchPagePolicy(candidate,sessions).catch(()=>{appWorkerDetected=true;});};
  context.on("page",onPage);
  return {assertSafe:()=>{if(appWorkerDetected)throw sanitized("SHARED_SESSION_POLICY_UNSUPPORTED","The shared app registered a service worker after attachment or could not install a page network guard. Browser capture paused; rebind a compatible app tab.");},securePage:(candidate)=>patchPagePolicy(candidate,sessions),release:async()=>{context.off("page",onPage);context.off("serviceworker",onWorker);for(const item of sessions){try{await item.page.evaluate((key)=>{const restore=(globalThis as any)[key];if(typeof restore==="function")restore();},POLICY_KEY);}catch{}try{await item.cdp.send("Page.removeScriptToEvaluateOnNewDocument",{identifier:item.scriptId});}catch{}try{await item.cdp.detach();}catch{}}}};
}

export async function attachBorrowedSession(session:ResolvedSession,app:CaptureAppConfig):Promise<CaptureSession>{
  if(app.session?.networkPolicy!=="capture")throw sanitized("SHARED_SESSION_POLICY_UNSUPPORTED","Shared capture requires an explicit app.session.networkPolicy. Strict WebSocket containment is unsupported for this already-loaded page; select 'capture' only when its documented HTTP/navigation boundary is sufficient.");
  let browser:Browser|undefined,context:BrowserContext|undefined,page:Page|undefined,targetSession:CDPSession|undefined,restoreViewport:(()=>Promise<void>)|undefined;
  const policySessions:Array<{page:Page;cdp:CDPSession;scriptId:string}>=[];
  const popupSources=new Set<Page>();
  let routeHandler:((route:Route)=>Promise<void>)|undefined;
  let popupListener:((popup:Page)=>void)|undefined;
  let closeStarted=false,viewportRestored=true,assertPolicy:()=>void=()=>{},securePage:(candidate:Page)=>Promise<void>=async()=>{},releasePolicy:()=>Promise<void>=async()=>{};
  try{
    browser=await chromium.connectOverCDP(session.endpoint,{timeout:app.navigationTimeoutMs??20000});
    const contexts=browser.contexts();if(!contexts.length)throw sanitized("SESSION_TARGET_UNAVAILABLE","The registered owner browser has no available context. Reopen the authorized app tab and rebind it.");
    const matches:Array<{context:BrowserContext;page:Page;cdp:CDPSession}>=[];
    for(const candidateContext of contexts)for(const candidatePage of candidateContext.pages()){
      const candidate=await pageTargetId(candidateContext,candidatePage);
      if(candidate.targetId===session.descriptor.targetId)matches.push({context:candidateContext,page:candidatePage,cdp:candidate.session});
      else try{await candidate.session.detach();}catch{}
    }
    if(matches.length!==1)throw sanitized("SESSION_TARGET_UNAVAILABLE","The registered app tab is missing or ambiguous. Reopen the intended owner tab and rebind it; no other tab was selected.");
    ({context,page,cdp:targetSession}=matches[0]);
    if(!isAllowedCaptureUrl(page.url(),app))throw sanitized("SHARED_SESSION_POLICY_UNSUPPORTED","The registered owner tab is outside the configured capture host policy. Rebind the intended app tab.");
    const policy=await assertSharedPolicy(context,page,policySessions);assertPolicy=policy.assertSafe;releasePolicy=policy.release;
    const isAllowed=(raw:string)=>isAllowedCaptureUrl(raw,app);
    const watchPopups=(candidate:Page)=>{if(popupSources.has(candidate))return;popupSources.add(candidate);candidate.on("popup",popupListener!);};
    popupListener=(popup:Page)=>{watchPopups(popup);};
    securePage=async(candidate)=>{await policy.securePage(candidate);watchPopups(candidate);};
    const belongsToCapture=async(candidate:Page):Promise<boolean>=>{
      const seen=new Set<Page>();let current:Page|null=candidate;
      while(current&&!seen.has(current)){if(current===page)return true;seen.add(current);try{current=await current.opener();}catch{return false;}}
      return false;
    };
    // BrowserContext.route is required here: Page.route is installed too late to catch a popup's first navigation request.
    // Requests with an available frame are attributed to the selected page/opener chain; other existing pages fall back.
    // Chromium can issue a new target's first request before a frame exists, so those requests use the host allowlist
    // as a fail-closed boundary. This can block an unrelated manual popup to a disallowed host during capture.
    routeHandler=async(route:Route)=>{
      let candidate:Page;
      try{candidate=route.request().frame().page();}catch{
        // Chromium can issue a new target's first navigation before its frame/page is attributable.
        // Fail closed for that unowned-by-evidence case; this can also block a manual unrelated popup to a disallowed host.
        if(!isAllowed(route.request().url()))await route.abort("blockedbyclient");else await route.fallback();
        return;
      }
      const owned=await belongsToCapture(candidate);
      if(!owned){await route.fallback();return;}
      if(!isAllowed(route.request().url()))await route.abort("blockedbyclient");else await route.fallback();
    };
    await context.route("**/*",routeHandler);watchPopups(page);
    const before=await page.evaluate(()=>({width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio}));
    if(!Number.isFinite(before.width)||!Number.isFinite(before.height)||before.width<1||before.height<1||!Number.isFinite(before.dpr)||before.dpr<1)throw sanitized("SESSION_VIEWPORT_INVALID","The owner tab has no measurable viewport. Reopen it and rebind the app session.");
    if(app.dpr!==undefined&&Math.abs(before.dpr-app.dpr)>0.001)throw sanitized("SESSION_DPR_MISMATCH","The app DPR does not match the registered browser page. Rebind a page with the configured DPR.");
    let after:Viewport={width:before.width,height:before.height};
    if(app.viewport){
      await page.setViewportSize(app.viewport);const measured=await page.evaluate(()=>({width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio}));
      if(app.dpr!==undefined&&Math.abs(measured.dpr-app.dpr)>0.001)throw sanitized("SESSION_DPR_MISMATCH","Changing the owner viewport changed its DPR. Rebind a page with the configured DPR.");
      after={width:measured.width,height:measured.height};
      restoreViewport=async()=>{await page!.setViewportSize({width:before.width,height:before.height});};
    }
    await assertCaptureIdentity(page,app);
    page.setDefaultTimeout(app.actionTimeoutMs??10000);page.setDefaultNavigationTimeout(app.navigationTimeoutMs??20000);
    const borrowedViewport={before:{width:before.width,height:before.height},after};
    const close=async()=>{
      if(closeStarted)return;closeStarted=true;
      if(routeHandler)try{await context?.unroute("**/*",routeHandler);}catch{}
      for(const source of popupSources)if(popupListener)source.off("popup",popupListener);
      await releasePolicy();
      if(restoreViewport)try{await restoreViewport();}catch{viewportRestored=false;}
      try{await targetSession?.detach();}catch{}
      try{await browser?.close();}catch{}
      if(!viewportRestored)throw sanitized("SESSION_VIEWPORT_RESTORE_FAILED","The borrowed page viewport could not be restored after capture. Inspect the owner tab and rebind before continuing.");
    };
    return {browser,context,page,clockEnabled:false,ownership:"borrowed",viewport:after,deviceScaleFactor:before.dpr,sessionBinding:{appId:session.descriptor.appId,contextId:session.descriptor.contextId,role:session.descriptor.role},borrowedViewport,borrowedViewportRestored:()=>viewportRestored,assertPolicy,securePage,close};
  }catch(error){
    if(routeHandler)try{await context?.unroute("**/*",routeHandler);}catch{}
    for(const source of popupSources)if(popupListener)source.off("popup",popupListener);
    await releasePolicy();
    try{await restoreViewport?.();}catch{}
    try{await targetSession?.detach();}catch{}
    try{await browser?.close();}catch{}
    if(error instanceof WebCaptureError)throw error;
    throw sanitized("SESSION_TARGET_UNAVAILABLE","Could not attach to the registered owner tab. Check the owner session, then reauthenticate and rebind if needed.");
  }
}
