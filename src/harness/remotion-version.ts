import {resolve} from "node:path";
import {readJson} from "../core/io.js";

interface RemotionPackageManifest {dependencies?:Record<string,unknown>;}

const exactVersion=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Reads the single Remotion runtime version pin from remotion/package.json. */
export async function readPinnedRemotionVersion(remotionRoot:string):Promise<string>{
  const manifest=await readJson<RemotionPackageManifest>(resolve(remotionRoot,"package.json"));
  const version=manifest.dependencies?.remotion;
  if(typeof version!=="string"||!exactVersion.test(version))throw new Error("remotion/package.json must pin an exact Remotion version in dependencies.remotion.");
  return version;
}
