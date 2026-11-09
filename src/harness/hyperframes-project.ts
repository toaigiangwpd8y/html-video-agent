import {copyFile,mkdir,readFile,readdir,realpath,rename,rm,stat,writeFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {dirname,extname,relative,resolve,sep} from "node:path";
import type {VideoProject} from "../core/types.js";
import {sha256} from "../core/hash.js";
import type {AssetManifest,AssetManifestItem} from "./assets.js";
import {harnessPaths} from "./paths.js";
import {videoProjectHash} from "./project-state.js";
import {frameToSeconds,resolveHyperFramesTimeline,type HyperFramesTimeline} from "./hyperframes-timeline.js";

export interface HyperFramesProjectAsset {id:string;file:string;publicPath:string;sha256:string;type:string;role:string;sceneIds:string[];license?:string;rights?:string;permittedUse:string;source?:string;sourceUrl?:string;provenance?:string;derivedFrom?:string;width?:number;height?:number;hasAlpha?:boolean;notes?:string;}
export interface HyperFramesAudioClip {assetId:string;file:string;role:string;narrationSegmentId?:string;playbackRate:1;startFrame:number;durationInFrames:number;sourceStartSeconds:number;gain:number;fadeInInFrames:number;fadeOutInFrames:number;}
export interface HyperFramesSceneBinding {sceneId:string;compositionId:string;sourceFile:string;textId:string;screenText:string;voiceoverText?:string;startFrame:number;durationInFrames:number;startSeconds:number;durationSeconds:number;assetIds:string[];}
export interface HyperFramesProjectManifest {version:"1";renderer:"hyperframes";rendererVersion:"0.8.50";projectId:string;revision:number;projectHash:string;productionProfileHash:string;assetManifestHash:string;width:number;height:number;fps:number;durationInFrames:number;durationSeconds:number;scenes:HyperFramesSceneBinding[];assets:HyperFramesProjectAsset[];audioClips:HyperFramesAudioClip[];generatedFiles:string[];}
export interface PreparedHyperFramesProject {projectDir:string;relativeProjectDir:string;manifest:HyperFramesProjectManifest;timeline:HyperFramesTimeline;}

const NATIVE_AUDIO_GROUP_ID="agent-video-audio-master";
const OUTPUT_LIMITER={type:"limiter",id:"agent-video-output-limiter",params:{limit:-0.2,attack:5,release:50,level_out:0}};

/** Serializes frame-addressed fades using HyperFrames native audio automation. */
export function hyperFramesAudioAutomation(audio:HyperFramesAudioClip,fps:number):string|undefined{
  if(audio.fadeInInFrames===0&&audio.fadeOutInFrames===0)return undefined;
  const duration=frameToSeconds(audio.durationInFrames,fps),fadeIn=frameToSeconds(audio.fadeInInFrames,fps),fadeOut=frameToSeconds(audio.fadeOutInFrames,fps),points:Array<{t:number;v:number}>=[];
  points.push({t:0,v:fadeIn>0?0:1});
  if(fadeIn>0)points.push({t:fadeIn,v:1});
  const fadeOutStart=duration-fadeOut;
  if(fadeOut>0){if(fadeOutStart>fadeIn)points.push({t:fadeOutStart,v:1});points.push({t:duration,v:0});}
  else if(duration>fadeIn)points.push({t:duration,v:1});
  return JSON.stringify({version:1,lanes:[{target:"volume",points}]});
}

/** Updates the existing composition with canonical fades and a native output limiter. */
export async function ensureHyperFramesNativeAudio(projectDir:string,manifest:HyperFramesProjectManifest,applyChanges=true):Promise<boolean>{
  if(manifest.audioClips.some(clip=>clip.playbackRate!==1))throw new Error("Narration renderer contract requires playbackRate 1.0 for every approved audio clip.");
  for(const extension of [".html",".css",".js",".mjs"]){for(const file of await listProjectFiles(projectDir,extension)){const source=await readFile(file,"utf8");if(/\b(?:playbackRate|setPlaybackRate|atempo|timeStretch|time-stretch|pitchShift|preservesPitch)\b/i.test(source))throw new Error(`${relative(projectDir,file)} contains an audio playback-rate or time/pitch transformation control; approved narration must play at natural rate.`);}}
  const indexPath=resolve(projectDir,"index.html");let source=await readFile(indexPath,"utf8"),changed=false;
  const matches=[...source.matchAll(/<audio\b[^>]*>/gi)];
  if(matches.length!==manifest.audioClips.length)throw new Error(`HyperFrames root contains ${matches.length} audio elements; the approved manifest contains ${manifest.audioClips.length}.`);
  const clips=new Map(manifest.audioClips.map((clip)=>[`audio-${clip.assetId}`,clip]));
  for(const match of matches){
    const tag=match[0],attributes=tagAttributes(tag),clip=attributes.id?clips.get(attributes.id):undefined;
    if(!clip)throw new Error(`HyperFrames audio element '${attributes.id??"(missing id)"}' is not bound to an approved audio asset.`);
    const expected={src:`./${clip.file}`,start:frameToSeconds(clip.startFrame,manifest.fps),duration:frameToSeconds(clip.durationInFrames,manifest.fps),mediaStart:clip.sourceStartSeconds,gain:clip.gain};
    for(const [attribute,value] of [["src",expected.src],["data-start",String(expected.start)],["data-duration",String(expected.duration)],["data-media-start",String(expected.mediaStart)],["data-volume",String(expected.gain)]] as const){
      const actual=attributes[attribute];
      if(attribute==="src"?actual!==value:!Number.isFinite(Number(actual))||Math.abs(Number(actual)-Number(value))>1e-6)throw new Error(`HyperFrames audio element '${attributes.id}' has ${attribute}='${actual??"(missing)"}', expected '${value}'.`);
    }
    const generated=hyperFramesAudioAutomation(clip,manifest.fps),existing=attributes["data-automation"];
    let fxLanes:unknown[]=[];
    if(existing){try{const parsed=JSON.parse(existing) as {version?:unknown;lanes?:unknown};if(parsed.version!==1||!Array.isArray(parsed.lanes))throw new Error("unsupported schema");fxLanes=parsed.lanes.filter((lane)=>Boolean(lane)&&typeof lane==="object"&&(lane as {target?:unknown}).target!=="volume");}catch{throw new Error(`HyperFrames audio element '${attributes.id}' has invalid data-automation JSON.`);}}
    const automation=generated?JSON.stringify({version:1,lanes:[...fxLanes,...(JSON.parse(generated) as {lanes:unknown[]}).lanes]}):fxLanes.length?JSON.stringify({version:1,lanes:fxLanes}):undefined;
    let replacement=tag;
    if((automation??"")!==(existing??""))replacement=replaceHtmlAttribute(replacement,"data-automation",automation);
    if(attributes["data-audio-group"]!==NATIVE_AUDIO_GROUP_ID)replacement=replaceHtmlAttribute(replacement,"data-audio-group",NATIVE_AUDIO_GROUP_ID);
    if(replacement!==tag){source=source.replace(tag,replacement);changed=true;}
    clips.delete(attributes.id!);
  }
  if(clips.size)throw new Error(`HyperFrames root is missing approved audio elements: ${[...clips.keys()].join(", ")}.`);
  if(manifest.audioClips.length){
    const groupTags=[...source.matchAll(/<hf-audio-group\b[^>]*>/gi)],matching=groupTags.filter((match)=>tagAttributes(match[0]).id===NATIVE_AUDIO_GROUP_ID);
    if(matching.length>1)throw new Error(`HyperFrames root has duplicate '${NATIVE_AUDIO_GROUP_ID}' audio groups.`);
    const groupTag=matching[0]?.[0];let existingChain:string|undefined;
    if(groupTag){existingChain=tagAttributes(groupTag)["data-fx-chain"];if(existingChain){try{const parsed=JSON.parse(existingChain) as {version?:unknown;nodes?:unknown};if(parsed.version!==1||!Array.isArray(parsed.nodes))throw new Error("unsupported schema");}catch{throw new Error(`HyperFrames audio group '${NATIVE_AUDIO_GROUP_ID}' has invalid data-fx-chain JSON.`);}}}
    let nodes:unknown[]=[];if(existingChain){const parsed=JSON.parse(existingChain) as {nodes:Array<{id?:unknown}>};nodes=parsed.nodes.filter((node)=>!node||typeof node!=="object"||(node as {id?:unknown}).id!==OUTPUT_LIMITER.id);}
    const chain=JSON.stringify({version:1,nodes:[...nodes,OUTPUT_LIMITER]});
    if(groupTag){if(existingChain!==chain){source=source.replace(groupTag,replaceHtmlAttribute(groupTag,"data-fx-chain",chain));changed=true;}}
    else{const bodyEnd=source.toLowerCase().lastIndexOf("</body>");if(bodyEnd<0)throw new Error("HyperFrames root has no closing body tag for its native audio group.");source=`${source.slice(0,bodyEnd)}    <hf-audio-group id="${NATIVE_AUDIO_GROUP_ID}" data-fx-chain="${html(chain)}"></hf-audio-group>\n${source.slice(bodyEnd)}`;changed=true;}
  }
  if(changed&&!applyChanges)throw new Error("Native HyperFrames audio automation is missing or stale; run `video renderer check` and reopen visual review before rendering.");
  if(changed){const temporary=`${indexPath}.${randomUUID()}.tmp`;try{await writeFile(temporary,source,"utf8");await rename(temporary,indexPath);}catch(error){await rm(temporary,{force:true});throw error;}}
  return changed;
}

/** Replaces or appends one escaped attribute on an HTML opening tag. */
function replaceHtmlAttribute(tag:string,name:string,value:string|undefined):string{
  const escapedName=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),pattern=new RegExp(`\\s${escapedName}=(?:"[^"]*"|'[^']*'|[^\\s>]+)`,"i"),without=tag.replace(pattern,"");
  return value===undefined?without:without.replace(/>$/,` ${name}="${html(value)}">`);
}

