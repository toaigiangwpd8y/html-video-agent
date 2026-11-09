import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import type {UniversalHitlEvent} from "../src/harness/hitl-protocol.js";
import {applyPendingReviewChange,reviewChangeTargetHash,submitReviewChange} from "../src/harness/review-changes.js";
import {harnessPaths} from "../src/harness/paths.js";

const checkpoints:UniversalHitlEvent[]=[
  {protocol:"video-hitl/1",status:"REVIEW_REQUIRED",phase:"needs_brief_review",checkpoint:"VIDEO_BRIEF",payload:{brief:{version:"1",status:"awaiting_user_review",objective:"Explain the product"}},message:"Review brief"},
  {protocol:"video-hitl/1",status:"REVIEW_REQUIRED",phase:"needs_script_review",checkpoint:"SCRIPT",payload:{scriptReview:{contentHash:"script-v1",upstreamHash:"brief-v1"}},message:"Review Script"},
  {protocol:"video-hitl/1",status:"REVIEW_REQUIRED",phase:"needs_storyboard_review",checkpoint:"STORYBOARD",payload:{storyboardReview:{contentHash:"storyboard-v1",upstreamHash:"script-v1"}},message:"Review Storyboard"},
  {protocol:"video-hitl/1",status:"REVIEW_REQUIRED",phase:"needs_asset_preflight_approval",checkpoint:"ASSET_PREFLIGHT",payload:{projectHash:"project-v1",assetSnapshotHash:"assets-v1",reportHash:"report-v1"},message:"Review assets"},
  {protocol:"video-hitl/1",status:"REVIEW_REQUIRED",phase:"needs_visual_review",checkpoint:"VISUAL_REVIEW",payload:{sourceHash:"renderer-v1"},message:"Review renderer"},
];

/** Creates an isolated request root for review-change persistence tests. */
async function makeRoot():Promise<string>{
  const root=await mkdtemp(join(tmpdir(),"video-review-changes-"));
  await mkdir(resolve(root,".video"),{recursive:true});
  await writeFile(resolve(root,".video/request.txt"),"A reviewable test request.","utf8");
  return root;
}

/** Creates a new reviewed subject so stale feedback no longer applies. */
function revisedEvent(event:UniversalHitlEvent):UniversalHitlEvent{
  const next=structuredClone(event);
  if(next.checkpoint==="VIDEO_BRIEF")next.payload={brief:{version:"1",status:"awaiting_user_review",objective:"Revised product objective"}};
  if(next.checkpoint==="SCRIPT")next.payload={scriptReview:{contentHash:"script-v2",upstreamHash:"brief-v1"}};
  if(next.checkpoint==="STORYBOARD")next.payload={storyboardReview:{contentHash:"storyboard-v2",upstreamHash:"script-v1"}};
  if(next.checkpoint==="ASSET_PREFLIGHT")next.payload={projectHash:"project-v1",assetSnapshotHash:"assets-v2",reportHash:"report-v2"};
  if(next.checkpoint==="VISUAL_REVIEW")next.payload={sourceHash:"renderer-v2"};
  return next;
}

test("every review checkpoint can return to authoring without approving its artifact",async()=>{
  for(const event of checkpoints){
    const root=await makeRoot();
    try{
      const request=await submitReviewChange(root,event,"Add the missing evidence before approval.");
      assert.equal(request.checkpoint,event.checkpoint);
      assert.equal(request.targetHash,reviewChangeTargetHash(event));
      assert.match(request.targetHash,/^sha256:[a-f0-9]{64}$/);
      assert.doesNotMatch(request.requestId,/^sha256:sha256:/);
      const returned=await applyPendingReviewChange(root,event);
      assert.equal(returned.status,"WORKING",event.checkpoint);
      assert.equal(returned.phase,"revision_requested",event.checkpoint);
      assert.equal((returned.payload as any).reviewChange.feedback,"Add the missing evidence before approval.",event.checkpoint);
      assert.equal(await readFile(harnessPaths(root).productionPreflightApproval,"utf8").catch(()=>null),null,event.checkpoint);
      assert.equal((await applyPendingReviewChange(root,revisedEvent(event))).status,"REVIEW_REQUIRED",event.checkpoint);
    }finally{await rm(root,{recursive:true,force:true});}
  }
});

