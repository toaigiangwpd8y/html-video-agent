import {createRequire} from "node:module";
import {copyFile,mkdir,readFile,writeFile} from "node:fs/promises";
import {basename,extname,resolve} from "node:path";
import {writeJson} from "../core/io.js";
import type {NormalizedSource,SourceAsset,SourceBBox,SourceElement,SourceElementType,SourceRewritePolicy,SourceSection} from "./normalized-source.js";
import {appendNormalizedSource,contentSourceId} from "./source-storage.js";
import {loadNormalizedSourceIndex,normalizedSourcesRoot} from "./source-loader.js";

type ParsedElement={type?:unknown;content?:unknown;base64?:unknown;ref?:unknown;left?:unknown;top?:unknown;width?:unknown;height?:unknown;order?:unknown;elements?:unknown[];textList?:unknown[];fill?:unknown;borderColor?:unknown;borderWidth?:unknown;borderType?:unknown;shapType?:unknown;name?:unknown;path?:unknown;pathViewBox?:unknown;[key:string]:unknown};
type ParsedSlide={elements?:unknown[];note?:unknown};
type ParsedPresentation={slides?:unknown[];size?:{width?:unknown;height?:unknown};themeColors?:unknown[];usedFonts?:unknown[]};
type PptxParser={parse(input:Uint8Array|ArrayBuffer,options:Record<string,string>):Promise<unknown>};
const require=createRequire(import.meta.url),parser=require("pptxtojson/dist/index.cjs") as PptxParser;
export interface PptxImportOptions {narrationText?:string;narrationBySection?:Record<string,{text:string;path?:string;rewritePolicy?:SourceRewritePolicy}>;narrationPath?:string;rewritePolicy?:SourceRewritePolicy;}

export function assertPptxPreviewRuntime(version=process.versions.node):void{
  const match=/^(\d+)\.(\d+)\.(\d+)/.exec(version),major=match?Number(match[1]):0,minor=match?Number(match[2]):0;
  if(!match||major<22||(major===22&&minor<18))throw new Error(`PPTX import requires Node.js >=22.18.0 to generate slide previews; current runtime is ${version}.`);
}

