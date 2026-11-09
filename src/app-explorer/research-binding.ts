import {createHash,randomUUID} from "node:crypto";
import {copyFile,lstat,mkdir,readFile,rename,rm,writeFile} from "node:fs/promises";
import {join,relative,resolve,sep} from "node:path";
import {readApp} from "./service.js";
import {resolveAppWorkspace} from "./registry.js";
import {readJson,writeJson} from "../core/io.js";
import {sha256} from "../core/hash.js";
import {requestHash} from "../harness/request.js";
import {harnessPaths} from "../harness/paths.js";
import {exists} from "../harness/fs.js";
import * as appExplorerCore from "../../packages/app-explorer/index.mjs";

export type ResearchSelection={contextIds:string[];scenarioIds:string[];executionIds:string[];evidenceRefs:string[]};
export type ResearchReadiness={basis:"scope_complete"|"user_enough";runId?:string;userInstructionRef?:string};
export type BindResearchInput={appId:string;knowledgeRevision:string;selection:ResearchSelection;readiness:ResearchReadiness};
export type ResearchBinding={version:"1";requestHash:string;appId:string;knowledgeRevision:string;selection:ResearchSelection;evidenceHashes:Record<string,string>;readiness:ResearchReadiness;unknowns:{openTaskIds:string[];openQuestions:Array<{id:string;contextId:string|null;text:string}>;checkpointUnknowns:string[];checkpointQuestions:Array<{id?:string;text:string}>;checkpointTaskIds:string[]}};

const core:any=appExplorerCore;
const activeStatuses=new Set(["queued","running","waiting_user","waiting_external","blocked"]);
const text=(value:unknown):value is string=>typeof value==="string"&&value.trim().length>0;
function uniqueStrings(value:unknown,label:string,allowEmpty=true):string[]{
  if(!Array.isArray(value)||(!allowEmpty&&!value.length)||value.some(item=>!text(item))||new Set(value).size!==value.length)throw new Error(`Research selection ${label} must be a unique string array${allowEmpty?"":" with at least one item"}.`);
  return value.map(item=>item.trim());
}
function safeEvidenceRef(ref:string):string{
  const parts=ref.replaceAll("\\","/").split("/");
  if(!parts.length||parts.some(part=>!part||part==="."||part===".."||part.startsWith("."))||!/\.(png|jpe?g|webp|txt|json)$/i.test(ref))throw new Error(`Unsafe selected evidence reference: ${ref}`);
  return parts.join(sep);
}
function sha256Bytes(bytes:Uint8Array):string{return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;}
async function evidencePath(workspace:string,ref:string):Promise<string>{
  const root=resolve(workspace,"evidence"),target=resolve(root,safeEvidenceRef(ref)),fromRoot=relative(root,target);
  if(fromRoot===".."||fromRoot.startsWith(`..${sep}`)||fromRoot.startsWith(sep))throw new Error(`Selected evidence escapes the registered workspace: ${ref}`);
  const rootInfo=await lstat(root);if(rootInfo.isSymbolicLink()||!rootInfo.isDirectory())throw new Error("App Explorer evidence root is not a regular directory.");
  let cursor=root;
  for(const part of fromRoot.split(sep).filter(Boolean)){cursor=join(cursor,part);const info=await lstat(cursor);if(info.isSymbolicLink())throw new Error(`Selected evidence contains a symlink: ${ref}`);if(cursor===target&&!info.isFile())throw new Error(`Selected evidence is not a regular file: ${ref}`);}
  return target;
}
function isVerifiedScenario(scenario:any):boolean{
  return ["success","expected_denial"].includes(scenario.outcome)&&text(scenario.testedContext?.role)&&text(scenario.testedContext?.date)&&scenario.testedContext.contextId===scenario.contextId&&
    Array.isArray(scenario.evidenceRefs)&&scenario.evidenceRefs.length>0&&Array.isArray(scenario.completionCriteria)&&scenario.completionCriteria.length>0&&
    scenario.completionCriteria.every((criterion:any)=>criterion.met===true&&Array.isArray(criterion.evidenceRefs)&&criterion.evidenceRefs.length>0&&Array.isArray(scenario.steps)&&scenario.steps.some((step:any)=>text(step.observed)&&Array.isArray(step.evidenceRefs)&&step.evidenceRefs.some((ref:string)=>criterion.evidenceRefs.includes(ref))));
}
function openQuestions(data:any,contextIds:Set<string>){
  return (data.features||[]).flatMap((feature:any)=>(feature.questions||[]).filter((question:any)=>question.state==="open"&&(question.contextId==null||contextIds.has(question.contextId))).map((question:any)=>({id:question.id,contextId:question.contextId??null,text:question.text})));
}
function openTasks(data:any,contextIds:Set<string>){
  return (data.frontier?.tasks||[]).filter((task:any)=>activeStatuses.has(task.status)&&(task.contextId==null||contextIds.has(task.contextId))).map((task:any)=>task.id);
}
function checkpointFacts(checkpoint:any){
  const strings=(...keys:string[])=>[...new Set(keys.flatMap(key=>Array.isArray(checkpoint?.[key])?checkpoint[key]:[]).filter(text).map((item:string)=>item.trim()))];
  const questions=[...(Array.isArray(checkpoint?.openQuestions)?checkpoint.openQuestions:[]),...(Array.isArray(checkpoint?.questions)?checkpoint.questions:[])]
    .flatMap((item:any)=>text(item)?[{text:item.trim()}]:item&&typeof item==="object"&&!Array.isArray(item)&&text(item.text)?[{...(text(item.id)?{id:item.id.trim()}:{}),text:item.text.trim()}]:[]);
  const taskIds=[...(Array.isArray(checkpoint?.openTasks)?checkpoint.openTasks:[]),...(Array.isArray(checkpoint?.tasks)?checkpoint.tasks:[])]
    .map((item:any)=>text(item)?item.trim():item&&typeof item==="object"?(text(item.taskId)?item.taskId.trim():text(item.id)?item.id.trim():null):null).filter(text);
  return {checkpointUnknowns:strings("unknowns","remainingUnknowns"),checkpointQuestions:questions,checkpointTaskIds:[...new Set(taskIds)]};
}
async function currentRequestHash(root:string){return requestHash(root);}

