import {createHash} from "node:crypto";
import {copyFile,mkdir,mkdtemp,readdir,readFile,rm,stat,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename,extname,relative,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {writeJson} from "../core/io.js";
import {extractPdfTextLayer,isDecoration,pdfInfo,renderPdfPages,renderPdfRegion,round,runsWithin,tool,toolVersion,type PdfPageText,type PdfRun} from "./poppler.js";
import {readPptx,type PptxSlide} from "./pptx.js";
import {DECK_SCHEMA,SLIDE_SCHEMA,type Bounds,type DeckImage,type DeckIndex,type ImageElement,type ShapeElement,type SlideMetrics,type SlideRecord,type TextBlock} from "./types.js";
import {openZip} from "./zip.js";

export const SOURCES_DIR=".video/sources";
export const DEFAULT_DPI=216;
/** An image on at least this share of slides (and on 3+ slides) is template chrome such as a logo. */
const CHROME_SHARE=.5;
/** A placed image below this share of the slide area is treated as decoration, not content. */
const DECORATIVE_AREA=.015;

export interface ExtractOptions {id?:string;dpi?:number;contactSheets?:boolean;}
export interface ExtractResult {deck:DeckIndex;directory:string;}

export function deckIdFrom(file:string):string{
  return basename(file,extname(file)).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60)||"deck";
}
export function sourcesRoot(root:string):string{return resolve(root,SOURCES_DIR);}
export function deckDirectory(root:string,id:string):string{
  if(!/^[a-z0-9][a-z0-9-]*$/.test(id))throw new Error(`Invalid deck id '${id}': use lowercase letters, digits and hyphens.`);
  return resolve(sourcesRoot(root),id);
}
const pad=(n:number)=>String(n).padStart(3,"0");
const sha256=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const words=(text:string)=>text.split(/\s+/).filter(w=>/[\p{L}\p{N}]/u.test(w)).length;
const posixRel=(from:string,to:string)=>relative(from,to).replaceAll("\\","/");

/** Read PNG pixel size from its IHDR chunk, JPEG size from its SOF marker. */
export function imageSize(bytes:Buffer):{width:number;height:number}|undefined{
  if(bytes.length>24&&bytes.readUInt32BE(0)===0x89504e47)return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  if(bytes.length>4&&bytes[0]===0xff&&bytes[1]===0xd8){let i=2;while(i+9<bytes.length){if(bytes[i]!==0xff){i++;continue;}const marker=bytes[i+1];if(marker>=0xc0&&marker<=0xcf&&marker!==0xc4&&marker!==0xc8&&marker!==0xcc)return {height:bytes.readUInt16BE(i+5),width:bytes.readUInt16BE(i+7)};i+=2+bytes.readUInt16BE(i+2);}}
  if(bytes.length>10&&bytes.toString("ascii",0,3)==="GIF")return {width:bytes.readUInt16LE(6),height:bytes.readUInt16LE(8)};
  return undefined;
}
function formatOf(name:string,bytes:Buffer):string{
  if(bytes.readUInt32BE(0)===0x89504e47)return "png";if(bytes[0]===0xff&&bytes[1]===0xd8)return "jpg";if(bytes.toString("ascii",0,3)==="GIF")return "gif";
  const ext=extname(name).slice(1).toLowerCase();return ext==="jpeg"?"jpg":ext||"bin";
}

