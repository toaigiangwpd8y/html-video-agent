import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {getReconciliationContext} from "../src/harness/reconciliation.js";
import {reviewSelectedRenderer} from "../src/harness/renderer.js";

test("renderer review refuses a pending revision before lint or preview can run",async()=>{
  const root=await mkdtemp(resolve(tmpdir(),"video-review-reconcile-"));
  try{
    await mkdir(resolve(root,".video"));
    await writeFile(resolve(root,".video/reopen-ledger.json"),JSON.stringify({version:"1",pending:["SCRIPT"],records:[]}));
    await assert.rejects(()=>reviewSelectedRenderer(root),/submit a complete reconciliation/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("reconciliation reports added and removed scenes without hashing missing values",async()=>{
  const root=await mkdtemp(resolve(tmpdir(),"video-reconcile-scenes-"));
  try{
    await mkdir(resolve(root,".video"));
    const prior=resolve(root,"prior-video.json"),current=resolve(root,"video.json");
    const save=async(path:string,value:unknown)=>writeFile(path,JSON.stringify(value));
    await save(prior,{scenes:[{id:"removed"},{id:"same",screenText:"A"},{id:"changed",screenText:"A"}]});
    await save(current,{scenes:[{id:"added"},{id:"same",screenText:"A"},{id:"changed",screenText:"B"}]});
    await save(resolve(root,".video/reopen-ledger.json"),{version:"1",pending:[],records:[{checkpoint:"STORYBOARD",snapshots:{[current]:prior}}]});
    assert.deepEqual((await getReconciliationContext(root)).affectedSceneIds,["removed","changed","added"]);
    await save(resolve(root,".video/reopen-ledger.json"),{version:"1",pending:[],records:[{checkpoint:"STORYBOARD",snapshots:{}}]});
    assert.deepEqual((await getReconciliationContext(root)).affectedSceneIds,["added","same","changed"]);
  }finally{await rm(root,{recursive:true,force:true});}
});
