import type {CaptureAppConfig,CaptureRecipe,CaptureStep,LocatorSpec} from "./types.js";
import {WebCaptureError} from "./types.js";

const LOCAL_HOSTS=new Set(["localhost","127.0.0.1","::1"]);
function record(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value);}
function string(value:unknown,label:string,max=2000):string{if(typeof value!=="string"||!value.trim()||value.length>max)throw new WebCaptureError("INVALID_RECIPE",`${label} must be a non-empty string of at most ${max} characters.`);return value;}
function integer(value:unknown,label:string,min:number,max:number):number{if(!Number.isInteger(value)||Number(value)<min||Number(value)>max)throw new WebCaptureError("INVALID_RECIPE",`${label} must be an integer from ${min} to ${max}.`);return Number(value);}

export function isAllowedCaptureUrl(raw:string,app:CaptureAppConfig):boolean{
  let url:URL;try{url=new URL(raw,app.url);}catch{return false;}
  if((url.protocol!=="http:"&&url.protocol!=="https:")||url.username||url.password)return false;
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,"");
  return LOCAL_HOSTS.has(host)||(app.allowedHosts??[]).some((entry)=>entry.toLowerCase().replace(/^\[|\]$/g,"")===host);
}

function validateLocator(value:unknown,depth=0):asserts value is LocatorSpec{
  if(!record(value)||depth>4)throw new WebCaptureError("INVALID_RECIPE","Locator must be an object with one selector strategy; nested locators may be at most four levels deep.");
  const strategies=["role","text","testId","css"].filter((key)=>Object.hasOwn(value,key));
  if(strategies.length!==1)throw new WebCaptureError("INVALID_RECIPE","Each locator must define exactly one of role, text, testId, or css.");
  if(value.index!==undefined)integer(value.index,"Locator index",0,1000);
  if(value.first!==undefined&&typeof value.first!=="boolean")throw new WebCaptureError("INVALID_RECIPE","Locator first must be a boolean.");
  const strategy=strategies[0],selector=string(value[strategy],`Locator ${strategy}`,500);
  if(strategy==="role"&&value.name!==undefined)string(value.name,"Locator name",500);
  if(strategy!=="role"&&value.name!==undefined)throw new WebCaptureError("INVALID_RECIPE","Only role locators may include a name.");
  if(value.exact!==undefined&&typeof value.exact!=="boolean")throw new WebCaptureError("INVALID_RECIPE","Locator exact must be a boolean.");
  if(value.within!==undefined){validateLocator(value.within,depth+1);if(!record(value.within)||!Object.hasOwn(value.within,"role")&&!Object.hasOwn(value.within,"text")&&!Object.hasOwn(value.within,"testId")&&!Object.hasOwn(value.within,"css"))throw new WebCaptureError("INVALID_RECIPE","Nested locator is missing its selector.");}
  void selector;
}

