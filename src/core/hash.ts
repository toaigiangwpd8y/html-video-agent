import {createHash} from "node:crypto";

export function sha256Hex(value:string|Uint8Array):string{
  return createHash("sha256").update(value).digest("hex");
}

export function sha256(value:string|Uint8Array):string{
  return `sha256:${sha256Hex(value)}`;
}
