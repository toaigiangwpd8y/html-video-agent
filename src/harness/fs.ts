import {cp, mkdir, rm, stat} from "node:fs/promises";

function errorCode(error:unknown):unknown{
  return typeof error === "object" && error !== null && "code" in error
    ? (error as {code?:unknown}).code
    : undefined;
}

export async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch(error) { if(errorCode(error)==="ENOENT") return false; throw error; }
}

export async function requireFile(path: string, label: string): Promise<void> {
  let info;
  try { info = await stat(path); }
  catch(error) {
    if(errorCode(error)==="ENOENT") throw new Error(`${label} not found: ${path}`);
    throw error;
  }
  if(!info.isFile()) throw new Error(`${label} is not a file: ${path}`);
}

export async function cleanDir(path: string): Promise<void> {
  await rm(path, {recursive: true, force: true});
  await mkdir(path, {recursive: true});
}

export async function copyTree(source: string, destination: string): Promise<void> {
  if (!(await exists(source))) return;
  await mkdir(destination, {recursive: true});
  await cp(source, destination, {recursive: true, force: true});
}