async function validateSelection(input:BindResearchInput,data:any):Promise<ResearchBinding["unknowns"]>{
  if(data.schemaVersion!==2||typeof data.revision!=="string")throw new Error("App Explorer V1 data has no immutable revision. Explicitly migrate this workspace before binding research.");
  if(data.revision!==input.knowledgeRevision)throw new Error(`Knowledge revision mismatch: selection names ${input.knowledgeRevision}, current revision is ${data.revision}; refresh the selection explicitly.`);
  const selection=input.selection;
  const contextIds=uniqueStrings(selection?.contextIds,"contextIds",false),scenarioIds=uniqueStrings(selection?.scenarioIds,"scenarioIds"),executionIds=uniqueStrings(selection?.executionIds,"executionIds"),evidenceRefs=uniqueStrings(selection?.evidenceRefs,"evidenceRefs");
  const knownContexts=new Map((data.contexts||[]).map((context:any)=>[context.id,context]));
  for(const id of contextIds)if(!knownContexts.has(id))throw new Error(`Selected context ${id} does not exist in the exact knowledge revision.`);
  const scenarios=new Map((data.scenarios||[]).map((scenario:any)=>[scenario.id,scenario]));
  const selectedScenarios:any[]=[];
  for(const id of scenarioIds){
    const scenario:any=scenarios.get(id);if(!scenario)throw new Error(`Selected scenario ${id} does not exist in the exact knowledge revision.`);
    if(!contextIds.includes(scenario.contextId))throw new Error(`Selected scenario ${id} belongs to context ${scenario.contextId}, outside the selected contexts.`);
    const context:any=knownContexts.get(scenario.contextId);
    if(scenario.testedContext?.contextId!==context.id||scenario.testedContext?.role!==context.role)throw new Error(`Selected scenario ${id} has mismatched role/context.`);
    selectedScenarios.push(scenario);
  }
  const executions=new Map<string,{execution:any;scenario:any}>();
  for(const scenario of selectedScenarios)for(const execution of scenario.history||[])executions.set(execution.executionId,{execution,scenario});
  const selectedExecutions:Array<{execution:any;scenario:any}>=[];
  for(const id of executionIds){
    const match=executions.get(id);if(!match)throw new Error(`Selected execution ${id} is not linked to a selected scenario in the exact knowledge revision.`);
    const context:any=knownContexts.get(match.scenario.contextId);
    if(match.execution.scenarioId!==match.scenario.id||match.execution.testedContext?.contextId!==context.id||match.execution.testedContext?.role!==context.role||!isVerifiedScenario(match.execution))throw new Error(`Selected execution ${id} has mismatched role/context or is not verified.`);
    selectedExecutions.push(match);
  }
  for(const scenario of selectedScenarios)if(!selectedExecutions.some(item=>item.scenario.id===scenario.id))throw new Error(`Selected scenario ${scenario.id} has no explicitly selected verified execution.`);
  const eligibleEvidence=new Set(selectedExecutions.flatMap(({execution})=>[
    ...(execution.evidenceRefs||[]),...(execution.steps||[]).flatMap((step:any)=>step.evidenceRefs||[]),...(execution.completionCriteria||[]).flatMap((criterion:any)=>criterion.evidenceRefs||[])
  ]));
  for(const ref of evidenceRefs)if(!eligibleEvidence.has(ref))throw new Error(`Selected evidence ${ref} is not linked to a selected scenario in the exact knowledge revision.`);
  const contextSet=new Set(contextIds),tasks=openTasks(data,contextSet),questions=openQuestions(data,contextSet);
  const readiness=input.readiness;
  if(!readiness||!(readiness.basis==="scope_complete"||readiness.basis==="user_enough"))throw new Error("Research readiness basis must be scope_complete or user_enough.");
  if(!text(readiness.runId))throw new Error("Research readiness requires the authoritative runId.");
  const run=(data.runs||[]).find((item:any)=>item.id===readiness.runId);
  if(!run)throw new Error(`Readiness run ${readiness.runId} is absent from the exact knowledge revision.`);
  if(run.scope?.contextId&&!contextIds.includes(run.scope.contextId))throw new Error(`Readiness run ${run.id} is scoped to another context.`);
  if(readiness.basis==="scope_complete"){
    if(run.status!=="exhausted_in_scope")throw new Error(`Scope is incomplete: authoritative run is ${run.status}, not exhausted_in_scope.`);
    if(run.scope?.contextId&&(contextIds.length!==1||contextIds[0]!==run.scope.contextId))throw new Error("Readiness run scope does not cover every selected context.");
    const scopedContextIds=contextIds;
    const scopedContexts=(data.contexts||[]).filter((context:any)=>scopedContextIds.includes(context.id));
    const allTasks=data.frontier?.tasks||[];
    const inScope=(item:any)=>{
      if(item.contextId!=null)return scopedContextIds.includes(item.contextId);
      const linkedTasks=allTasks.filter((task:any)=>task.nodeId===item.id||(item.taskIds||[]).includes(task.id));
      const ownerContexts=linkedTasks.map((task:any)=>task.contextId).filter(text);
      return !ownerContexts.length||ownerContexts.some((id:string)=>scopedContextIds.includes(id));
    };
    const scopedNodes=(data.frontier?.nodes||[]).filter(inScope),scopedNodeIds=new Set(scopedNodes.map((node:any)=>node.id));
    const scopedFrontier={...(data.frontier||{}),nodes:scopedNodes,edges:(data.frontier?.edges||[]).filter((edge:any)=>scopedNodeIds.has(edge.from)&&scopedNodeIds.has(edge.to)),tasks:(data.frontier?.tasks||[]).filter(inScope)};
    const scopedInventory={...(data.inventory||{}),nodes:(data.inventory?.nodes||[]).filter(inScope)};
    const coverage=core.scopeCoverage(core.auditCoverage(data,{contextIds:scopedContextIds}),scopedContextIds);
    const frontier=core.frontierSummary(scopedFrontier,scopedContexts,new Date().toISOString(),scopedInventory,{coverage});
    if(frontier.state!=="exhausted_in_scope")throw new Error(`Scope is not currently exhausted: authoritative frontier is ${frontier.state} (${frontier.reason}).`);
  }else{
    if(run.status!=="paused")throw new Error(`user_enough requires an explicitly paused run; current run is ${run.status}.`);
    if(!readiness.userInstructionRef?.trim())throw new Error("user_enough requires a reference to the user's explicit instruction to stop and proceed.");
    if(!core.isMeaningfulCheckpoint(run.checkpoint))throw new Error("user_enough requires a meaningful paused checkpoint; a bare pause/error is insufficient.");
  }
  return {openTaskIds:tasks,openQuestions:questions,...(readiness.basis==="user_enough"?checkpointFacts(run.checkpoint):{checkpointUnknowns:[],checkpointQuestions:[],checkpointTaskIds:[]})};
}

