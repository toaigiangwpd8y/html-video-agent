import {readFile,readdir,rm,stat} from "node:fs/promises";
import {createRequire} from "node:module";
import {basename,extname,isAbsolute,relative,resolve} from "node:path";
import {readJson,readText,writeJson} from "../core/io.js";
import {exists,requireFile} from "../harness/fs.js";
import {harnessPaths} from "../harness/paths.js";
import {loadNormalizedSourceIndex,normalizedSourcesRoot} from "./source-loader.js";
import type {NormalizedSource,SourceNarration,SourceRewritePolicy} from "./normalized-source.js";
import {importPdf} from "./pdf-adapter.js";
import {parseSlideNarration} from "./narration-map.js";
import {importPptx} from "./pptx-adapter.js";
const require=createRequire(import.meta.url),pptxParser=require("pptxtojson/dist/index.cjs") as {parse(input:Uint8Array,options:Record<string,string>):Promise<{slides?:unknown[]}>};

type SlideFormat="pptx"|"pdf";
interface ManifestSource {id?:string;type?:string;path:string;script?:string;}
interface SlideManifest {version:number;workflow:string;request?:string;brief?:string;script?:string;sources:ManifestSource[];}
export interface SlideImportOptions {narrationBySection?:Record<string,SourceNarration>;narrationText?:string;narrationPath?:string;rewritePolicy?:SourceRewritePolicy;}
export interface PackageImportSummary {ok:true;inputDirectory:string;contextFiles:Record<string,string>;imported:Array<{inputId?:string;sourceId:string;kind:string;sourcePath:string;sections:number}>;}

function formatForPath(path:string):SlideFormat{switch(extname(path).toLowerCase()){case ".pptx":return "pptx";case ".pdf":return "pdf";default:throw new Error(`Unsupported slide source '${path}'; expected .pptx or .pdf.`);}}
function safeRelativePath(directory:string,path:string,description:string):string{
  if(!path||isAbsolute(path)||path.includes("\0"))throw new Error(`${description} must be a safe relative path inside video-input: ${path}`);
  const base=resolve(directory),candidate=resolve(base,path),rest=relative(base,candidate);
  if(rest===".."||rest.startsWith(`..\\`)||rest.startsWith(`../`)||isAbsolute(rest))throw new Error(`${description} path escapes video-input: ${path}`);
  return candidate;
}
function validateManifest(value:unknown):SlideManifest{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Slide input manifest must be an object.");
  const manifest=value as Record<string,unknown>;
  if(manifest.version!==1||manifest.workflow!=="slides-to-video"||!Array.isArray(manifest.sources)||manifest.sources.length===0)throw new Error("Slide input manifest must use version 1, workflow 'slides-to-video', and declare at least one source.");
  for(const key of ["request","brief","script"])if(manifest[key]!==undefined&&(typeof manifest[key]!=="string"||!manifest[key].trim()))throw new Error(`Manifest '${key}' must be a non-empty relative path.`);
  const ids=new Set<string>();
  const sources=manifest.sources.map((entry,index)=>{
    if(!entry||typeof entry!=="object"||Array.isArray(entry))throw new Error(`Manifest source ${index+1} must be an object.`);
    const source=entry as Record<string,unknown>;
    if(typeof source.path!=="string"||!source.path.trim())throw new Error(`Manifest source ${index+1} requires a path.`);
    if(source.id!==undefined&&(typeof source.id!=="string"||!/^[a-zA-Z0-9_-]+$/.test(source.id)))throw new Error(`Manifest source ${index+1} id must contain only letters, numbers, underscores, or hyphens.`);
    if(typeof source.id==="string"){if(ids.has(source.id))throw new Error(`Manifest source id '${source.id}' is duplicated.`);ids.add(source.id);}
    if(source.type!==undefined&&source.type!=="pptx"&&source.type!=="pdf")throw new Error(`Manifest source '${String(source.id??index+1)}' type must be pptx or pdf.`);
    if(source.script!==undefined&&(typeof source.script!=="string"||!source.script.trim()))throw new Error(`Manifest source '${String(source.id??index+1)}' script must be a relative path.`);
    return {id:source.id as string|undefined,type:source.type as string|undefined,path:source.path as string,script:source.script as string|undefined};
  });
  return {version:1,workflow:"slides-to-video",...(typeof manifest.request==="string"?{request:manifest.request}:{}),...(typeof manifest.brief==="string"?{brief:manifest.brief}:{}),...(typeof manifest.script==="string"?{script:manifest.script}:{}),sources};
}

async function rollbackImportedSources(root:string,sourceIds:string[]):Promise<void>{
  const ids=new Set(sourceIds);if(ids.size===0)return;
  const index=await loadNormalizedSourceIndex(root);
  await writeJson(harnessPaths(root).sourceIndex,{...index,sources:index.sources.filter(source=>!ids.has(source.id))});
  await Promise.all([...ids].map(id=>rm(resolve(normalizedSourcesRoot(root),id),{recursive:true,force:true})));
}

export async function importSlideSource(root:string,inputPath:string,options:SlideImportOptions={}):Promise<NormalizedSource>{
  const format=formatForPath(inputPath);
  let narrationBySection=options.narrationBySection;
  if(options.narrationText!==undefined){
    const count=await countSlideSourcePages(inputPath);
    if(count!==1)throw new Error("A single unlabelled narration value can only be used with a one-slide source. Use --script with explicit slide labels for multiple slides.");
    narrationBySection={...narrationBySection,"slide-1":{text:options.narrationText.trim(),...(options.narrationPath?{path:options.narrationPath}:{}),rewritePolicy:options.rewritePolicy??"preserve"}};
  }
  if(options.rewritePolicy&&narrationBySection)narrationBySection=Object.fromEntries(Object.entries(narrationBySection).map(([id,narration])=>[id,{...narration,rewritePolicy:options.rewritePolicy}]));
  if(format==="pptx")return importPptx(root,inputPath,{...options,narrationBySection,narrationText:undefined});
  return importPdf(root,inputPath,{...(narrationBySection?{narrationBySection}:{})});
}

