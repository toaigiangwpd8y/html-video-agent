import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {clarificationHash,clarificationStatus,clarificationTemplate,commitClarification,resolveClarification} from "../src/harness/clarification.js";
import {approveScriptReview,approveStoryboardReview,approveVideoBrief,assertScriptApproved,commitScriptReview,commitStoryboardReview,commitVideoBrief,preproductionHitlStatus,reviseScriptReview,reviseStoryboardReview,scriptUpstreamHash,videoBriefTemplate} from "../src/harness/preproduction-hitl.js";
import {commitProductionProfile,loadProductionProfile,productionProfileTemplate} from "../src/harness/production-profile.js";
import {advanceProjectState,loadProjectState} from "../src/harness/project-state.js";
import {invalidateProjectDerived,persistRevision,validateCanonicalProject} from "../src/harness/canonical-promotion.js";
import {harnessPaths} from "../src/harness/paths.js";
import {assertRequestMutable} from "../src/harness/request.js";
import {readJson,writeJson} from "../src/core/io.js";
import type {VideoProject} from "../src/core/types.js";
import {universalHitlStatus} from "../src/harness/hitl-protocol.js";
import {withAvailableRemotion} from "./helpers/renderer-fixtures.js";
import {synthesizeNarration} from "../src/tts/cache.js";
import {reopenCheckpoint} from "../src/harness/reopen.js";
import {getReconciliationContext,submitReconciliation} from "../src/harness/reconciliation.js";
import {bindResearch,researchBindingDigest} from "../src/app-explorer/research-binding.js";
import {registerApp,resolveAppWorkspace} from "../src/app-explorer/registry.js";

const root=process.cwd();
const request="Create a vertical Vietnamese video explaining this repository.";
const sha256=(value:string)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;
const testRendererRecommendation={renderer:"remotion" as const,rationale:"Remotion fits a deterministic, scene-timed technical explainer.",alternativeTradeoff:"HyperFrames could simplify markup authoring but offers less direct control over frame-based React compositions."};

async function base(tmp:string){
  await rm(tmp,{recursive:true,force:true});
  await mkdir(resolve(tmp,".video/candidates"),{recursive:true});
  await writeFile(resolve(tmp,".video/request.txt"),request,"utf8");
}

async function resolvedAssessment(tmp:string){
  if(await readFile(resolve(tmp,".video/clarification.json"),"utf8").catch(()=>null))return;
  const resolved={version:"2",requestHash:sha256(request),status:"resolved",decisions:[{id:"objective",label:"Primary video objective",value:"Explain the repository workflow",source:"CONTEXT_INFERRED",confidence:.95,materiality:"high",reason:"The request states a concrete explanatory objective, so no user question is required.",alternatives:[]}],questions:[],answers:[]};
  await writeFile(resolve(tmp,".video/candidates/clarification.json"),JSON.stringify(resolved),"utf8");
  await commitClarification(tmp,".video/candidates/clarification.json");
}

async function setupProfileCatalog(tmp:string,id="technical-explainer"){
  const ids=id==="neutral"?["neutral"]:["neutral",id];
  for(const profileId of ids)await mkdir(resolve(tmp,".agents/skills/video-types",profileId),{recursive:true});
  await writeFile(resolve(tmp,".agents/skills/video-types/catalog.json"),JSON.stringify({version:"1",profiles:ids.map(profileId=>({id:profileId,description:"Test profile"}))}),"utf8");
  for(const profileId of ids)await writeFile(resolve(tmp,".agents/skills/video-types",profileId,"SKILL.md"),`# ${profileId}\n\n## Success Definition\nSatisfy the exact request.\n`,`utf8`);
}

async function approvedBrief(tmp:string){
  await resolvedAssessment(tmp);
  const t=await videoBriefTemplate(tmp);
  const brief={...t,objective:"Explain the repository workflow",audience:"Software engineering students",durationSeconds:30,aspectRatio:"9:16",language:"Vietnamese",angle:"Request to structured project to Remotion render",tone:"Clear and technical",pacing:"Fast but readable",mustInclude:["Repository flow"],mustAvoid:["Unsupported capabilities"],sourceNotes:["Repository docs are authoritative"],rendererRecommendation:testRendererRecommendation};
  await writeFile(resolve(tmp,".video/candidates/brief.json"),JSON.stringify(brief),"utf8");
  await commitVideoBrief(tmp,".video/candidates/brief.json");
  return withAvailableRemotion(tmp,()=>approveVideoBrief(tmp,"HUMAN","remotion"));
}