/** De-duplicating image store: identical bytes are written once under images/. */
class ImageStore{
  readonly entries=new Map<string,DeckImage>();
  constructor(private readonly deckDir:string){}
  async add(bytes:Buffer,name:string,slide:number):Promise<DeckImage>{
    const hash=sha256(bytes);let entry=this.entries.get(hash);
    if(!entry){
      const format=formatOf(name,bytes),id=`img-${hash.slice(0,12)}`,file=`images/${id}.${format}`,size=imageSize(bytes);
      await writeFile(resolve(this.deckDir,file),bytes);
      entry={id,path:file,sha256:hash,format,...(size?{pixelWidth:size.width,pixelHeight:size.height}:{}),slides:[],chrome:false,bytes:bytes.length};this.entries.set(hash,entry);
    }
    if(!entry.slides.includes(slide))entry.slides.push(slide);
    return entry;
  }
  finalize(slideCount:number):DeckImage[]{
    const list=[...this.entries.values()].sort((a,b)=>a.slides[0]-b.slides[0]||a.id.localeCompare(b.id));
    for(const e of list)e.chrome=slideCount>=3&&e.slides.length>=3&&e.slides.length/slideCount>=CHROME_SHARE;
    return list;
  }
}

function union(bounds:Bounds[]):number{return bounds.reduce((sum,b)=>sum+b.width*b.height,0);}
function metricsFor(record:Pick<SlideRecord,"textBlocks"|"images"|"size">):SlideMetrics{
  const area=record.size.width*record.size.height,sizes=record.textBlocks.filter(b=>b.role!=="footer").flatMap(b=>[b.fontSizePt,b.minFontSizePt]).filter((s):s is number=>typeof s==="number"&&s>0);
  const content=record.images.filter(i=>!i.chrome&&!i.decorative),minFont=sizes.length?Math.min(...sizes):undefined;
  return {
    wordCount:words(record.textBlocks.map(b=>b.text).join(" ")),textBlockCount:record.textBlocks.length,
    bodyWordCount:words(record.textBlocks.filter(b=>b.role==="body"||b.role==="other"||b.role==="subtitle").map(b=>b.text).join(" ")),
    imageCount:record.images.length,contentImageCount:content.length,
    ...(minFont!==undefined?{minFontSizePt:minFont,maxFontSizePt:Math.max(...sizes),minFontPxAt1080:round(minFont*1080/record.size.height,1)}:{}),
    textAreaRatio:round(Math.min(1,union(record.textBlocks.filter(b=>b.role!=="footer"&&b.bounds).map(b=>b.bounds!))/area),3),
    imageAreaRatio:round(Math.min(1,union(content.filter(i=>i.bounds).map(i=>i.bounds!))/area),3),
  };
}

/** Classify PDF text-layer blocks: footer band, title (outline title or largest top text), else body. */
function pdfBlocks(page:PdfPageText,size:{width:number;height:number},slide:number,outlineTitle?:string):TextBlock[]{
  const blocks=page.blocks.map((b,i)=>{
    const runs=runsWithin(page.runs,b.bounds).filter(r=>!isDecoration(r.text)),sizes=runs.map(r=>r.fontSizePt).filter(s=>s>0);
    const block:TextBlock={id:`s${pad(slide)}-text-${String(i+1).padStart(2,"0")}`,role:"body",text:b.text,bounds:b.bounds,...(sizes.length?{fontSizePt:Math.max(...sizes),minFontSizePt:Math.min(...sizes)}:{}),...(runs.some(r=>r.bold)?{bold:true}:{}),...(runs[0]?.color?{color:runs[0].color}:{}),source:"pdf-text-layer"};
    return block;
  });
  for(const b of blocks){const top=b.bounds!.y,bottom=top+b.bounds!.height;if(top>=size.height*.9&&bottom<=size.height+1&&words(b.text)<=12)b.role="footer";}
  const normalized=(t:string)=>t.replace(/\s+/g," ").trim().toLowerCase();
  let title=outlineTitle?blocks.find(b=>b.role!=="footer"&&normalized(b.text).startsWith(normalized(outlineTitle).slice(0,Math.min(24,outlineTitle.length)))):undefined;
  if(!title){const top=blocks.filter(b=>b.role!=="footer"&&b.bounds!.y<size.height*.3&&b.fontSizePt);const max=Math.max(0,...top.map(b=>b.fontSizePt!));title=top.find(b=>b.fontSizePt===max&&max>=20);}
  if(title)title.role="title";
  return blocks;
}

