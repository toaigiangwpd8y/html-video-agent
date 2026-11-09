import {mkdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {buildCatalog} from "./shotcraft-library.mjs";

export function validateTypecheckResult({status, error, signal, output}) {
  if (error) throw new Error(`Catalog closure typecheck could not start TypeScript: ${error.message}`);
  if (signal) throw new Error(`Catalog closure typecheck was terminated by signal ${signal}.`);
  if (!Number.isInteger(status)) throw new Error(`Catalog closure typecheck returned no valid exit status (${status}).`);
  const errors = output.split(/\r?\n/).filter(line => /error TS\d+/.test(line));
  if (status !== 0 && errors.length === 0) throw new Error("Catalog closure typecheck exited nonzero without TypeScript diagnostics.");
  const expected = errors.length > 0 && errors.every(line => line.includes("Cannot find module '@remotion/motion-blur'"));
  if (status !== 0 && !expected) throw new Error(`Catalog closure typecheck produced unexpected errors:\n${output}`);
  if (status === 0 && errors.length) throw new Error(`Catalog closure typecheck reported diagnostics despite a zero exit status:\n${output}`);
  return errors;
}

export async function typecheckCatalog({root, outputRoot}) {
  const sourceRoot=resolve(root,"third-party/video-shotcraft/source");
  const catalog=await buildCatalog(sourceRoot);
  const allFiles=[...new Set(catalog.cards.flatMap(card=>card.variants.flatMap(variant=>variant.source.closure)))].sort();
  const temporary=join(outputRoot,"catalog-typecheck");
  await rm(temporary,{recursive:true,force:true});
  await mkdir(temporary,{recursive:true});
  for(const path of allFiles){const destination=join(temporary,"src",path);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,await readFile(join(sourceRoot,path)));}
  await symlink(resolve(root,"remotion/node_modules"),join(temporary,"node_modules"),"junction");
  await writeFile(join(temporary,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"ESNext",moduleResolution:"Bundler",jsx:"react-jsx",strict:true,skipLibCheck:true,esModuleInterop:true,resolveJsonModule:true,noEmit:true,lib:["DOM","ES2022"]},include:["src/**/*.ts","src/**/*.tsx"]},null,2));
  const tsc=resolve(root,"remotion/node_modules/typescript/bin/tsc");
  const runtimeVersion=JSON.parse(await readFile(resolve(root,"remotion/package.json"),"utf8")).dependencies.remotion;
  const result=spawnSync(process.execPath,[tsc,"-p",join(temporary,"tsconfig.json"),"--pretty","false"],{cwd:root,encoding:"utf8",windowsHide:true});
  const output=`${result.stdout??""}${result.stderr??""}`;
  await writeFile(join(temporary,"typecheck.log"),output,"utf8");
  await writeFile(join(temporary,"denominator.json"),JSON.stringify({cards:catalog.cardCount,variants:catalog.variantCount,uniqueClosureFiles:allFiles.length,categoryCounts:catalog.categoryCounts},null,2));
  const errors=validateTypecheckResult({status:result.status,error:result.error,signal:result.signal,output});
  const blockedFiles=errors.map(line=>line.match(/src[\\/]([^(:]+\.tsx?)/)?.[1]?.replaceAll("\\","/")).filter(Boolean);
  return {cards:catalog.cardCount,variants:catalog.variantCount,uniqueClosureFiles:allFiles.length,passedFiles:allFiles.length-blockedFiles.length,blockedFiles,errors,categoryCounts:catalog.categoryCounts,runtimeVersion,status:blockedFiles.length?"blocked":"smoke_passed",catalog};
}