async function committedProfile(tmp:string){
  await setupProfileCatalog(tmp);
  const candidate=await productionProfileTemplate(tmp);
  candidate.primary={id:"technical-explainer",source:"MODEL_INFERRED",reason:"The approved brief asks for a technical explanation of a software repository."};
  await writeFile(resolve(tmp,".video/candidates/profile.json"),JSON.stringify(candidate),"utf8");
  return commitProductionProfile(tmp,".video/candidates/profile.json");
}

async function approvedScript(tmp:string){
  await approvedBrief(tmp);await committedProfile(tmp);
  await writeFile(resolve(tmp,".video/candidates/script.md"),"This is a complete reviewable script with enough content to pass the minimum length requirement for the checkpoint.","utf8");
  await synthesizeNarration(tmp,{version:"1",scriptFile:".video/candidates/script.md",language:"en",segments:[]});
  await commitScriptReview(tmp,".video/candidates/script.md");
  await approveScriptReview(tmp,"HUMAN");
}

function project():VideoProject{return {meta:{title:"Repository explainer",width:1080,height:1920,durationsInFrames:900,fps:30,theme:{palette:["#101820","#FEE715"],font:"Inter"},constraints:{style:"Clear technical explainer",disallowed:["Unsupported capabilities"],motionTone:"Measured"}},scenes:[{id:"scene-1",durationInFrames:900,screenText:"Repository workflow",visualConcept:"Show the request becoming a rendered video through explicit production states."}]};}

test("clear request requires a resolved clarification assessment, which may contain zero questions",async()=>{
  const tmp=resolve(root,"tests/.tmp-clear-brief");await base(tmp);
  const status=await preproductionHitlStatus(tmp);assert.equal(status.phase,"needs_clarification_assessment");
  await assert.rejects(()=>videoBriefTemplate(tmp),/clarification (assessment is required|artifact not found)/i);
  assert.equal(await readFile(resolve(tmp,".video/clarification.json"),"utf8").catch(()=>null),null);
  await resolvedAssessment(tmp);const t=await videoBriefTemplate(tmp);
  const brief={...t,objective:"Explain the repository",audience:"Developers",durationSeconds:30,aspectRatio:"9:16",language:"Vietnamese",angle:"Architecture flow",tone:"Clear",pacing:"Readable",mustInclude:[],mustAvoid:[],sourceNotes:[],rendererRecommendation:testRendererRecommendation};
  await writeFile(resolve(tmp,".video/candidates/brief.json"),JSON.stringify(brief),"utf8");await commitVideoBrief(tmp,".video/candidates/brief.json");
  assert.equal((await preproductionHitlStatus(tmp)).phase,"needs_brief_review");await rm(tmp,{recursive:true,force:true});
});

test("pending clarification blocks Video Brief and resolved clarification unlocks it",async()=>{
  const tmp=resolve(root,"tests/.tmp-optional-clarification");await base(tmp);
  const pending={version:"2",requestHash:sha256(request),status:"awaiting_user",decisions:[{id:"audience",label:"Audience",source:"UNRESOLVED",confidence:.2,materiality:"high",reason:"Developer versus newcomer audience changes depth and terminology.",alternatives:["developers","newcomers"]}],questions:[{id:"q1",question:"Which audience should this prioritize?",resolves:["audience"],options:["developers","newcomers"]}],answers:[]};
  await writeFile(resolve(tmp,".video/candidates/clarification.json"),JSON.stringify(pending),"utf8");await commitClarification(tmp,".video/candidates/clarification.json");
  await assert.rejects(()=>videoBriefTemplate(tmp),/NEEDS_USER_INPUT/);assert.equal((await universalHitlStatus(tmp)).status,"INPUT_REQUIRED");
  await writeFile(resolve(tmp,".video/candidates/answers.json"),JSON.stringify({answers:[{questionId:"q1",answer:"developers",answeredBy:"HUMAN"}]}),"utf8");await resolveClarification(tmp,".video/candidates/answers.json");
  assert.equal((await videoBriefTemplate(tmp)).requestHash,sha256(request));await rm(tmp,{recursive:true,force:true});
});

