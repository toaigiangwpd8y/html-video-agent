import assert from "node:assert/strict";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import test from "node:test";
import {sha256} from "../src/core/hash.js";
import type {VideoProject} from "../src/core/types.js";
import {withAssetStorageLock} from "../src/harness/asset-storage-lock.js";
import {harnessPaths} from "../src/harness/paths.js";
import {registerApprovedNarrationBindings} from "../src/harness/narration-bindings.js";

function tinyWav():Buffer{
  const samples=80,rate=8000,dataBytes=samples*2,wav=new Uint8Array(44+dataBytes),view=new DataView(wav.buffer),text=(value:string,offset:number)=>{for(let index=0;index<value.length;index++)wav[offset+index]=value.charCodeAt(index);};
  text("RIFF",0);view.setUint32(4,wav.length-8,true);text("WAVE",8);text("fmt ",12);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text("data",36);view.setUint32(40,dataBytes,true);return Buffer.from(wav);
}

test("synthetic narration registration waits for the shared asset lock and preserves Explorer entries",async()=>{
  const root=await mkdtemp(join(tmpdir(),"narration-manifest-lock-"));
  try{
    const p=harnessPaths(root),scriptPath=resolve(root,".video/candidates/script.md"),audioPath=resolve(root,".video/narration-cache/synthetic-voice.wav"),bytes=tinyWav();
    await mkdir(resolve(root,".video/candidates"),{recursive:true});await mkdir(resolve(root,".video/narration-cache"),{recursive:true});await mkdir(resolve(root,"assets"),{recursive:true});
    const script="Synthetic fixture only; this is not an approval or live user narration.";await writeFile(scriptPath,script,"utf8");await writeFile(audioPath,bytes);
    await writeFile(p.assetManifest,JSON.stringify({version:"1",assets:[]}));
    const segment={id:"fixture-voice",text:"Synthetic narration segment",textHash:sha256("Synthetic narration segment"),audioFile:".video/narration-cache/synthetic-voice.wav",audioHash:sha256(bytes),sampleCount:80,sampleRate:8000,durationSeconds:.01};
    const core={version:"1" as const,scriptFile:".video/candidates/script.md",scriptHash:sha256(script),synthesisConfigHash:"synthetic-fixture",createdAt:new Date(0).toISOString(),segments:[segment],totalAudioSeconds:.01,totalTimelineSeconds:.01,synthesisMetrics:{elapsedMs:0,peakRssBytes:0}};
    const manifest={...core,manifestHash:sha256(JSON.stringify(core))};await writeFile(p.narrationManifest,JSON.stringify(manifest));
    const project:VideoProject={meta:{title:"Synthetic narration lock fixture",width:1080,height:1920,durationsInFrames:30,fps:30,theme:{palette:["#000000","#ffffff"],font:"fixture"},constraints:{style:"synthetic fixture",disallowed:[],motionTone:"none"}},scenes:[{id:"scene-1",durationInFrames:30,screenText:"Fixture",visualConcept:"Test asset lock",audio:{voiceoverText:segment.text,voiceSegmentId:segment.id}}]};
    let release!:()=>void,entered!:()=>void;const held=new Promise<void>(resolveHeld=>{release=resolveHeld;}),ready=new Promise<void>(resolveReady=>{entered=resolveReady;});
    const manifestPath=p.assetManifest;
    const explorerWrite=withAssetStorageLock(root,async()=>{entered();await held;await writeFile(manifestPath,JSON.stringify({version:"1",assets:[{id:"explorer-evidence",publicPath:"/assets/app-explorer/promotion/evidence.png"}]}));});
    await ready;
    let settled=false;const narrationWrite=registerApprovedNarrationBindings(root,project).finally(()=>{settled=true;});
    await new Promise(resolveDelay=>setTimeout(resolveDelay,150));assert.equal(settled,false,"narration registration must wait for the shared manifest transaction lock");
    release();await explorerWrite;await narrationWrite;
    const final=JSON.parse(await readFile(manifestPath,"utf8"));assert.deepEqual(final.assets.map((item:{id:string})=>item.id).sort(),["explorer-evidence","narration-fixture-voice"]);
  }finally{await rm(root,{recursive:true,force:true});}
});
