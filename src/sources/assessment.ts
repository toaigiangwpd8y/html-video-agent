import {readFile,stat} from "node:fs/promises";
import {resolve} from "node:path";
import {writeJson} from "../core/io.js";
import {deckDirectory} from "./extract.js";
import type {NarrationBinding} from "./narration.js";
import type {DeckIndex,SlideRecord} from "./types.js";

/**
 * Slide assessment (`.video/sources/<id>/assessment.json`): per-slide legibility, expression quality,
 * a presentation decision, and which extracted assets may be reused (with licence).
 * The agent authors the judgment; `template` pre-fills measured facts and `check` validates the record.
 */
export const ASSESSMENT_SCHEMA="slide-assessment/v1";
/** Smallest text height, in px, when the slide is fit to a 1080 px tall frame. */
export const LEGIBILITY_PX={good:28,marginal:20};
export const DECISIONS=["keep-whole","crop-elements","rebuild-animated","text-only","omit"] as const;
export type Decision=typeof DECISIONS[number];
export const EXPRESSION=["strong","adequate","weak"] as const;
/** Expression issues that cannot coexist with a "strong" rating (legibility issues such as small-text can). */
export const STRONG_CONFLICTS=["wall-of-text","fragmented-labels"];
export const LEGIBILITY=["good","marginal","poor","n/a"] as const;
export const ASSET_KINDS=["slide-render","embedded-image","crop"] as const;
export const ASSET_USES=["whole","whole-with-attribution","crop","reference-only"] as const;

export interface AssetLicense {
  /** e.g. "CC BY", "CC BY-NC-ND", "course-deck", "unknown". */
  id:string;
  attribution?:string;source?:string;
  /** Machine-checkable restrictions: "no-derivatives", "non-commercial", "attribution-required". */
  constraints:string[];
}
export interface ReusableAsset {path:string;kind:typeof ASSET_KINDS[number];use:typeof ASSET_USES[number];license:AssetLicense;note?:string;}
export interface SlideAssessment {
  slide:number;title?:string;segment:string|null;
  legibility:{rating:typeof LEGIBILITY[number];minFontPxAt1080?:number;note?:string};
  expression:{rating:typeof EXPRESSION[number];issues:string[]};
  decision:Decision|null;
  reusableAssets:ReusableAsset[];
  rejectedAssets:Array<{path:string;reason:string}>;
  reason:string;
}
export interface DeckAssessment {
  schema:typeof ASSESSMENT_SCHEMA;deckId:string;deckSha256:string;
  frame:{width:number;height:number;slideFit:string;legibilityPx:typeof LEGIBILITY_PX};
  slides:SlideAssessment[];
  summary?:Record<string,unknown>;
}
export interface AssessmentCheck {ok:boolean;errors:string[];warnings:string[];summary:Record<string,unknown>;}

export function legibilityRating(px:number|undefined):SlideAssessment["legibility"]["rating"]{
  if(px===undefined)return "n/a";return px>=LEGIBILITY_PX.good?"good":px>=LEGIBILITY_PX.marginal?"marginal":"poor";
}

async function loadDeck(root:string,id:string){
  const dir=deckDirectory(root,id),deck=JSON.parse(await readFile(resolve(dir,"deck.json"),"utf8")) as DeckIndex;
  let narration:NarrationBinding|undefined;try{narration=JSON.parse(await readFile(resolve(dir,"narration.json"),"utf8"));}catch{}
  return {dir,deck,narration};
}
function segmentOf(narration:NarrationBinding|undefined,slide:number):string|null{return narration?.segments.find(s=>s.slides.includes(slide))?.id??null;}

