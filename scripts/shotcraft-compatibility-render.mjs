import {createHash} from "node:crypto";
import {readFile, stat, writeFile, mkdir} from "node:fs/promises";
import {createRequire} from "node:module";
import {dirname, join, relative, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {chromium} from "playwright-core";
import {classifyRenderedPair} from "./shotcraft-compatibility.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const cliPath = root => resolve(root,"remotion/node_modules/@remotion/cli/remotion-cli.js");
const GENERIC_FONTS = new Set(["serif","sans-serif","monospace","cursive","fantasy","system-ui","ui-serif","ui-sans-serif","ui-monospace","ui-rounded","emoji","math","fangsong"]);

export function fontProbeStyle(family) {
  return GENERIC_FONTS.has(family) ? `font:600 64px ${family}` : `font:600 64px &quot;${family}&quot;,sans-serif`;
}

function runCli(root,args) {
  const result=spawnSync(process.execPath,[cliPath(root),...args],{cwd:resolve(root,"remotion"),encoding:"utf8",windowsHide:true,maxBuffer:8_000_000});
  return {status:result.status,stdout:result.stdout??"",stderr:result.stderr??""};
}

async function readSequence(root,outputRoot,sample,side){
  const directory=join(outputRoot,`${sample.sampleId}-${side}-frames`),stillHashes={},files=[];
  for(const frame of sample.frames){
    const name=`element-${String(frame).padStart(sample.duration>100?3:2,"0")}.png`;
    const bytes=await readFile(join(directory,name));
    stillHashes[String(frame)]=sha(bytes);files.push({frame,file:`${sample.sampleId}-${side}-frames/${name}`,sha256:stillHashes[String(frame)]});
  }
  const clipName=`${sample.sampleId}-${side}-clip.mp4`;
  const clipHash=sha(await readFile(join(outputRoot,clipName)));
  return {stillHashes,files,clipName,clipHash};
}

export async function captureBrowserAndFonts(root) {
  const browserInfoCommand=spawnSync(process.execPath,["-e","const b=require('./node_modules/@remotion/renderer/dist/browser/BrowserFetcher.js');console.log(JSON.stringify(b.getRevisionInfo('headless-shell')));"],{cwd:resolve(root,"remotion"),encoding:"utf8",windowsHide:true});
  if(browserInfoCommand.status!==0)throw new Error(`Could not query the pinned Remotion browser: ${browserInfoCommand.stderr}`);
  const browserInfo=JSON.parse(browserInfoCommand.stdout.trim());
  if(!browserInfo.local)throw new Error(`Pinned Remotion browser is not installed: ${browserInfo.executablePath}`);
  const versionResult=spawnSync(browserInfo.executablePath,["--version"],{encoding:"utf8",windowsHide:true});
  if(versionResult.status!==0)throw new Error(`Could not read Remotion browser version: ${versionResult.stderr}`);
  const browserVersion=(versionResult.stdout||versionResult.stderr).trim();
  const version=JSON.parse(await readFile(resolve(root,"remotion/package.json"),"utf8")).dependencies.remotion;
  const browser=await chromium.launch({executablePath:browserInfo.executablePath,headless:true,args:["--no-sandbox"]});
  try{
    const page=await browser.newPage();
    const stacks=["Arial","Helvetica Neue","Inter","Georgia","Times New Roman","Courier New","monospace","sans-serif"];
    await page.setContent(`<html><body>${stacks.map((family,index)=>`<div id="font-${index}" style="${fontProbeStyle(family)}">Shotcraft compatibility text 0123456789</div>`).join("")}</body></html>`);
    await page.evaluate(()=>document.fonts.ready);
    const cdp=await page.context().newCDPSession(page);await cdp.send("DOM.enable");await cdp.send("CSS.enable");
    const {root:domRoot}=await cdp.send("DOM.getDocument"),fontResolution=[];
    for(let index=0;index<stacks.length;index++){
      const {nodeId}=await cdp.send("DOM.querySelector",{nodeId:domRoot.nodeId,selector:`#font-${index}`});
      const result=await cdp.send("CSS.getPlatformFontsForNode",{nodeId});
      fontResolution.push({requestedFamily:stacks[index],resolvedFonts:result.fonts.map(font=>({familyName:font.familyName,isCustomFont:font.isCustomFont,glyphCount:font.glyphCount}))});
    }
    const monospace=fontResolution.find(row=>row.requestedFamily==="monospace");
    if(!monospace?.resolvedFonts.length||monospace.resolvedFonts.some(font=>font.familyName==="Arial"))throw new Error(`Generic monospace probe did not resolve a physical monospace font: ${JSON.stringify(monospace)}`);
    const fontEnvironment={userAgent:await page.evaluate(()=>navigator.userAgent),platform:await page.evaluate(()=>navigator.platform),observation:"Resolved physical font families and glyph counts from Chrome DevTools CSS.getPlatformFontsForNode for fixture text; original and adapted sides use this same installed browser and host font environment.",fontResolution};
    await cdp.detach();
    await page.close();
    return {runtimeVersion:version,browser:{mode:"headless-shell",version:browserVersion,executable:browserInfo.executablePath},fontEnvironment};
  }finally{await browser.close();}
}

export async function renderRepresentativePairs({root,outputRoot,generatedRoot,samples}) {
  await mkdir(outputRoot,{recursive:true});
  const provenance=await captureBrowserAndFonts(root),records=[],pairs=[];
  const outputFromRemotion=relative(resolve(root,"remotion"),outputRoot).replaceAll("\\","/");
  for(const sample of samples){
    const sideResults=[];
    for(const side of ["original","adapted"]){
      const id=`${sample.sampleId}-${side}`;
      const stillPath=`${outputFromRemotion}/${sample.sampleId}-${side}-frames`;
      const browserArg=`--browser-executable=${provenance.browser.executable}`;
      const still=runCli(root,["render","generated/compatibility/index.ts",id,stillPath,`--frames=${sample.frames.join(",")}`,"--image-format=png","--public-dir=generated/compatibility/public",browserArg,"--log=error"]);
      if(still.status!==0)throw new Error(`Still render failed for ${id}: ${still.stderr}${still.stdout}`);
      const clipName=`${sample.sampleId}-${side}-clip.mp4`;
      const clip=runCli(root,["render","generated/compatibility/index.ts",id,`${outputFromRemotion}/${clipName}`,"--frames=0-15","--public-dir=generated/compatibility/public",browserArg,"--log=error"]);
      if(clip.status!==0)throw new Error(`Clip render failed for ${id}: ${clip.stderr}${clip.stdout}`);
      const rendered=await readSequence(root,outputRoot,sample,side);
      const record={sampleId:sample.sampleId,cardId:sample.cardId,variantId:sample.variantId,category:sample.category,helper:sample.helper??null,side,assets:sample.assets??[],renderStatus:"rendered",runtimeVersion:provenance.runtimeVersion,browserVersion:provenance.browser.version,fontEnvironment:provenance.fontEnvironment,evidence:[...rendered.files.map(file=>file.file),rendered.clipName]};
      records.push({...record,frames:rendered.files,clip:rendered.clipName,clipSha256:rendered.clipHash});
      sideResults.push({...record,stillHashes:rendered.stillHashes,clipHash:rendered.clipHash});
    }
    const comparison=classifyRenderedPair({original:sideResults[0],adapted:sideResults[1]});
    pairs.push({...sample,...comparison,frames:sample.frames.map(frame=>({frame,originalSha256:sideResults[0].stillHashes[String(frame)],adaptedSha256:sideResults[1].stillHashes[String(frame)],identical:sideResults[0].stillHashes[String(frame)]===sideResults[1].stillHashes[String(frame)]})),clips:{original:sideResults[0].clipName,adapted:sideResults[1].clipName,originalSha256:sideResults[0].clipHash,adaptedSha256:sideResults[1].clipHash,identical:sideResults[0].clipHash===sideResults[1].clipHash}});
  }
  const failed=pairs.filter(pair=>pair.status!=="smoke_passed");
  const evidence={provenance,settings:{width:1920,height:1080,fps:30,clipFrames:[0,15],inputs:"Default component inputs; no custom props."},records,pairs,helperCoverage:Object.fromEntries(["Fixtures.tsx","Motion.tsx","PageCam2D.tsx"].map(helper=>{const pair=pairs.find(item=>item.helper===helper);return [helper,pair?{status:pair.status,reason:pair.reason,evidence:pair.evidence,runtimeVersion:pair.runtimeVersion,sampleId:pair.sampleId}:{status:"blocked",reason:"No render fixture selected for this shared helper.",evidence:[],runtimeVersion:provenance.runtimeVersion}];}))};
  await writeFile(join(outputRoot,"render-evidence.json"),JSON.stringify(evidence,null,2));
  if(failed.length)throw new Error(`Source-fidelity render hash mismatch/blocked: ${failed.map(pair=>`${pair.sampleId}: ${pair.reason}`).join("; ")}`);
  return evidence;
}
