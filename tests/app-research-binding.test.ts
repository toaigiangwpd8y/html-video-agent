import assert from "node:assert/strict";
import {cp,mkdtemp,mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import test from "node:test";
import {registerApp,resolveAppWorkspace} from "../src/app-explorer/registry.js";
import {bindResearch,readResearchBinding,assertResearchBindingCurrent} from "../src/app-explorer/research-binding.js";
import {harnessPaths} from "../src/harness/paths.js";
import {archiveCurrentVideo,resetVideoWorkspace} from "../src/harness/archive.js";
import {writeJson} from "../src/core/io.js";

async function withRoot(fn:(root:string, parent:string)=>Promise<void>){
  const parent=await mkdtemp(join(tmpdir(),"research-binding-")),root=join(parent,"host");
  await mkdir(root);try{await fn(root,parent);}finally{await rm(parent,{recursive:true,force:true});}
}

async function seed(root:string){
  await registerApp(root,{id:"crm",name:"Synthetic CRM",url:"https://synthetic.invalid"});
  const dir=await resolveAppWorkspace(root,"crm");
  const explorer=await import("../packages/app-explorer/index.mjs");
  explorer.initWorkspace(dir,"Synthetic CRM","https://synthetic.invalid");
  const data=explorer.loadWorkspace(dir);
  await mkdir(join(dir,"evidence","run.synthetic"),{recursive:true});
  await writeFile(join(dir,"evidence","run.synthetic","result.txt"),"synthetic observed outcome\n","utf8");
  await writeFile(join(dir,"evidence","run.synthetic","unselected.txt"),"synthetic unselected evidence\n","utf8");
  const context={id:"member.fixture",role:"member",tenantAlias:"fixture",environment:"synthetic",date:"2026-10-17"};
  const evidenceRef="run.synthetic/result.txt";
  const scenario={id:"scenario.create",featureId:"items.create",contextId:context.id,goal:"Create a synthetic item",preconditions:[],completionCriteria:[{id:"item.saved",description:"Item appears after save",met:true,evidenceRefs:[evidenceRef]}],steps:[{id:"save",action:"Save item",observed:"Synthetic item appears",evidenceRefs:[evidenceRef]}],outcome:"success",evidenceRefs:[evidenceRef],testedContext:{contextId:context.id,role:"member",date:"2026-10-17"},history:[{executionId:"execution.create.1",scenarioId:"scenario.create",outcome:"success",evidenceRefs:[evidenceRef]}]};
  explorer.applyObservation(dir,{version:2,baseRevision:data.revision,inventory:{contexts:[context]},scenarios:[scenario],features:[{id:"items.create",title:"Create item",area:"Items",summary:"Synthetic create workflow",status:"partial",entry:{},steps:[],questions:[],nextActions:[]}]},{executionIdFactory:(id:string)=>`${id}.execution.1`});
  const paths=harnessPaths(root);await mkdir(join(root,".video"),{recursive:true});await writeFile(paths.request,"Make a short synthetic product demo.\n","utf8");
  return {dir,context,scenario,evidenceRef};
}

function selection(){return {contextIds:["member.fixture"],scenarioIds:["scenario.create"],executionIds:["scenario.create.execution.1"],evidenceRefs:["run.synthetic/result.txt"]};}
function input(revision:string,readiness:any={basis:"user_enough",runId:"run.paused",userInstructionRef:"chat:message-42"}){return {appId:"crm",knowledgeRevision:revision,selection:selection(),readiness};}
async function pauseRun(dir:string,runId:string,checkpoint?:Record<string,unknown>){
  const explorer=await import("../packages/app-explorer/index.mjs");
  const data=explorer.loadWorkspace(dir);const temp=join(dir,"checkpoint-fixture.json");
  const output={stdout:()=>{},stderr:()=>{}};
  if(checkpoint){await writeFile(temp,JSON.stringify(checkpoint),"utf8");await explorer.runKnowledgeCli(["run","checkpoint",runId,temp,"--data",dir],{cwd:dir,...output});}
  await explorer.runKnowledgeCli(["run","stop",runId,"User explicitly stopped exploration.","--data",dir],{cwd:dir,...output});
  await rm(temp,{force:true});return explorer.loadWorkspace(dir);
}

async function installExhaustedRun(dir:string,extra:(data:any,run:any,frontier:any)=>any=(data:any,run:any,frontier:any)=>({}),scope:any={contextId:"member.fixture"}){
  const explorer=await import("../packages/app-explorer/index.mjs"),started=explorer.startRun(dir,scope,null,{id:"run.exhausted"}).run;
  const data=explorer.loadWorkspace(dir),run=data.runs.find((item:any)=>item.id===started.id);
  const frontier={...(data.frontier||{}),nodes:(data.frontier.nodes||[]).map((node:any)=>({...node,discoveryState:"scanned"})),tasks:(data.frontier.tasks||[]).map((task:any)=>({...task,status:"done"}))};
  const next=extra(data,run,frontier)||{};
  explorer.applyObservation(dir,{version:2,baseRevision:data.revision,...next,runs:[{...run,status:"exhausted_in_scope",currentTaskId:null}],frontier:next.frontier||frontier});
  return explorer.loadWorkspace(dir);
}

test("V1 remains readable but cannot be bound without an immutable revision",async()=>withRoot(async(root)=>{
  await registerApp(root,{id:"legacy",name:"Legacy",url:"https://legacy.invalid"});
  const dir=await resolveAppWorkspace(root,"legacy");await cp(resolve("packages/app-explorer/examples/demo-knowledge"),dir,{recursive:true});
  await mkdir(join(root,".video"),{recursive:true});await writeFile(harnessPaths(root).request,"Synthetic video request\n","utf8");
  await assert.rejects(()=>bindResearch(root,{...input("r000001"),appId:"legacy"}),/V1|migrat|immutable/i);
}));

test("binding freezes the exact selected revision and validates context, execution and evidence identity",async()=>withRoot(async(root)=>{
  const seeded=await seed(root);const explorer=await import("../packages/app-explorer/index.mjs"),run=explorer.startRun(seeded.dir,{contextId:"member.fixture"},null,{id:"run.paused"}).run;
  await pauseRun(seeded.dir,run.id,{unknowns:["Selected workflow only confirms a synthetic visible result."]});const before=explorer.loadWorkspace(seeded.dir);
  const binding=await bindResearch(root,input(before.revision));
  assert.equal(binding.knowledgeRevision,before.revision);
  assert.equal(binding.readiness.basis,"user_enough");
  assert.equal(binding.evidenceHashes[seeded.evidenceRef].startsWith("sha256:"),true);
  await assertResearchBindingCurrent(root);
  await assert.rejects(()=>bindResearch(root,{...input(before.revision),selection:{...selection(),contextIds:["member.other"]}}),/context/i);
  await assert.rejects(()=>bindResearch(root,{...input(before.revision),selection:{...selection(),executionIds:["scenario.other.execution.1"]}}),/execution/i);
  await assert.rejects(()=>bindResearch(root,{...input(before.revision),selection:{...selection(),evidenceRefs:["run.synthetic/missing.txt"]}}),/evidence/i);
  const later=explorer.loadWorkspace(seeded.dir);
  explorer.applyObservation(seeded.dir,{version:2,baseRevision:later.revision,features:[{...later.features[0],summary:"Later unrelated revision"}]});
  await assertResearchBindingCurrent(root);
  assert.equal((await readResearchBinding(root))?.knowledgeRevision,before.revision);
  await writeFile(harnessPaths(root).request,"Changed request\n","utf8");
  await assert.rejects(()=>assertResearchBindingCurrent(root),/request|stale|hash/i);
  const bindingBytes=await readFile(harnessPaths(root).researchBinding),reviewPath=harnessPaths(root).scriptReview;
  await writeFile(reviewPath,"synthetic pending review\n","utf8");const reviewBytes=await readFile(reviewPath);
  const currentRevision=explorer.loadWorkspace(seeded.dir).revision;
  await assert.rejects(()=>bindResearch(root,{...input(currentRevision),selection:{...selection(),executionIds:["scenario.missing.execution"]}}),/execution/i);
  assert.deepEqual(await readFile(harnessPaths(root).researchBinding),bindingBytes);
  assert.deepEqual(await readFile(reviewPath),reviewBytes);
  const rebound=await bindResearch(root,input(currentRevision));assert.notEqual(rebound.requestHash,binding.requestHash);
  await assertResearchBindingCurrent(root);
}));

test("scope_complete requires authoritative exhausted run and current clear coverage",async()=>withRoot(async(root)=>{
  const seeded=await seed(root);const explorer=await import("../packages/app-explorer/index.mjs"),data=explorer.loadWorkspace(seeded.dir);
  const scopeFile=join(seeded.dir,"scope.json");await writeFile(scopeFile,JSON.stringify({appId:"crm",contextId:"member.fixture"}),"utf8");
  await explorer.runKnowledgeCli(["run","start",scopeFile,"--data",seeded.dir,"--json"],{cwd:root,stdout:()=>{},stderr:()=>{}});
  const current=explorer.loadWorkspace(seeded.dir);
  await assert.rejects(()=>bindResearch(root,input(current.revision,{basis:"scope_complete",runId:current.runs[0].id})),/scope|incomplete|ready|running/i);
}));

test("scope_complete rejects an old exhausted run when selected inventory becomes unseen",async()=>withRoot(async(root)=>{
  const seeded=await seed(root),explorer=await import("../packages/app-explorer/index.mjs");
  const current=await installExhaustedRun(seeded.dir,(data:any)=>({frontier:{...data.frontier,nodes:[...data.frontier.nodes,{id:"member.new.unseen",contextId:"member.fixture",kind:"capability",entryAliases:[],discoveryState:"unseen",taskIds:[]}]}}));
  await assert.rejects(()=>bindResearch(root,input(current.revision,{basis:"scope_complete",runId:"run.exhausted"})),/inventory_incomplete|unseen inventory|not currently exhausted/i);
}));

test("scope_complete ignores ready work owned by an unrelated role",async()=>withRoot(async(root)=>{
  const seeded=await seed(root),explorer=await import("../packages/app-explorer/index.mjs");
  const admin={id:"admin.fixture",role:"admin",tenantAlias:"fixture",environment:"synthetic",date:"2026-10-17"};
  const current=await installExhaustedRun(seeded.dir,(data:any,_run:any,completedFrontier:any)=>{
    const node={id:"admin.new.capability",contextId:admin.id,kind:"capability",entryAliases:[],discoveryState:"unseen",taskIds:["admin.new.discovery"]};
    const task={id:"admin.new.discovery",key:"admin.new.discovery",nodeId:node.id,contextId:admin.id,kind:"discover_capability",parentTaskId:null,depth:1,sequence:99,status:"queued",dependencies:[],goal:"Discover synthetic admin capability",completionCriteria:["Record visible result"],entry:{url:"https://synthetic.invalid/admin"},checkpoint:null,blocker:null,attempts:0,lastProgressAt:null};
    return {inventory:{...data.inventory,contexts:[...data.contexts,admin]},frontier:{...completedFrontier,nodes:[...completedFrontier.nodes,node],tasks:[...completedFrontier.tasks,task]}};
  });
  const binding=await bindResearch(root,input(current.revision,{basis:"scope_complete",runId:"run.exhausted"}));
  assert.equal(binding.readiness.basis,"scope_complete");
}));

test("scope_complete rejects a member-scoped run for a selection that also includes unfinished admin",async()=>withRoot(async(root)=>{
  const seeded=await seed(root);
  const admin={id:"admin.fixture",role:"admin",tenantAlias:"fixture",environment:"synthetic",date:"2026-10-17"};
  const current=await installExhaustedRun(seeded.dir,(data:any,_run:any,completedFrontier:any)=>({inventory:{...data.inventory,contexts:[...data.contexts,admin]},frontier:{...completedFrontier}}));
  const multiContext={...selection(),contextIds:["member.fixture","admin.fixture"]};
  await assert.rejects(()=>bindResearch(root,{...input(current.revision,{basis:"scope_complete",runId:"run.exhausted"}),selection:multiContext}),/run scope does not cover every selected context/i);
}));

test("a global exhausted run recomputes readiness across every selected context",async()=>withRoot(async(root)=>{
  const seeded=await seed(root);
  const admin={id:"admin.fixture",role:"admin",tenantAlias:"fixture",environment:"synthetic",date:"2026-10-17"};
  const current=await installExhaustedRun(seeded.dir,(data:any,_run:any,completedFrontier:any)=>{
    const node={id:"admin.new.capability",contextId:admin.id,kind:"capability",entryAliases:[],discoveryState:"unseen",taskIds:["admin.new.discovery"]};
    const task={id:"admin.new.discovery",key:"admin.new.discovery",nodeId:node.id,contextId:admin.id,kind:"discover_capability",parentTaskId:null,depth:1,sequence:99,status:"queued",dependencies:[],goal:"Discover synthetic admin capability",completionCriteria:["Record visible result"],entry:{url:"https://synthetic.invalid/admin"},checkpoint:null,blocker:null,attempts:0,lastProgressAt:null};
    return {inventory:{...data.inventory,contexts:[...data.contexts,admin]},frontier:{...completedFrontier,nodes:[...completedFrontier.nodes,node],tasks:[...completedFrontier.tasks,task]}};
  },{});
  const multiContext={...selection(),contextIds:["member.fixture","admin.fixture"]};
  await assert.rejects(()=>bindResearch(root,{...input(current.revision,{basis:"scope_complete",runId:"run.exhausted"}),selection:multiContext}),/ready|inventory_incomplete|not currently exhausted/i);
}));

test("binding rejects a selected execution whose tested role differs from its authorized context",async()=>withRoot(async(root)=>{
  const seeded=await seed(root),explorer=await import("../packages/app-explorer/index.mjs"),data=explorer.loadWorkspace(seeded.dir);
  const scenario={...seeded.scenario,testedContext:{contextId:seeded.context.id,role:"admin",date:"2026-10-17"}};
  explorer.applyObservation(seeded.dir,{version:2,baseRevision:data.revision,scenarios:[scenario]},{executionIdFactory:()=>"scenario.create.execution.2"});
  const run=explorer.startRun(seeded.dir,{contextId:seeded.context.id},null,{id:"run.paused"}).run;
  const paused=await pauseRun(seeded.dir,run.id,{unknowns:["Synthetic role mismatch fixture."]});
  await assert.rejects(()=>bindResearch(root,{...input(paused.revision),selection:{...selection(),executionIds:["scenario.create.execution.2"]}}),/role.context/i);
}));

test("user_enough needs explicit instruction and paused checkpoint while retaining unknowns",async()=>withRoot(async(root)=>{
  const seeded=await seed(root);const explorer=await import("../packages/app-explorer/index.mjs"),data=explorer.loadWorkspace(seeded.dir);
  const run=explorer.startRun(seeded.dir,{contextId:"member.fixture"},null,{id:"run.paused"}).run;
  const revised=await pauseRun(seeded.dir,run.id,{unknowns:["Persistence beyond current view is unverified."],openQuestions:[{id:"question.persistence",text:"Does the result survive reload?"}],openTasks:[{id:"task.persistence"}]}),beforeGaps=explorer.auditCoverage(revised).counts.gaps;
  const binding=await bindResearch(root,input(revised.revision));
  assert.equal(binding.unknowns.openTaskIds.length>0,true);
  assert.equal(binding.unknowns.openQuestions.length>=0,true);
  assert.deepEqual(binding.unknowns.checkpointUnknowns,["Persistence beyond current view is unverified."]);
  assert.deepEqual(binding.unknowns.checkpointQuestions,[{id:"question.persistence",text:"Does the result survive reload?"}]);
  assert.deepEqual(binding.unknowns.checkpointTaskIds,["task.persistence"]);
  assert.equal(JSON.stringify(binding).includes("Persistence beyond current view"),true);
  assert.equal(explorer.auditCoverage(explorer.loadWorkspace(seeded.dir)).counts.gaps,beforeGaps);
  await assert.rejects(()=>bindResearch(root,{...input(revised.revision),readiness:{basis:"user_enough",runId:"run.paused"}}),/explicit|instruction/i);
  const noCheckpoint=explorer.startRun(seeded.dir,{contextId:"member.fixture"},null,{id:"run.no-checkpoint"}).run;
  const noCheckpointData=await pauseRun(seeded.dir,noCheckpoint.id);
  await assert.rejects(()=>bindResearch(root,input(noCheckpointData.revision,{basis:"user_enough",runId:noCheckpoint.id,userInstructionRef:"chat:message-43"})),/checkpoint/i);
  const meaningful=explorer.startRun(seeded.dir,{contextId:"member.fixture"},null,{id:"run.meaningful"}).run;
  const meaningfulData=await pauseRun(seeded.dir,meaningful.id,{phase:"resume from the synthetic account overview"});
  const accepted=await bindResearch(root,input(meaningfulData.revision,{basis:"user_enough",runId:meaningful.id,userInstructionRef:"chat:message-44"}));
  assert.deepEqual(accepted.unknowns.checkpointUnknowns,[]);
}));

test("captured revision verification rejects manifest omissions, changed bytes, and extra revision files",async()=>withRoot(async(root)=>{
  const seeded=await seed(root);const explorer=await import("../packages/app-explorer/index.mjs"),run=explorer.startRun(seeded.dir,{contextId:"member.fixture"},null,{id:"run.paused"}).run;
  const data=await pauseRun(seeded.dir,run.id,{phase:"synthetic checkpoint"});await bindResearch(root,input(data.revision));
  const revisionDir=join(seeded.dir,"revisions",data.revision),manifestPath=join(revisionDir,"manifest.json"),manifest=JSON.parse(await readFile(manifestPath,"utf8")),originalRuns=await readFile(join(revisionDir,"runs.json"));
  const incomplete={...manifest,files:{...manifest.files}};delete incomplete.files["runs.json"];await writeJson(manifestPath,incomplete);
  await assert.rejects(()=>assertResearchBindingCurrent(root),/inventory mismatch/i);
  await writeJson(manifestPath,manifest);await writeFile(join(revisionDir,"runs.json"),"tampered\n","utf8");
  await assert.rejects(()=>assertResearchBindingCurrent(root),/hash mismatch/i);
  await writeFile(join(revisionDir,"runs.json"),originalRuns);
  await writeFile(join(revisionDir,"features","extra.json"),"{}\n","utf8");
  await assert.rejects(()=>assertResearchBindingCurrent(root),/inventory mismatch/i);
}));

test("archive includes only selected research evidence and init preserves unbound video behavior",async()=>withRoot(async(root)=>{
  const seeded=await seed(root);const explorer=await import("../packages/app-explorer/index.mjs"),data=explorer.loadWorkspace(seeded.dir);
  const run=explorer.startRun(seeded.dir,{contextId:"member.fixture"},null,{id:"run.paused"}).run;
  await pauseRun(seeded.dir,run.id,{unknowns:["Synthetic unknown"]});
  await bindResearch(root,input(explorer.loadWorkspace(seeded.dir).revision));
  const p=harnessPaths(root);await mkdir(p.output,{recursive:true});await writeFile(p.finalVideo,"synthetic mp4");await writeJson(p.video,{meta:{title:"Fixture",durationsInFrames:1},scenes:[]});
  const archived=await archiveCurrentVideo(root,new Date("2026-10-17T00:00:00Z"));assert.ok(archived);
  const archiveRoot=resolve(root,archived!.path);
  assert.equal(await readFile(resolve(archiveRoot,"app-research/evidence",seeded.evidenceRef),"utf8"),"synthetic observed outcome\n");
  const archivedBinding=JSON.parse(await readFile(resolve(archiveRoot,"app-research/research-binding.json"),"utf8"));
  assert.ok(archivedBinding.unknowns);assert.equal(archivedBinding.session,undefined);
  await assert.rejects(()=>readFile(resolve(archiveRoot,"app-research/evidence/run.synthetic/unselected.txt")),/ENOENT/);
  await resetVideoWorkspace(root);assert.equal(await readResearchBinding(root),null);
}));