// Match the `content` property without misclassifying `justify-content`.
const hasUnapprovedCssContent=(source:string):boolean=>/(?:^|[;{])\s*content\s*:(?!(?:\s*(?:["']\s*["']|none\b|normal\b)\s*[;}]))[^;}]+/im.test(source);

function slug(value:string):string{return value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"video";}
function html(value:string):string{return value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");}
function htmlComment(value:string):string{let safe=value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g," ");while(safe.includes("--"))safe=safe.replaceAll("--","- -");return safe.replace(/-$/,"- ");}
function cssToken(value:string|undefined,fallback:string):string{if(!value)return fallback;const token=value.trim();if(/[;{}<>\u0000-\u001f]/.test(token))return fallback;if(/^#[\da-f]{3,8}$/i.test(token))return token;if(/^(?:rgb|rgba|hsl|hsla|oklch)\([\d.%\s,+/-]+\)$/i.test(token))return token;if(/^[a-z][a-z\d-]*$/i.test(token))return token;return fallback;}
function cssFont(value:string|undefined):string{const fallback="Inter, ui-sans-serif, system-ui, sans-serif";if(!value||/[;{}<>\u0000-\u001f]/.test(value))return fallback;const generic=new Set(["serif","sans-serif","monospace","system-ui","ui-serif","ui-sans-serif","ui-monospace","ui-rounded","math","emoji","fangsong"]);return value.split(",").map((part)=>part.trim()).filter((part)=>/^[\w -]+$/.test(part)).map((part)=>generic.has(part.toLowerCase())?part:`"${part}"`).join(", ")||fallback;}
function themeCss(project:VideoProject):string{const [ink="#101216",paper="#f4f2ed",accent="#75e0c1"]=project.meta.theme.palette,font=cssFont(project.meta.theme.font);return `:root {\n  --hf-color-ink: ${cssToken(ink,"#101216")};\n  --hf-color-paper: ${cssToken(paper,"#f4f2ed")};\n  --hf-color-accent: ${cssToken(accent,"#75e0c1")};\n  --hf-font-display: ${font};\n  --hf-font-body: ${font};\n}\n`;}

function safeAssetSource(root:string,publicPath:string):string{if(!publicPath.startsWith("/assets/")||publicPath.includes("\\")||publicPath.includes("\0"))throw new Error(`Asset path '${publicPath}' is not a safe local /assets path.`);const rest=publicPath.slice("/assets/".length),segments=rest.split("/");if(!rest||segments.some((segment)=>!segment||segment==="."||segment===".."))throw new Error(`Asset path '${publicPath}' contains an unsafe segment.`);return resolve(root,"assets",...segments);}
async function checkedAssetSource(root:string,publicPath:string):Promise<string>{const candidate=safeAssetSource(root,publicPath),actual=await realpath(candidate),assetRoot=await realpath(resolve(root,"assets")),fromAssets=relative(assetRoot,actual);if(fromAssets===".."||fromAssets.startsWith(`..${sep}`)||fromAssets.startsWith(sep))throw new Error(`Asset '${publicPath}' resolves outside the local assets directory.`);if(!(await stat(actual)).isFile())throw new Error(`Asset '${publicPath}' is not a regular file.`);return actual;}
function assetFilename(asset:AssetManifestItem):string{return `asset-${slug(asset.id)}-${sha256(asset.id).slice(0,8)}${extname(asset.publicPath).toLowerCase()}`;}
function projectAsset(asset:AssetManifestItem,file:string,digest:string):HyperFramesProjectAsset{if(!asset.permittedUse?.trim())throw new Error(`Asset '${asset.id}' has no permittedUse record.`);if(!asset.license?.trim()&&!asset.rights?.trim())throw new Error(`Asset '${asset.id}' has no license or rights record.`);return {id:asset.id,file,publicPath:asset.publicPath,sha256:digest,type:asset.type,role:asset.role??"unspecified",sceneIds:asset.sceneIds??[],...(asset.license?{license:asset.license}:{}),...(asset.rights?{rights:asset.rights}:{}),permittedUse:asset.permittedUse,...(asset.source?{source:asset.source}:{}),...(asset.sourceUrl?{sourceUrl:asset.sourceUrl}:{}),...(asset.provenance?{provenance:asset.provenance}:{}),...(asset.derivedFrom?{derivedFrom:asset.derivedFrom}:{}),...(asset.width!==undefined?{width:asset.width}:{}),...(asset.height!==undefined?{height:asset.height}:{}),...(asset.hasAlpha!==undefined?{hasAlpha:asset.hasAlpha}:{}),...(asset.notes?{notes:asset.notes}:{})};}

/** Fingerprints the approved asset manifest together with each source file's bytes. */
export async function snapshotApprovedAssets(root:string,manifest:AssetManifest):Promise<{hash:string;assets:Map<string,{bytes:Uint8Array;sha256:string}>}>{
  if(!Array.isArray(manifest.assets))throw new Error("assets/manifest.json must contain an assets array.");
  const assets=new Map<string,{bytes:Uint8Array;sha256:string}>(),fingerprint:Array<{id:string;publicPath:string;sha256:string}>=[];
  for(const asset of manifest.assets){
    if(assets.has(asset.id))throw new Error(`Duplicate asset id '${asset.id}' in assets/manifest.json.`);
    const source=await checkedAssetSource(root,asset.publicPath),bytes=await readFile(source),digest=createHash("sha256").update(bytes).digest("hex");
    assets.set(asset.id,{bytes,sha256:digest});fingerprint.push({id:asset.id,publicPath:asset.publicPath,sha256:digest});
  }
  return {hash:sha256(JSON.stringify({manifest,fingerprint})),assets};
}

/** Resolves approved audio assets into canonical frame-addressed clips. */
export function resolveHyperFramesAudioClips(project:VideoProject,manifest:AssetManifest,timeline:HyperFramesTimeline,assets:HyperFramesProjectAsset[]):HyperFramesAudioClip[]{
  const starts=new Map(timeline.scenes.map((scene)=>[scene.sceneId,scene.startFrame])),scenes=new Map(project.scenes.map((scene)=>[scene.id,scene])),byId=new Map(assets.map((asset)=>[asset.id,asset]));
  return manifest.assets.filter((asset)=>asset.type.toLowerCase().startsWith("audio/")).map((source)=>{
    const asset=byId.get(source.id);if(!asset)throw new Error(`Audio asset '${source.id}' was not materialized into the renderer project.`);
    const timing=source.audioTiming??{};let startFrame=timing.startFrame;
    let narrationSegmentId:string|undefined;
    if(source.role==="voiceover"){
      if((source.sceneIds??[]).length!==1)throw new Error(`Voiceover asset '${source.id}' must bind to exactly one scene.`);
      const sceneId=source.sceneIds![0],scene=scenes.get(sceneId);if(!scene?.audio?.voiceoverText.trim())throw new Error(`Voiceover asset '${source.id}' has no matching canonical narration in scene '${sceneId}'.`);if(!scene.audio.voiceSegmentId||source.id!==`narration-${scene.audio.voiceSegmentId}`)throw new Error(`Voiceover asset '${source.id}' is not bound to the canonical Script-stage segment ID.`);narrationSegmentId=scene.audio.voiceSegmentId;startFrame??=starts.get(sceneId);
      if(timing.durationInFrames===undefined)throw new Error(`Voiceover asset '${source.id}' requires audioTiming.durationInFrames from the measured approved narration asset.`);
    }else if(startFrame===undefined||timing.durationInFrames===undefined)throw new Error(`Audio asset '${source.id}' requires audioTiming.startFrame and audioTiming.durationInFrames.`);
    const durationInFrames=timing.durationInFrames??(timeline.durationInFrames-(startFrame??0));
    if(!Number.isInteger(startFrame)||startFrame!<0)throw new Error(`Audio asset '${source.id}' startFrame must be a non-negative integer.`);
    if(!Number.isInteger(durationInFrames)||durationInFrames<1)throw new Error(`Audio asset '${source.id}' durationInFrames must be a positive integer.`);
    if((startFrame??0)+durationInFrames>timeline.durationInFrames)throw new Error(`Audio asset '${source.id}' extends past the composition duration.`);
    const sourceStartSeconds=timing.mediaStartSeconds??0,gain=timing.gain??1,fadeInInFrames=timing.fadeInInFrames??0,fadeOutInFrames=timing.fadeOutInFrames??0;
    if(!Number.isFinite(sourceStartSeconds)||sourceStartSeconds<0)throw new Error(`Audio asset '${source.id}' mediaStartSeconds is invalid.`);
    if(!Number.isFinite(gain)||gain<0||gain>3.98)throw new Error(`Audio asset '${source.id}' gain must be between 0 and 3.98.`);
    if(!Number.isInteger(fadeInInFrames)||fadeInInFrames<0||fadeInInFrames>durationInFrames)throw new Error(`Audio asset '${source.id}' fadeInInFrames is invalid.`);
    if(!Number.isInteger(fadeOutInFrames)||fadeOutInFrames<0||fadeOutInFrames>durationInFrames)throw new Error(`Audio asset '${source.id}' fadeOutInFrames is invalid.`);
    return {assetId:source.id,file:asset.file,role:asset.role,...(narrationSegmentId?{narrationSegmentId}:{}),playbackRate:1,startFrame:startFrame!,durationInFrames,sourceStartSeconds,gain,fadeInInFrames,fadeOutInFrames};
  });
}

/** Renders canonical scene copy and its approved narration caption. */
function sceneDocument(project:VideoProject,scene:VideoProject["scenes"][number],timing:HyperFramesTimeline["scenes"][number],compositionId:string,textId:string,assetIds:string[]):string{
  const mediaNote=assetIds.length?`Approved local assets for this scene: ${assetIds.join(", ")}.`:"No approved local assets are bound to this scene.",visualNote=scene.visualConcept,caption=scene.audio?.voiceoverText?`<p class="hf-voice-caption" data-canonical-caption-id="${html(scene.id)}">${html(scene.audio.voiceoverText)}</p>`:"";
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `  <head>`,
    `    <meta charset="utf-8">`,
    `    <meta name="viewport" content="width=${project.meta.width}, height=${project.meta.height}">`,
    `    <title>${html(scene.id)}</title>`,
    `    <link rel="stylesheet" href="../kit/tokens.css">`,
    `    <link rel="stylesheet" href="../kit/theme.css">`,
    `    <link rel="stylesheet" href="../kit/primitives.css">`,
    `  </head>`,
    `  <body>`,
    `    <!-- ${htmlComment(`${mediaNote} Visual direction: ${visualNote}`)} -->`,
    `    <main id="${compositionId}" class="hf-scene" data-composition-id="${compositionId}" data-width="${project.meta.width}" data-height="${project.meta.height}" data-start="0" data-duration="${timing.durationSeconds}">`,
    `      <p id="${textId}" class="hf-title hf-enter-fade-up" data-canonical-text-id="${textId}">${html(scene.screenText)}</p>`,
    ...(caption ? [`      ${caption}`] : []),
    `    </main>`,
    `  </body>`,
    `</html>`,
    "",
  ].join("\n");
}

function rootDocument(project:VideoProject,timeline:HyperFramesTimeline,scenes:HyperFramesSceneBinding[],audioClips:HyperFramesAudioClip[]):string{
  const sceneElements=scenes.map((scene,index)=>`    <div id="${scene.sceneId}-mount" class="clip" data-composition-id="${scene.compositionId}" data-composition-src="./${scene.sourceFile}" data-start="${scene.startSeconds}" data-duration="${scene.durationSeconds}" data-track-index="${index}"></div>`);
  const audioElements=audioClips.map((audio,index)=>{const automation=hyperFramesAudioAutomation(audio,timeline.fps);return `    <audio id="audio-${audio.assetId}" class="clip" src="./${audio.file}" data-start="${frameToSeconds(audio.startFrame,timeline.fps)}" data-duration="${frameToSeconds(audio.durationInFrames,timeline.fps)}" data-media-start="${audio.sourceStartSeconds}" data-volume="${audio.gain}" data-audio-group="${NATIVE_AUDIO_GROUP_ID}"${automation?` data-automation="${html(automation)}"`:""} data-track-index="${scenes.length+index}"></audio>`;});
  const audioGroup=audioClips.length?`    <hf-audio-group id="${NATIVE_AUDIO_GROUP_ID}" data-fx-chain="${html(JSON.stringify({version:1,nodes:[OUTPUT_LIMITER]}))}"></hf-audio-group>`:"";
  return [`<!doctype html>`,`<html lang="en">`,`  <head>`,`    <meta charset="utf-8">`,`    <meta name="viewport" content="width=${project.meta.width}, height=${project.meta.height}">`,`    <title>${html(project.meta.title)}</title>`,`    <link rel="stylesheet" href="./kit/tokens.css">`,`    <link rel="stylesheet" href="./kit/theme.css">`,`    <style>html,body{width:${project.meta.width}px;height:${project.meta.height}px;margin:0;overflow:hidden;background:var(--hf-color-ink)}</style>`,`  </head>`,`  <body>`,`    <div id="main" data-composition-id="main" data-width="${project.meta.width}" data-height="${project.meta.height}" data-start="0" data-duration="${timeline.durationSeconds}">`,...sceneElements,...audioElements,`    </div>`,audioGroup,`  </body>`,`</html>` ,""].join("\n");
}

/** Creates a new versioned HyperFrames project from approved canonical data. */
export async function createHyperFramesProject(input:{root:string;project:VideoProject;projectId:string;revision:number;productionProfileHash:string;assetManifestHash:string;assetManifest:AssetManifest;copyForwardFrom?:string}):Promise<PreparedHyperFramesProject>{
  const {root,project,projectId,revision,productionProfileHash:profileHash,assetManifestHash,assetManifest,copyForwardFrom}=input,p=harnessPaths(root),timeline=resolveHyperFramesTimeline(project),assetSnapshot=await snapshotApprovedAssets(root,assetManifest);
  if(assetSnapshot.hash!==assetManifestHash)throw new Error("Approved assets changed while the HyperFrames project was being prepared.");
  const projectName=`${slug(projectId)}-r${revision}-${videoProjectHash(project).slice(7,15)}-${profileHash.slice(7,15)}-${assetManifestHash.slice(7,15)}`,projectDir=resolve(p.hyperframesProjects,projectName),stagingDir=`${projectDir}.building-${randomUUID()}`;await mkdir(p.hyperframesProjects,{recursive:true});
  try{await stat(projectDir);throw new Error(`Renderer version '${projectName}' already exists; refusing to overwrite it.`);}catch(error){if((error as {code?:string}).code!=="ENOENT")throw error;}
  await mkdir(resolve(stagingDir,"compositions"),{recursive:true});await mkdir(resolve(stagingDir,"assets"),{recursive:true});await mkdir(resolve(stagingDir,"kit"),{recursive:true});
  try{
  const materialized:HyperFramesProjectAsset[]=[];
  for(const asset of assetManifest.assets){const file=`assets/${assetFilename(asset)}`,snapshot=assetSnapshot.assets.get(asset.id)!;await writeFile(resolve(stagingDir,file),snapshot.bytes);materialized.push(projectAsset(asset,file,snapshot.sha256));}
  const assetByScene=new Map<string,string[]>();for(const asset of materialized)for(const sceneId of asset.sceneIds){const list=assetByScene.get(sceneId)??[];list.push(asset.id);assetByScene.set(sceneId,list);}
  const scenes:HyperFramesSceneBinding[]=project.scenes.map((scene,index)=>{const timing=timeline.scenes[index],stableId=`${slug(scene.id)}-${sha256(scene.id).slice(0,8)}`,compositionId=`scene-${stableId}`,textId=`screen-${stableId}`,sourceFile=`compositions/${stableId}.html`;return {sceneId:scene.id,compositionId,sourceFile,textId,screenText:scene.screenText,...(scene.audio?.voiceoverText?{voiceoverText:scene.audio.voiceoverText}:{}),startFrame:timing.startFrame,durationInFrames:timing.durationInFrames,startSeconds:timing.startSeconds,durationSeconds:timing.durationSeconds,assetIds:[...(assetByScene.get(scene.id)??[])]};});
  const audioClips=resolveHyperFramesAudioClips(project,assetManifest,timeline,materialized),files=["index.html","kit/tokens.css","kit/theme.css","kit/primitives.css",...scenes.map((scene)=>scene.sourceFile),...materialized.map((asset)=>asset.file),"hyperframes-manifest.json"];
  const manifest:HyperFramesProjectManifest={version:"1",renderer:"hyperframes",rendererVersion:"0.8.50",projectId,revision,projectHash:videoProjectHash(project),productionProfileHash:profileHash,assetManifestHash,width:project.meta.width,height:project.meta.height,fps:timeline.fps,durationInFrames:timeline.durationInFrames,durationSeconds:timeline.durationSeconds,scenes,assets:materialized,audioClips,generatedFiles:files};
  await copyFile(resolve(p.hyperframesKit,"tokens.css"),resolve(stagingDir,"kit/tokens.css"));await copyFile(resolve(p.hyperframesKit,"primitives.css"),resolve(stagingDir,"kit/primitives.css"));
  await writeFile(resolve(stagingDir,"kit/theme.css"),themeCss(project),"utf8");
  for(let i=0;i<project.scenes.length;i++){const scene=project.scenes[i],binding=scenes[i];await writeFile(resolve(stagingDir,binding.sourceFile),sceneDocument(project,scene,timeline.scenes[i],binding.compositionId,binding.textId,binding.assetIds),"utf8");}
  await writeFile(resolve(stagingDir,"index.html"),rootDocument(project,timeline,scenes,audioClips),"utf8");await writeFile(resolve(stagingDir,"hyperframes-manifest.json"),`${JSON.stringify(manifest,null,2)}\n`,"utf8");
  if(copyForwardFrom){
    const projectsRoot=await realpath(p.hyperframesProjects),sourceRoot=await realpath(copyForwardFrom),sourceRelative=relative(projectsRoot,sourceRoot);
    if(sourceRelative===".."||sourceRelative.startsWith(`..${sep}`)||sourceRelative.startsWith(sep))throw new Error("HyperFrames copy-forward source must remain inside the versioned projects directory.");
    const sceneFiles=new Set(manifest.scenes.map(scene=>scene.sourceFile)),canonicalAssets=new Set(materialized.map(asset=>asset.file)),preservable=new Set([".html",".css",".js",".mjs",".json",".svg",".png",".jpg",".jpeg",".gif",".webp",".avif",".mp3",".wav",".m4a",".ogg",".aac",".flac",".mp4",".webm",".mov",".m4v",".woff",".woff2",".ttf",".otf"]);
    for(const source of await listProjectFiles(sourceRoot)){const rel=relative(sourceRoot,source).replaceAll("\\","/"),extension=extname(rel).toLowerCase();if(!preservable.has(extension)||rel.startsWith("kit/")||rel==="hyperframes-manifest.json"||canonicalAssets.has(rel))continue;if(extension===".html"&&rel!=="index.html"&&!sceneFiles.has(rel))continue;const destination=resolve(stagingDir,rel);await mkdir(dirname(destination),{recursive:true});await copyFile(source,destination);}
  }else{
    const textErrors=await validateCanonicalText(stagingDir,manifest,project);if(textErrors.length)throw new Error(`Generated HyperFrames copy validation failed:\n${textErrors.map((message)=>`- ${message}`).join("\n")}`);
  }
  await rename(stagingDir,projectDir);
  return {projectDir,relativeProjectDir:relative(root,projectDir).replaceAll("\\","/"),manifest,timeline};
  }catch(error){await rm(stagingDir,{recursive:true,force:true});throw error;}
}

function decodeHtmlText(value:string):string{return value.replace(/&#(\d+);/g,(_,n:string)=>String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi,(_,n:string)=>String.fromCodePoint(parseInt(n,16))).replace(/&nbsp;/gi," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'");}
function normalizedText(value:string):string{return decodeHtmlText(value).replace(/\s+/g," ").trim();}
function isNonLocalUrl(value:string):boolean{return value.startsWith("/")||/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);}
function htmlTokens(source:string):string[]{const tokens:string[]=[];let index=0;while(index<source.length){if(source.startsWith("<!--",index)){const end=source.indexOf("-->",index+4);index=end<0?source.length:end+3;continue;}if(source[index]==="<"){let quote="",end=index+1;for(;end<source.length;end++){const ch=source[end];if(quote){if(ch===quote)quote="";}else if(ch==='"'||ch==="'")quote=ch;else if(ch===">")break;}tokens.push(source.slice(index,end<source.length?end+1:source.length));index=end<source.length?end+1:source.length;}else{const end=source.indexOf("<",index);tokens.push(source.slice(index,end<0?source.length:end));index=end<0?source.length:end;}}return tokens;}
function tagAttributes(raw:string):Record<string,string>{const tag=raw.replace(/^<\/?[^\s/>]+|\s*\/?\s*>$/g,"");const attributes:Record<string,string>={};const pattern=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;let match:RegExpExecArray|null;while((match=pattern.exec(tag)))attributes[match[1].toLowerCase()]=decodeHtmlText(match[2]??match[3]??match[4]??"");return attributes;}

/** Validates canonical headline text, narration captions, and immutable visible copy. */
export async function validateCanonicalText(projectDir:string,manifest:HyperFramesProjectManifest,canonicalProject?:VideoProject):Promise<string[]>{
  const errors:string[]=[],canonicalScenes=canonicalProject?.scenes,expected=new Map(manifest.scenes.map((scene,index)=>[scene.textId,normalizedText(canonicalScenes?.[index]?.screenText??scene.screenText)])),seen=new Map<string,number>(),actual=new Map<string,string>(),captionExpected=new Map<string,string>(manifest.scenes.filter((scene)=>scene.voiceoverText?.trim()).map((scene)=>[scene.sceneId,normalizedText(scene.voiceoverText!)] as const)),captionSeen=new Map<string,number>(),captionActual=new Map<string,string[]>(),unmarked:string[]=[];
  if(canonicalProject){
    if(manifest.scenes.length!==canonicalProject.scenes.length)errors.push("Renderer scene bindings do not match canonical video.json scene count.");
    const timeline=resolveHyperFramesTimeline(canonicalProject);
    manifest.scenes.forEach((scene,index)=>{const canonical=canonicalScenes?.[index],timing=timeline.scenes[index],assetIds=manifest.assets.filter((asset)=>asset.sceneIds.includes(scene.sceneId)).map((asset)=>asset.id);if(!canonical||!timing||scene.sceneId!==canonical.id||scene.screenText!==canonical.screenText||scene.voiceoverText!==(canonical.audio?.voiceoverText||undefined)||scene.startFrame!==timing.startFrame||scene.durationInFrames!==timing.durationInFrames||scene.startSeconds!==timing.startSeconds||scene.durationSeconds!==timing.durationSeconds||JSON.stringify(scene.assetIds)!==JSON.stringify(assetIds))errors.push(`Renderer scene binding '${scene.sceneId}' differs from canonical video.json or approved assets.`);});
    if(manifest.durationInFrames!==timeline.durationInFrames||manifest.durationSeconds!==timeline.durationSeconds||manifest.fps!==timeline.fps||manifest.width!==canonicalProject.meta.width||manifest.height!==canonicalProject.meta.height)errors.push("Renderer dimensions or duration differ from canonical video.json.");
  }
  const files=await listProjectFiles(projectDir,".html");
  const approvedFiles=new Set(manifest.assets.map((asset)=>asset.file));
  const audioTags:Array<{file:string;attributes:Record<string,string>}>=[];
  for(const file of files){
    const source=await readFile(file,"utf8"),stack:Array<{tag:string;marker?:string;captionId?:string;skip:boolean}>=[];
    for(const token of htmlTokens(source))if(token.startsWith("<")&&!/^<!|^<\?|^<\//.test(token)){
      const attrs=tagAttributes(token),tagName=token.match(/^<\s*([\w:-]+)/)?.[1]?.toLowerCase();
      for(const key of ["src","srcset","href","poster","data","action","formaction","xlink:href","manifest"]){const value=attrs[key]?.trim();if(value){const references=key==="srcset"?value.split(",").map((part)=>part.trim().split(/\s+/)[0]):[value];for(const reference of references)if(isNonLocalUrl(reference))errors.push(`${relative(projectDir,file)} uses non-local ${key} resource '${reference}'.`);else{const pathError=validateLocalReference(projectDir,file,reference,approvedFiles);if(pathError)errors.push(pathError);}}}
      if(attrs.ping!==undefined)errors.push(`${relative(projectDir,file)} contains a network-capable ping attribute.`);
      if(attrs.srcdoc!==undefined)errors.push(`${relative(projectDir,file)} contains inline frame content.`);
      if(Object.keys(attrs).some((key)=>key.toLowerCase().startsWith("on")))errors.push(`${relative(projectDir,file)} contains executable inline event attributes.`);
      if(tagName==="meta"&&attrs["http-equiv"]?.toLowerCase()==="refresh")errors.push(`${relative(projectDir,file)} contains a meta refresh.`);
      for(const match of (attrs.style??"").matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)){const value=match[2].trim();if(isNonLocalUrl(value))errors.push(`${relative(projectDir,file)} contains a non-local inline CSS resource '${value}'.`);else{const pathError=validateLocalReference(projectDir,file,value,approvedFiles);if(pathError)errors.push(pathError);}}
    }
    if(hasUnapprovedCssContent(source))errors.push(`${relative(projectDir,file)} contains generated CSS content outside canonical text.`);
    for(const block of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)){
      const inlineCss=block[1]??"";
      if(/@import\b/i.test(inlineCss))errors.push(relative(projectDir,file)+" contains CSS @import; reference an approved local stylesheet explicitly.");
      for(const match of inlineCss.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)){const value=match[2].trim();if(isNonLocalUrl(value))errors.push(relative(projectDir,file)+" contains a non-local inline CSS resource: "+value);else{const pathError=validateLocalReference(projectDir,file,value,approvedFiles);if(pathError)errors.push(pathError);}}
    }
    for(const token of htmlTokens(source)){
      if(!token.startsWith("<")){const text=normalizedText(token);if(!text||stack.at(-1)?.skip)continue;const context=[...stack].reverse().find((entry)=>entry.marker||entry.captionId);if(context?.marker)actual.set(context.marker,`${actual.get(context.marker)??""} ${text}`.trim());else if(context?.captionId){const parts=captionActual.get(context.captionId)??[];parts.push(text);captionActual.set(context.captionId,parts);}else unmarked.push(`${relative(projectDir,file)}: ${text}`);continue;}
      if(/^<!|^<\?/.test(token))continue;
      const closing=/^<\//.test(token),name=token.match(/^<\/?\s*([\w:-]+)/)?.[1]?.toLowerCase();if(!name)continue;
      if(closing){for(let i=stack.length-1;i>=0;i--){const entry=stack.pop()!;if(entry.tag===name)break;}continue;}
      // Exclude explicitly hidden decorative symbols from canonical copy extraction.
      const attrs=tagAttributes(token),marker=attrs["data-canonical-text-id"],captionId=attrs["data-canonical-caption-id"],inHead=stack.some((entry)=>entry.tag==="head"),skip=name==="head"||name==="script"||name==="style"||(name==="title"&&inHead)||attrs["aria-hidden"]?.toLowerCase()==="true"||stack.at(-1)?.skip===true;
      if(["base","embed","form","iframe","object"].includes(name))errors.push(`${relative(projectDir,file)} contains disallowed active HTML element <${name}>.`);
      if(name==="script"&&attrs.type!=="application/json"&&attrs.type!=="application/ld+json")errors.push(`${relative(projectDir,file)} contains an executable script; copy validation cannot prove generated text.`);
      if(name==="audio"){if(file!==resolve(projectDir,"index.html"))errors.push(`${relative(projectDir,file)} contains audio outside the manifest-timed root composition.`);audioTags.push({file,attributes:attrs});}
      if(name==="video"&&!Object.hasOwn(attrs,"muted"))errors.push(`${relative(projectDir,file)} contains video without a muted attribute; final audio comes only from the frame-addressed audio manifest.`);
      for(const key of ["alt","title","aria-label","placeholder"])if(attrs[key]?.trim())errors.push(`${relative(projectDir,file)} has non-canonical text in '${key}'.`);
      if(marker){seen.set(marker,(seen.get(marker)??0)+1);if(!expected.has(marker))errors.push(`${relative(projectDir,file)} contains unknown canonical text id '${marker}'.`);}
      if(captionId){captionSeen.set(captionId,(captionSeen.get(captionId)??0)+1);if(!captionExpected.has(captionId))errors.push(`${relative(projectDir,file)} contains unknown canonical caption id '${captionId}'.`);}
      const voidTag=/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(name);if(!voidTag&&!/\/>$/.test(token))stack.push({tag:name,...(marker?{marker}:{}),...(captionId?{captionId}:{}),skip});
    }
  }
  for(const [id,text] of expected){if(seen.get(id)!==1)errors.push(`Canonical text id '${id}' must occur exactly once; found ${seen.get(id)??0}.`);if(normalizedText(actual.get(id)??"")!==text)errors.push(`Canonical text id '${id}' does not match video.json.`);}
  for(const [sceneId,text] of captionExpected){if(!captionSeen.get(sceneId))errors.push(`Canonical narration captions for scene '${sceneId}' are missing.`);if(normalizedText((captionActual.get(sceneId)??[]).join(" "))!==text)errors.push(`Canonical narration captions for scene '${sceneId}' do not match video.json audio.voiceoverText.`);}
  if(unmarked.length)errors.push(`Unmarked visible text exists: ${unmarked.slice(0,12).join(" | ")}`);
  if(audioTags.length!==manifest.audioClips.length)errors.push(`Root composition has ${audioTags.length} audio clips but manifest declares ${manifest.audioClips.length}.`);
  for(let index=0;index<manifest.audioClips.length;index++){
    const audio=manifest.audioClips[index],matches=audioTags.filter((tag)=>tag.attributes.src===`./${audio.file}`);
    if(matches.length!==1){errors.push(`Manifest audio asset '${audio.assetId}' must appear exactly once in root HTML.`);continue;}
    const {file,attributes}=matches[0],checks:Array<[string,number]>=[["data-start",frameToSeconds(audio.startFrame,manifest.fps)],["data-duration",frameToSeconds(audio.durationInFrames,manifest.fps)],["data-media-start",audio.sourceStartSeconds],["data-volume",audio.gain],["data-track-index",manifest.scenes.length+index]];
    if(!attributes.class?.split(/\s+/).includes("clip"))errors.push(`${relative(projectDir,file)} audio asset '${audio.assetId}' is missing the HyperFrames clip class.`);
    for(const [key,value] of checks){const actualValue=Number(attributes[key]);if(!Number.isFinite(actualValue)||Math.abs(actualValue-value)>1e-9)errors.push(`${relative(projectDir,file)} audio asset '${audio.assetId}' has incorrect ${key}.`);}
  }
  const cssFiles=await listProjectFiles(projectDir,".css"),css=await Promise.all(cssFiles.map((file)=>readFile(file,"utf8")));
  if(css.some(hasUnapprovedCssContent))errors.push("Renderer CSS contains generated content that is not represented in video.json.");
  for(let index=0;index<css.length;index++){
    const source=css[index],file=cssFiles[index];
    if(/@import\b/i.test(source))errors.push(`${relative(projectDir,file)} contains CSS @import; reference an approved local stylesheet explicitly.`);
    for(const match of source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)){const value=match[2].trim();if(isNonLocalUrl(value))errors.push(`${relative(projectDir,file)} contains a non-local CSS resource '${value}'.`);else{const pathError=validateLocalReference(projectDir,file,value,approvedFiles);if(pathError)errors.push(pathError);}}
  }
  for(const asset of manifest.assets.filter((item)=>item.file.toLowerCase().endsWith(".svg"))){
    const file=resolve(projectDir,asset.file),source=await readFile(file,"utf8");
    if(/<script\b|<text\b|<!ENTITY\b|<!DOCTYPE[^>]*(?:SYSTEM|PUBLIC)|\son[a-z]+\s*=/i.test(source))errors.push(`${asset.file} contains executable SVG content or visible copy outside canonical text.`);
    if(/<foreignObject\b/i.test(source))errors.push(`${asset.file} contains SVG foreignObject HTML content.`);
    for(const token of htmlTokens(source))if(token.startsWith("<")&&!/^<!|^<\?|^<\//.test(token)){const attrs=tagAttributes(token);for(const key of ["href","xlink:href","src"]){const value=attrs[key]?.trim();if(value&&isNonLocalUrl(value))errors.push(`${asset.file} contains a non-local SVG ${key} reference.`);else if(value){const pathError=validateLocalReference(projectDir,file,value,approvedFiles);if(pathError)errors.push(pathError);}}}
    for(const match of source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)){const value=match[2].trim();if(isNonLocalUrl(value))errors.push(`${asset.file} contains a non-local SVG CSS reference.`);else{const pathError=validateLocalReference(projectDir,file,value,approvedFiles);if(pathError)errors.push(pathError);}}
  }
  return [...new Set(errors)];
}

/** Restricts authored media and font paths to the approved project asset manifest. */
function validateLocalReference(projectDir:string,sourceFile:string,value:string,approvedFiles:Set<string>):string|undefined{
  if(!value||value.startsWith("#"))return;
  let pathValue=value.split(/[?#]/,1)[0];try{pathValue=decodeURIComponent(pathValue);}catch{return `${relative(projectDir,sourceFile)} contains an invalid encoded local path.`;}
  if(!pathValue)return;
  const sourceRelative=relative(projectDir,sourceFile).replaceAll("\\","/"),projectRootReference=sourceRelative.startsWith("compositions/")&&!pathValue.startsWith("./")&&!pathValue.startsWith("../");
  const target=projectRootReference?resolve(projectDir,pathValue):resolve(dirname(sourceFile),pathValue),relativePath=relative(projectDir,target),normalized=relativePath.replaceAll("\\","/");
  if(relativePath===".."||relativePath.startsWith(`..${sep}`)||relativePath.startsWith(sep))return `${relative(projectDir,sourceFile)} references a local resource outside its project.`;
  const media=/\.(?:png|jpe?g|gif|webp|avif|svg|mp3|wav|m4a|ogg|aac|flac|mp4|webm|mov|m4v|woff2?|ttf|otf)$/i.test(normalized);
  if((normalized.startsWith("assets/")||media)&&!approvedFiles.has(normalized))return `${relative(projectDir,sourceFile)} references unapproved asset '${normalized}'.`;
}

/** Collects authored project files while excluding CLI-generated snapshots. */
async function listProjectFiles(projectDir:string,extension?:string):Promise<string[]>{
  const files:string[]=[];
  async function visit(directory:string):Promise<void>{for(const entry of await readdir(directory,{withFileTypes:true})){const path=resolve(directory,entry.name);if(entry.isSymbolicLink())throw new Error(`Renderer source '${relative(projectDir,path)}' must not be a symbolic link.`);if(entry.isDirectory()&&! ["snapshots","node_modules",".git"].includes(entry.name.toLowerCase()))await visit(path);else if(entry.isFile()&&(!extension||entry.name.toLowerCase().endsWith(extension)))files.push(path);}}
  await visit(projectDir);return files.sort();
}
