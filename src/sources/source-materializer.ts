import {copyFile,mkdir} from "node:fs/promises";
import {basename,resolve} from "node:path";
import {readJson,writeJson} from "../core/io.js";
import type {AssetManifest,AssetManifestItem} from "../harness/remotion-manifest.js";
import {exists,requireFile} from "../harness/fs.js";
import {loadNormalizedSources,resolveNormalizedSourcePath} from "./source-loader.js";
import {withAssetStorageLock} from "../harness/asset-storage-lock.js";

function findElement(elements:import("./normalized-source.js").SourceElement[]|undefined,predicate:(item:import("./normalized-source.js").SourceElement)=>boolean):import("./normalized-source.js").SourceElement|undefined{for(const item of elements??[]){if(predicate(item))return item;const child=findElement(item.children,predicate);if(child)return child;}return undefined;}
/** Promote exactly one explicitly selected source asset into the production registry. */
export async function materializeNormalizedSourceAsset(root:string,sourceId:string,assetId:string,sceneId:string,role:string):Promise<AssetManifestItem>{
  return withAssetStorageLock(root,()=>materializeNormalizedSourceAssetLocked(root,sourceId,assetId,sceneId,role));
}
async function materializeNormalizedSourceAssetLocked(root:string,sourceId:string,assetId:string,sceneId:string,role:string):Promise<AssetManifestItem>{
  const source=(await loadNormalizedSources(root)).find(item=>item.id===sourceId);if(!source)throw new Error(`Normalized source '${sourceId}' was not found.`);
  const asset=source.assets?.find(item=>item.id===assetId);if(!asset)throw new Error(`Normalized source asset '${assetId}' was not found in source '${sourceId}'.`);
  const sourcePath=resolveNormalizedSourcePath(root,`${sourceId}/${asset.path}`);await requireFile(sourcePath,`Normalized source asset '${assetId}'`);
  const fileName=basename(asset.path),publicPath=`/assets/source/${sourceId}/${fileName}`,target=resolve(root,publicPath.slice(1)),manifestPath=resolve(root,"assets/manifest.json");
  if(!(await exists(manifestPath)))throw new Error(`Asset manifest not found: ${manifestPath}`);
  const manifest=await readJson<AssetManifest>(manifestPath);if(!manifest||!Array.isArray(manifest.assets))throw new Error("Asset manifest must contain an assets array.");
  const id=`source-${sourceId}-${assetId}`,existing=manifest.assets.find(item=>item.id===id);
  if(existing){
    if(existing.publicPath!==publicPath)throw new Error(`Asset id '${id}' is already bound to another path.`);
    const sceneIds=existing.sceneIds??[];if(sceneIds.includes(sceneId))return existing;
    const updated={...existing,sceneIds:[...sceneIds,sceneId]};
    await writeJson(manifestPath,{...manifest,assets:manifest.assets.map(item=>item.id===id?updated:item)});return updated;
  }
  await mkdir(resolve(target,".."),{recursive:true});await copyFile(sourcePath,target);
  const element=findElement(source.elements,item=>item.assetRef===assetId)||findElement(source.elements,item=>item.id===asset.metadata?.sourceElementId),item:AssetManifestItem={id,publicPath,type:asset.type??"application/octet-stream",source:"user-provided",provenance:`sourceId=${sourceId};sourceElementId=${element?.id??asset.metadata?.sourceElementId??assetId}`,sceneIds:[sceneId],role,...(asset.width!==undefined?{width:asset.width}:{}),...(asset.height!==undefined?{height:asset.height}:{}),notes:"Explicitly selected normalized source asset."};
  await writeJson(manifestPath,{...manifest,assets:[...manifest.assets,item]});return item;
}
