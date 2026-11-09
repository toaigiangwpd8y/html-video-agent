import {readText} from "../core/io.js";
import {sha256} from "../core/hash.js";
import {exists,requireFile} from "./fs.js";
import {harnessPaths} from "./paths.js";

export async function requestHash(root:string):Promise<string>{
  const p=harnessPaths(root);await requireFile(p.request,"Captured user request");return sha256(await readText(p.request));
}

/** Request content remains replaceable until the Production Profile freezes it. */
export async function assertRequestMutable(root:string):Promise<void>{
  const p=harnessPaths(root);
  if(await exists(p.productionProfile))throw new Error("Request is frozen by the Production Profile. Run `video init` to start a new request.");
}
