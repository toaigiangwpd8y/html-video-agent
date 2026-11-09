import {spawn} from "node:child_process";
import {resolve,relative,isAbsolute} from "node:path";
import {mkdir,readFile,rename,rm,stat} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {sha256} from "../core/hash.js";
import {harnessPaths} from "../harness/paths.js";
import {ttsConfig,publicTtsConfig} from "./config.js";
import type {TtsConfig,TtsReadiness,TtsSegmentInput,TtsWorkerResult} from "./types.js";

function toWslPath(path:string):string{
  const normalized=path.replaceAll("\\","/");const match=/^([A-Za-z]):\/(.*)$/.exec(normalized);
  if(!match)throw new Error(`Cannot map host path into WSL: ${path}`);
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function runWorker(root:string,config:TtsConfig,payload:Record<string,unknown>):Promise<{stdout:string;stderr:string}>{
  const worker=harnessPaths(root).narrationWorker;
  return new Promise((resolvePromise,reject)=>{
    const isWsl=process.platform==="win32"&&config.pythonExecutable.startsWith("wsl:");
    if(config.pythonExecutable.startsWith("wsl:")&&!isWsl){reject(new Error("The wsl: Python transport is only available from the Windows host."));return;}
    const python=isWsl?config.pythonExecutable.slice(4):config.pythonExecutable;
    if(isWsl&&!python.startsWith("/")){reject(new Error("VIDEO_TTS_PYTHON wsl: path must name an absolute Linux Python executable."));return;}
    const linuxRoot=isWsl?toWslPath(root):undefined,linuxWorker=isWsl?toWslPath(worker):worker;
    const command=isWsl?"wsl.exe":python,args=isWsl?["--distribution",process.env.VIDEO_TTS_WSL_DISTRO||"Ubuntu-24.04","--cd",linuxRoot!,"--exec",python,linuxWorker]:[worker];
    const payloadForWorker=isWsl?JSON.parse(JSON.stringify(payload,(key,value)=>key==="outputPath"&&typeof value==="string"?toWslPath(value):value)) as Record<string,unknown>:payload;
    const child=spawn(command,args,{cwd:root,stdio:["pipe","pipe","pipe"],shell:false,windowsHide:true});
    let stdout="",stderr="",settled=false;
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolvePromise({stdout,stderr});};
    const timer=setTimeout(()=>{child.kill("SIGKILL");finish(new Error(`VieNeu worker exceeded ${config.timeoutMs}ms and was terminated.`));},config.timeoutMs);
    child.stdout.on("data",(part:Uint8Array)=>{stdout+=Buffer.from(part).toString("utf8");if(stdout.length>2_000_000){child.kill("SIGKILL");finish(new Error("VieNeu worker exceeded the response size limit."));}});
    child.stderr.on("data",(part:Uint8Array)=>{stderr+=Buffer.from(part).toString("utf8").slice(0,100_000);});
    child.on("error",(error:Error)=>finish(new Error(`Unable to start Python TTS worker: ${error.message}`)));
    child.on("close",(code:number)=>code===0?finish():finish(new Error(`VieNeu worker exited ${code}. ${stderr.trim()||"No diagnostics were returned."}`)));
    child.stdin.end(JSON.stringify(payloadForWorker));
  });
}

export async function probeTts(root:string,overrides:Partial<TtsConfig>={}):Promise<TtsReadiness>{
  const config=ttsConfig(root,overrides);
  try{
    const response=await runWorker(root,config,{action:"probe",config:publicTtsConfig(config)}),result=JSON.parse(response.stdout) as {ready:boolean;message:string;python:string;missingFiles?:string[];sdkVersion?:string;onnxruntimeVersion?:string;soundfileVersion?:string};
    return {ready:result.ready,provider:config.provider,configured:true,python:result.python,message:result.message,...(result.missingFiles?{missingFiles:result.missingFiles}:{}),runtime:{sdkVersion:result.sdkVersion,onnxruntimeVersion:result.onnxruntimeVersion,soundfileVersion:result.soundfileVersion},config};
  }catch(error){return {ready:false,provider:config.provider,configured:true,python:config.pythonExecutable,message:error instanceof Error?error.message:String(error),config};}
}

