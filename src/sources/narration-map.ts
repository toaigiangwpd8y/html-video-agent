import type {SourceNarration} from "./normalized-source.js";

/** Parse an explicitly labeled, one-section-per-slide narration document. */
export function parseSlideNarration(text:string,slideCount:number,path?:string):Record<string,SourceNarration>{
  if(!text.trim())throw new Error("Narration file is empty.");
  const lines=text.replace(/\r\n/g,"\n").split("\n"),headers:Array<{index:number;slide:number}>=[];
  for(let index=0;index<lines.length;index++){
    const match=/^\s*(?:#{1,6}\s*)?(?:slide|page)[ -]+(\d+)\s*$/i.exec(lines[index]);
    if(match)headers.push({index,slide:Number(match[1])});
  }
  if(headers.length===0){
    if(slideCount===1)return {"slide-1":{text:text.trim(),...(path?{path}:{}),rewritePolicy:"preserve"}};
    throw new Error(`Narration must label each slide with a heading such as '## slide-1'; received an unlabeled script for ${slideCount} slides.`);
  }
  const preamble=lines.slice(0,headers[0].index).join("\n").trim();
  if(preamble)throw new Error("Narration contains text before the first slide label; put narration under an explicit slide heading.");
  const bySlide=new Map<number,string>();
  for(let index=0;index<headers.length;index++){
    const current=headers[index],next=headers[index+1]?.index??lines.length;
    if(current.slide<1||current.slide>slideCount)throw new Error(`Narration label slide-${current.slide} is outside the ${slideCount}-slide source.`);
    if(bySlide.has(current.slide))throw new Error(`Narration repeats the label slide-${current.slide}.`);
    const body=lines.slice(current.index+1,next).join("\n").trim();
    bySlide.set(current.slide,/^<!--\s*silent\s*-->$/i.test(body)?"":body);
  }
  for(let slide=1;slide<=slideCount;slide++)if(!bySlide.has(slide))throw new Error(`Narration is missing an explicit slide-${slide} label. Use an empty slide section or '<!-- silent -->' for an intentionally silent slide.`);
  return Object.fromEntries([...bySlide.entries()].filter(([,value])=>value.length>0).map(([slide,value])=>[`slide-${slide}`,{text:value,...(path?{path}:{}),rewritePolicy:"preserve" as const}]));
}