function slideText(record:Pick<SlideRecord,"textBlocks"|"title">):string{
  const order=(b:TextBlock)=>b.role==="title"?0:b.role==="footer"?2:1;
  return [...record.textBlocks].sort((a,b)=>order(a)-order(b)).map(b=>b.role==="footer"?`[footer] ${b.text.replace(/\n/g," ")}`:b.text).join("\n\n").trim()+"\n";
}

async function soffice(pptx:string,outDir:string):Promise<string>{
  const profile=await mkdtemp(resolve(tmpdir(),"video-soffice-"));
  try{await tool("soffice",[`-env:UserInstallation=${pathToFileURL(profile).href}`,"--headless","--norestore","--convert-to","pdf","--outdir",outDir,pptx],{timeout:600_000});}
  finally{await rm(profile,{recursive:true,force:true});}
  const pdf=resolve(outDir,`${basename(pptx,extname(pptx))}.pdf`);
  try{await stat(pdf);}catch{throw new Error(`LibreOffice did not produce a PDF for ${pptx}`);}
  return pdf;
}

async function contactSheets(deckDir:string,renders:string[],warnings:string[]):Promise<string[]>{
  if(renders.length===0)return [];
  const perSheet=12,sheets:string[]=[],tmp=await mkdtemp(resolve(tmpdir(),"video-sheet-"));
  try{
    for(let start=0;start<renders.length;start+=perSheet){
      const batch=renders.slice(start,start+perSheet);
      for(let i=0;i<batch.length;i++)await copyFile(resolve(deckDir,batch[i]),resolve(tmp,`f-${pad(i+1)}.png`));
      const label=`drawtext=text='%{eif\\:n+${start+1}\\:d}':x=w-tw-14:y=h-th-12:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=6`;
      const out=`overview/contact-${pad(sheets.length+1)}.png`,cols=4,rows=Math.ceil(batch.length/cols);
      const args=["-y","-loglevel","error","-framerate","1","-i",resolve(tmp,"f-%03d.png"),"-frames:v","1"];
      try{await tool("ffmpeg",[...args,"-vf",`scale=480:-2,${label},tile=${cols}x${rows}:padding=6:color=0x444444`,resolve(deckDir,out)]);}
      catch{await tool("ffmpeg",[...args,"-vf",`scale=480:-2,tile=${cols}x${rows}:padding=6:color=0x444444`,resolve(deckDir,out)]);warnings.push("Contact sheets were written without slide-number labels (ffmpeg drawtext unavailable).");}
      sheets.push(out);for(const f of await readdir(tmp))await rm(resolve(tmp,f));
    }
  }catch(error){warnings.push(`Contact sheets skipped: ${error instanceof Error?error.message:String(error)}`);}
  finally{await rm(tmp,{recursive:true,force:true});}
  return sheets;
}

/**
 * Normalize a PDF or PPTX deck into `.video/sources/<id>/`:
 * slides/slide-NNN.png + slide-NNN.json, text/slide-NNN.txt, notes/slide-NNN.txt (PPTX speaker notes),
 * images/ (de-duplicated embedded images), elements/ (chart/diagram/media parts), overview/ contact sheets, deck.json.
 * Output is deterministic for identical input and tool versions (no timestamps).
 */
