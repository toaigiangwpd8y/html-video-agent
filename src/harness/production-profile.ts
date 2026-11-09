import {readdir} from "node:fs/promises";
import {resolve,relative} from "node:path";
import {readJson,readText,writeJson} from "../core/io.js";
import {sha256} from "../core/hash.js";
import {exists,requireFile} from "./fs.js";
import {harnessPaths} from "./paths.js";
import {assertClarificationResolved,clarificationHash,validateClarificationApplied} from "./clarification.js";
import {assertVideoBriefApproved} from "./preproduction-hitl.js";
import {readJson as readJsonProfile} from "../core/io.js";

export type ProfileSource="USER_EXPLICIT"|"MODEL_INFERRED";
export interface ProfileCatalogEntry {id:string;description:string;}
export interface ProfileCatalog {version:"1";profiles:ProfileCatalogEntry[];}
export interface ProfileSelection {id:string;source:ProfileSource;reason:string;}
export interface ClarificationApplied {clarificationHash:string;appliedAnswerIds:string[];}
export interface BriefApplied {briefHash:string;}
export interface ProductionProfileCandidate {version:"1";primary:ProfileSelection;supporting?:ProfileSelection[];clarificationApplied?:ClarificationApplied;briefApplied?:BriefApplied;}
export interface BoundProfileSkill {id:string;path:string;skillHash:string;}
export interface ProductionProfile extends ProductionProfileCandidate {requestHash:string;skills:BoundProfileSkill[];}

const nonempty=(v:unknown):v is string=>typeof v==="string"&&v.trim().length>0;
const hasPlaceholder=(v:string)=>/REPLACE:|TODO|<[^>]+>/.test(v);

function selected(profile:ProductionProfileCandidate):ProfileSelection[]{return [profile.primary,...(profile.supporting??[])];}

export async function loadProfileCatalog(root:string):Promise<ProfileCatalog>{
  const p=harnessPaths(root);await requireFile(p.videoTypeCatalog,"Video production profile catalog");
  const value=await readJson<ProfileCatalog>(p.videoTypeCatalog);
  if(value.version!=="1"||!Array.isArray(value.profiles)||value.profiles.length===0)throw new Error("Video production profile catalog must use version 1 and contain profiles.");
  const ids=new Set<string>();
  for(const [i,item] of value.profiles.entries()){
    if(!nonempty(item?.id)||!nonempty(item?.description))throw new Error(`Profile catalog entry ${i} requires id and description.`);
    if(ids.has(item.id))throw new Error(`Profile catalog id '${item.id}' is duplicated.`);ids.add(item.id);
    const skill=resolve(p.videoTypeSkillsRoot,item.id,"SKILL.md");await requireFile(skill,`Video-type skill '${item.id}'`);
  }
  return value;
}

function parseSelection(value:unknown,label:string,allowed:Set<string>):ProfileSelection{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(`${label} must be an object.`);
  const x=value as Record<string,unknown>;
  if(!nonempty(x.id)||!allowed.has(x.id))throw new Error(`${label}.id must be one profile id from the catalog.`);
  if(x.source!=="USER_EXPLICIT"&&x.source!=="MODEL_INFERRED")throw new Error(`${label}.source must be USER_EXPLICIT or MODEL_INFERRED.`);
  if(!nonempty(x.reason)||hasPlaceholder(x.reason))throw new Error(`${label}.reason must concretely explain why this profile applies to the exact request.`);
  return {id:x.id,source:x.source,reason:x.reason};
}