export async function bindResearch(root:string,input:BindResearchInput):Promise<ResearchBinding>{
  if(!input||!text(input.appId)||!text(input.knowledgeRevision))throw new Error("Research binding requires appId and knowledgeRevision.");
  const capturedRequestHash=await currentRequestHash(root);
  const workspace=await resolveAppWorkspace(root,input.appId),data=await readApp(root,input.appId);
  const normalizedInput:BindResearchInput={...input,selection:{
    contextIds:uniqueStrings(input.selection?.contextIds,"contextIds",false),scenarioIds:uniqueStrings(input.selection?.scenarioIds,"scenarioIds"),
    executionIds:uniqueStrings(input.selection?.executionIds,"executionIds"),evidenceRefs:uniqueStrings(input.selection?.evidenceRefs,"evidenceRefs")
  },readiness:{...input.readiness,...(input.readiness?.runId?{runId:input.readiness.runId.trim()}:{}),...(input.readiness?.userInstructionRef?{userInstructionRef:input.readiness.userInstructionRef.trim()}:{})}};
  const unknowns=await validateSelection(normalizedInput,data);
  const evidenceHashes:Record<string,string>={};
  for(const ref of normalizedInput.selection.evidenceRefs){const bytes=await readFile(await evidencePath(workspace,ref));evidenceHashes[ref]=sha256Bytes(bytes);}
  const binding:ResearchBinding={version:"1",requestHash:capturedRequestHash,appId:normalizedInput.appId,knowledgeRevision:normalizedInput.knowledgeRevision,
    selection:normalizedInput.selection,evidenceHashes,readiness:normalizedInput.readiness,unknowns};
  const path=harnessPaths(root).researchBinding;
  if(capturedRequestHash!==await currentRequestHash(root))throw new Error("Video request changed while research was being bound; retry with a fresh selection.");
  await mkdir(resolve(root,".video"),{recursive:true});const temporary=`${path}.tmp-${randomUUID()}`;
  try{await writeFile(temporary,JSON.stringify(binding,null,2)+"\n","utf8");await rename(temporary,path);}catch(error){try{await rm(temporary,{force:true});}catch{}throw error;}
  return binding;
}