export async function extractDeck(root:string,input:string,options:ExtractOptions={}):Promise<ExtractResult>{
  const file=resolve(root,input),ext=extname(file).toLowerCase();
  if(ext!==".pdf"&&ext!==".pptx")throw new Error(`Unsupported deck format '${ext||"(none)"}'. Supported: .pdf, .pptx`);
  const bytes=await readFile(file),id=options.id??deckIdFrom(file),dir=deckDirectory(root,id),dpi=options.dpi??DEFAULT_DPI;
  await rm(dir,{recursive:true,force:true});
  for(const sub of ["slides","text","images","elements","overview"])await mkdir(resolve(dir,sub),{recursive:true});
  const work=await mkdtemp(resolve(tmpdir(),"video-extract-")),warnings:string[]=[],limitations:string[]=[];
  try{
    let pdf=file,pptxSlides:PptxSlide[]|undefined,pptxSize:{width:number;height:number}|undefined,pptxTitle:string|undefined,zip;
    if(ext===".pptx"){
      zip=openZip(bytes);const deck=readPptx(zip);pptxSlides=deck.slides;pptxSize=deck.slideSize;pptxTitle=deck.title;
      pdf=await soffice(file,work);await copyFile(pdf,resolve(dir,"rendered.pdf"));
      limitations.push("Slide renders come from LibreOffice; fonts, SmartArt and effects may differ slightly from PowerPoint.","Animations and transitions are not extracted.","Images on slide layouts/masters (template chrome) appear in renders but are not extracted as separate assets.");
    }else limitations.push("PDF vector artwork (shapes, arrows, diagrams drawn as paths) is not separable; use the full-slide render or `video sources crop` for a region.","PDF has no speaker notes or element grouping; text blocks come from the positioned text layer.");
    const info=await pdfInfo(pdf);
    const renderDir=resolve(work,"render"),imageDir=resolve(work,"images");await mkdir(renderDir);await mkdir(imageDir);
    const renders=await renderPdfPages(pdf,renderDir,dpi),layer=await extractPdfTextLayer(pdf,imageDir,info.pages);
    const store=new ImageStore(dir);
    const visible=pptxSlides?pptxSlides.filter(s=>!s.hidden):undefined;
    if(visible&&visible.length!==info.pages)warnings.push(`Rendered page count (${info.pages}) differs from visible PPTX slide count (${visible.length}); renders are mapped in order.`);
    const slideCount=pptxSlides?pptxSlides.length:info.pages,size=pptxSize??{width:info.width,height:info.height};
    const records:SlideRecord[]=[];
    for(let n=1;n<=slideCount;n++){
      const sid=`slide-${pad(n)}`,pptx=pptxSlides?.[n-1],slideWarnings:string[]=[...(pptx?.warnings??[])];
      const page=pptx?(pptx.hidden?undefined:visible!.indexOf(pptx)+1):n;
      const renderSrc=page?renders[page-1]:undefined;let render:SlideRecord["render"];
      if(renderSrc){const out=`slides/${sid}.png`;await copyFile(renderSrc,resolve(dir,out));const s=imageSize(await readFile(resolve(dir,out)));render={path:out,width:s?.width??0,height:s?.height??0,dpi};}
      else slideWarnings.push(pptx?.hidden?"Hidden slide: not rendered by LibreOffice.":"No page render available.");
      const pageText=page?layer.pages[page-1]:undefined;
      let textBlocks:TextBlock[],images:ImageElement[]=[],shapes:ShapeElement[]=[];
      if(pptx){
        textBlocks=pptx.textBlocks.map(b=>{
          if(b.fontSizePt!==undefined||!b.bounds||!pageText)return b;
          const sizes=runsWithin(pageText.runs,b.bounds).filter((r:PdfRun)=>!isDecoration(r.text)).map(r=>r.fontSizePt).filter(s=>s>0);
          return sizes.length?{...b,fontSizePt:Math.max(...sizes),minFontSizePt:Math.min(...sizes)}:b;
        });
        for(const pic of pptx.pictures){
          if(!zip!.has(pic.mediaPart)){slideWarnings.push(`Missing media part ${pic.mediaPart}`);continue;}
          const media=await store.add(zip!.read(pic.mediaPart),pic.mediaPart,n);
          if(!["png","jpg","gif","svg"].includes(media.format))slideWarnings.push(`${pic.id}: ${media.format.toUpperCase()} image kept in original format; convert before web use.`);
          images.push({id:pic.id,asset:media.path,sha256:media.sha256,format:media.format,...(media.pixelWidth?{pixelWidth:media.pixelWidth,pixelHeight:media.pixelHeight}:{}),...(pic.bounds?{bounds:pic.bounds}:{}),...(pic.name?{name:pic.name}:{}),...(pic.description?{description:pic.description}:{}),chrome:false,source:"ooxml-media"});
        }
        shapes=[];for(const shape of pptx.shapes){
          const part=pptx.parts.find(p=>p.id===shape.id);
          if(part&&zip!.has(part.part)){const out=`elements/${sid}/${shape.id}${extname(part.part)||".bin"}`;await mkdir(resolve(dir,"elements",sid),{recursive:true});await writeFile(resolve(dir,out),zip!.read(part.part));shapes.push({...shape,asset:out});}
          else{const {asset:_asset,...rest}=shape;shapes.push(rest);}
        }
      }else{
        textBlocks=pdfBlocks(pageText!,size,n,layer.outline.get(n));
        let k=0;for(const placement of pageText!.images){
          let data:Buffer;try{data=await readFile(placement.file);}catch{slideWarnings.push(`Image file missing from pdftohtml output: ${basename(placement.file)}`);continue;}
          const media=await store.add(data,placement.file,n);
          images.push({id:`s${pad(n)}-img-${String(++k).padStart(2,"0")}`,asset:media.path,sha256:media.sha256,format:media.format,...(media.pixelWidth?{pixelWidth:media.pixelWidth,pixelHeight:media.pixelHeight}:{}),bounds:placement.bounds,chrome:false,source:"pdf-embedded-image"});
        }
      }
      const title=pptx?.title??textBlocks.find(b=>b.role==="title")?.text.replace(/\s+/g," ").trim()??layer.outline.get(n);
      const textPath=`text/${sid}.txt`,notes=pptx?.notes;let notesPath:string|undefined;
      if(notes){notesPath=`notes/${sid}.txt`;await mkdir(resolve(dir,"notes"),{recursive:true});await writeFile(resolve(dir,notesPath),notes.trim()+"\n","utf8");}
      const record:SlideRecord={schema:SLIDE_SCHEMA,deckId:id,slide:n,id:sid,...(title?{title}:{}),...(pptx?.hidden?{hidden:true}:{}),size:{...size,unit:"pt"},...(render?{render}:{}),textPath,...(notesPath?{notesPath}:{}),text:"",...(notes?{notes}:{}),textBlocks,images,shapes,metrics:undefined as unknown as SlideMetrics,warnings:slideWarnings};
      record.text=slideText(record);await writeFile(resolve(dir,textPath),record.text,"utf8");
      records.push(record);
    }
    const deckImages=store.finalize(slideCount),chrome=new Set(deckImages.filter(i=>i.chrome).map(i=>i.sha256));
    for(const r of records){for(const img of r.images){img.chrome=chrome.has(img.sha256);if(img.bounds&&img.bounds.width*img.bounds.height<DECORATIVE_AREA*r.size.width*r.size.height)img.decorative=true;}r.metrics=metricsFor(r);if(r.textBlocks.length===0&&r.images.length===0)r.warnings.push("No text layer or embedded images: slide may be a flattened picture or vector-only; rely on the render.");await writeJson(resolve(dir,`slides/${r.id}.json`),r);}
    const deckText=records.map(r=>`=== Slide ${r.slide}${r.title?`: ${r.title.replace(/\s+/g," ")}`:""}${r.hidden?" (hidden)":""} ===\n${r.text.trim()}${r.notes?`\n\n[speaker notes]\n${r.notes.trim()}`:""}\n`).join("\n");
    await writeFile(resolve(dir,"text/deck.txt"),deckText,"utf8");
    const sheets=options.contactSheets===false?[]:await contactSheets(dir,records.filter(r=>r.render).map(r=>r.render!.path),warnings);
    const tools:Record<string,string>={poppler:await toolVersion("pdftoppm")};if(ext===".pptx")tools.libreoffice=await toolVersion("soffice",["--version"]);
    const ratio=size.width/size.height,aspect=Math.abs(ratio-4/3)<.02?"4:3":Math.abs(ratio-16/9)<.02?"16:9":Math.abs(ratio-16/10)<.02?"16:10":`${round(ratio,3)}:1`;
    const title=pptxTitle??records[0]?.title??basename(file,ext);
    const deck:DeckIndex={schema:DECK_SCHEMA,id,title:title.replace(/\s+/g," ").trim(),format:ext===".pdf"?"pdf":"pptx",
      source:{path:posixRel(root,file),fileName:basename(file),sha256:sha256(bytes),bytes:bytes.length},
      slideSize:{...size,unit:"pt",aspectRatio:aspect},slideCount,renderDpi:dpi,tools,
      files:{deckText:"text/deck.txt",...(ext===".pptx"?{renderedPdf:"rendered.pdf"}:{}),contactSheets:sheets},
      slides:records.map(r=>({slide:r.slide,id:r.id,...(r.title?{title:r.title}:{}),...(r.hidden?{hidden:true}:{}),...(r.render?{render:r.render.path}:{}),text:r.textPath,json:`slides/${r.id}.json`,...(r.notesPath?{notes:r.notesPath}:{}),wordCount:r.metrics.wordCount,imageCount:r.metrics.contentImageCount,...(r.metrics.minFontPxAt1080!==undefined?{minFontPxAt1080:r.metrics.minFontPxAt1080}:{}),warnings:r.warnings.length})),
      images:deckImages,limitations,warnings};
    await writeJson(resolve(dir,"deck.json"),deck);
    return {deck,directory:dir};
  }finally{await rm(work,{recursive:true,force:true});}
}