test("clarification template supports a resolved zero-question assessment",async()=>{
  const tmp=resolve(root,"tests/.tmp-clarification-template");await base(tmp);const template=await clarificationTemplate(tmp);assert.equal(template.status,"resolved");assert.equal(template.questions.length,0);assert.equal(template.answers.length,0);assert.equal(template.decisions[0].materiality,"high");assert.match(template.decisions[0].reason,/REPLACE/i);await writeJson(resolve(tmp,".video/candidates/clarification.json"),template);await assert.rejects(()=>commitClarification(tmp,".video/candidates/clarification.json"),/concrete|REPLACE|explain/i);await resolvedAssessment(tmp);assert.equal((await preproductionHitlStatus(tmp)).phase,"needs_video_brief");await rm(tmp,{recursive:true,force:true});
});

test("production profile always binds the resolved clarification assessment",async()=>{
  const tmp=resolve(root,"tests/.tmp-profile-clarification-required");await base(tmp);await approvedBrief(tmp);await setupProfileCatalog(tmp);
  const template=await productionProfileTemplate(tmp);template.primary={id:"technical-explainer",source:"MODEL_INFERRED",reason:"The approved brief asks for a technical explanation."};assert.equal(template.clarificationApplied?.clarificationHash,await clarificationHash(tmp));
  const missing={...template};delete missing.clarificationApplied;await writeFile(resolve(tmp,".video/candidates/missing.json"),JSON.stringify(missing),"utf8");await assert.rejects(()=>commitProductionProfile(tmp,".video/candidates/missing.json"),/clarificationApplied/);await rm(tmp,{recursive:true,force:true});
});

test("changing a selected profile skill makes the frozen Production Profile stale without rebinding it",async()=>{
  const tmp=resolve(root,"tests/.tmp-profile-skill-stale");await base(tmp);await approvedBrief(tmp);
  const profile=await committedProfile(tmp),profilePath=resolve(tmp,".video/production-profile.json"),profileBytes=await readFile(profilePath,"utf8");
  const skillPath=resolve(tmp,".agents/skills/video-types",profile.primary.id,"SKILL.md");
  await writeFile(skillPath,"# technical-explainer\n\n## Success Definition\nChanged after profile freeze.\n","utf8");
  await assert.rejects(()=>loadProductionProfile(tmp),/skill changed after the production profile was frozen/i);
  assert.equal(await readFile(profilePath,"utf8"),profileBytes,"stale detection must not rebind or rewrite the frozen profile");
  await rm(tmp,{recursive:true,force:true});
});

test("production profile requires exact clarification binding when clarification occurred",async()=>{
  const tmp=resolve(root,"tests/.tmp-profile-clarification-binding");await base(tmp);
  const resolved={version:"2",requestHash:sha256(request),status:"resolved",decisions:[{id:"audience",label:"Audience",value:"developers",source:"USER_EXPLICIT",confidence:1,materiality:"high",reason:"The user supplied the audience in the clarification answer.",alternatives:["newcomers"]}],questions:[{id:"q1",question:"Which audience?",resolves:["audience"],options:["developers","newcomers"]}],answers:[{questionId:"q1",answer:"developers",answeredBy:"HUMAN"}]};
  await writeFile(resolve(tmp,".video/candidates/clarification.json"),JSON.stringify(resolved),"utf8");await commitClarification(tmp,".video/candidates/clarification.json");await approvedBrief(tmp);await setupProfileCatalog(tmp);
  const template=await productionProfileTemplate(tmp);template.primary={id:"technical-explainer",source:"MODEL_INFERRED",reason:"The approved brief asks for a technical explanation."};assert.equal(template.clarificationApplied?.clarificationHash,await clarificationHash(tmp));
  const missing={...template};delete missing.clarificationApplied;await writeFile(resolve(tmp,".video/candidates/missing.json"),JSON.stringify(missing),"utf8");await assert.rejects(()=>commitProductionProfile(tmp,".video/candidates/missing.json"),/clarificationApplied/);
  await rm(tmp,{recursive:true,force:true});
});

