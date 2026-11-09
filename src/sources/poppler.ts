import {execFile} from "node:child_process";
import {readdir,readFile} from "node:fs/promises";
import {resolve} from "node:path";
import type {Bounds} from "./types.js";
import {children,descendants,parseXml,textContent,type XmlNode} from "./xml.js";

function run(command:string,args:string[],options:Record<string,unknown>):Promise<{stdout:string;stderr:string}>{
  return new Promise((resolvePromise,reject)=>execFile(command,args,{encoding:"utf8",...options},(error:any,stdout:string,stderr:string)=>error?reject(Object.assign(error,{stdout,stderr})):resolvePromise({stdout,stderr})));
}
export async function tool(command:string,args:string[],options:{cwd?:string;timeout?:number}={}):Promise<string>{
  try{const {stdout}=await run(command,args,{maxBuffer:256*1024*1024,timeout:options.timeout??300_000,...(options.cwd?{cwd:options.cwd}:{})});return stdout;}
  catch(error){const e=error as {code?:string;message:string;stderr?:string};if(e.code==="ENOENT")throw new Error(`Required tool '${command}' is not installed or not on PATH.`);throw new Error(`${command} failed: ${e.stderr?.trim()||e.message}`);}
}
export async function toolVersion(command:string,args=["-v"]):Promise<string>{
  try{const {stdout,stderr}=await run(command,args,{timeout:30_000});return (`${stdout}\n${stderr}`).split("\n").map(l=>l.trim()).find(l=>/\d+\.\d+/.test(l))??"unknown";}
  catch(error){const e=error as {stdout?:string;stderr?:string;code?:string};if(e.code==="ENOENT")return "missing";return (`${e.stdout??""}\n${e.stderr??""}`).split("\n").map(l=>l.trim()).find(l=>/\d+\.\d+/.test(l))??"unknown";}
}

export interface PdfInfo {pages:number;width:number;height:number;}
export async function pdfInfo(pdf:string):Promise<PdfInfo>{
  const out=await tool("pdfinfo",[pdf]);const pages=Number(/^Pages:\s+(\d+)/m.exec(out)?.[1]);const size=/^Page size:\s+([\d.]+) x ([\d.]+)/m.exec(out);
  if(!pages||!size)throw new Error(`Could not read page count/size from pdfinfo output for ${pdf}`);
  return {pages,width:Number(size[1]),height:Number(size[2])};
}

/** Render every page to `<dir>/page-NNN.png` at the given DPI; returns paths in page order. */
export async function renderPdfPages(pdf:string,dir:string,dpi:number):Promise<string[]>{
  await tool("pdftoppm",["-r",String(dpi),"-png",pdf,resolve(dir,"page")]);
  return (await readdir(dir)).filter(f=>/^page-\d+\.png$/.test(f)).sort((a,b)=>Number(/\d+/.exec(a)![0])-Number(/\d+/.exec(b)![0])).map(f=>resolve(dir,f));
}
export async function renderPdfRegion(pdf:string,page:number,dpi:number,region:Bounds,outPrefix:string):Promise<void>{
  const k=dpi/72;
  await tool("pdftoppm",["-r",String(dpi),"-png","-singlefile","-f",String(page),"-l",String(page),"-x",String(Math.round(region.x*k)),"-y",String(Math.round(region.y*k)),"-W",String(Math.max(1,Math.round(region.width*k))),"-H",String(Math.max(1,Math.round(region.height*k))),pdf,outPrefix]);
}

export interface PdfLine {text:string;bounds:Bounds;}
export interface PdfBlock {text:string;bounds:Bounds;lines:PdfLine[];}
export interface PdfRun {text:string;bounds:Bounds;fontSizePt:number;bold:boolean;color?:string;}
export interface PdfImagePlacement {file:string;bounds:Bounds;}
export interface PdfPageText {blocks:PdfBlock[];runs:PdfRun[];images:PdfImagePlacement[];}
export interface PdfTextLayer {pages:PdfPageText[];outline:Map<number,string>;}

const DECORATION=/^[\s•‣⁃∙■-◿☀-➿⬀-⯿-§·\-–—>»]+$/u;
const LEADING_GLYPH=/^[•■-◿☀-➿-]\s*/u;
function boundsOf(node:XmlNode):Bounds{const x=Number(node.attrs.xMin),y=Number(node.attrs.yMin);return {x:round(x),y:round(y),width:round(Number(node.attrs.xMax)-x),height:round(Number(node.attrs.yMax)-y)};}
export function round(value:number,places=2):number{const k=10**places;return Math.round(value*k)/k;}
export function isDecoration(text:string):boolean{return DECORATION.test(text);}