function validateApp(value:unknown):asserts value is CaptureAppConfig{
  if(!record(value))throw new WebCaptureError("INVALID_RECIPE","app must be an object.");
  const app=value as unknown as CaptureAppConfig;
  string(app.url,"app.url");
  if(app.session!==undefined){if(!record(app.session))throw new WebCaptureError("INVALID_RECIPE","app.session must contain a registered session handle and explicit network policy.");string(app.session.handle,"app.session.handle",80);if(!new Set(["capture","strict"]).has(String(app.session.networkPolicy)))throw new WebCaptureError("SHARED_SESSION_POLICY_UNSUPPORTED","Shared browser capture requires explicit app.session.networkPolicy. Use 'capture' for supported HTTP/navigation policy, or 'strict' to request unsupported full host containment.");if(app.session.networkPolicy==="strict")throw new WebCaptureError("SHARED_SESSION_POLICY_UNSUPPORTED","Strict host containment is not supported for an already-loaded shared browser page. Use explicit networkPolicy 'capture' only if its documented boundary is sufficient.");if(app.auth?.storageStatePath)throw new WebCaptureError("INVALID_RECIPE","app.session cannot be combined with app.auth.storageStatePath.");if(app.clock===true)throw new WebCaptureError("INVALID_RECIPE","Shared browser sessions use the real clock; app.clock cannot be enabled.");}
  if(app.allowedHosts!==undefined&&(!Array.isArray(app.allowedHosts)||app.allowedHosts.length>50||app.allowedHosts.some((host)=>typeof host!=="string"||!/^[a-z0-9.:[\]-]+$/i.test(host))))throw new WebCaptureError("INVALID_RECIPE","app.allowedHosts must be a list of host names without schemes or paths.");
  let url:URL;try{url=new URL(app.url);}catch{throw new WebCaptureError("INVALID_RECIPE","app.url must be an absolute HTTP(S) URL.");}
  if(!isAllowedCaptureUrl(url.href,app))throw new WebCaptureError("INVALID_RECIPE","app.url must use HTTP(S) and a host allowed by app.allowedHosts or a local loopback host.");
  if(app.browserExecutablePath!==undefined)string(app.browserExecutablePath,"app.browserExecutablePath",2000);
  if(app.viewport!==undefined){if(!record(app.viewport))throw new WebCaptureError("INVALID_RECIPE","app.viewport must be an object.");integer(app.viewport.width,"app.viewport.width",320,3840);integer(app.viewport.height,"app.viewport.height",240,2160);}
  if(app.dpr!==undefined&&(!(typeof app.dpr==="number")||!Number.isFinite(app.dpr)||app.dpr<1||app.dpr>2))throw new WebCaptureError("INVALID_RECIPE","app.dpr must be between 1 and 2.");
  const dpr=app.dpr??1,viewport=app.viewport;
  if(viewport){const pixelWidth=Math.round(viewport.width*dpr),pixelHeight=Math.round(viewport.height*dpr);if(Math.abs(viewport.width*dpr-pixelWidth)>0.001||Math.abs(viewport.height*dpr-pixelHeight)>0.001||pixelWidth%2!==0||pixelHeight%2!==0)throw new WebCaptureError("INVALID_RECIPE","Viewport × dpr must produce even integer pixel dimensions for H.264 capture.");}
  if(app.fps!==undefined)integer(app.fps,"app.fps",1,60);
  for(const [key,value,min,max] of [["navigationTimeoutMs",app.navigationTimeoutMs,100,120000],["actionTimeoutMs",app.actionTimeoutMs,100,120000],["maxFrames",app.maxFrames,1,10000],["maxDurationSeconds",app.maxDurationSeconds,1,300],["maxArtifactBytes",app.maxArtifactBytes,1024,524288000],["maxRunBytes",app.maxRunBytes,1048576,2147483648]] as const)if(value!==undefined)integer(value,`app.${key}`,min,max);
  if(app.clock!==undefined&&typeof app.clock!=="boolean")throw new WebCaptureError("INVALID_RECIPE","app.clock must be a boolean.");
  if(app.headless!==undefined&&typeof app.headless!=="boolean")throw new WebCaptureError("INVALID_RECIPE","app.headless must be a boolean.");
  if(app.auth!==undefined){if(!record(app.auth))throw new WebCaptureError("INVALID_RECIPE","app.auth must be an object.");if(app.auth.storageStatePath!==undefined)string(app.auth.storageStatePath,"app.auth.storageStatePath",2000);}
  if(app.identity!==undefined){if(!record(app.identity))throw new WebCaptureError("INVALID_RECIPE","app.identity must contain observable app-specific assertions.");for(const key of ["required","account","role"] as const){const assertion=app.identity[key];if(assertion===undefined)continue;if(key==="required"){if(typeof assertion!=="boolean")throw new WebCaptureError("INVALID_RECIPE","app.identity.required must be a boolean.");continue;}if(!record(assertion))throw new WebCaptureError("INVALID_RECIPE",`app.identity.${key} must be an observable text assertion.`);validateLocator(assertion.target);string(assertion.text,`app.identity.${key}.text`);if(assertion.exact!==undefined&&typeof assertion.exact!=="boolean")throw new WebCaptureError("INVALID_RECIPE",`app.identity.${key}.exact must be a boolean.`);}}
  if(app.server!==undefined){
    const server=app.server;if(!record(server))throw new WebCaptureError("INVALID_RECIPE","app.server must be an object.");
    string(server.command,"app.server.command",500);string(server.cwd,"app.server.cwd",2000);string(server.healthUrl,"app.server.healthUrl");
    if(!Array.isArray(server.args)||server.args.length>100||server.args.some((arg)=>typeof arg!=="string"||arg.length>4000))throw new WebCaptureError("INVALID_RECIPE","app.server.args must be an array of argument strings.");
    if(!isAllowedCaptureUrl(server.healthUrl,app))throw new WebCaptureError("INVALID_RECIPE","app.server.healthUrl host must be local or listed in app.allowedHosts.");
    if(server.startTimeoutMs!==undefined)integer(server.startTimeoutMs,"app.server.startTimeoutMs",500,120000);
  }
}

