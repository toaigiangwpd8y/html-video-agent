import {randomUUID} from "node:crypto";
import {mkdir,readFile,realpath,rename,writeFile,lstat} from "node:fs/promises";
import {spawn} from "node:child_process";
import {join,resolve,sep,relative} from "node:path";
import {resolveAppWorkspace} from "../app-explorer/registry.js";
import type {PrivateSessionDescriptor,RegisterSessionInput,ResolvedSession} from "./types.js";

const HANDLE=/^[a-f0-9]{32}$/;
const ALIAS=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const MAX_OUTPUT=256*1024;

function privateRoot():string{
  const configured=process.env.APP_EXPLORER_SESSION_DIR;
  if(configured)return resolve(configured);
  const local=process.env.LOCALAPPDATA||process.env.XDG_STATE_HOME;
  return local?join(local,"AppExplorer","sessions"):join(process.env.USERPROFILE||process.env.HOME||process.cwd(),".app-explorer","sessions");
}
function binary():string{return process.env.AGENT_BROWSER_NATIVE||process.env.AGENT_BROWSER_EXECUTABLE||"agent-browser";}
function inside(base:string,target:string):boolean{const rel=relative(base,target);return !rel||(!rel.startsWith(`..${sep}`)&&rel!==".."&&!resolve(rel).startsWith(sep));}
async function assertPrivatePath(base:string,target:string):Promise<void>{
  if(!inside(base,target))throw new Error("SESSION_REGISTRY_UNSAFE");
  let cursor=base;const remainder=relative(base,target).split(sep).filter(Boolean);
  for(const [index,part] of remainder.entries()){
    cursor=join(cursor,part);
    try{const entry=await lstat(cursor);if(entry.isSymbolicLink())throw new Error("SESSION_REGISTRY_UNSAFE");if(index<remainder.length-1&&!entry.isDirectory())throw new Error("SESSION_REGISTRY_UNSAFE");}
    catch(error){if((error as {code?:string}).code!=="ENOENT")throw error;break;}
  }
}
function runOwner(sessionName:string,args:string[],timeoutMs=45000):Promise<string>{
  return new Promise((resolveOutput,rejectOutput)=>{
    const child=spawn(binary(),["--session",sessionName,...args],{stdio:["ignore","pipe","pipe"],shell:false,windowsHide:true});
    const stdout:Buffer[]=[],stderr:Buffer[]=[];let bytes=0,settled=false;
    const finish=(error?:Error,value?:string)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)rejectOutput(error);else resolveOutput(value??"");};
    let killTimer:any;const timer=setTimeout(()=>{try{child.kill();}catch{}killTimer=setTimeout(()=>finish(new Error("SESSION_OWNER_TIMEOUT")),3000);},timeoutMs);
    const collect=(target:Buffer[])=> (chunk:Uint8Array)=>{bytes+=chunk.byteLength;if(bytes>MAX_OUTPUT){try{child.kill();}catch{}finish(new Error("SESSION_OWNER_OUTPUT_LIMIT"));return;}target.push(Buffer.from(chunk));};
    child.stdout.on("data",collect(stdout));child.stderr.on("data",collect(stderr));
    child.once("error",()=>finish(new Error("SESSION_OWNER_UNAVAILABLE")));
    child.once("exit",(code:number|null)=>{if(killTimer)clearTimeout(killTimer);const output=Buffer.concat(stdout).toString("utf8").trim();setTimeout(()=>{child.stdout.destroy();child.stderr.destroy();child.unref();},0);if(code!==0){finish(new Error("SESSION_OWNER_COMMAND_FAILED"));return;}finish(undefined,output);});
  });
}
function parsedJson(raw:string):any{try{return JSON.parse(raw);}catch{throw new Error("SESSION_OWNER_RESPONSE_INVALID");}}
async function ownerTargets(sessionName:string):Promise<Array<{targetId:string;active:boolean}>>{
  const payload=parsedJson(await runOwner(sessionName,["tab","list","--json"]));
  const tabs=Array.isArray(payload)?payload:(Array.isArray(payload.tabs)?payload.tabs:Array.isArray(payload.data?.tabs)?payload.data.tabs:[]);
  return tabs.filter((tab:any)=>tab&&typeof tab.targetId==="string").map((tab:any)=>({targetId:tab.targetId,active:tab.active===true||tab.isActive===true||tab.selected===true}));
}
async function selectedTarget(sessionName:string):Promise<string>{
  const tabs=await ownerTargets(sessionName);
  const selected=tabs.filter((tab)=>tab.active);
  const target=selected.length===1?selected[0]:tabs.length===1?tabs[0]:undefined;
  if(!target)throw new Error("SESSION_TARGET_AMBIGUOUS");
  return target.targetId;
}
function validateDescriptor(value:unknown,handle:string):PrivateSessionDescriptor{
  if(!value||typeof value!=="object")throw new Error("SESSION_DESCRIPTOR_INVALID");
  const descriptor=value as PrivateSessionDescriptor;
  if(descriptor.version!=="1"||descriptor.handle!==handle||!ALIAS.test(descriptor.appId)||!ALIAS.test(descriptor.contextId)||!ALIAS.test(descriptor.sessionName)||typeof descriptor.role!=="string"||!descriptor.role||typeof descriptor.targetId!=="string"||!descriptor.targetId||Number.isNaN(Date.parse(descriptor.createdAt)))throw new Error("SESSION_DESCRIPTOR_INVALID");
  return descriptor;
}