test("Script review binds request, approved brief, and frozen profile without extra exploratory artifacts",async()=>{
  const tmp=resolve(root,"tests/.tmp-script-upstream");await base(tmp);await approvedBrief(tmp);await committedProfile(tmp);
  await writeFile(resolve(tmp,".video/candidates/script.md"),"This is a complete reviewable script with enough content to pass the minimum length requirement for the checkpoint.","utf8");await synthesizeNarration(tmp,{version:"1",scriptFile:".video/candidates/script.md",language:"en",segments:[]});const review=await commitScriptReview(tmp,".video/candidates/script.md");assert.equal(review.upstreamHash,await scriptUpstreamHash(tmp));
  await assert.rejects(()=>assertScriptApproved(tmp),/NEEDS_USER_REVIEW/);await approveScriptReview(tmp,"HUMAN");await assertScriptApproved(tmp);
  await writeFile(resolve(tmp,".video/request.txt"),"Changed request after script review.","utf8");await assert.rejects(()=>assertScriptApproved(tmp),/different request|modified|upstream/i);await rm(tmp,{recursive:true,force:true});
});

test("research binding fingerprints Brief and Script review provenance and a successful rebind leaves reviews intact",async()=>{
  const tmp=resolve(root,"tests/.tmp-research-fingerprint");await base(tmp);
  const explorer=await import("../packages/app-explorer/index.mjs");
  await registerApp(tmp,{id:"crm",name:"Synthetic CRM",url:"https://synthetic.invalid"});
  const workspace=await resolveAppWorkspace(tmp,"crm");explorer.initWorkspace(workspace,"Synthetic CRM","https://synthetic.invalid");
  let data=explorer.loadWorkspace(workspace);const context={id:"member.fixture",role:"member",tenantAlias:"fixture",environment:"synthetic",date:"2026-10-17"};
  explorer.applyObservation(workspace,{version:2,baseRevision:data.revision,inventory:{contexts:[context]}});data=explorer.loadWorkspace(workspace);
  const run=explorer.startRun(workspace,{contextId:context.id},null,{id:"run.fingerprint"}).run,checkpointPath=resolve(tmp,".video/candidates/research-checkpoint.json");
  await writeFile(checkpointPath,JSON.stringify({unknowns:["An unrelated workflow remains unverified."]}),"utf8");
  await explorer.runKnowledgeCli(["run","checkpoint",run.id,checkpointPath,"--data",workspace],{cwd:root,stdout:()=>{},stderr:()=>{}});
  await explorer.runKnowledgeCli(["run","stop",run.id,"The user explicitly paused scoped exploration.","--data",workspace],{cwd:root,stdout:()=>{},stderr:()=>{}});data=explorer.loadWorkspace(workspace);
  const bindInput={appId:"crm",knowledgeRevision:data.revision,selection:{contextIds:[context.id],scenarioIds:[],executionIds:[],evidenceRefs:[]},readiness:{basis:"user_enough" as const,runId:run.id,userInstructionRef:"chat:message-explicit-stop"}};
  const originalBinding=await bindResearch(tmp,bindInput);await approvedScript(tmp);const p=harnessPaths(tmp),reviewBytes=await readFile(p.scriptReview);
  assert.equal((await videoBriefTemplate(tmp)).researchBindingHash,await researchBindingDigest(tmp));
  assert.equal((await readJson<any>(p.scriptReview)).researchBindingHash,await researchBindingDigest(tmp));
  assert.equal((await readJson<any>(p.scriptReview)).upstreamHash,await scriptUpstreamHash(tmp));
  const extraContext={id:"viewer.fixture",role:"viewer",tenantAlias:"fixture",environment:"synthetic",date:"2026-10-17"};
  explorer.applyObservation(workspace,{version:2,baseRevision:data.revision,inventory:{contexts:[extraContext]}});data=explorer.loadWorkspace(workspace);
  const rebound=await bindResearch(tmp,{...bindInput,knowledgeRevision:data.revision});assert.notEqual(rebound.knowledgeRevision,originalBinding.knowledgeRevision);
  assert.deepEqual(await readFile(p.scriptReview),reviewBytes);
  await assert.rejects(()=>assertScriptApproved(tmp),/research binding|upstream/i);
  await rm(tmp,{recursive:true,force:true});
});