async function parseCandidate(root:string,value:unknown):Promise<ProductionProfileCandidate>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Production profile candidate must be a JSON object.");
  const x=value as Record<string,unknown>;if(x.version!=="1")throw new Error("Production profile candidate must use version 1.");
  const catalog=await loadProfileCatalog(root),allowed=new Set(catalog.profiles.map(p=>p.id));
  const primary=parseSelection(x.primary,"primary",allowed);
  let supporting:ProfileSelection[]=[];
  if(x.supporting!==undefined){if(!Array.isArray(x.supporting))throw new Error("supporting must be an array when present.");supporting=x.supporting.map((v,i)=>parseSelection(v,`supporting[${i}]`,allowed));}
  const ids=[primary.id,...supporting.map(s=>s.id)];if(new Set(ids).size!==ids.length)throw new Error("Primary/supporting production profiles must be unique.");
  if(primary.id==="neutral"&&supporting.length)throw new Error("neutral cannot have supporting profiles. Use neutral only as a fallback when no specialized objective clearly applies.");
  if(primary.source==="MODEL_INFERRED"&&primary.id!=="neutral"&&/user explicitly|explicitly asked/i.test(primary.reason))throw new Error("MODEL_INFERRED reason should not claim the user explicitly selected the profile.");
  const result:ProductionProfileCandidate={version:"1",primary,...(supporting.length?{supporting}:{})};
  if(x.clarificationApplied!==undefined){
    if(typeof x.clarificationApplied!=="object"||x.clarificationApplied===null||Array.isArray(x.clarificationApplied))throw new Error("clarificationApplied must be an object.");
    const ca=x.clarificationApplied as Record<string,unknown>;
    if(!nonempty(ca.clarificationHash))throw new Error("clarificationApplied.clarificationHash must be non-empty.");
    if(!Array.isArray(ca.appliedAnswerIds))throw new Error("clarificationApplied.appliedAnswerIds must be an array.");
    const appliedAnswerIds=ca.appliedAnswerIds.map((id,i)=>{if(!nonempty(id))throw new Error(`clarificationApplied.appliedAnswerIds[${i}] must be a non-empty string.`);return id;});
    result.clarificationApplied={clarificationHash:ca.clarificationHash,appliedAnswerIds};
  }
  if(x.briefApplied!==undefined){
    if(typeof x.briefApplied!=="object"||x.briefApplied===null||Array.isArray(x.briefApplied))throw new Error("briefApplied must be an object.");
    const ba=x.briefApplied as Record<string,unknown>;
    if(!nonempty(ba.briefHash))throw new Error("briefApplied.briefHash must be non-empty.");
    result.briefApplied={briefHash:ba.briefHash};
  }
  return result;
}

async function bindSkills(root:string,candidate:ProductionProfileCandidate):Promise<BoundProfileSkill[]>{
  const p=harnessPaths(root),out:BoundProfileSkill[]=[];
  for(const item of selected(candidate)){
    const path=resolve(p.videoTypeSkillsRoot,item.id,"SKILL.md"),text=await readText(path);
    out.push({id:item.id,path:relative(root,path).replaceAll("\\","/"),skillHash:sha256(text)});
  }
  return out;
}

async function assertPreproductionBindings(root:string,candidate:ProductionProfileCandidate):Promise<void>{
  await validateClarificationApplied(root,candidate.clarificationApplied);
  const briefHash=await assertVideoBriefApproved(root);
  if(!candidate.briefApplied||candidate.briefApplied.briefHash!==briefHash)throw new Error("Production profile must bind the approved Video Brief via briefApplied.briefHash.");
}

export async function productionProfileTemplate(root:string):Promise<ProductionProfileCandidate>{
  await loadProfileCatalog(root);
  const briefHash=await assertVideoBriefApproved(root);
  const clarification=await assertClarificationResolved(root);
  const clarificationApplied:ClarificationApplied={clarificationHash:await clarificationHash(root),appliedAnswerIds:clarification.answers.map(a=>a.questionId)};
  return {
    version:"1",
    primary:{id:"neutral",source:"MODEL_INFERRED",reason:"REPLACE: infer the primary production objective from the approved Video Brief and exact request. Use neutral only when no specialized profile clearly applies."},
    supporting:[],
    clarificationApplied,
    briefApplied:{briefHash},
  };
}

export async function commitProductionProfile(root:string,file:string):Promise<ProductionProfile>{
  const p=harnessPaths(root);await requireFile(p.request,"Captured user request");if(await exists(p.productionProfile))throw new Error("Production profile is already frozen. Run `video init` to start a new request.");
  const candidate=await parseCandidate(root,await readJson(resolve(root,file)));
  await assertPreproductionBindings(root,candidate);
  const request=await readText(p.request),profile:ProductionProfile={...candidate,requestHash:sha256(request),skills:await bindSkills(root,candidate)};
  await writeJson(p.productionProfile,profile);return profile;
}

