import {resolve} from "node:path";
import {sha256} from "../core/hash.js";
import {writeJson} from "../core/io.js";
import type {NormalizedSource,SourceIndex} from "./normalized-source.js";
import {loadNormalizedSourceIndex,normalizedSourcesRoot} from "./source-loader.js";

export function contentSourceId(prefix:"presentation"|"document",bytes:Uint8Array):string{return `${prefix}-${sha256(Buffer.from(bytes).toString("base64")).slice(7,19)}`;}
export async function appendNormalizedSource(root:string,source:NormalizedSource):Promise<void>{
  const current=await loadNormalizedSourceIndex(root);
  if(current.sources.some(item=>item.id===source.id))throw new Error(`Normalized source '${source.id}' already exists.`);
  const index:SourceIndex={version:"1",sources:[...current.sources,{id:source.id,kind:source.kind,path:`${source.id}/source.json`}]};
  await writeJson(resolve(normalizedSourcesRoot(root),"index.json"),index);
}
