import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";
import {sha256} from "../src/core/hash.js";

const root=process.cwd();

async function source(path:string):Promise<string>{return readFile(resolve(root,path),"utf8");}

test("Remotion evidence prepares once and finalize validates the approved prior render",async()=>{
  const remotion=await source("src/harness/remotion.ts");
  const evidenceStart=remotion.indexOf("export async function renderBoundaryEvidence");
  const readinessStart=remotion.indexOf("async function readiness",evidenceStart);
  const evidence=remotion.slice(evidenceStart,readinessStart);
  assert.equal((evidence.match(/syncProjectAndAssets\(/g)??[]).length,1);
  assert.match(evidence,/runStillPrepared\(/);
  assert.doesNotMatch(evidence,/stillRemotion\(/);

  const finalizeStart=remotion.indexOf("export async function finalizeRemotion");
  const finalize=remotion.slice(finalizeStart);
  assert.equal((finalize.match(/syncProjectAndAssets\(/g)??[]).length,1);
  assert.match(finalize,/runTypecheckPrepared\(/);
  assert.match(finalize,/runStillPrepared\(/);
  assert.match(finalize,/Previously completed approved Remotion render/);
  assert.match(finalize,/requireFile\(p\.finalVideo/);
  assert.doesNotMatch(finalize,/runRenderPrepared\(/);
  assert.doesNotMatch(finalize,/\b(?:typecheckRemotion|stillRemotion|renderRemotion)\(/);
});

test("Remotion command timeouts are optional caller controls",async()=>{
  const remotion=await source("src/harness/remotion.ts");
  assert.match(remotion,/function run\(cwd:string,args:string\[\],timeout\?:number\)/);
  assert.doesNotMatch(remotion,/180_000|300_000|900_000/);
  assert.match(remotion,/typecheckRemotion\(root=process\.cwd\(\),timeout\?:number\)/);
  assert.match(remotion,/renderBoundaryEvidence\(root=process\.cwd\(\),timeout\?:number\)/);
  assert.match(remotion,/finalizeRemotion\(root=process\.cwd\(\),candidatePath\?:string,frame\?:number,timeout\?:number\)/);
});

test("shared hash helper owns SHA-256 formatting",async()=>{
  const hash=await source("src/core/hash.ts");
  assert.match(hash,/export function sha256\(value:string\|Uint8Array\)/);
  assert.equal(sha256("abc"),"sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.match(sha256(new Uint8Array([0,255])),/^sha256:[a-f0-9]{64}$/);
  assert.notEqual(sha256(new Uint8Array([0,255])),sha256("\u0000ÿ"),"binary input must not be decoded and re-encoded as UTF-8");
  for(const file of [
    "src/harness/request.ts",
    "src/harness/clarification.ts",
    "src/harness/project-state.ts",
    "src/harness/production-profile.ts",
    "src/harness/preproduction-hitl.ts",
    "src/harness/remotion.ts",
  ]){
    const text=await source(file);
    assert.doesNotMatch(text,/createHash\("sha256"\)/,file);
    assert.match(text,/core\/hash\.js|\.\.\/core\/hash\.js/,file);
  }
});