function record(value:unknown):Record<string,unknown>|undefined{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function textFromHtml(value:unknown):string{if(typeof value!=="string")return "";return value.replace(/<[^>]*>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#39;/g,"'").replace(/&quot;/gi,'"').replace(/\s+/g," ").trim();}
function finite(value:unknown):number|undefined{return typeof value==="number"&&Number.isFinite(value)?value:undefined;}
function bbox(element:ParsedElement):SourceBBox|undefined{const x=finite(element.left),y=finite(element.top),width=finite(element.width),height=finite(element.height);return x!==undefined&&y!==undefined&&width!==undefined&&height!==undefined?{x,y,width,height}:undefined;}
function elementType(element:ParsedElement,text:string):SourceElementType{
  if(element.type==="image")return "image";if(element.type==="table")return "table";if(element.type==="chart")return "chart";if(element.type==="diagram")return "diagram";if(element.type==="group")return "group";if(element.type==="connector")return "connector";
  if(element.type==="shape")return text?"text":"shape";if(element.type==="text")return "text";return "unknown";
}
function extension(ref:string|undefined):string{const value=ref?extname(ref).toLowerCase():"";return /^\.[a-z0-9]{2,5}$/.test(value)?value:".bin";}
function mimeType(path:string):string{switch(extname(path).toLowerCase()){case ".png":return "image/png";case ".jpg":case ".jpeg":return "image/jpeg";case ".gif":return "image/gif";case ".svg":return "image/svg+xml";case ".webp":return "image/webp";default:return "application/octet-stream";}}
function decodeBase64(value:string):Uint8Array{return new Uint8Array(Buffer.from(value.replace(/^data:[^,]+,/,""),"base64"));}
function parserMetadata(element:ParsedElement):Record<string,unknown>|undefined{
  const metadata:Record<string,unknown>={parserType:String(element.type??"unknown")};
  for(const key of ["name","shapType","fill","borderColor","borderWidth","borderType","path","pathViewBox","textInset","headEnd","tailEnd","rotate","isFlipH","isFlipV","strokeOnly"]){if(element[key]!==undefined)metadata[key]=element[key];}
  if(element.type&&!(["image","table","chart","shape","text","group","connector","diagram"] as unknown[]).includes(element.type))metadata.reason=`unsupported-${String(element.type)}`;
  return Object.keys(metadata).length?metadata:undefined;
}
function visibleText(element:ParsedElement):string[]{const texts:string[]=[],own=textFromHtml(element.content);if(own)texts.push(own);if(Array.isArray(element.textList))for(const value of element.textList)if(typeof value==="string"&&value.trim())texts.push(value.trim());if(Array.isArray(element.elements))for(const child of element.elements){const item=record(child) as ParsedElement|undefined;if(item)texts.push(...visibleText(item));}return texts;}
export async function importPptx(root:string,inputPath:string,options:PptxImportOptions={}):Promise<NormalizedSource>{
  assertPptxPreviewRuntime();
  const bytes=await readFile(inputPath),parsed=await parser.parse(bytes,{imageMode:"base64",videoMode:"none",audioMode:"none"}) as ParsedPresentation;
  if(!Array.isArray(parsed.slides)||parsed.slides.length===0)throw new Error("PPTX parser returned no slides.");
  if(options.narrationText?.trim()&&parsed.slides.length!==1)throw new Error("A single unlabelled narration value can only be used with a one-slide PPTX. Use --script with explicit slide labels for multi-slide sources.");
  const id=contentSourceId("presentation",bytes);if((await loadNormalizedSourceIndex(root)).sources.some(item=>item.id===id))throw new Error(`Normalized source '${id}' already exists.`);
  const directory=resolve(normalizedSourcesRoot(root),id),assetDirectory=resolve(directory,"assets"),textDirectory=resolve(directory,"text");await mkdir(assetDirectory,{recursive:true});await mkdir(textDirectory,{recursive:true});await copyFile(inputPath,resolve(directory,"original.pptx"));
  const {renderPptxSlidePreviews}=await import("./pptx-preview-adapter.js"),previewSet=await renderPptxSlidePreviews(bytes,parsed as ParsedPresentation&{slides:ParsedSlide[]},inputPath),previews=previewSet.pages,assets:SourceAsset[]=[],elements:SourceElement[]=[],sections:SourceSection[]=[];let elementSequence=0,imageSequence=0;
  for(let slideIndex=0;slideIndex<parsed.slides.length;slideIndex++){
    const slide=record(parsed.slides[slideIndex]) as ParsedSlide|undefined,rawElements=Array.isArray(slide?.elements)?slide.elements:[],elementIds:string[]=[],sectionText:string[]=[];
    const convert=async(rawValue:unknown):Promise<SourceElement|undefined>=>{
      const raw=record(rawValue) as ParsedElement|undefined;if(!raw)return undefined;
      const text=textFromHtml(raw.content),type=elementType(raw,text),elementId=`slide-${slideIndex+1}-element-${++elementSequence}`,element:SourceElement={id:elementId,type,...(text?{text}:{}),...(bbox(raw)?{bbox:bbox(raw)}:{}),...(finite(raw.order)!==undefined?{zIndex:finite(raw.order)}:{})};
      if(type==="diagram"&&Array.isArray(raw.textList))element.textList=raw.textList.filter((item):item is string=>typeof item==="string");
      if(Array.isArray(raw.elements)){element.children=[];for(const child of raw.elements){const converted=await convert(child);if(converted)element.children.push(converted);}}
      if(Array.isArray(raw.relations)){element.relations=raw.relations.map(value=>{const relation=record(value)??{};return {id:typeof relation.id==="string"?relation.id:undefined,sourceId:typeof relation.sourceId==="string"?relation.sourceId:undefined,targetId:typeof relation.targetId==="string"?relation.targetId:undefined,type:typeof relation.type==="string"?relation.type:undefined};});}
      element.metadata=parserMetadata(raw);
      if(type==="image"&&typeof raw.base64==="string"&&raw.base64){const assetId=`image-${String(++imageSequence).padStart(3,"0")}`,path=`assets/${assetId}${extension(typeof raw.ref==="string"?raw.ref:undefined)}`;await writeFile(resolve(directory,path),decodeBase64(raw.base64));assets.push({id:assetId,path,type:mimeType(path),metadata:{kind:"embedded-image",sourceElementId:elementId}});element.assetRef=assetId;}
      return element;
    };
    for(const raw of rawElements){const element=await convert(raw);if(!element)continue;elementIds.push(element.id);elements.push(element);sectionText.push(...visibleText(record(raw) as ParsedElement));}
    const previewId=`preview-slide-${String(slideIndex+1).padStart(3,"0")}`,previewPath=`assets/${previewId}.png`,previewBytes=previews[slideIndex];await writeFile(resolve(directory,previewPath),previewBytes);assets.push({id:previewId,path:previewPath,type:"image/png",width:1280,metadata:{kind:"slide-preview",slideIndex:slideIndex+1,renderer:previewSet.renderer,fidelity:previewSet.fidelity,sourceElementId:`slide-${slideIndex+1}-preview`}});
    const previewElement:SourceElement={id:`slide-${slideIndex+1}-preview`,type:"image",assetRef:previewId,metadata:{kind:"slide-preview",renderer:previewSet.renderer}};elements.push(previewElement);elementIds.push(previewElement.id);
    const notes=textFromHtml(slide?.note),slideText=[...new Set(sectionText.filter(Boolean))],sectionId=`slide-${slideIndex+1}`,textPath=`text/slide-${String(slideIndex+1).padStart(3,"0")}.txt`;await writeFile(resolve(directory,textPath),slideText.join("\n"),"utf8");
    const narration=options.narrationBySection?.[sectionId]??(options.narrationText?.trim()?{text:options.narrationText.trim(),...(options.narrationPath?{path:options.narrationPath}:{}),rewritePolicy:options.rewritePolicy??"preserve"}:undefined);
    sections.push({id:sectionId,label:slideText[0],text:slideText.join("\n"),textPath,elementIds,...(narration?{narration}:{}),...(notes?{metadata:{speakerNotes:notes}}:{})});
  }
  const title=sections[0]?.label||basename(inputPath),source:NormalizedSource={id,kind:"presentation",title,sections,elements,assets,metadata:{parser:"pptxtojson",version:"2.1.0",units:"pt",...(parsed.size?{size:parsed.size}:{}),sourceFile:"original.pptx",previewRenderer:previewSet.renderer,previewFidelity:previewSet.fidelity}};
  await writeJson(resolve(directory,"source.json"),source);await appendNormalizedSource(root,source);return source;
}