test("pending Script review is surfaced as a HITL checkpoint",async()=>{
  const tmp=resolve(root,"tests/.tmp-script-pending-status");await base(tmp);await approvedBrief(tmp);await committedProfile(tmp);
  await writeFile(resolve(tmp,".video/candidates/script.md"),"This is a complete reviewable script with enough content to pass the minimum length requirement for the checkpoint.","utf8");
  await synthesizeNarration(tmp,{version:"1",scriptFile:".video/candidates/script.md",language:"en",segments:[]});await commitScriptReview(tmp,".video/candidates/script.md");
  const raw=await preproductionHitlStatus(tmp);
  assert.equal(raw.phase,"needs_script_review");
  assert.equal(raw.needsUserInput,true);
  assert.equal((await universalHitlStatus(tmp)).status,"REVIEW_REQUIRED");
  await rm(tmp,{recursive:true,force:true});
});

test("Script revision updates its review after reconciliation without invalidating itself",async()=>{
  const tmp=resolve(root,"tests/.tmp-script-revision-reconcile");await base(tmp);await approvedScript(tmp);const p=harnessPaths(tmp);await reopenCheckpoint(tmp,{checkpoint:"SCRIPT",reason:"Clarify the approved narration.",expectedRevision:0});
  const scriptText="This revised narration keeps the same approved intent while clarifying the key point for the intended viewer.";await writeFile(resolve(tmp,".video/candidates/script-revised.md"),scriptText,"utf8");await synthesizeNarration(tmp,{version:"1",scriptFile:".video/candidates/script-revised.md",language:"en",segments:[]});
  const reconcile=async()=>{const context=await getReconciliationContext(tmp),entries=(context.artifacts as Array<{id:string;priorHash?:string;currentHash?:string}>).map(item=>({artifactId:item.id,action:item.priorHash===undefined?"add" as const:item.currentHash===undefined?"remove" as const:item.priorHash===item.currentHash?"reuse" as const:"modify" as const,priorHash:item.priorHash,currentHash:item.currentHash,reason:"Reviewed current script artifacts."}));await submitReconciliation(tmp,{version:"1",generation:context.generation as number,reason:"Reconcile the revised Script artifacts.",entries});};
  await reconcile();const revised=await reviseScriptReview(tmp,".video/candidates/script-revised.md");assert.equal(revised.contentHash,sha256(scriptText));await reconcile();assert.equal(revised.upstreamHash,await scriptUpstreamHash(tmp));await approveScriptReview(tmp,"HUMAN");await assertScriptApproved(tmp);assert.equal((await readFile(p.scriptDraft,"utf8")),scriptText);await rm(tmp,{recursive:true,force:true});
});

test("Storyboard approval promotes the exact project and invalidates renderer-derived state",async()=>{
  const tmp=resolve(root,"tests/.tmp-storyboard-promotion");await base(tmp);await approvedScript(tmp);const p=harnessPaths(tmp);const candidate=project();
  await mkdir(resolve(tmp,"assets"),{recursive:true});await writeFile(resolve(tmp,"assets/manifest.json"),JSON.stringify({version:"1",assets:[]}),"utf8");await mkdir(p.remotionGenerated,{recursive:true});await writeFile(resolve(p.remotionGenerated,"old.tsx"),"old","utf8");await mkdir(p.output,{recursive:true});await mkdir(resolve(tmp,"hyperframes"),{recursive:true});await writeFile(p.manifest,"old","utf8");await writeFile(p.boundaryEvidenceIndex,"old","utf8");await writeFile(p.remotionRendererState,JSON.stringify({version:"1",renderer:"remotion",phase:"AUTHORING",projectId:"prior-project",revision:1,projectHash:"prior-hash",productionProfileHash:"prior-profile",assetManifestHash:"prior-assets",updatedAt:new Date().toISOString()}),"utf8");
  await writeFile(resolve(tmp,".video/candidates/project.json"),JSON.stringify(candidate),"utf8");await commitStoryboardReview(tmp,".video/candidates/project.json");const result=await approveStoryboardReview(tmp,"HUMAN");
  assert.equal(result.review.status,"approved");assert.equal(result.promotion.revision,1);assert.deepEqual(await readJson(p.video),candidate);assert.equal((await loadProjectState(tmp,candidate)).revision,1);assert.deepEqual(await readJson(resolve(p.revisions,"video-r1.json")),candidate);assert.equal((await readJson<any>(p.preflight)).valid,true);assert.equal(await readFile(resolve(p.remotionGenerated,"old.tsx"),"utf8").catch(()=>null),null);assert.equal(await readFile(resolve(p.remotionProjects,"prior-project-r1/generated/old.tsx"),"utf8"),"old");assert.equal(await readFile(p.manifest,"utf8").catch(()=>null),null);assert.equal(await readFile(p.boundaryEvidenceIndex,"utf8").catch(()=>null),null);assert.equal((await preproductionHitlStatus(tmp)).phase,"ready_to_render");const hitl=await universalHitlStatus(tmp);assert.equal(hitl.status,"WORKING");assert.equal(hitl.phase,"asset_preflight_not_run");await rm(tmp,{recursive:true,force:true});
});