/** Crop a region (slide points) of one slide at render resolution into elements/slide-NNN/<name>.png. */
export async function cropSlideRegion(root:string,id:string,slide:number,region:Bounds,name:string,dpi?:number):Promise<string>{
  const dir=deckDirectory(root,id),deck=JSON.parse(await readFile(resolve(dir,"deck.json"),"utf8")) as DeckIndex;
  if(!/^[a-z0-9][a-z0-9-]*$/.test(name))throw new Error(`Invalid crop name '${name}'.`);
  const entry=deck.slides.find(s=>s.slide===slide);if(!entry)throw new Error(`Deck '${id}' has no slide ${slide}.`);
  const pdf=deck.format==="pdf"?resolve(root,deck.source.path):resolve(dir,deck.files.renderedPdf!);
  const page=deck.format==="pdf"?slide:deck.slides.filter(s=>!s.hidden&&s.slide<=slide).length;
  const outDir=resolve(dir,"elements",`slide-${pad(slide)}`);await mkdir(outDir,{recursive:true});
  await renderPdfRegion(pdf,page,dpi??deck.renderDpi,region,resolve(outDir,name));
  return posixRel(root,resolve(outDir,`${name}.png`));
}

export async function listDecks(root:string):Promise<Array<{id:string;title:string;format:string;slideCount:number;path:string}>>{
  let dirs:string[]=[];try{dirs=(await readdir(sourcesRoot(root),{withFileTypes:true})).filter(d=>d.isDirectory()).map(d=>d.name).sort();}catch{return [];}
  const out=[];for(const d of dirs){try{const deck=JSON.parse(await readFile(resolve(sourcesRoot(root),d,"deck.json"),"utf8")) as DeckIndex;out.push({id:deck.id,title:deck.title,format:deck.format,slideCount:deck.slideCount,path:posixRel(root,resolve(sourcesRoot(root),d))});}catch{}}
  return out;
}
