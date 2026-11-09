import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {buildCatalog} from "./shotcraft-library.mjs";
import {buildCompatibilityLedger} from "./shotcraft-compatibility.mjs";
import {createCompatibilityFixtures} from "./shotcraft-compatibility-fixtures.mjs";
import {typecheckCatalog} from "./shotcraft-compatibility-typecheck.mjs";
import {renderRepresentativePairs} from "./shotcraft-compatibility-render.mjs";
import {runTargetProductProbe} from "./shotcraft-compatibility-target.mjs";
import {proveStaleReviewInvalidation} from "./shotcraft-compatibility-stale.mjs";

const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const outputRoot=resolve(root,"output/GRA-54");
const generatedRoot=resolve(root,"remotion/generated/compatibility");

export async function runCompatibilityProof(){
  if(outputRoot!==resolve(root,"output/GRA-54"))throw new Error("Compatibility artifact output escaped its dedicated ignored directory.");
  await rm(outputRoot,{recursive:true,force:true});
  await mkdir(outputRoot,{recursive:true});
  const typecheck=await typecheckCatalog({root,outputRoot});
  const fixture=await createCompatibilityFixtures({root,outputRoot});
  let renderEvidence,renderFailure;
  try{renderEvidence=await renderRepresentativePairs({root,outputRoot,generatedRoot,samples:fixture.samples});}
  catch(error){renderFailure=error instanceof Error?error.message:String(error);try{renderEvidence=JSON.parse(await readFile(resolve(outputRoot,"render-evidence.json"),"utf8"));}catch{renderEvidence=undefined;}}
  let targetEvidence,targetFailure;
  try{targetEvidence=await runTargetProductProbe({root,outputRoot,generatedRoot});}
  catch(error){targetFailure=error instanceof Error?error.message:String(error);}

  const selectedSourcePath="remotion/generated/compatibility/target/TargetShotAdapted.tsx";
  const selectedSource=await readFile(resolve(root,selectedSourcePath),"utf8");
  const staleProof=await proveStaleReviewInvalidation(join(outputRoot,"stale-review-fixture"),{sourcePath:selectedSourcePath,sourceContent:selectedSource});
  await writeFile(resolve(outputRoot,"source-hash-review-proof.json"),JSON.stringify(staleProof,null,2));

  const pairs=renderEvidence?.pairs??[];
  const pairByVariant=new Map();
  for(const sample of fixture.samples){const pair=pairs.find(item=>item.sampleId===sample.sampleId);if(pair)pairByVariant.set(sample.variantId,pair);}
  const proofs=[];
  for(const card of typecheck.catalog.cards)for(const variant of card.variants){
    const blockedFiles=variant.source.closure.filter(path=>typecheck.blockedFiles.includes(path));
    const pair=pairByVariant.get(variant.id);
    if(blockedFiles.length){proofs.push({variantId:variant.id,status:"blocked",reason:`Strict catalog closure typecheck lacks @remotion/motion-blur: ${blockedFiles.join(", ")}`,evidence:["catalog-typecheck/typecheck.log",...blockedFiles.map(path=>`third-party/video-shotcraft/source/${path}`)],runtimeVersion:typecheck.runtimeVersion});continue;}
    if(pair){proofs.push({variantId:variant.id,status:pair.status,reason:pair.reason,evidence:pair.evidence??[],runtimeVersion:pair.runtimeVersion??null});continue;}
    const selectedSample=fixture.samples.find(sample=>sample.variantId===variant.id);
    if(selectedSample&&renderFailure){proofs.push({variantId:variant.id,status:"blocked",reason:`Selected representative render did not complete: ${renderFailure}`,evidence:["compatibility-run.json","render-evidence.json"],runtimeVersion:typecheck.runtimeVersion});continue;}
    proofs.push({variantId:variant.id,status:"source_only",reason:"Catalog closure typechecked; no per-item motion render was recorded.",evidence:[],runtimeVersion:null});
  }
  const ledger=buildCompatibilityLedger(typecheck.catalog,proofs);
  const compatibility={catalog:{cards:typecheck.cards,variants:typecheck.variants,uniqueClosureFiles:typecheck.uniqueClosureFiles,categoryCounts:typecheck.categoryCounts,typecheck:{status:typecheck.status,passedFiles:typecheck.passedFiles,denominatorFiles:typecheck.uniqueClosureFiles,blockedFiles:typecheck.blockedFiles,errors:typecheck.errors}},...ledger};
  await writeFile(resolve(outputRoot,"catalog-compatibility.json"),JSON.stringify(compatibility,null,2));
  const run={compatibility:{denominator:ledger.denominator,counts:ledger.counts},renderPairs:pairs.map(pair=>({sampleId:pair.sampleId,status:pair.status,reason:pair.reason})),helperCoverage:renderEvidence?.helperCoverage??{},targetProduct:{status:targetFailure?"blocked":"smoke_passed",failure:targetFailure??null,evidence:targetEvidence?"target-product-evidence.json":null},sourceHashReview:{phase:staleProof.after?.phase,approvalInvalidated:staleProof.after?.payload?.approvalInvalidated===true,humanApprovalRecorded:staleProof.humanApprovalRecorded,stateHasVisualApproval:staleProof.stateHasVisualApproval},renderFailure:renderFailure??null,provenance:renderEvidence?.provenance??null};
  await writeFile(resolve(outputRoot,"compatibility-run.json"),JSON.stringify(run,null,2));
  console.log(JSON.stringify(run,null,2));
  const failedPairs=pairs.filter(pair=>pair.status!=="smoke_passed");
  if(renderFailure||targetFailure||failedPairs.length||!staleProof.after?.payload?.approvalInvalidated||staleProof.humanApprovalRecorded||staleProof.stateHasVisualApproval)process.exitCode=1;
  return run;
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url)))await runCompatibilityProof();
