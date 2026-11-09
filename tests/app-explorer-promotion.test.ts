import assert from "node:assert/strict";
import {stat as fileStat,mkdtemp,mkdir,readFile,rm,writeFile,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
import test from "node:test";
import * as explorer from "../packages/app-explorer/index.mjs";
import {registerApp,resolveAppWorkspace} from "../src/app-explorer/registry.js";
import {bindResearch,researchBindingDigest} from "../src/app-explorer/research-binding.js";
import {promoteExplorerEvidence} from "../src/app-explorer/promote.js";
import {harnessPaths} from "../src/harness/paths.js";
import {archiveCurrentVideo} from "../src/harness/archive.js";
import {sha256} from "../src/core/hash.js";
import {writeJson} from "../src/core/io.js";
import {handleExplorerCli} from "../src/app-explorer/cli.js";
import {runProductionAssetPreflight,productionAssetPreflightStatus} from "../src/harness/production-preflight-hitl.js";
import {videoBriefTemplate} from "../src/harness/preproduction-hitl.js";
import {productionAssetPreflight} from "../src/authoring/preflight.js";
import type {VideoProject} from "../src/core/types.js";

const png=Buffer.from(Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137]));
const jpg=Buffer.from(Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,1]));
const webp=Buffer.from("RIFF\x04\x00\x00\x00WEBPVP8 ","binary");
const bytesHash=(bytes:Uint8Array)=>`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const sameBytes=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
const project:VideoProject={meta:{title:"Synthetic fixture",width:1280,height:720,durationsInFrames:90,fps:30,theme:{palette:["#111827","#2563EB","#F8FAFC"],font:"Arial"},constraints:{style:"local fixture",disallowed:[],motionTone:"direct"}},scenes:[{id:"scene-1",durationInFrames:90,screenText:"Synthetic",visualConcept:"Synthetic fixture state."}]};
async function withRoot(fn:(root:string)=>Promise<void>){const parent=await mkdtemp(join(tmpdir(),"explorer-promotion-")),root=join(parent,"host");await mkdir(root);try{await fn(root);}finally{await rm(parent,{recursive:true,force:true});}}
async function canonical(root:string){
  const p=harnessPaths(root),request="Synthetic app exploration promotion fixture.\n";await mkdir(join(root,".video"),{recursive:true});await mkdir(join(root,"assets"),{recursive:true});await writeJson(join(root,"assets/manifest.json"),{version:"1",assets:[]});await writeFile(p.request,request,"utf8");await writeJson(p.video,project);
  const requestHash=sha256(request),projectHash=sha256(JSON.stringify(project));await writeJson(p.projectState,{version:"1",projectId:"fixture",revision:1,requestHash,projectHash});
  await writeJson(p.storyboardReview,{version:"1",requestHash,status:"approved",approvedBy:"HUMAN",contentHash:projectHash,upstreamHash:"sha256:synthetic"});
}
async function seed(root:string){
  await registerApp(root,{id:"crm",name:"Synthetic CRM",url:"https://synthetic.invalid"});const dir=await resolveAppWorkspace(root,"crm");explorer.initWorkspace(dir,"Synthetic CRM","https://synthetic.invalid");
  const data=explorer.loadWorkspace(dir),context={id:"member.fixture",role:"member",tenantAlias:"fixture",environment:"synthetic",date:"2026-10-17"};
  await mkdir(join(dir,"evidence","run.synthetic"),{recursive:true});await writeFile(join(dir,"evidence/run.synthetic/image.png"),png);await writeFile(join(dir,"evidence/run.synthetic/bad.jpg"),png);await writeFile(join(dir,"evidence/run.synthetic/still.jpg"),jpg);await writeFile(join(dir,"evidence/run.synthetic/still.webp"),webp);await writeFile(join(dir,"evidence/run.synthetic/linked.png"),png);await writeFile(join(dir,"evidence/run.synthetic/missing.png"),png);
  const ref="run.synthetic/image.png",allEvidence=[ref,"run.synthetic/bad.jpg","run.synthetic/still.jpg","run.synthetic/still.webp","run.synthetic/linked.png","run.synthetic/missing.png"],scenario={id:"scenario.view",featureId:"items.view",contextId:context.id,goal:"View one synthetic item",preconditions:[],completionCriteria:[{id:"item.visible",description:"Item is visible",met:true,evidenceRefs:allEvidence}],steps:[{id:"view",action:"View item",observed:"Synthetic item is visible",evidenceRefs:allEvidence}],outcome:"success",evidenceRefs:allEvidence,testedContext:{contextId:context.id,role:"member",date:"2026-10-17"},history:[{executionId:"execution.view.1",scenarioId:"scenario.view",outcome:"success",evidenceRefs:allEvidence}]};
  explorer.applyObservation(dir,{version:2,baseRevision:data.revision,inventory:{contexts:[context]},scenarios:[scenario],features:[{id:"items.view",title:"View item",area:"Items",summary:"Synthetic view workflow",status:"partial",entry:{},steps:[],questions:[],nextActions:[]}]},{executionIdFactory:()=>"execution.view.1"});
  const run=explorer.startRun(dir,{contextId:context.id},null,{id:"run.paused"}).run;
  const checkpointFile=join(dir,"checkpoint.json");await writeFile(checkpointFile,JSON.stringify({phase:"synthetic checkpoint"}));await explorer.runKnowledgeCli(["run","checkpoint",run.id,checkpointFile,"--data",dir],{cwd:dir,stdout:()=>{},stderr:()=>{}});await explorer.runKnowledgeCli(["run","stop",run.id,"Synthetic user-enough fixture.","--data",dir],{cwd:dir,stdout:()=>{},stderr:()=>{}});await rm(checkpointFile,{force:true});
  const revision=explorer.loadWorkspace(dir).revision;await canonical(root);const input:{appId:string;knowledgeRevision:string;selection:{contextIds:string[];scenarioIds:string[];executionIds:string[];evidenceRefs:string[]};readiness:{basis:"user_enough";runId:string;userInstructionRef:string}}={appId:"crm",knowledgeRevision:revision,selection:{contextIds:[context.id],scenarioIds:["scenario.view"],executionIds:["execution.view.1"],evidenceRefs:allEvidence.filter(ref=>!ref.endsWith("missing.png"))},readiness:{basis:"user_enough",runId:"run.paused",userInstructionRef:"chat:synthetic"}};await bindResearch(root,input);return {dir,ref,input};
}
function promotion(input:{appId:string;knowledgeRevision:string;selection:{evidenceRefs:string[]}},overrides:Record<string,unknown>={}){return {appId:input.appId,revision:input.knowledgeRevision,contextId:"member.fixture",featureId:"items.view",scenarioId:"scenario.view",executionId:"execution.view.1",evidenceRef:input.selection.evidenceRefs[0]!,assetId:"still-one",sceneId:"scene-1",role:"product-ui-still",rights:{rights:"Synthetic fixture license",permittedUse:"Synthetic local test"},...overrides} as any;}

test("Explorer promotion validates image signatures, binds origin, and makes identical retries idempotent",async()=>withRoot(async(root)=>{
  const seeded=await seed(root),result=await promoteExplorerEvidence(root,promotion(seeded.input));assert.equal(result.asset.source,"app-explorer");assert.equal(result.asset.researchEvidence?.sha256,bytesHash(png));assert.equal(result.asset.researchEvidence?.knowledgeRevision,seeded.input.knowledgeRevision);assert.equal(result.asset.publicPath.startsWith("/assets/app-explorer/"),true);assert.equal(result.idempotent,false);
  const retry=await promoteExplorerEvidence(root,promotion(seeded.input));assert.equal(retry.idempotent,true);assert.equal(sameBytes(await readFile(join(root,retry.asset.publicPath.slice(1))),png),true);
  const registry=JSON.parse(await readFile(harnessPaths(root).assetManifest,"utf8")),runtime=await productionAssetPreflight(project,{version:"1",assets:registry.assets},root);assert.equal(runtime.report.valid,true,JSON.stringify(runtime.report.issues));const malformed={...registry.assets[0],researchEvidence:{...registry.assets[0].researchEvidence,sha256:"bad"}};const invalid=await productionAssetPreflight(project,{version:"1",assets:[malformed]},root);assert.ok(invalid.report.issues.some((issue:any)=>issue.code==="ASSET_RESEARCH_ORIGIN_INVALID"));
  await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"still-one",evidenceRef:"run.synthetic/still.jpg"})),/conflict|origin|bytes/i);
  await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"same-role",role:"product-ui-still"})),/conflict|already has/i);
  await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"unknown-scene",sceneId:"scene-unknown"})),/scene/i);
  await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"unselected-evidence",evidenceRef:"run.synthetic/missing.png"})),/research|binding/i);
  await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"bad-signature",evidenceRef:"run.synthetic/bad.jpg"})),/signature|image|type/i);
  const jpeg=await promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"jpeg-still",evidenceRef:"run.synthetic/still.jpg",role:"product-ui-jpeg"}));assert.equal(jpeg.asset.type,"image/jpeg");
  const webpAsset=await promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"webp-still",evidenceRef:"run.synthetic/still.webp",role:"product-ui-webp"}));assert.equal(webpAsset.asset.type,"image/webp");
  const cliSelection=promotion(seeded.input,{assetId:"cli-still",evidenceRef:"run.synthetic/linked.png",role:"product-ui-cli"});await writeJson(join(root,"selection.json"),cliSelection);const cliOutput:any[]=[];assert.equal(await handleExplorerCli(root,["evidence","materialize","selection.json","--app","crm"],value=>cliOutput.push(value)),0);assert.equal((cliOutput[0] as any).asset.source,"app-explorer");
  await assert.rejects(()=>fileStat(join(root,".video/web-capture/runs")),"promotion must not fabricate CaptureRunResult artifacts");
}));

test("concurrent Explorer promotions serialize manifest updates without losing either asset",async()=>withRoot(async(root)=>{
  const seeded=await seed(root),first=promotion(seeded.input,{assetId:"parallel-one",role:"product-ui-first"}),second=promotion(seeded.input,{assetId:"parallel-two",role:"product-ui-second"});
  const results=await Promise.all([promoteExplorerEvidence(root,first),promoteExplorerEvidence(root,second)]);assert.equal(results.every(result=>!result.idempotent),true);
  const manifest=JSON.parse(await readFile(harnessPaths(root).assetManifest,"utf8"));assert.deepEqual(manifest.assets.map((item:any)=>item.id).sort(),["parallel-one","parallel-two"]);
  for(const result of results)assert.equal(sameBytes(await readFile(join(root,result.asset.publicPath.slice(1))),png),true);
}));

test("Explorer promotion rejects tampered or unsafe evidence, mismatched execution, and missing rights without side effects",async()=>withRoot(async(root)=>{
  const seeded=await seed(root),manifestPath=harnessPaths(root).assetManifest;await mkdir(join(root,"assets"),{recursive:true});await writeJson(manifestPath,{version:"1",assets:[]});
  await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"no-rights",rights:{permittedUse:"tests"}})),/rights|license/i);
  await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"no-permitted-use",rights:{rights:"Synthetic rights"}})),/rights|permittedUse/i);
  await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"wrong-execution",executionId:"execution.other"})),/execution|selected|revision/i);
  await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"traversal",evidenceRef:"../image.png"})),/unsafe|evidence|path/i);
  const previous=explorer.loadWorkspace(seeded.dir),scenario=previous.scenarios.find((item:any)=>item.id==="scenario.view");explorer.applyObservation(seeded.dir,{version:2,baseRevision:previous.revision,scenarios:[{...scenario}]},{executionIdFactory:()=>"execution.view.missing"});const laterRevision=explorer.loadWorkspace(seeded.dir).revision;
  await rm(join(seeded.dir,"evidence/run.synthetic/missing.png"));await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{revision:laterRevision,executionId:"execution.view.missing",assetId:"missing",evidenceRef:"run.synthetic/missing.png"})),/missing|ENOENT|file/i);
  const linked=join(seeded.dir,"evidence/run.synthetic/linked.png"),linkedBytes=await readFile(linked);await rm(linked);let symlinkSupported=true;try{await symlink(join(seeded.dir,"evidence/run.synthetic/still.jpg"),linked);}catch(error){symlinkSupported=false;if((error as any).code!=="EPERM"&&(error as any).code!=="EACCES")throw error;await writeFile(linked,linkedBytes);}
  if(symlinkSupported)await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"symlink" ,evidenceRef:"run.synthetic/linked.png"})),/symlink|confined|changed|path/i);
  if(symlinkSupported){await rm(linked);await writeFile(linked,linkedBytes);}
  const projectBefore=await readFile(harnessPaths(root).video),sourceBefore=await readFile(join(seeded.dir,"evidence/run.synthetic/still.webp"));
  await writeJson(harnessPaths(root).clarification,{version:"2",requestHash:sha256(await readFile(harnessPaths(root).request,"utf8")),status:"awaiting_user",questions:[{id:"q",prompt:"Synthetic pending review"}]});
  await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"pending-review"})),/HITL|user action|blocked/i);
  const requestHash=sha256(await readFile(harnessPaths(root).request,"utf8"));await writeJson(harnessPaths(root).clarification,{version:"2",requestHash,status:"resolved",decisions:[{id:"objective",label:"Objective",value:"Demonstrate synthetic state",source:"CONTEXT_INFERRED",confidence:.9,materiality:"high",reason:"Synthetic fixture decision."}],questions:[],answers:[]});
  const brief=await videoBriefTemplate(root);await writeJson(harnessPaths(root).videoBrief,{...brief,status:"awaiting_user_review",objective:"Demonstrate the synthetic item view.",audience:"Synthetic fixture audience.",aspectRatio:"16:9",language:"English",angle:"A synthetic user views one item.",tone:"Direct",pacing:"Steady",rendererRecommendation:{renderer:"remotion",rationale:"Synthetic fixture choice.",alternativeTradeoff:"Synthetic fixture tradeoff."}});
  await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"pending-brief-review"})),/HITL|user action|blocked/i);
  await rm(harnessPaths(root).videoBrief);await rm(harnessPaths(root).clarification);
  assert.deepEqual(await readFile(harnessPaths(root).video),projectBefore);assert.deepEqual(await readFile(join(seeded.dir,"evidence/run.synthetic/still.webp")),sourceBefore);
  await writeFile(join(seeded.dir,"evidence",seeded.ref),"changed bytes");
  await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{assetId:"tampered"})),/evidence|changed|hash/i);
  assert.deepEqual(JSON.parse(await readFile(manifestPath,"utf8")).assets,[]);
}));

test("a later Explorer revision adds an immutable image without changing frozen research semantics and archives its origin",async()=>withRoot(async(root)=>{
  const seeded=await seed(root),bindingHash=await researchBindingDigest(root);await writeFile(join(root,".video/video-brief.json"),"frozen synthetic Brief");await writeFile(join(root,".video/script.md"),"frozen synthetic Script");const brief=await readFile(join(root,".video/video-brief.json")),script=await readFile(join(root,".video/script.md"));await runProductionAssetPreflight(root);await mkdir(join(seeded.dir,"evidence","run.later"),{recursive:true});await writeFile(join(seeded.dir,"evidence/run.later/still.webp"),webp);
  const current=explorer.loadWorkspace(seeded.dir),scenario=current.scenarios.find((item:any)=>item.id==="scenario.view");const laterEvidence="run.later/still.webp";const laterScenario={...scenario,evidenceRefs:[...scenario.evidenceRefs,laterEvidence],steps:scenario.steps.map((step:any)=>({...step,evidenceRefs:[...step.evidenceRefs,laterEvidence]})),completionCriteria:scenario.completionCriteria.map((item:any)=>({...item,evidenceRefs:[...item.evidenceRefs,laterEvidence]}))};explorer.applyObservation(seeded.dir,{version:2,baseRevision:current.revision,features:[{...current.features[0],summary:"Unrelated later observation"}],scenarios:[laterScenario]},{executionIdFactory:()=>"execution.view.2"});const later=explorer.loadWorkspace(seeded.dir),laterRevision=later.revision;assert.ok(later.scenarios.find((item:any)=>item.id==="scenario.view").history.find((item:any)=>item.executionId==="execution.view.2").evidenceRefs.includes(laterEvidence));
  const result=await promoteExplorerEvidence(root,promotion(seeded.input,{revision:laterRevision,executionId:"execution.view.2",evidenceRef:"run.later/still.webp",expectedSourceSha256:bytesHash(webp),assetId:"later-still",role:"product-detail-still"}));assert.equal(result.asset.researchEvidence?.knowledgeRevision,laterRevision);assert.equal(await researchBindingDigest(root),bindingHash);assert.deepEqual(await readFile(join(root,".video/video-brief.json")),brief);assert.deepEqual(await readFile(join(root,".video/script.md")),script);assert.equal((await productionAssetPreflightStatus(root,true)).status,"STALE");
  await mkdir(join(root,"output"),{recursive:true});await writeFile(harnessPaths(root).finalVideo,"synthetic final");const archive=await archiveCurrentVideo(root,new Date("2026-10-17T00:00:00Z"));assert.ok(archive);const archived=join(root,archive!.path,"assets",result.asset.publicPath.slice("/assets/".length));assert.equal(sameBytes(await readFile(archived),webp),true);
  const origin=JSON.parse(await readFile(join(root,archive!.path,"assets/manifest.json"),"utf8")).assets.find((item:any)=>item.id==="later-still").researchEvidence;assert.equal(origin.knowledgeRevision,laterRevision);assert.equal(origin.sha256,bytesHash(webp));
}));

test("later Explorer evidence requires the selected byte hash and rejects tampering before any asset mutation",async()=>withRoot(async(root)=>{
  const seeded=await seed(root),manifestPath=harnessPaths(root).assetManifest,bindingHash=await researchBindingDigest(root);await writeJson(manifestPath,{version:"1",assets:[]});await mkdir(join(seeded.dir,"evidence","run.later"),{recursive:true});await writeFile(join(seeded.dir,"evidence/run.later/still.webp"),webp);
  const current=explorer.loadWorkspace(seeded.dir),scenario=current.scenarios.find((item:any)=>item.id==="scenario.view"),ref="run.later/still.webp",laterScenario={...scenario,evidenceRefs:[...scenario.evidenceRefs,ref],steps:scenario.steps.map((step:any)=>({...step,evidenceRefs:[...step.evidenceRefs,ref]})),completionCriteria:scenario.completionCriteria.map((item:any)=>({...item,evidenceRefs:[...item.evidenceRefs,ref]}))};
  explorer.applyObservation(seeded.dir,{version:2,baseRevision:current.revision,scenarios:[laterScenario]},{executionIdFactory:()=>"execution.view.2"});const revision=explorer.loadWorkspace(seeded.dir).revision,selection=promotion(seeded.input,{revision,executionId:"execution.view.2",evidenceRef:ref,assetId:"tamper-later",role:"product-detail-still"});
  await assert.rejects(()=>promoteExplorerEvidence(root,selection),/expectedSourceSha256|selected byte hash/i);
  const changedWebp=Buffer.from(webp);changedWebp[4]=0x05;await writeFile(join(seeded.dir,"evidence",ref),changedWebp);selection.expectedSourceSha256=bytesHash(webp);
  await assert.rejects(()=>promoteExplorerEvidence(root,selection),/expectedSourceSha|selected bytes|hash/i);
  assert.deepEqual(JSON.parse(await readFile(manifestPath,"utf8")).assets,[]);assert.equal(await researchBindingDigest(root),bindingHash);assert.equal(await fileStat(join(root,"assets/app-explorer/tamper-later" )).then(()=>true,()=>false),false);
}));

test("Explorer promotion rejects a scenario role that disagrees with the selected context",async()=>withRoot(async(root)=>{
  const seeded=await seed(root),current=explorer.loadWorkspace(seeded.dir),scenario=current.scenarios.find((item:any)=>item.id==="scenario.view"),mismatch={...scenario,testedContext:{...scenario.testedContext,role:"admin"}};
  explorer.applyObservation(seeded.dir,{version:2,baseRevision:current.revision,scenarios:[mismatch]},{executionIdFactory:()=>"execution.view.role-mismatch"});const revision=explorer.loadWorkspace(seeded.dir).revision;
  await assert.rejects(()=>promoteExplorerEvidence(root,promotion(seeded.input,{revision,executionId:"execution.view.role-mismatch",expectedSourceSha256:bytesHash(png),assetId:"role-mismatch"})),/context|role/i);
  assert.deepEqual(JSON.parse(await readFile(harnessPaths(root).assetManifest,"utf8")).assets,[]);
}));