test("tampered storyboard cannot be promoted",async()=>{
  const tmp=resolve(root,"tests/.tmp-storyboard-tamper");await base(tmp);await approvedScript(tmp);const p=harnessPaths(tmp);const candidate=project();await mkdir(resolve(tmp,"assets"),{recursive:true});await writeFile(resolve(tmp,"assets/manifest.json"),JSON.stringify({version:"1",assets:[]}),"utf8");await writeFile(resolve(tmp,".video/candidates/project.json"),JSON.stringify(candidate),"utf8");await commitStoryboardReview(tmp,".video/candidates/project.json");const stored=await readJson<any>(p.storyboardDraft);stored.meta.title="tampered";await writeFile(p.storyboardDraft,JSON.stringify(stored),"utf8");await assert.rejects(()=>approveStoryboardReview(tmp,"HUMAN"),/changed after review|content/i);assert.equal(await readFile(p.video,"utf8").catch(()=>null),null);await rm(tmp,{recursive:true,force:true});
});

test("invalid storyboard validation prevents canonical promotion",async()=>{
  const tmp=resolve(root,"tests/.tmp-storyboard-invalid");await base(tmp);await approvedScript(tmp);const p=harnessPaths(tmp);const candidate=project();candidate.meta.durationsInFrames=1;await mkdir(resolve(tmp,"assets"),{recursive:true});await writeFile(resolve(tmp,"assets/manifest.json"),JSON.stringify({version:"1",assets:[]}),"utf8");await writeFile(resolve(tmp,".video/candidates/project.json"),JSON.stringify(candidate),"utf8");await commitStoryboardReview(tmp,".video/candidates/project.json");await assert.rejects(()=>approveStoryboardReview(tmp,"HUMAN"),/validation failed|promotion was not performed/i);assert.equal(await readFile(p.video,"utf8").catch(()=>null),null);await rm(tmp,{recursive:true,force:true});
});

test("changed approved Script prevents Storyboard promotion",async()=>{
  const tmp=resolve(root,"tests/.tmp-storyboard-stale-script");await base(tmp);await approvedScript(tmp);const p=harnessPaths(tmp);const candidate=project();await mkdir(resolve(tmp,"assets"),{recursive:true});await writeFile(resolve(tmp,"assets/manifest.json"),JSON.stringify({version:"1",assets:[]}),"utf8");await writeFile(resolve(tmp,".video/candidates/project.json"),JSON.stringify(candidate),"utf8");await commitStoryboardReview(tmp,".video/candidates/project.json");await writeFile(p.scriptDraft,"This approved script was changed after the storyboard review was created, making the storyboard stale.","utf8");await assert.rejects(()=>approveStoryboardReview(tmp,"HUMAN"),/Script|upstream|changed/i);assert.equal(await readFile(p.video,"utf8").catch(()=>null),null);await rm(tmp,{recursive:true,force:true});
});

test("request remains mutable through Brief and freezes only after Production Profile",async()=>{
  const tmp=resolve(root,"tests/.tmp-request-freeze");await base(tmp);await approvedBrief(tmp);await assert.doesNotReject(()=>assertRequestMutable(tmp));await committedProfile(tmp);await assert.rejects(()=>assertRequestMutable(tmp),/frozen|production profile/i);await rm(tmp,{recursive:true,force:true});
});