/** Rebinds unchanged profile choices after a duration-only Brief revision. */
export async function rebindProductionProfile(root:string):Promise<ProductionProfile>{
  const p=harnessPaths(root);await requireFile(p.productionProfile,"Frozen production profile");
  const stored=await readJson<ProductionProfile>(p.productionProfile),candidate=await parseCandidate(root,stored);
  const status=await import("./reopen.js").then(m=>m.reopenStatus(root)),last=status.records.at(-1);
  if(last?.checkpoint!=="VIDEO_BRIEF")throw new Error("Profile rebind is only available after a host reopened the Video Brief.");
  const previous=await readJsonProfile<Record<string,unknown>>(last.snapshots[p.videoBrief]),current=await readJsonProfile<Record<string,unknown>>(p.videoBrief);
  const intentKeys=["objective","audience","aspectRatio","language","angle","tone","pacing","mustInclude","mustAvoid","sourceNotes","rendererRecommendation"];
  if(intentKeys.some(key=>JSON.stringify(previous[key])!==JSON.stringify(current[key])))throw new Error("Brief intent changed. Reassess and submit a revised production profile instead of rebinding existing choices.");
  const briefHash=await assertVideoBriefApproved(root),next:ProductionProfile={...candidate,briefApplied:{briefHash},requestHash:stored.requestHash,skills:await bindSkills(root,candidate)};
  await validateClarificationApplied(root,next.clarificationApplied);await writeJson(p.productionProfile,next);return next;
}

export async function reviseProductionProfile(root:string,file:string):Promise<ProductionProfile>{
  const p=harnessPaths(root),status=await import("./reopen.js").then(m=>m.reopenStatus(root));
  if(status.records.at(-1)?.checkpoint!=="VIDEO_BRIEF")throw new Error("A host must reopen VIDEO_BRIEF before revising the frozen production profile.");
  const candidate=await parseCandidate(root,await readJson(resolve(root,file)));await assertPreproductionBindings(root,candidate);
  const prior=await readJson<ProductionProfile>(p.productionProfile),profile:ProductionProfile={...candidate,requestHash:prior.requestHash,skills:await bindSkills(root,candidate)};
  await writeJson(p.productionProfile,profile);return profile;
}

export async function loadProductionProfile(root:string):Promise<ProductionProfile>{
  const p=harnessPaths(root);await requireFile(p.productionProfile,"Frozen production profile");await requireFile(p.request,"Captured user request");
  const stored=await readJson<ProductionProfile>(p.productionProfile),candidate=await parseCandidate(root,stored),request=await readText(p.request);
  if(stored.requestHash!==sha256(request))throw new Error("Production profile belongs to a different request or the request was modified.");
  await assertPreproductionBindings(root,candidate);
  const expected=await bindSkills(root,candidate);if(JSON.stringify(stored.skills)!==JSON.stringify(expected))throw new Error("A selected video-type skill changed after the production profile was frozen. Start a new request or restore the bound skill version.");
  return {...candidate,requestHash:stored.requestHash,skills:stored.skills};
}

export async function productionProfileHash(root:string):Promise<string>{await loadProductionProfile(root);return sha256(await readText(harnessPaths(root).productionProfile));}

export async function productionProfileStatus(root:string):Promise<Record<string,unknown>>{
  const p=harnessPaths(root);if(!(await exists(p.productionProfile)))return {ready:false,catalog:relative(root,p.videoTypeCatalog).replaceAll("\\","/"),available:(await loadProfileCatalog(root)).profiles.map(x=>x.id)};
  try{const profile=await loadProductionProfile(root);return {ready:true,primary:profile.primary,supporting:profile.supporting??[],skills:profile.skills};}catch(error){return {ready:false,error:error instanceof Error?error.message:String(error)};}
}

export async function profileCatalogForCli(root:string):Promise<ProfileCatalog>{return loadProfileCatalog(root);}
