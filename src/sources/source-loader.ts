import {isAbsolute,relative,resolve} from "node:path";
import {readJson} from "../core/io.js";
import {exists,requireFile} from "../harness/fs.js";
import {harnessPaths} from "../harness/paths.js";
import type {NormalizedSource,SourceIndex} from "./normalized-source.js";

export function normalizedSourcesRoot(root:string):string{return harnessPaths(root).sources;}
function safeSourcePath(root:string,path:string):string{
  if(!path||isAbsolute(path)||path.includes("\0"))throw new Error(`Normalized source path is unsafe: ${path}`);
  const base=normalizedSourcesRoot(root),candidate=resolve(base,path),rest=relative(base,candidate);
  if(rest.startsWith("..")||isAbsolute(rest))throw new Error(`Normalized source path escapes .video/sources: ${path}`);
  return candidate;
}
function validateIndex(value:unknown):SourceIndex{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Normalized source index must be an object.");
  const record=value as Record<string,unknown>;
  if(record.version!=="1"||!Array.isArray(record.sources))throw new Error("Normalized source index must use version 1 and contain sources.");
  const sources=record.sources.map((entry,index)=>{
    if(!entry||typeof entry!=="object"||Array.isArray(entry))throw new Error(`Normalized source index entry ${index} is invalid.`);
    const item=entry as Record<string,unknown>;
    if(typeof item.id!=="string"||!item.id.trim()||typeof item.kind!=="string"||typeof item.path!=="string"||!item.path.trim())throw new Error(`Normalized source index entry ${index} requires id, kind, and path.`);
    return {id:item.id,kind:item.kind as SourceIndex["sources"][number]["kind"],path:item.path};
  });
  return {version:"1",sources};
}
export async function loadNormalizedSourceIndex(root:string=process.cwd()):Promise<SourceIndex>{
  const indexPath=harnessPaths(root).sourceIndex;if(!(await exists(indexPath)))return {version:"1",sources:[]};return validateIndex(await readJson(indexPath));
}
export function resolveNormalizedSourcePath(root:string,path:string):string{return safeSourcePath(root,path);}
export async function loadNormalizedSources(root:string=process.cwd()):Promise<NormalizedSource[]>{
  const index=await loadNormalizedSourceIndex(root),sources:NormalizedSource[]=[];
  for(const entry of index.sources){const path=safeSourcePath(root,entry.path);await requireFile(path,`Normalized source '${entry.id}'`);const source=await readJson<NormalizedSource>(path);if(source.id!==entry.id||source.kind!==entry.kind)throw new Error(`Normalized source '${entry.id}' does not match its index entry.`);sources.push(source);}
  return sources;
}