/** Parse `pdftotext -bbox-layout` XHTML into per-page reading-order blocks; bullet-glyph-only blocks are dropped. */
export function parseBboxLayout(xhtml:string):PdfBlock[][]{
  const doc=parseXml(xhtml);
  return descendants(doc,"page").map(page=>descendants(page,"block").map(block=>{
    const lines=children(block,"line").map(line=>({text:children(line,"word").map(w=>textContent(w)).join(" ").replace(LEADING_GLYPH,"").trim(),bounds:boundsOf(line)})).filter(line=>line.text&&!isDecoration(line.text));
    return {text:lines.map(l=>l.text).join("\n"),bounds:boundsOf(block),lines};
  }).filter(block=>block.lines.length>0));
}

/** Parse `pdftohtml -xml -zoom 1` output: styled text runs, image placements (pt) and the document outline. */
export function parsePdfToHtmlXml(xml:string):{pages:Map<number,{runs:PdfRun[];images:PdfImagePlacement[]}>;outline:Map<number,string>}{
  const doc=parseXml(xml),pages=new Map<number,{runs:PdfRun[];images:PdfImagePlacement[]}>(),outline=new Map<number,string>();
  // fontspec ids are document-global: a font is declared on the first page that uses it.
  const fonts=new Map<string,{size:number;color:string}>();
  for(const page of descendants(doc,"page")){
    for(const spec of children(page,"fontspec"))fonts.set(spec.attrs.id,{size:Number(spec.attrs.size),color:spec.attrs.color});
    const runs:PdfRun[]=[],images:PdfImagePlacement[]=[];
    for(const node of page.children){
      const b=():Bounds=>({x:round(Number(node.attrs.left)),y:round(Number(node.attrs.top)),width:round(Number(node.attrs.width)),height:round(Number(node.attrs.height))});
      if(node.name==="text"){const text=textContent(node).trim();if(!text)continue;const font=fonts.get(node.attrs.font);runs.push({text,bounds:b(),fontSizePt:font?.size??0,bold:descendants(node,"b").length>0,...(font?.color?{color:font.color}:{})});}
      else if(node.name==="image")images.push({file:node.attrs.src,bounds:b()});
    }
    pages.set(Number(page.attrs.number),{runs,images});
  }
  for(const item of descendants(doc,"item")){const n=Number(item.attrs.page);const title=textContent(item).trim().replace(/^Slide \d+:\s*/,"");if(n&&title&&!outline.has(n))outline.set(n,title);}
  return {pages,outline};
}

/** Extract the positioned text layer, styled runs and embedded images of every page. Images land in `imageDir`. */
export async function extractPdfTextLayer(pdf:string,imageDir:string,pageCount:number):Promise<PdfTextLayer>{
  const bbox=await tool("pdftotext",["-bbox-layout","-enc","UTF-8",pdf,"-"]);
  const blocks=parseBboxLayout(bbox);
  await tool("pdftohtml",["-xml","-zoom","1","-nodrm","-q",pdf,resolve(imageDir,"doc")]);
  const parsed=parsePdfToHtmlXml(await readFile(resolve(imageDir,"doc.xml"),"utf8"));
  const pages:PdfPageText[]=[];
  for(let n=1;n<=pageCount;n++){const styled=parsed.pages.get(n);pages.push({blocks:blocks[n-1]??[],runs:styled?.runs??[],images:(styled?.images??[]).map(i=>({...i,file:resolve(imageDir,i.file.replace(/^.*[\\/]/,""))}))});}
  return {pages,outline:parsed.outline};
}

export function overlapRatio(inner:Bounds,outer:Bounds):number{
  const w=Math.max(0,Math.min(inner.x+inner.width,outer.x+outer.width)-Math.max(inner.x,outer.x)),h=Math.max(0,Math.min(inner.y+inner.height,outer.y+outer.height)-Math.max(inner.y,outer.y));
  const area=inner.width*inner.height;return area>0?(w*h)/area:0;
}
/** Styled runs whose area mostly lies inside `bounds`. */
export function runsWithin(runs:PdfRun[],bounds:Bounds,threshold=.5):PdfRun[]{return runs.filter(r=>overlapRatio(r.bounds,{x:bounds.x-2,y:bounds.y-2,width:bounds.width+4,height:bounds.height+4})>=threshold);}