/** Draft with measured facts filled in and judgment fields left for the agent (decision null, reason empty). */
export async function assessmentTemplate(root:string,id:string):Promise<DeckAssessment>{
  const {dir,deck,narration}=await loadDeck(root,id),slides:SlideAssessment[]=[];
  for(const entry of deck.slides){
    const record=JSON.parse(await readFile(resolve(dir,entry.json),"utf8")) as SlideRecord,m=record.metrics,issues:string[]=[];
    if(m.bodyWordCount>=55)issues.push("wall-of-text");
    if(m.minFontPxAt1080!==undefined&&m.minFontPxAt1080<LEGIBILITY_PX.marginal)issues.push("small-text");
    if(m.textBlockCount>=10&&m.textAreaRatio<.12)issues.push("fragmented-labels");
    const segment=segmentOf(narration,entry.slide),skipped=!!narration?.skipped.some(s=>s.slides.includes(entry.slide));
    slides.push({slide:entry.slide,...(entry.title?{title:entry.title}:{}),segment,
      legibility:{rating:legibilityRating(m.minFontPxAt1080),...(m.minFontPxAt1080!==undefined?{minFontPxAt1080:m.minFontPxAt1080}:{})},
      expression:{rating:"adequate",issues},decision:skipped?"omit":null,
      reusableAssets:[],rejectedAssets:record.images.filter(i=>i.chrome).map(i=>({path:i.asset,reason:"template chrome (repeated logo/decoration)"})),
      reason:""});
  }
  return {schema:ASSESSMENT_SCHEMA,deckId:deck.id,deckSha256:deck.source.sha256,frame:{width:1920,height:1080,slideFit:"full slide fit to frame height",legibilityPx:LEGIBILITY_PX},slides};
}

export function summarize(a:DeckAssessment):Record<string,unknown>{
  const count=<T extends string>(values:T[])=>values.reduce((acc,v)=>({...acc,[v]:(acc[v]??0)+1}),{} as Record<string,number>);
  const reused=a.slides.flatMap(s=>s.reusableAssets.filter(r=>r.use!=="reference-only"));
  return {slides:a.slides.length,decisions:count(a.slides.map(s=>s.decision??"undecided")),legibility:count(a.slides.map(s=>s.legibility.rating)),expression:count(a.slides.map(s=>s.expression.rating)),
    reusedAssets:reused.length,licences:count(reused.map(r=>r.license.id))};
}