test("visual revision stays open while the reviewed source is being edited and reopens after a new preview",async()=>{
  const root=await makeRoot(),review=checkpoints.find((event)=>event.checkpoint==="VISUAL_REVIEW")!;
  try{
    await submitReviewChange(root,review,"Fix the preview layout.");
    const edited={...review,phase:"renderer_source_changed",payload:{sourceHash:"renderer-v2",reviewedSourceHash:"renderer-v1"}};
    assert.equal((await applyPendingReviewChange(root,edited)).status,"WORKING");
    const newPreview={...review,payload:{sourceHash:"renderer-v2"}};
    assert.equal((await applyPendingReviewChange(root,newPreview)).status,"REVIEW_REQUIRED");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("asset feedback stays visible while its changed snapshot is stale",async()=>{
  const root=await makeRoot(),review=checkpoints.find((event)=>event.checkpoint==="ASSET_PREFLIGHT")!;
  try{
    await submitReviewChange(root,review,"Add the missing image captures.");
    const stale={protocol:"video-hitl/1",status:"WORKING",phase:"asset_preflight_stale",payload:{status:"STALE"},message:"Rerun preflight."} as UniversalHitlEvent;
    const returned=await applyPendingReviewChange(root,stale);
    assert.equal(returned.checkpoint,"ASSET_PREFLIGHT");
    assert.equal(returned.phase,"revision_requested");
    assert.equal((returned.payload as any).reviewChange.feedback,"Add the missing image captures.");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("review-change feedback is scoped to the current request and cannot be empty or duplicated",async()=>{
  const root=await makeRoot(),event=checkpoints.find((item)=>item.checkpoint==="ASSET_PREFLIGHT")!;
  try{
    await assert.rejects(()=>submitReviewChange(root,event,"  "),/cannot be empty/i);
    await assert.rejects(()=>submitReviewChange(root,event,"x".repeat(4001)),/4000 characters/i);
    await submitReviewChange(root,event,"Add image evidence.");
    await assert.rejects(()=>submitReviewChange(root,event,"Add another image."),/already requested/i);
    await writeFile(resolve(root,".video/request.txt"),"A different request.","utf8");
    assert.equal((await applyPendingReviewChange(root,event)).status,"REVIEW_REQUIRED");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("input-required checkpoints are not eligible for request changes",async()=>{
  const root=await makeRoot();
  try{
    const input={protocol:"video-hitl/1",status:"INPUT_REQUIRED",phase:"needs_user_input",checkpoint:"CLARIFICATION",payload:{questions:[]},message:"Answer clarification"} as UniversalHitlEvent;
    await assert.rejects(()=>submitReviewChange(root,input,"Change the answer."),/active review checkpoint/i);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("malformed Visual Review state remains visible when no matching change request exists",async()=>{
  const root=await makeRoot();
  try{
    const invalid={protocol:"video-hitl/1",status:"REVIEW_REQUIRED",phase:"invalid_renderer_review",checkpoint:"VISUAL_REVIEW",payload:{error:"Missing renderer source."},message:"Inspect renderer state."} as UniversalHitlEvent;
    assert.deepEqual(await applyPendingReviewChange(root,invalid),invalid);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("legacy double-prefixed ledger hashes normalize without dropping pending feedback",async()=>{
  const root=await makeRoot(),event=checkpoints.find((item)=>item.checkpoint==="ASSET_PREFLIGHT")!,path=harnessPaths(root).reviewChanges;
  try{
    const request=await submitReviewChange(root,event,"Keep this request while upgrading the ledger format.");
    await writeFile(path,JSON.stringify({version:"1",requests:[{...request,requestId:`sha256:${request.requestId}`,targetHash:`sha256:${request.targetHash}`}]}),"utf8");
    assert.equal((await applyPendingReviewChange(root,event)).status,"WORKING");
    const persisted=JSON.parse(await readFile(path,"utf8"));
    assert.equal(persisted.requests[0].targetHash,request.targetHash);
    assert.equal(persisted.requests[0].requestId,request.requestId);
  }finally{await rm(root,{recursive:true,force:true});}
});
