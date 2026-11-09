import {randomUUID} from "node:crypto";
import {rename,writeFile} from "node:fs/promises";
import {basename,join} from "node:path";
import type {CaptureProgress} from "../browser-session/types.js";
import {readConfinedFile} from "../app-explorer/safe-file.js";

const STATES=new Set(["starting","running","waiting_for_reauthentication","succeeded","failed"]);
const ERROR=/^[A-Z][A-Z0-9_]{1,79}$/;
const RUN_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STEP_ID=/^[A-Za-z0-9._:-]{1,100}$/;
const APP_ALIAS=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

/** Write a small independent progress projection; no page data or connection details are accepted. */
export async function writeCaptureProgress(runDirectory:string,progress:CaptureProgress):Promise<void>{
  if(!progress||typeof progress.runId!=="string"||!RUN_ID.test(progress.runId)||basename(runDirectory)!==progress.runId)throw new Error("CAPTURE_PROGRESS_INVALID");
  if(!(progress.stepId===null||(typeof progress.stepId==="string"&&STEP_ID.test(progress.stepId)))||!STATES.has(progress.state)||typeof progress.timestamp!=="string"||progress.timestamp.length>64||Number.isNaN(Date.parse(progress.timestamp))||(progress.errorCode!==undefined&&!ERROR.test(progress.errorCode))||((progress.appId===undefined)!==(progress.contextId===undefined))||(progress.appId!==undefined&&(!APP_ALIAS.test(progress.appId)||!APP_ALIAS.test(progress.contextId!))))throw new Error("CAPTURE_PROGRESS_INVALID");
  const value:CaptureProgress={runId:progress.runId,stepId:progress.stepId,state:progress.state,timestamp:progress.timestamp,...(progress.errorCode?{errorCode:progress.errorCode}:{}),...(progress.appId?{appId:progress.appId,contextId:progress.contextId}: {})};
  const file=join(runDirectory,"progress.json"),temporary=`${file}.tmp-${randomUUID()}`;
  await writeFile(temporary,`${JSON.stringify(value)}\n`,{encoding:"utf8",flag:"wx"});await rename(temporary,file);
}

export async function readCaptureProgress(runDirectory:string,filter?:{appId:string;contextId?:string}):Promise<CaptureProgress|undefined>{
  try{const value=JSON.parse((await readConfinedFile(runDirectory,"progress.json")).toString("utf8"));if(!value||typeof value!=="object"||!RUN_ID.test(value.runId)||basename(runDirectory)!==value.runId||!(value.stepId===null||(typeof value.stepId==="string"&&STEP_ID.test(value.stepId)))||!STATES.has(value.state)||typeof value.timestamp!=="string"||value.timestamp.length>64||Number.isNaN(Date.parse(value.timestamp))||(value.errorCode!==undefined&&!ERROR.test(value.errorCode))||((value.appId===undefined)!==(value.contextId===undefined))||(value.appId!==undefined&&(!APP_ALIAS.test(value.appId)||!APP_ALIAS.test(value.contextId)))||(filter&&(!APP_ALIAS.test(filter.appId)||value.appId!==filter.appId||(filter.contextId!==undefined&&value.contextId!==filter.contextId))))return undefined;return {runId:value.runId,stepId:value.stepId,state:value.state,timestamp:value.timestamp,...(typeof value.errorCode==="string"?{errorCode:value.errorCode}:{}),...(typeof value.appId==="string"&&typeof value.contextId==="string"?{appId:value.appId,contextId:value.contextId}:{})};}catch{return undefined;}
}