/** Validate an assessment against the extracted deck and narration binding. */
export async function checkAssessment(root:string,id:string,file?:string):Promise<AssessmentCheck>{
  const {dir,deck,narration}=await loadDeck(root,id),path=file?resolve(root,file):resolve(dir,"assessment.json");
  const a=JSON.parse(await readFile(path,"utf8")) as DeckAssessment,errors:string[]=[],warnings:string[]=[];
  if(a.schema!==ASSESSMENT_SCHEMA)errors.push(`schema must be '${ASSESSMENT_SCHEMA}'.`);
  if(a.deckId!==deck.id)errors.push(`deckId '${a.deckId}' does not match '${deck.id}'.`);
  if(a.deckSha256!==deck.source.sha256)errors.push("deckSha256 does not match the extracted source; re-run the template after re-extraction.");
  const seen=new Set<number>();
  for(const s of a.slides??[]){
    const at=`slide ${s.slide}`;
    if(seen.has(s.slide))errors.push(`${at}: assessed twice.`);seen.add(s.slide);
    const entry=deck.slides.find(x=>x.slide===s.slide);if(!entry){errors.push(`${at}: not in deck.`);continue;}
    if(!LEGIBILITY.includes(s.legibility?.rating))errors.push(`${at}: legibility.rating must be one of ${LEGIBILITY.join("|")}.`);
    else{const measured=legibilityRating(entry.minFontPxAt1080);if(measured!=="n/a"&&s.legibility.rating!==measured&&!s.legibility.note)warnings.push(`${at}: legibility '${s.legibility.rating}' differs from measured '${measured}' (${entry.minFontPxAt1080}px) without a note.`);}
    if(!EXPRESSION.includes(s.expression?.rating))errors.push(`${at}: expression.rating must be one of ${EXPRESSION.join("|")}.`);
    if(!Array.isArray(s.expression?.issues))errors.push(`${at}: expression.issues must be an array.`);
    else if(s.expression.rating==="strong"){const clash=s.expression.issues.filter(i=>STRONG_CONFLICTS.includes(i));if(clash.length)errors.push(`${at}: expression 'strong' contradicts issue(s) ${clash.join(", ")}; drop the issue or lower the rating.`);}
    if(!s.decision||!DECISIONS.includes(s.decision))errors.push(`${at}: decision must be one of ${DECISIONS.join("|")}.`);
    if(typeof s.reason!=="string"||!s.reason.trim())errors.push(`${at}: reason is required.`);else if(/\n/.test(s.reason))errors.push(`${at}: reason must be one line.`);
    const skipped=!!narration?.skipped.some(x=>x.slides.includes(s.slide)),segment=segmentOf(narration,s.slide);
    if(narration){
      if(s.segment!==segment)errors.push(`${at}: segment '${s.segment}' does not match narration binding '${segment}'.`);
      if(skipped&&s.decision!=="omit")errors.push(`${at}: the approved script skips this slide, so decision must be 'omit'.`);
      if(!skipped&&s.decision==="omit")errors.push(`${at}: narrated slide cannot be 'omit'; use text-only or rebuild-animated.`);
    }else warnings.push("No narration.json: segment coverage not checked.");
    const reused=(s.reusableAssets??[]).filter(r=>r.use!=="reference-only");
    for(const r of s.reusableAssets??[]){
      if(!ASSET_KINDS.includes(r.kind))errors.push(`${at}: asset ${r.path} kind must be one of ${ASSET_KINDS.join("|")}.`);
      if(!ASSET_USES.includes(r.use))errors.push(`${at}: asset ${r.path} use must be one of ${ASSET_USES.join("|")}.`);
      try{if(!(await stat(resolve(dir,r.path))).isFile())errors.push(`${at}: ${r.path} is not a file.`);}catch{errors.push(`${at}: ${r.path} does not exist under the deck directory.`);}
      if(!r.license?.id)errors.push(`${at}: ${r.path} needs a licence id (use "unknown" when not stated).`);
      const constraints=r.license?.constraints??[];
      if(constraints.includes("no-derivatives")&&r.use==="crop")errors.push(`${at}: ${r.path} is no-derivatives; it may only be used whole.`);
      if(constraints.includes("attribution-required")&&r.use!=="reference-only"&&!r.license.attribution)errors.push(`${at}: ${r.path} requires attribution text.`);
      if(r.license?.id==="unknown"&&r.use!=="reference-only")errors.push(`${at}: ${r.path} has an unknown licence; it cannot be reused on screen (mark it reference-only or reject it).`);
      if(r.kind==="crop"&&r.use!=="crop"&&r.use!=="reference-only")warnings.push(`${at}: ${r.path} is a crop but use is '${r.use}'.`);
    }
    if(s.decision==="keep-whole"&&!reused.some(r=>r.kind==="slide-render"))errors.push(`${at}: keep-whole needs the slide render as a reusable asset.`);
    if(s.decision==="crop-elements"&&!reused.some(r=>r.kind!=="slide-render"))errors.push(`${at}: crop-elements needs at least one reusable crop or embedded image.`);
    if(s.decision==="text-only"&&reused.length)warnings.push(`${at}: text-only slide lists on-screen reusable assets.`);
    if(s.legibility?.rating==="poor"&&s.decision==="keep-whole")warnings.push(`${at}: keep-whole with poor legibility at 1080p.`);
  }
  const missing=deck.slides.filter(x=>!seen.has(x.slide)).map(x=>x.slide);
  if(missing.length)errors.push(`Slides not assessed: ${missing.join(", ")}`);
  const summary=summarize(a);
  return {ok:errors.length===0,errors,warnings,summary};
}

export async function writeAssessmentTemplate(root:string,id:string,out?:string):Promise<string>{
  const template=await assessmentTemplate(root,id),path=out?resolve(root,out):resolve(deckDirectory(root,id),"assessment.template.json");
  await writeJson(path,template);return path;
}
