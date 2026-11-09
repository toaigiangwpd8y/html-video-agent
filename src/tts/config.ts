import {isAbsolute,resolve} from "node:path";
import type {TtsConfig} from "./types.js";

// Immutable snapshots of the upstream OSS Turbo and its MOSS codec as verified for GRA-17.
export const DEFAULT_TTS_CONFIG:TtsConfig={
  provider:"vieneu-v3-turbo",sdkVersion:"3.8.3",modelId:"pnnbao-ump/VieNeu-TTS-v3-Turbo",
  modelRevision:"61b85e3d937fbbacb387714180e8182823512523",
  codecId:"OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX",codecRevision:"ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae",
  device:"cpu",precision:"fp32",voice:"Minh Đức",language:"vi-en",pythonExecutable:"python",timeoutMs:900_000
};

export function ttsConfig(root:string,overrides:Partial<TtsConfig>={}):TtsConfig {
  const config={...DEFAULT_TTS_CONFIG,...overrides};
  config.pythonExecutable=process.env.VIDEO_TTS_PYTHON?.trim()||config.pythonExecutable;
  if(!config.pythonExecutable.startsWith("wsl:"))config.pythonExecutable=isAbsolute(config.pythonExecutable)?config.pythonExecutable:config.pythonExecutable.includes("/")||config.pythonExecutable.includes("\\")?resolve(root,config.pythonExecutable):config.pythonExecutable;
  if(!Number.isFinite(config.timeoutMs)||config.timeoutMs<1000)throw new Error("TTS timeoutMs must be at least 1000.");
  if(!config.voice.trim())throw new Error("TTS voice must be nonempty.");
  if(!["vi","en","vi-en"].includes(config.language))throw new Error("VieNeu v3 Turbo only supports Vietnamese, English, or explicitly mixed Vietnamese/English narration.");
  if(!/^[0-9a-f]{40}$/i.test(config.modelRevision)||!/^[0-9a-f]{40}$/i.test(config.codecRevision))throw new Error("VieNeu model and codec revisions must be immutable 40-character commit hashes.");
  return config;
}

export function publicTtsConfig(config:TtsConfig):Omit<TtsConfig,"pythonExecutable">&{pythonExecutable:"<configured>"}{
  const {pythonExecutable:_,...safe}=config;return {...safe,pythonExecutable:"<configured>"};
}