async function detectOneSource(directory:string):Promise<string>{
  const files:string[]=[];
  for(const folder of [directory,resolve(directory,"sources")]){
    let entries:any[];try{entries=await readdir(folder,{withFileTypes:true});}catch{continue;}
    for(const entry of entries)if(entry.isFile()&&[".pptx",".pdf"].includes(extname(entry.name).toLowerCase()))files.push(resolve(folder,entry.name));
  }
  if(files.length===0)throw new Error(`No PPTX or PDF found in '${directory}'. Put one source in video-input/sources or add it to manifest.json.`);
  if(files.length!==1)throw new Error(`Slide source auto-detection is ambiguous: found ${files.length} PPTX/PDF files. Declare the intended files in manifest.json.`);
  return files[0];
}

export async function importInputPackage(root:string,inputDirectory=harnessPaths(root).videoInput):Promise<PackageImportSummary>{
  const directory=resolve(inputDirectory),directoryInfo=await stat(directory).catch(()=>undefined);if(!directoryInfo?.isDirectory())throw new Error(`Slide input folder not found: ${directory}`);
  const manifestPath=resolve(directory,"manifest.json");let manifest:SlideManifest|undefined;
  if(await exists(manifestPath))manifest=validateManifest(await readJson(manifestPath));
  const contextFiles:Record<string,string>={},imported:PackageImportSummary["imported"]=[];
  if(manifest){
    for(const [key,path] of Object.entries({request:manifest.request,brief:manifest.brief,script:manifest.script}))if(path){const candidate=safeRelativePath(directory,path,`Manifest ${key}`);await requireFile(candidate,`Manifest ${key}`);contextFiles[key]=relative(root,candidate).replaceAll("\\","/");}
    if(manifest.sources.length>1&&manifest.script&&manifest.sources.some(source=>!source.script))throw new Error("A package with multiple decks must attach a separate script path to each manifest source; a single shared script path is ambiguous.");
    try{
      for(const source of manifest.sources){
        const inputPath=safeRelativePath(directory,source.path,`Manifest source '${source.id??basename(source.path)}'`);await requireFile(inputPath,`Manifest source '${source.id??basename(source.path)}'`);
        const format=formatForPath(inputPath);if(source.type&&source.type!==format)throw new Error(`Manifest source '${source.id??basename(source.path)}' type '${source.type}' does not match file extension '${format}'.`);
        const scriptPath=source.script?safeRelativePath(directory,source.script,`Manifest source '${source.id??basename(source.path)}' script`):manifest.script?safeRelativePath(directory,manifest.script,"Manifest script"):undefined;
        const narrationBySection=scriptPath?parseSlideNarration(await readText(scriptPath),await countSlideSourcePages(inputPath),relative(root,scriptPath).replaceAll("\\","/")):undefined;
        const normalized=await importSlideSource(root,inputPath,{...(narrationBySection?{narrationBySection}:{})});
        imported.push({...(source.id?{inputId:source.id}:{}),sourceId:normalized.id,kind:normalized.kind,sourcePath:relative(root,resolve(root,".video/sources",normalized.id,"source.json")).replaceAll("\\","/"),sections:normalized.sections?.length??0});
      }
    }catch(error){
      try{await rollbackImportedSources(root,imported.map(source=>source.sourceId));}
      catch(rollbackError){throw new AggregateError([error,rollbackError],"Slide input package import failed and rollback was incomplete.");}
      throw error;
    }
  }else{
    const inputPath=await detectOneSource(directory),scriptCandidate=resolve(directory,"script.md"),hasScript=await exists(scriptCandidate);
    const narrationBySection=hasScript?parseSlideNarration(await readText(scriptCandidate),await countSlideSourcePages(inputPath),relative(root,scriptCandidate).replaceAll("\\","/")):undefined;
    const normalized=await importSlideSource(root,inputPath,{...(narrationBySection?{narrationBySection}:{})});
    for(const key of ["request","brief"]){const candidate=resolve(directory,`${key}.md`);if(await exists(candidate))contextFiles[key]=relative(root,candidate).replaceAll("\\","/");}
    if(hasScript)contextFiles.script=relative(root,scriptCandidate).replaceAll("\\","/");
    imported.push({sourceId:normalized.id,kind:normalized.kind,sourcePath:relative(root,resolve(root,".video/sources",normalized.id,"source.json")).replaceAll("\\","/"),sections:normalized.sections?.length??0});
  }
  return {ok:true,inputDirectory:relative(root,directory).replaceAll("\\","/"),contextFiles,imported};
}

export async function countSlideSourcePages(inputPath:string):Promise<number>{
  if(extname(inputPath).toLowerCase()===".pptx"){
    const parsed=await pptxParser.parse(await readFile(inputPath),{imageMode:"none",videoMode:"none",audioMode:"none"});
    return Array.isArray(parsed.slides)?parsed.slides.length:0;
  }
  const {getPdfPageCount}=await import("./pdf-adapter.js");return getPdfPageCount(await readFile(inputPath));
}