export async function readResearchBinding(root:string):Promise<ResearchBinding|null>{const path=harnessPaths(root).researchBinding;if(!(await exists(path)))return null;return readJson<ResearchBinding>(path);}
export async function researchBindingDigest(root:string):Promise<string|null>{const binding=await readResearchBinding(root);if(!binding)return null;await assertResearchBindingCurrent(root);return sha256(JSON.stringify(binding));}

async function verifyImmutableRevision(workspace:string,revision:string):Promise<string>{
  if(!/^r\d{6,}$/.test(revision))throw new Error("Research binding revision is invalid; bind from an immutable V2 revision.");
  const dataDir=resolve(workspace,"revisions",revision),manifest=core.readRevisionManifest(dataDir,revision);
  if(!manifest)throw new Error(`Research revision ${revision} is missing its immutable manifest.`);
  core.verifyRevisionHashes(dataDir,manifest);
  return dataDir;
}

export async function assertResearchBindingCurrent(root:string):Promise<void>{
  const binding=await readResearchBinding(root);if(!binding)return;
  if(binding.version!=="1")throw new Error("Research binding version is unsupported; explicitly rebind this video.");
  if(binding.requestHash!==await currentRequestHash(root))throw new Error("Research binding request hash is stale; explicitly rebind for the current video request.");
  const workspace=await resolveAppWorkspace(root,binding.appId);await verifyImmutableRevision(workspace,binding.knowledgeRevision);
  for(const [ref,expected] of Object.entries(binding.evidenceHashes)){
    const actual=sha256Bytes(await readFile(await evidencePath(workspace,ref)));
    if(actual!==expected)throw new Error(`Selected research evidence changed after binding: ${ref}.`);
  }
}

export async function copyBoundResearchArchive(root:string,target:string):Promise<void>{
  const binding=await readResearchBinding(root);if(!binding)return;
  await assertResearchBindingCurrent(root);
  const workspace=await resolveAppWorkspace(root,binding.appId);await verifyImmutableRevision(workspace,binding.knowledgeRevision);const archiveRoot=resolve(target,"app-research");
  await mkdir(resolve(archiveRoot,"evidence"),{recursive:true});
  await writeJson(resolve(archiveRoot,"research-binding.json"),binding);
  for(const ref of binding.selection.evidenceRefs){
    const from=await evidencePath(workspace,ref),to=resolve(archiveRoot,"evidence",safeEvidenceRef(ref));await mkdir(resolve(to,".."),{recursive:true});await copyFile(from,to);
  }
}
