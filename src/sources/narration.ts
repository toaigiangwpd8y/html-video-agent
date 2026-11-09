import {readFile} from "node:fs/promises";
import {relative,resolve} from "node:path";
import {writeJson} from "../core/io.js";
import {deckDirectory} from "./extract.js";
import type {DeckIndex} from "./types.js";

/**
 * Slide-labeled voice-over script ("fixed input") binding.
 *
 * Format (Markdown):
 *   ## Slide 3: Title            one slide, narrated
 *   ## Slides 4-6: Title         several slides merged into one narrated segment
 *   ## Slides 1, 2 [skip]        slides deliberately not narrated; the body is the reason
 *   > author note                lines starting with ">" are notes, not narration
 * Every non-hidden slide must be covered exactly once (narrated or skipped).
 */
export const NARRATION_SCHEMA="slide-narration/v1";
export const WORDS_PER_MINUTE=150;

export interface NarrationSegment {id:string;slides:number[];title?:string;narration:string;words:number;estimatedSeconds:number;notes:string[];}
export interface NarrationBinding {
  schema:typeof NARRATION_SCHEMA;deckId:string;script:string;
  segments:NarrationSegment[];skipped:Array<{slides:number[];reason:string}>;
  totals:{segments:number;narratedSlides:number;skippedSlides:number;words:number;estimatedSeconds:number;wordsPerMinute:number};
  errors:string[];warnings:string[];
}

const HEADING=/^##\s+Slides?\s+(\d+(?:\s*[-–—]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–—]\s*\d+)?)*)\s*(\[(skip)\])?\s*(?:[:—–-]\s*(.*?))?\s*(\[(skip)\])?\s*$/i;
function parseSlides(spec:string):number[]{
  const out:number[]=[];
  for(const part of spec.split(",").map(s=>s.trim()).filter(Boolean)){
    const range=/^(\d+)\s*[-–—]\s*(\d+)$/.exec(part);
    if(range){const a=Number(range[1]),b=Number(range[2]);if(b<a)throw new Error(`Descending slide range '${part}'`);for(let n=a;n<=b;n++)out.push(n);}
    else if(/^\d+$/.test(part))out.push(Number(part));else throw new Error(`Bad slide reference '${part}'`);
  }
  return out;
}
const countWords=(text:string)=>text.split(/\s+/).filter(w=>/[\p{L}\p{N}]/u.test(w)).length;

export function parseNarrationScript(markdown:string,deck:Pick<DeckIndex,"id"|"slideCount"|"slides">,scriptPath:string):NarrationBinding{
  const errors:string[]=[],warnings:string[]=[],segments:NarrationSegment[]=[],skipped:NarrationBinding["skipped"]=[];
  let current:{slides:number[];title?:string;skip:boolean;body:string[];notes:string[];line:number}|undefined;
  const flush=()=>{
    if(!current)return;
    const narration=current.body.join("\n").replace(/\n{3,}/g,"\n\n").trim();
    if(current.skip)skipped.push({slides:current.slides,reason:narration||current.notes.join(" ")||"(no reason given)"});
    else{
      if(!narration)errors.push(`Line ${current.line}: section for slide(s) ${current.slides.join(", ")} has no narration; mark it [skip] with a reason instead.`);
      const words=countWords(narration);
      segments.push({id:`seg-${String(segments.length+1).padStart(2,"0")}`,slides:current.slides,...(current.title?{title:current.title}:{}),narration,words,estimatedSeconds:Math.round(words/WORDS_PER_MINUTE*600)/10,notes:current.notes});
    }
    current=undefined;
  };
  markdown.split(/\r?\n/).forEach((line,i)=>{
    if(/^##\s/.test(line)){
      flush();const m=HEADING.exec(line);
      if(!m){errors.push(`Line ${i+1}: heading is not a slide label ('## Slide N' or '## Slides N-M'): ${line.trim()}`);return;}
      try{current={slides:parseSlides(m[1]),...(m[4]?{title:m[4]}:{}),skip:!!(m[3]||m[6]),body:[],notes:[],line:i+1};}
      catch(error){errors.push(`Line ${i+1}: ${error instanceof Error?error.message:String(error)}`);}
      return;
    }
    if(!current)return;
    if(/^\s*>/.test(line)){current.notes.push(line.replace(/^\s*>\s?/,"").trim());return;}
    if(/^#\s/.test(line)){flush();return;}
    current.body.push(line.trim());
  });
  flush();
  const seen=new Map<number,string>(),hidden=new Set(deck.slides.filter(s=>s.hidden).map(s=>s.slide));
  const claim=(n:number,owner:string)=>{if(n<1||n>deck.slideCount)errors.push(`${owner} references slide ${n}, but the deck has ${deck.slideCount} slides.`);else if(seen.has(n))errors.push(`Slide ${n} is covered twice (${seen.get(n)} and ${owner}).`);else seen.set(n,owner);};
  for(const s of segments)for(const n of s.slides)claim(n,s.id);
  skipped.forEach((s,i)=>s.slides.forEach(n=>claim(n,`skip-${i+1}`)));
  const missing=Array.from({length:deck.slideCount},(_,i)=>i+1).filter(n=>!seen.has(n)&&!hidden.has(n));
  if(missing.length)errors.push(`Slides not covered (narrate or mark [skip]): ${missing.join(", ")}`);
  for(let i=1;i<segments.length;i++)if(Math.min(...segments[i].slides)<Math.max(...segments[i-1].slides))warnings.push(`${segments[i].id} narrates slides out of deck order.`);
  const words=segments.reduce((sum,s)=>sum+s.words,0);
  return {schema:NARRATION_SCHEMA,deckId:deck.id,script:scriptPath,segments,skipped,
    totals:{segments:segments.length,narratedSlides:segments.reduce((n,s)=>n+s.slides.length,0),skippedSlides:skipped.reduce((n,s)=>n+s.slides.length,0),words,estimatedSeconds:Math.round(words/WORDS_PER_MINUTE*60),wordsPerMinute:WORDS_PER_MINUTE},errors,warnings};
}

/** Validate a slide-labeled script against an extracted deck and write narration.json next to deck.json. */
export async function bindNarrationScript(root:string,id:string,script:string):Promise<NarrationBinding>{
  const dir=deckDirectory(root,id),deck=JSON.parse(await readFile(resolve(dir,"deck.json"),"utf8")) as DeckIndex,file=resolve(root,script);
  const binding=parseNarrationScript(await readFile(file,"utf8"),deck,relative(root,file).replaceAll("\\","/"));
  await writeJson(resolve(dir,"narration.json"),binding);
  return binding;
}
