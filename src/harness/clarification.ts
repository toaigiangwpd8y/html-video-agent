import {resolve} from "node:path";
import {sha256} from "../core/hash.js";
import {readJson,readText,writeJson} from "../core/io.js";
import {exists,requireFile} from "./fs.js";
import {harnessPaths} from "./paths.js";

export type ClarificationStatus="resolved"|"awaiting_user";
export type DecisionSource="USER_EXPLICIT"|"CONTEXT_INFERRED"|"MODEL_DEFAULT"|"UNRESOLVED";
export type DecisionMateriality="low"|"medium"|"high";
export type AnswerSource="USER_ROUTER"|"HUMAN";

export interface ClarificationDecision {
  id:string;
  label:string;
  value?:string;
  source:DecisionSource;
  confidence?:number;
  materiality:DecisionMateriality;
  reason:string;
  alternatives?:string[];
}

export interface ClarificationQuestion {
  id:string;
  question:string;
  resolves:string[];
  options?:string[];
}

export interface ClarificationAnswer {
  questionId:string;
  answer:string;
  answeredBy:AnswerSource;
}

export interface ClarificationArtifact {
  version:"2";
  requestHash:string;
  status:ClarificationStatus;
  decisions:ClarificationDecision[];
  questions:ClarificationQuestion[];
  answers:ClarificationAnswer[];
}

export interface ClarificationApplied {
  clarificationHash:string;
  appliedAnswerIds:string[];
}

interface ClarificationAnswersDocument {
  answers:ClarificationAnswer[];
}

const nonempty=(v:unknown):v is string=>typeof v==="string"&&v.trim().length>0;
const hasPlaceholder=(v:string)=>/REPLACE:|TODO|<[^>]+>/.test(v);

function stringArray(value:unknown,label:string,allowEmpty=true):string[]{
  if(!Array.isArray(value))throw new Error(`${label} must be an array.`);
  const out=value.map((x,i)=>{
    if(!nonempty(x))throw new Error(`${label}[${i}] must be a non-empty string.`);
    return x.trim();
  });
  if(!allowEmpty&&out.length===0)throw new Error(`${label} must contain at least one item.`);
  return out;
}

function validateAnswer(value:unknown,index:number,questionIds:Set<string>):ClarificationAnswer{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(`answers[${index}] must be an object.`);
  const a=value as Record<string,unknown>;
  if(!nonempty(a.questionId)||!questionIds.has(a.questionId))throw new Error(`answers[${index}].questionId must match one clarification question.`);
  if(!nonempty(a.answer)||hasPlaceholder(a.answer))throw new Error(`answers[${index}].answer must be concrete.`);
  if(a.answeredBy!=="USER_ROUTER"&&a.answeredBy!=="HUMAN")throw new Error(`answers[${index}].answeredBy must be USER_ROUTER or HUMAN.`);
  return {questionId:a.questionId,answer:a.answer,answeredBy:a.answeredBy};
}

