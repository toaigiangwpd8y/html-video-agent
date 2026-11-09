import {withWorkspaceLock} from "../../packages/app-explorer/index.mjs";
import {resolve} from "node:path";

/** Serialize asset registry and storage mutations across Explorer and capture writers. */
export async function withAssetStorageLock<T>(root:string,operation:()=>Promise<T>,timeoutMs=30_000):Promise<T>{
  // Share the revision lock's token fencing, dead-local-owner recovery guard, and compare-before-removal protocol.
  // The dedicated root keeps this storage transaction domain separate from knowledge revisions.
  return withWorkspaceLock(resolve(root,".video/asset-storage"),operation,{timeoutMs});
}
