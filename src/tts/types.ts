export interface TtsConfig {
  provider:"vieneu-v3-turbo";
  sdkVersion:"3.8.3";
  modelId:"pnnbao-ump/VieNeu-TTS-v3-Turbo";
  modelRevision:string;
  codecId:"OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX";
  codecRevision:string;
  device:"cpu";
  precision:"fp32";
  voice:string;
  language:"vi"|"en"|"vi-en";
  pythonExecutable:string;
  timeoutMs:number;
}

export interface TtsSegmentInput {id:string;text:string;}
export interface TtsWorkerSegmentResult {id:string;outputPath:string;sampleRate:number;sampleCount:number;durationSeconds:number;}
export interface TtsWorkerResult {ok:boolean;segments:TtsWorkerSegmentResult[];sdkVersion:string;modelRevision:string;elapsedMs:number;peakRssBytes:number;stderr?:string;}
export interface TtsReadiness {ready:boolean;provider:string;configured:boolean;python:string;message:string;missingFiles?:string[];runtime?:{sdkVersion?:string;onnxruntimeVersion?:string;soundfileVersion?:string};config:TtsConfig;}

export interface NarrationSegment {
  id:string;
  text:string;
  textHash:string;
  audioFile:string;
  audioHash:string;
  sampleCount:number;
  sampleRate:number;
  durationSeconds:number;
  gapAfterSeconds?:number;
  silent?:false;
}

export interface SilentNarrationSegment {id:string;silent:true;durationSeconds:number;gapAfterSeconds?:number;}
export interface NarrationManifest {
  version:"1";
  scriptFile:string;
  scriptHash:string;
  synthesisConfigHash:string;
  createdAt:string;
  segments:Array<NarrationSegment|SilentNarrationSegment>;
  totalAudioSeconds:number;
  totalTimelineSeconds:number;
  synthesisMetrics:{elapsedMs:number;peakRssBytes:number};
  manifestHash:string;
}