async function readDescriptor(handle:string):Promise<PrivateSessionDescriptor>{
  if(typeof handle!=="string"||!HANDLE.test(handle))throw new Error("SESSION_HANDLE_INVALID");
  const base=privateRoot();
  let canonical:string;try{canonical=await realpath(base);}catch(error){if((error as {code?:string}).code==="ENOENT")throw new Error("SESSION_BINDING_MISSING");throw error;}
  const file=join(canonical,`${handle}.json`);await assertPrivatePath(canonical,file);
  try{return validateDescriptor(JSON.parse(await readFile(file,"utf8")),handle);}
  catch(error){if((error as {code?:string}).code==="ENOENT")throw new Error("SESSION_BINDING_MISSING");if(error instanceof SyntaxError)throw new Error("SESSION_DESCRIPTOR_INVALID");throw error;}
}

/** Return only sanitized aliases when a valid binding exists; owner availability is not required. */
export async function readSessionBinding(handle:string):Promise<{appId:string;contextId:string}>{
  const descriptor=await readDescriptor(handle);
  return {appId:descriptor.appId,contextId:descriptor.contextId};
}

/** Bind only the currently selected owner tab. The opaque CDP endpoint is never persisted. */
export async function registerSession(root:string,input:RegisterSessionInput):Promise<{handle:string}>{
  if(!input||!ALIAS.test(input.appId)||!ALIAS.test(input.contextId)||!ALIAS.test(input.sessionName))throw new Error("SESSION_BINDING_INVALID");
  await resolveAppWorkspace(root,input.appId);
  const targetId=await selectedTarget(input.sessionName);
  const handle=randomUUID().replaceAll("-","");
  const descriptor:PrivateSessionDescriptor={version:"1",handle,appId:input.appId,contextId:input.contextId,role:input.role?.trim()||"unspecified",sessionName:input.sessionName,targetId,createdAt:new Date().toISOString()};
  const base=privateRoot();await mkdir(base,{recursive:true});const canonical=await realpath(base),file=join(canonical,`${handle}.json`);await assertPrivatePath(canonical,file);
  const temporary=`${file}.tmp-${randomUUID()}`;await writeFile(temporary,`${JSON.stringify(descriptor)}\n`,{encoding:"utf8",flag:"wx"});await rename(temporary,file);
  return {handle};
}

/** Re-query the named owner on every resolution; the endpoint is returned only in memory. */
export async function resolveSession(handle:string):Promise<ResolvedSession>{
  const descriptor=await readDescriptor(handle);
  const targets=await ownerTargets(descriptor.sessionName);
  if(!targets.some((target)=>target.targetId===descriptor.targetId))throw new Error("SESSION_TARGET_UNAVAILABLE");
  const response=await runOwner(descriptor.sessionName,["get","cdp-url"]);
  const endpoint=response.match(/wss?:\/\/[^\s"']+/)?.[0];
  if(!endpoint)throw new Error("SESSION_OWNER_UNAVAILABLE");
  let url:URL;try{url=new URL(endpoint);}catch{throw new Error("SESSION_OWNER_UNAVAILABLE");}
  if((url.protocol!=="ws:"&&url.protocol!=="wss:")||url.username||url.password)throw new Error("SESSION_OWNER_UNAVAILABLE");
  return {descriptor,endpoint};
}

export async function agentBrowserCapability():Promise<{available:boolean;version:string|null;mode:"native"|"external-wrapper"|"missing";nodeRequirement:"native-binary-independent"|"npm-wrapper-requires-node-24"|"unknown"}>{
  const configuredNative=Boolean(process.env.AGENT_BROWSER_NATIVE),configuredExternal=Boolean(process.env.AGENT_BROWSER_EXECUTABLE);
  try{
    const version=await new Promise<string>((resolveVersion,rejectVersion)=>{
      const child=spawn(binary(),["--version"],{stdio:["ignore","pipe","ignore"],shell:false,windowsHide:true});let stdout="",settled=false;
      const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)rejectVersion(error);else resolveVersion(stdout.trim());};
      let killTimer:any;const timer=setTimeout(()=>{try{child.kill();}catch{}killTimer=setTimeout(()=>finish(new Error("AGENT_BROWSER_TIMEOUT")),2000);},3000);
      child.stdout.on("data",(chunk:Uint8Array)=>{stdout+=Buffer.from(chunk).toString("utf8").slice(0,200);});child.once("error",()=>finish(new Error("AGENT_BROWSER_MISSING")));child.once("exit",(code:number|null)=>{if(killTimer)clearTimeout(killTimer);code===0?finish():finish(new Error("AGENT_BROWSER_MISSING"));});
    });
    return {available:true,version:version.match(/agent-browser\s+(\d+\.\d+\.\d+)/i)?.[1]??null,mode:configuredNative?"native":configuredExternal?"external-wrapper":"external-wrapper",nodeRequirement:configuredNative?"native-binary-independent":"npm-wrapper-requires-node-24"};
  }catch{return {available:false,version:null,mode:"missing",nodeRequirement:"unknown"};}
}