function validateArtifact(value:unknown):ClarificationArtifact{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Clarification artifact must be a JSON object.");
  const x=value as Record<string,unknown>;
  if(x.version!=="2")throw new Error("Clarification artifact must use version 2.");
  if(!nonempty(x.requestHash))throw new Error("Clarification artifact requires requestHash.");
  if(x.status!=="resolved"&&x.status!=="awaiting_user")throw new Error("Clarification status must be resolved or awaiting_user.");
  if(!Array.isArray(x.decisions)||x.decisions.length===0)throw new Error("Clarification artifact requires at least one decision.");

  const decisionIds=new Set<string>();
  const decisions:ClarificationDecision[]=x.decisions.map((item,i)=>{
    if(!item||typeof item!=="object"||Array.isArray(item))throw new Error(`decisions[${i}] must be an object.`);
    const v=item as Record<string,unknown>;
    if(!nonempty(v.id)||hasPlaceholder(v.id))throw new Error(`decisions[${i}].id must be concrete.`);
    if(decisionIds.has(v.id))throw new Error(`Duplicate decision id '${v.id}'.`);
    decisionIds.add(v.id);
    if(!nonempty(v.label)||hasPlaceholder(v.label))throw new Error(`decisions[${i}].label must be concrete.`);
    if(v.source!=="USER_EXPLICIT"&&v.source!=="CONTEXT_INFERRED"&&v.source!=="MODEL_DEFAULT"&&v.source!=="UNRESOLVED")
      throw new Error(`decisions[${i}].source is invalid.`);
    if(v.materiality!=="low"&&v.materiality!=="medium"&&v.materiality!=="high")throw new Error(`decisions[${i}].materiality is invalid.`);
    if(!nonempty(v.reason)||hasPlaceholder(v.reason))throw new Error(`decisions[${i}].reason must explain evidence and downstream impact.`);
    if(v.value!==undefined&&(!nonempty(v.value)||hasPlaceholder(v.value)))throw new Error(`decisions[${i}].value must be concrete when present.`);
    if(v.confidence!==undefined&&(typeof v.confidence!=="number"||v.confidence<0||v.confidence>1))throw new Error(`decisions[${i}].confidence must be between 0 and 1.`);
    const alternatives=v.alternatives===undefined?undefined:stringArray(v.alternatives,`decisions[${i}].alternatives`);
    return {id:v.id,label:v.label,value:v.value as string|undefined,source:v.source,confidence:v.confidence as number|undefined,materiality:v.materiality,reason:v.reason,alternatives};
  });

  if(!Array.isArray(x.questions))throw new Error("questions must be an array.");
  if(x.questions.length>2)throw new Error("At most 2 high-information clarification questions are allowed.");
  const questionIds=new Set<string>();
  const questions:ClarificationQuestion[]=x.questions.map((item,i)=>{
    if(!item||typeof item!=="object"||Array.isArray(item))throw new Error(`questions[${i}] must be an object.`);
    const q=item as Record<string,unknown>;
    if(!nonempty(q.id)||hasPlaceholder(q.id))throw new Error(`questions[${i}].id must be concrete.`);
    if(questionIds.has(q.id))throw new Error(`Duplicate clarification question id '${q.id}'.`);
    questionIds.add(q.id);
    if(!nonempty(q.question)||hasPlaceholder(q.question))throw new Error(`questions[${i}].question must be concrete.`);
    const resolves=stringArray(q.resolves,`questions[${i}].resolves`,false);
    for(const id of resolves)if(!decisionIds.has(id))throw new Error(`questions[${i}] resolves unknown decision '${id}'.`);
    const options=q.options===undefined?undefined:stringArray(q.options,`questions[${i}].options`);
    return {id:q.id,question:q.question,resolves,options};
  });

  if(!Array.isArray(x.answers))throw new Error("answers must be an array.");
  const answers=x.answers.map((a,i)=>validateAnswer(a,i,questionIds));
  if(new Set(answers.map(a=>a.questionId)).size!==answers.length)throw new Error("Each clarification question can be answered at most once.");

  if(x.status==="awaiting_user"){
    if(questions.length===0)throw new Error("awaiting_user requires at least one question.");
    if(answers.length===questions.length)throw new Error("Use status resolved when every question already has an answer.");
  }else{
    if(questions.length!==answers.length)throw new Error("resolved clarification must contain one answer for every question.");
    const covered=new Set(questions.flatMap(q=>q.resolves));
    const unhandled=decisions.filter(v=>v.source==="UNRESOLVED"&&v.materiality==="high"&&!covered.has(v.id));
    if(unhandled.length)throw new Error(`High-materiality unresolved decisions require clarification questions: ${unhandled.map(v=>v.id).join(", ")}`);
  }

  return {version:"2",requestHash:x.requestHash,status:x.status,decisions,questions,answers};
}

async function assertRequestBinding(root:string,artifact:ClarificationArtifact):Promise<void>{
  const p=harnessPaths(root);await requireFile(p.request,"Captured user request");
  const current=sha256(await readText(p.request));
  if(artifact.requestHash!==current)throw new Error("Clarification belongs to a different request or the request was modified after clarification.");
}

export async function clarificationTemplate(root:string):Promise<ClarificationArtifact>{
  const p=harnessPaths(root);await requireFile(p.request,"Captured user request");
  if(await exists(p.productionProfile))throw new Error("Clarification cannot start after the production profile is frozen.");
  if(await exists(p.clarification))throw new Error("A clarification artifact already exists. Run `video init` for a new request.");
  return {
    version:"2",
    requestHash:sha256(await readText(p.request)),
    status:"resolved",
    decisions:[{
      id:"objective",
      label:"Primary video objective",
      value:"REPLACE: infer from prompt/repo/assets or leave unresolved when materially ambiguous.",
      source:"UNRESOLVED",
      confidence:0,
      materiality:"high",
      reason:"REPLACE: explain the evidence, missing preference, and downstream impact.",
      alternatives:[],
    }],
    questions:[],
    answers:[],
  };
}