test("storyboard promotion rolls back canonical outputs when project state collides",async()=>{
  const tmp=resolve(root,"tests/.tmp-promotion-atomic");await base(tmp);await approvedScript(tmp);const p=harnessPaths(tmp);await writeFile(p.projectState,JSON.stringify({version:"1",projectId:"stale",revision:1,requestHash:"stale",projectHash:"stale"}),"utf8");const candidate=project();await mkdir(resolve(tmp,"assets"),{recursive:true});await writeFile(resolve(tmp,"assets/manifest.json"),JSON.stringify({version:"1",assets:[]}),"utf8");await writeFile(resolve(tmp,".video/candidates/project.json"),JSON.stringify(candidate),"utf8");await commitStoryboardReview(tmp,".video/candidates/project.json");await assert.rejects(()=>approveStoryboardReview(tmp,"HUMAN"),/Project state already exists|promotion/i);assert.equal(await readFile(p.video,"utf8").catch(()=>null),null);assert.equal(await readFile(resolve(p.revisions,"video-r1.json"),"utf8").catch(()=>null),null);assert.equal(await readFile(p.preflight,"utf8").catch(()=>null),null);await rm(tmp,{recursive:true,force:true});
});

test("existing canonical project is preserved when promotion is refused",async()=>{
  const tmp=resolve(root,"tests/.tmp-existing-canonical");await base(tmp);await approvedScript(tmp);const p=harnessPaths(tmp),candidate=project(),existing={video:"existing-canonical",state:"existing-state",revision:"existing-revision",preflight:"existing-preflight"};await mkdir(resolve(tmp,"assets"),{recursive:true});await mkdir(p.revisions,{recursive:true});await writeFile(resolve(tmp,"assets/manifest.json"),JSON.stringify({version:"1",assets:[]}),"utf8");await writeFile(resolve(tmp,".video/candidates/project.json"),JSON.stringify(candidate),"utf8");await commitStoryboardReview(tmp,".video/candidates/project.json");await writeFile(p.video,existing.video,"utf8");await writeFile(p.projectState,existing.state,"utf8");await writeFile(resolve(p.revisions,"video-r1.json"),existing.revision,"utf8");await writeFile(p.preflight,existing.preflight,"utf8");await assert.rejects(()=>approveStoryboardReview(tmp,"HUMAN"),/already exists|revision workflow|JSON/i);assert.equal(await readFile(p.video,"utf8"),existing.video);assert.equal(await readFile(p.projectState,"utf8"),existing.state);assert.equal(await readFile(resolve(p.revisions,"video-r1.json"),"utf8"),existing.revision);assert.equal(await readFile(p.preflight,"utf8"),existing.preflight);await rm(tmp,{recursive:true,force:true});
});

test("ready_to_render revalidates approved Script and canonical bindings",async()=>{
  const tmp=resolve(root,"tests/.tmp-ready-revalidation");await base(tmp);await approvedScript(tmp);const p=harnessPaths(tmp);const candidate=project();await mkdir(resolve(tmp,"assets"),{recursive:true});await writeFile(resolve(tmp,"assets/manifest.json"),JSON.stringify({version:"1",assets:[]}),"utf8");await writeFile(resolve(tmp,".video/candidates/project.json"),JSON.stringify(candidate),"utf8");await commitStoryboardReview(tmp,".video/candidates/project.json");await approveStoryboardReview(tmp,"HUMAN");await writeFile(p.scriptDraft,"The approved Script was tampered after the Storyboard checkpoint and must no longer be render-ready.","utf8");const status=await preproductionHitlStatus(tmp);assert.notEqual(status.phase,"ready_to_render");assert.match(String(status.error),/Script|upstream|changed|invalid/i);await rm(tmp,{recursive:true,force:true});
});

