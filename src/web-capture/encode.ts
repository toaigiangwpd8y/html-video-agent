import {spawn} from "node:child_process";
import {stat} from "node:fs/promises";
import {resolve} from "node:path";
import {findExecutable} from "./app-session.js";
import {WebCaptureError} from "./types.js";

interface ProcessResult {code:number|null;stdout:string;stderr:string;}
function run(file:string,args:string[],timeoutMs=120000):Promise<ProcessResult>{
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(file,args,{shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"]});let stdout="",stderr="",settled=false;
    const timer=setTimeout(()=>{if(settled)return;settled=true;try{child.kill();}catch{}reject(new WebCaptureError("ENCODE_FAILED","Media tool exceeded its execution timeout."));},timeoutMs);
    child.stdout?.on("data",(chunk:Uint8Array)=>{if(stdout.length<2_000_000)stdout+=Buffer.from(chunk).toString("utf8");});
    child.stderr?.on("data",(chunk:Uint8Array)=>{if(stderr.length<500_000)stderr+=Buffer.from(chunk).toString("utf8");});
    child.once("error",()=>{if(settled)return;settled=true;clearTimeout(timer);reject(new WebCaptureError("ENCODE_FAILED","Could not start the configured media tool."));});
    child.once("close",(code:number|null)=>{if(settled)return;settled=true;clearTimeout(timer);resolvePromise({code,stdout,stderr});});
  });
}
function safeDiagnostic(stderr:string):string{
  return stderr.split(/\r?\n/).filter((line)=>/error|failed|invalid|no such|unknown|cannot|unsupported/i.test(line)).slice(-3).join(" ").replace(/[A-Za-z]:\\[^\s'\"]+/g,"[local-file]").replace(/\/(?:[^\s]+\/)+[^\s]+/g,"[local-file]").slice(0,500);
}

export interface EncodedVideo {file:string;width:number;height:number;frames:number;fps:number;durationSeconds:number;sizeBytes:number;}
export async function inspectH264Video(root:string,file:string,frames:number,fps:number,maxBytes:number):Promise<EncodedVideo>{
  const ffmpeg=findExecutable("ffmpeg",root),ffprobe=findExecutable("ffprobe",root);
  if(!ffmpeg||!ffprobe)throw new WebCaptureError("ENCODER_UNAVAILABLE","FFmpeg and ffprobe must be installed and available on PATH; no binary is downloaded.");
  const info=await stat(file);if(info.size>maxBytes)throw new WebCaptureError("ARTIFACT_LIMIT","Encoded MP4 exceeds app.maxArtifactBytes.");
  const probed=await run(ffprobe,["-v","error","-count_frames","-show_entries","stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames:format=duration","-of","json",file]);
  if(probed.code!==0)throw new WebCaptureError("INVALID_ARTIFACT","ffprobe could not inspect the encoded MP4.");
  let data:any;try{data=JSON.parse(probed.stdout);}catch{throw new WebCaptureError("INVALID_ARTIFACT","ffprobe returned invalid metadata for the encoded MP4.");}
  const streams=Array.isArray(data.streams)?data.streams:[],video=streams.find((stream:any)=>stream.codec_type==="video"),format=data.format??{};
  const [numerator,denominator]=String(video?.avg_frame_rate??"0/1").split("/").map(Number),actualFps=denominator?numerator/denominator:0,actualFrames=Number(video?.nb_read_frames),duration=Number(format.duration);
  if(streams.some((stream:any)=>stream.codec_type==="audio"))throw new WebCaptureError("INVALID_ARTIFACT","Encoded capture unexpectedly contains an audio stream.");
  if(!video||video.codec_name!=="h264"||!Number.isInteger(Number(video.width))||!Number.isInteger(Number(video.height))||Number(video.width)<2||Number(video.height)<2||actualFrames!==frames||Math.abs(actualFps-fps)>0.001||!Number.isFinite(duration)||Math.abs(duration-frames/fps)>1/fps+0.02)throw new WebCaptureError("INVALID_ARTIFACT","Encoded MP4 metadata does not match its PNG frame sequence.");
  const decoded=await run(ffmpeg,["-hide_banner","-loglevel","error","-i",file,"-c:v","rawvideo","-f","null","-"]);
  if(decoded.code!==0)throw new WebCaptureError("INVALID_ARTIFACT",`Encoded MP4 did not pass a full decode check.${safeDiagnostic(decoded.stderr)?` ${safeDiagnostic(decoded.stderr)}`:""}`);
  return {file,width:Number(video.width),height:Number(video.height),frames,fps,durationSeconds:duration,sizeBytes:info.size};
}

export async function encodePngSequence(root:string,runDirectory:string,frames:number,fps:number,maxBytes:number,fileName="capture.mp4"):Promise<EncodedVideo>{
  const ffmpeg=findExecutable("ffmpeg",root);
  if(!ffmpeg)throw new WebCaptureError("ENCODER_UNAVAILABLE","FFmpeg must be installed and available on PATH; no binary is downloaded.");
  if(!Number.isInteger(frames)||frames<1)throw new WebCaptureError("CAPTURE_FAILED","No browser frames were recorded.");
  const file=resolve(runDirectory,fileName),sequence=resolve(runDirectory,"frames","frame-%05d.png");
  const encoded=await run(ffmpeg,["-hide_banner","-loglevel","error","-n","-framerate",String(fps),"-start_number","0","-i",sequence,"-frames:v",String(frames),"-c:v","libx264","-pix_fmt","yuv420p","-an","-movflags","+faststart",file]);
  if(encoded.code!==0)throw new WebCaptureError("ENCODE_FAILED",`FFmpeg could not encode the captured PNG sequence.${safeDiagnostic(encoded.stderr)?` ${safeDiagnostic(encoded.stderr)}`:""}`);
  return inspectH264Video(root,file,frames,fps,maxBytes);
}