export async function commitClarification(root:string,file:string):Promise<{clarification:ClarificationArtifact;clarificationHash:string;needsUserInput:boolean}>{
  const p=harnessPaths(root);await requireFile(p.request,"Captured user request");
  if(await exists(p.productionProfile))throw new Error("Clarification cannot be committed after the production profile is frozen.");
  if(await exists(p.clarification))throw new Error("A clarification artifact already exists.");
  const clarification=validateArtifact(await readJson(resolve(root,file)));
  await assertRequestBinding(root,clarification);
  await writeJson(p.clarification,clarification);
  return {clarification,clarificationHash:sha256(JSON.stringify(clarification)),needsUserInput:clarification.status==="awaiting_user"};
}

export async function resolveClarification(root:string,file:string):Promise<{clarification:ClarificationArtifact;clarificationHash:string}>{
  const p=harnessPaths(root);await requireFile(p.clarification,"Clarification artifact");
  const stored=validateArtifact(await readJson(p.clarification));await assertRequestBinding(root,stored);
  if(stored.status!=="awaiting_user")throw new Error("Clarification is not awaiting user input.");
  const raw=await readJson<ClarificationAnswersDocument>(resolve(root,file));
  if(!raw||!Array.isArray(raw.answers))throw new Error("Answer document must contain an answers array.");
  const qids=new Set(stored.questions.map(q=>q.id));
  const supplied=raw.answers.map((a,i)=>validateAnswer(a,i,qids));
  const byId=new Map(stored.answers.map(a=>[a.questionId,a]));
  for(const answer of supplied)byId.set(answer.questionId,answer);
  const merged=stored.questions.map(q=>byId.get(q.id)).filter((x):x is ClarificationAnswer=>Boolean(x));
  if(merged.length!==stored.questions.length){
    const missing=stored.questions.filter(q=>!byId.has(q.id)).map(q=>q.id);
    throw new Error(`Clarification still needs answers for: ${missing.join(", ")}`);
  }
  const resolved=validateArtifact({...stored,status:"resolved",answers:merged});
  await assertRequestBinding(root,resolved);
  await writeJson(p.clarification,resolved);
  return {clarification:resolved,clarificationHash:sha256(JSON.stringify(resolved))};
}

export async function loadClarification(root:string):Promise<ClarificationArtifact>{
  const p=harnessPaths(root);await requireFile(p.clarification,"Clarification artifact");
  const artifact=validateArtifact(await readJson(p.clarification));await assertRequestBinding(root,artifact);return artifact;
}

export async function clarificationHash(root:string):Promise<string>{return sha256(JSON.stringify(await loadClarification(root)));}

export async function assertClarificationResolved(root:string):Promise<ClarificationArtifact>{
  const clarification=await loadClarification(root);
  if(clarification.status==="awaiting_user")throw new Error("NEEDS_USER_INPUT: clarification questions are pending. Surface them to the user and stop; the human or host resolves them with `npm run video:host -- clarify resolve <answers.json>`.");
  return clarification;
}

export async function clarificationStatus(root:string):Promise<Record<string,unknown>>{
  const p=harnessPaths(root);
  if(!(await exists(p.clarification)))return {ready:false,phase:"needs_clarification_assessment",needsUserInput:false};
  try{
    const c=await loadClarification(root);
    return {ready:c.status==="resolved",phase:c.status==="awaiting_user"?"needs_user_input":"resolved",needsUserInput:c.status==="awaiting_user",decisions:c.decisions,questions:c.status==="awaiting_user"?c.questions:[],answers:c.answers,clarificationHash:sha256(JSON.stringify(c))};
  }catch(error){return {ready:false,error:error instanceof Error?error.message:String(error)};}
}

export async function validateClarificationApplied(root:string,clarificationApplied?:ClarificationApplied):Promise<void>{
  const p=harnessPaths(root);
  if(!(await exists(p.clarification)))throw new Error("Pre-production clarification assessment is required before profile freeze.");
  const stored=await assertClarificationResolved(root);
  if(!clarificationApplied)throw new Error("Production profile is missing clarificationApplied.");
  if(clarificationApplied.clarificationHash!==sha256(JSON.stringify(stored)))throw new Error("clarificationApplied.clarificationHash does not match resolved clarification.");
  const expected=stored.answers.map(a=>a.questionId).sort();
  const actual=[...new Set(clarificationApplied.appliedAnswerIds)].sort();
  if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error("clarificationApplied.appliedAnswerIds must exactly match resolved human answer ids.");
}
