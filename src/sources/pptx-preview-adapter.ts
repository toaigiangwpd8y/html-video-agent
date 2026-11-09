import {execFile} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {basename,extname,join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {loadPresentation,getSlides} from "@office-kit/pptx";
import {renderSlideToImage} from "@office-kit/pptx-preview/node";
import {Resvg} from "@resvg/resvg-js";

type Box={x:number;y:number;width:number;height:number};
type ParsedShape={type?:string;content?:string;left?:number;top?:number;width?:number;height?:number;fill?:{type?:string;value?:string};borderColor?:string;borderWidth?:number;borderType?:string;shapType?:string;path?:string;pathViewBox?:{x:number;y:number;width:number;height:number};name?:string;headEnd?:{type?:string};tailEnd?:{type?:string};};
type ParsedElement=ParsedShape & {elements?:ParsedShape[];textList?:string[]};
type ParsedSlide={elements?:ParsedElement[]};
type ParsedDeck={slides:Array<{elements?:unknown[]}>;size?:{width?:unknown;height?:unknown}};
export interface PptxPreviewSet {pages:Uint8Array[];renderer:string;fidelity:string;}

function record(value:unknown):Record<string,unknown>|undefined{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function esc(value:string):string{return value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");}
function cleanText(html:unknown):string{return typeof html==="string"?html.replace(/<[^>]*>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim():"";}
function color(fill:ParsedShape["fill"],fallback="#dce8f5"):string{return fill?.type==="color"&&typeof fill.value==="string"&&/^#[0-9a-f]{6}$/i.test(fill.value)?fill.value:fallback;}
function drawDiagram(diagram:ParsedElement):string{
  const x=diagram.left??0,y=diagram.top??0,w=diagram.width??0,h=diagram.height??0;
  const children=Array.isArray(diagram.elements)?diagram.elements:[];
  if(children.length){return `<g transform="translate(${x} ${y})"><rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>${children.map(child=>{
    const cx=child.left??0,cy=child.top??0,cw=child.width??0,ch=child.height??0,fill=color(child.fill),stroke=child.borderColor??"#334155",strokeWidth=child.borderWidth??0;
    const shape=child.path&&child.pathViewBox?`<path d="${esc(child.path)}" transform="translate(${cx} ${cy})" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`:`<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="${child.shapType==="roundRect"?6:0}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    const text=cleanText(child.content),tx=cx+cw/2,ty=cy+ch/2;
    return `${shape}${text?`<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="14" fill="#172033">${esc(text)}</text>`:""}`;
  }).join("")}</g>`;}
  const labels=(diagram.textList??[]).filter(Boolean);if(!labels.length)return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f1f5f9" stroke="#94a3b8"/><text x="${x+12}" y="${y+24}" font-family="Arial,sans-serif" font-size="16">SmartArt preview unavailable</text></g>`;
  const gap=8,cardHeight=Math.min(46,Math.max(28,(h-gap*(labels.length+1))/labels.length));
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff" stroke="#94a3b8"/>${labels.map((label,index)=>{const cardY=y+gap+index*(cardHeight+gap);return `<rect x="${x+gap}" y="${cardY}" width="${Math.max(16,w-gap*2)}" height="${cardHeight}" rx="5" fill="#e2e8f0" stroke="#64748b"/><text x="${x+w/2}" y="${cardY+cardHeight/2}" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="14" fill="#172033">${esc(label)}</text>`;}).join("")}</g>`;
}

async function runFile(executable:string,args:string[]):Promise<void>{await new Promise<void>((resolvePromise,reject)=>execFile(executable,args,{timeout:120000,windowsHide:true},error=>error?reject(error):resolvePromise()));}
function libreOfficeExecutable():string{
  const configured=process.env.LIBREOFFICE_PATH;
  if(configured)return configured;
  if(process.platform==="win32")for(const candidate of ["C:\\Program Files\\LibreOffice\\program\\soffice.exe","C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"])if(existsSync(candidate))return candidate;
  for(const candidate of ["/usr/bin/soffice","/usr/local/bin/soffice"])if(existsSync(candidate))return candidate;
  return "soffice";
}
async function renderUsingLibreOffice(inputPath:string):Promise<Uint8Array[]|undefined>{
  const temporary=await mkdtemp(join(tmpdir(),"video-pptx-preview-")),pdfPath=join(temporary,basename(inputPath,extname(inputPath))+".pdf");
  try{
    try{await runFile(libreOfficeExecutable(),["--headless","--convert-to","pdf","--outdir",temporary,inputPath]);}catch{return undefined;}
    if(!existsSync(pdfPath))return undefined;
    try{const {renderPdfPages}=await import("./pdf-adapter.js"),pages=await renderPdfPages(await readFile(pdfPath),{extractImages:false});return pages.map(page=>page.png);}catch{return undefined;}
  }finally{await rm(temporary,{recursive:true,force:true});}
}

/** Prefer a real office render so SmartArt and slide artwork retain their original appearance. */
export async function renderPptxSlidePreviews(bytes:Uint8Array,parsed:ParsedDeck,inputPath?:string):Promise<PptxPreviewSet>{
  if(inputPath){const officePages=await renderUsingLibreOffice(inputPath);if(officePages&&officePages.length===parsed.slides.length)return {pages:officePages,renderer:"LibreOffice → PDF.js",fidelity:"faithful office slide render"};}
  const presentation=await loadPresentation(bytes),slides=getSlides(presentation),width=1280,slideWidth=typeof parsed.size?.width==="number"?parsed.size.width:960,slideHeight=typeof parsed.size?.height==="number"?parsed.size.height:540,height=Math.round(width*slideHeight/slideWidth);
  if(slides.length!==parsed.slides.length)throw new Error("PPTX preview renderer slide count did not match parser output.");
  const previews:Uint8Array[]=[];
  for(let index=0;index<slides.length;index++){
    const base=renderSlideToImage(presentation,slides[index],{width}),base64=Buffer.from(base).toString("base64"),diagrams=(parsed.slides[index].elements??[]).map(record).filter((element):element is Record<string,unknown>=>element!==undefined&&element.type==="diagram") as ParsedElement[];
    const overlays=diagrams.map(drawDiagram).join("");
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${slideWidth} ${slideHeight}"><image href="data:image/png;base64,${base64}" x="0" y="0" width="${slideWidth}" height="${slideHeight}"/>${overlays}</svg>`;
    previews.push(new Uint8Array(new Resvg(svg,{fitTo:{mode:"width",value:width}}).render().asPng()));
  }
  return {pages:previews,renderer:"@office-kit/pptx-preview@0.11.0 + diagram fallback",fidelity:"approximate when the source contains unsupported graphicFrame content"};
}