export interface TtsProvider {config:TtsConfig;probe():Promise<TtsReadiness>;synthesizeSegment(input:TtsSegmentInput,outputPath:string):Promise<TtsWorkerResult>;synthesizeSegments(inputs:Array<TtsSegmentInput&{outputPath:string}>):Promise<TtsWorkerResult>;}

export function createTtsProvider(root:string,overrides:Partial<TtsConfig>={}):TtsProvider{
  const config=ttsConfig(root,overrides);
  const synthesizeSegments=async(inputs:Array<TtsSegmentInput&{outputPath:string}>):Promise<TtsWorkerResult>=>{
    if(!inputs.length)throw new Error("At least one uncached narration segment is required for synthesis.");
    const p=harnessPaths(root),cacheRoot=resolve(p.narrationCache),seen=new Set<string>(),staged:Array<{id:string;target:string;staging:string}>=[];
    for(const input of inputs){
      if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.id)||seen.has(input.id))throw new Error(`Unsafe or duplicate narration segment id: ${input.id}`);seen.add(input.id);
      if(!input.text.trim()||input.text.length>3000)throw new Error("TTS narration text must contain 1-3000 characters.");
      const target=resolve(input.outputPath),rel=relative(cacheRoot,target);if(rel.startsWith("..")||isAbsolute(rel))throw new Error("TTS output must be written under the local narration cache.");
      await mkdir(resolve(target,".."),{recursive:true});staged.push({id:input.id,target,staging:`${target}.${randomUUID()}.partial.wav`});
    }
    try{
      const started=Date.now(),response=await runWorker(root,config,{action:"synthesize",config:publicTtsConfig(config),segments:inputs.map((item,index)=>({id:item.id,text:item.text,outputPath:staged[index].staging}))});
      const worker=JSON.parse(response.stdout) as TtsWorkerResult;
      if(!worker.ok||worker.segments.length!==inputs.length||worker.segments.some((item,index)=>item.id!==inputs[index].id))throw new Error("VieNeu worker returned incomplete or out-of-order segment results.");
      for(let index=0;index<staged.length;index++)await inspectWav(staged[index].staging,worker.segments[index].sampleRate,worker.segments[index].sampleCount);
      for(const item of staged)await rename(item.staging,item.target);
      return {...worker,elapsedMs:worker.elapsedMs||Date.now()-started,segments:worker.segments.map((segment,index)=>({...segment,outputPath:staged[index].target})),...(response.stderr?{stderr:response.stderr}:{})};
    }catch(error){await Promise.all(staged.map(item=>rm(item.staging,{force:true})));throw error;}
  };
  return {config,probe:()=>probeTts(root,overrides),synthesizeSegments,synthesizeSegment:async(input,outputPath)=>synthesizeSegments([{...input,outputPath}])};
}

export async function inspectWav(path:string,expectedRate?:number,expectedSamples?:number):Promise<{sampleRate:number;sampleCount:number;durationSeconds:number;audioHash:string}>{
  const data=await readFile(path),view=Buffer.from(data);
  if(view.length<44||view.toString("ascii",0,4)!=="RIFF"||view.toString("ascii",8,12)!=="WAVE")throw new Error(`Invalid or partial PCM WAV: ${path}`);
  let offset=12,format=0,channels=0,rate=0,bits=0,dataSize=-1;
  while(offset+8<=view.length){const id=view.toString("ascii",offset,offset+4),size=view.readUInt32LE(offset+4),body=offset+8;if(body+size>view.length)throw new Error(`Truncated WAV chunk ${id}.`);if(id==="fmt "){format=view.readUInt16LE(body);channels=view.readUInt16LE(body+2);rate=view.readUInt32LE(body+4);bits=view.readUInt16LE(body+14);}if(id==="data")dataSize=size;offset=body+size+(size%2);}
  if(format!==1||channels<1||channels>2||bits!==16||dataSize<=0||dataSize% (channels*2)!==0)throw new Error("TTS WAV must contain nonempty PCM 16-bit mono/stereo audio.");
  const sampleCount=dataSize/(channels*2);if(expectedRate&&rate!==expectedRate||expectedSamples&&sampleCount!==expectedSamples)throw new Error("WAV sample metadata differs from the worker result.");
  const durationSeconds=sampleCount/rate;if(!Number.isFinite(durationSeconds)||durationSeconds<=0)throw new Error("WAV has invalid duration or sample rate.");
  await stat(path);return {sampleRate:rate,sampleCount,durationSeconds,audioHash:sha256(view)};
}