test("canonical revision 2 remains ready while revision 1 preserves approved Storyboard provenance",async()=>{
  const tmp=resolve(root,"tests/.tmp-canonical-revisions");await base(tmp);await approvedScript(tmp);const p=harnessPaths(tmp),candidate=project();await mkdir(resolve(tmp,"assets"),{recursive:true});await writeFile(resolve(tmp,"assets/manifest.json"),JSON.stringify({version:"1",assets:[]}),"utf8");await writeFile(resolve(tmp,".video/candidates/project.json"),JSON.stringify(candidate),"utf8");await commitStoryboardReview(tmp,".video/candidates/project.json");await approveStoryboardReview(tmp,"HUMAN");const next=structuredClone(candidate);next.meta.title="Patched canonical revision";const state2=await advanceProjectState(tmp,candidate,next);await writeJson(p.video,next);await persistRevision(tmp,next,state2);const check=await validateCanonicalProject(tmp,next);await writeJson(p.preflight,check.preflight);await invalidateProjectDerived(tmp);const status=await preproductionHitlStatus(tmp);assert.equal(status.phase,"ready_to_render");assert.equal(status.revision,2);assert.deepEqual(await readJson(resolve(p.revisions,"video-r1.json")),candidate);assert.deepEqual(await readJson(resolve(p.revisions,"video-r2.json")),next);assert.equal((await loadProjectState(tmp,next)).revision,2);await rm(tmp,{recursive:true,force:true});
});

test("reapproved Storyboard binds provenance to its recorded canonical revision",async()=>{
  const tmp=resolve(root,"tests/.tmp-reapproved-storyboard-revision");await base(tmp);await approvedScript(tmp);const p=harnessPaths(tmp),candidate=project();await mkdir(resolve(tmp,"assets"),{recursive:true});await writeFile(resolve(tmp,"assets/manifest.json"),JSON.stringify({version:"1",assets:[]}),"utf8");await writeFile(resolve(tmp,".video/candidates/project.json"),JSON.stringify(candidate),"utf8");await commitStoryboardReview(tmp,".video/candidates/project.json");await approveStoryboardReview(tmp,"HUMAN");await reopenCheckpoint(tmp,{checkpoint:"STORYBOARD",reason:"Update approved storyboard evidence.",expectedRevision:0});
  const reconcile=async()=>{const context=await getReconciliationContext(tmp),entries=(context.artifacts as Array<{id:string;priorHash?:string;currentHash?:string}>).map(item=>({artifactId:item.id,action:item.priorHash===undefined?"add" as const:item.currentHash===undefined?"remove" as const:item.priorHash===item.currentHash?"reuse" as const:"modify" as const,priorHash:item.priorHash,currentHash:item.currentHash,reason:"Reviewed current storyboard artifacts."}));await submitReconciliation(tmp,{version:"1",generation:context.generation as number,reason:"Reconcile the approved storyboard revision.",entries});};
  await reconcile();const next=structuredClone(candidate);next.meta.title="Reapproved canonical revision";await writeFile(resolve(tmp,".video/candidates/project-r2.json"),JSON.stringify(next),"utf8");await reviseStoryboardReview(tmp,".video/candidates/project-r2.json");await reconcile();const result=await approveStoryboardReview(tmp,"HUMAN");assert.equal(result.review.projectRevision,2);assert.deepEqual(await readJson(resolve(p.revisions,"video-r1.json")),candidate);assert.deepEqual(await readJson(resolve(p.revisions,"video-r2.json")),next);assert.equal((await preproductionHitlStatus(tmp)).phase,"ready_to_render");await rm(tmp,{recursive:true,force:true});
});

test("tampered revision 1 provenance prevents render readiness",async()=>{
  const tmp=resolve(root,"tests/.tmp-tampered-revision-one");await base(tmp);await approvedScript(tmp);const p=harnessPaths(tmp),candidate=project();await mkdir(resolve(tmp,"assets"),{recursive:true});await writeFile(resolve(tmp,"assets/manifest.json"),JSON.stringify({version:"1",assets:[]}),"utf8");await writeFile(resolve(tmp,".video/candidates/project.json"),JSON.stringify(candidate),"utf8");await commitStoryboardReview(tmp,".video/candidates/project.json");await approveStoryboardReview(tmp,"HUMAN");const revision1=await readJson<any>(resolve(p.revisions,"video-r1.json"));revision1.meta.title="tampered provenance";await writeJson(resolve(p.revisions,"video-r1.json"),revision1);const status=await preproductionHitlStatus(tmp);assert.notEqual(status.phase,"ready_to_render");assert.match(String(status.error),/revision 1|Storyboard|provenance|approved/i);await rm(tmp,{recursive:true,force:true});
});