function validateStep(step:unknown,index:number,app:CaptureAppConfig):asserts step is CaptureStep{
  if(!record(step)||typeof step.action!=="string")throw new WebCaptureError("INVALID_RECIPE",`steps[${index}] must have an action.`);
  if(step.timeoutMs!==undefined)integer(step.timeoutMs,`steps[${index}].timeoutMs`,100,120000);
  if(step.optional!==undefined&&typeof step.optional!=="boolean")throw new WebCaptureError("INVALID_RECIPE",`steps[${index}].optional must be a boolean.`);
  const requireTarget=()=>validateLocator(step.target);
  switch(step.action){
    case "goto":{const target=string(step.url,`steps[${index}].url`);if(!isAllowedCaptureUrl(target,app))throw new WebCaptureError("INVALID_RECIPE",`steps[${index}].url must stay on the configured HTTP(S) host allowlist.`);break;}
    case "back":if(step.holdFrames!==undefined)integer(step.holdFrames,`steps[${index}].holdFrames`,0,600);break;
    case "waitFor":case "assertVisible":requireTarget();if(step.action==="waitFor"&&step.state!==undefined&&!new Set(["visible","hidden","attached","detached"]).has(String(step.state)))throw new WebCaptureError("INVALID_RECIPE",`steps[${index}].state is invalid.`);break;
    case "assertText":requireTarget();string(step.text,`steps[${index}].text`);if(step.exact!==undefined&&typeof step.exact!=="boolean")throw new WebCaptureError("INVALID_RECIPE",`steps[${index}].exact must be a boolean.`);break;
    case "hover":requireTarget();if(step.travelFrames!==undefined)integer(step.travelFrames,`steps[${index}].travelFrames`,0,300);if(step.holdFrames!==undefined)integer(step.holdFrames,`steps[${index}].holdFrames`,0,600);break;
    case "click":requireTarget();if(step.travelFrames!==undefined)integer(step.travelFrames,`steps[${index}].travelFrames`,0,300);if(step.holdFrames!==undefined)integer(step.holdFrames,`steps[${index}].holdFrames`,0,600);break;
    case "fill":requireTarget();if(typeof step.value==="string")string(step.value,`steps[${index}].value`,10000);else if(record(step.value)){const env=string(step.value.env,`steps[${index}].value.env`,200);if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(env))throw new WebCaptureError("INVALID_RECIPE",`steps[${index}].value.env must be an environment variable name.`);}else throw new WebCaptureError("INVALID_RECIPE",`steps[${index}].value must be text or an environment-variable reference.`);if(step.travelFrames!==undefined)integer(step.travelFrames,`steps[${index}].travelFrames`,0,300);if(step.holdFrames!==undefined)integer(step.holdFrames,`steps[${index}].holdFrames`,0,600);break;
    case "press":string(step.key,`steps[${index}].key`,100);if(step.target!==undefined)requireTarget();if(step.travelFrames!==undefined)integer(step.travelFrames,`steps[${index}].travelFrames`,0,300);if(step.holdFrames!==undefined)integer(step.holdFrames,`steps[${index}].holdFrames`,0,600);break;
    case "scroll":if(typeof step.deltaY!=="number"||!Number.isFinite(step.deltaY)||Math.abs(step.deltaY)>10000)throw new WebCaptureError("INVALID_RECIPE",`steps[${index}].deltaY must be between -10000 and 10000.`);if(step.frames!==undefined)integer(step.frames,`steps[${index}].frames`,1,600);if(step.target!==undefined)requireTarget();break;
    case "hold":integer(step.frames,`steps[${index}].frames`,0,6000);break;
    case "marker":string(step.name,`steps[${index}].name`,100);break;
    case "screenshot":{const name=string(step.name,`steps[${index}].name`,100);if(name.includes("..")||/[\\/:*?"<>|\0]/.test(name))throw new WebCaptureError("INVALID_RECIPE",`steps[${index}].name must be a plain filename stem.`);if(step.mode!==undefined&&!new Set(["viewport","fullPage","element"]).has(String(step.mode)))throw new WebCaptureError("INVALID_RECIPE",`steps[${index}].mode is invalid.`);if(step.target!==undefined)requireTarget();if(step.mode==="element"&&!step.target)throw new WebCaptureError("INVALID_RECIPE",`steps[${index}] element screenshots require target.`);break;}
    default:throw new WebCaptureError("INVALID_RECIPE",`steps[${index}] uses an unsupported action.`);
  }
}

export function validateCaptureRecipe(value:unknown):CaptureRecipe{
  if(!record(value))throw new WebCaptureError("INVALID_RECIPE","Recipe must be a JSON object.");
  if(value.version!=="1")throw new WebCaptureError("INVALID_RECIPE","Recipe version must be '1'.");
  string(value.name,"recipe.name",120);validateApp(value.app);
  if(!Array.isArray(value.steps)||value.steps.length===0||value.steps.length>200)throw new WebCaptureError("INVALID_RECIPE","recipe.steps must contain between 1 and 200 steps.");
  const app=value.app as unknown as CaptureAppConfig;
  value.steps.forEach((step,index)=>validateStep(step,index,app));
  if(!record(value.outputs))throw new WebCaptureError("INVALID_RECIPE","recipe.outputs must be an object.");
  if(value.outputs.video!==undefined&&typeof value.outputs.video!=="boolean")throw new WebCaptureError("INVALID_RECIPE","recipe.outputs.video must be a boolean.");
  if(value.outputs.cursorOverlay!==undefined&&typeof value.outputs.cursorOverlay!=="boolean")throw new WebCaptureError("INVALID_RECIPE","recipe.outputs.cursorOverlay must be a boolean.");
  if(value.outputs.cursorOverlay===true&&value.outputs.video!==true)throw new WebCaptureError("INVALID_RECIPE","recipe.outputs.cursorOverlay requires outputs.video to be true.");
  if(value.postconditions!==undefined){
    if(!Array.isArray(value.postconditions)||value.postconditions.length>100)throw new WebCaptureError("INVALID_RECIPE","recipe.postconditions must be an array of at most 100 assertions.");
    value.postconditions.forEach((condition,index)=>{if(!record(condition)||!new Set(["assertVisible","assertText"]).has(String(condition.action)))throw new WebCaptureError("INVALID_RECIPE",`postconditions[${index}] must be assertVisible or assertText.`);validateLocator(condition.target);if(condition.action==="assertText")string(condition.text,`postconditions[${index}].text`);if(condition.timeoutMs!==undefined)integer(condition.timeoutMs,`postconditions[${index}].timeoutMs`,100,120000);});
  }
  const fps=value.app.fps??30,maxFrames=value.app.maxFrames??1800,maxDuration=value.app.maxDurationSeconds??60;
  if(maxFrames>fps*maxDuration)throw new WebCaptureError("INVALID_RECIPE","app.maxFrames cannot exceed fps × maxDurationSeconds.");
  let reserved=value.outputs.video?1:0;
  if(value.outputs.video)for(const step of value.steps){
    if(step.action==="goto")reserved+=1;
    else if(step.action==="back")reserved+=(step.holdFrames??10)+1;
    else if(step.action==="hold")reserved+=step.frames;
    else if(step.action==="hover")reserved+=(step.travelFrames??8)+(step.holdFrames??15);
    else if(step.action==="click")reserved+=(step.travelFrames??8)+(step.holdFrames??4);
    else if(step.action==="fill")reserved+=(step.travelFrames??8)+(step.holdFrames??3);
    else if(step.action==="press")reserved+=(step.target?(step.travelFrames??8):0)+(step.holdFrames??3);
    else if(step.action==="scroll")reserved+=step.frames??12;
  }
  if(reserved>maxFrames)throw new WebCaptureError("INVALID_RECIPE","Recipe's declared actions exceed app.maxFrames.");
  return value as unknown as CaptureRecipe;
}
