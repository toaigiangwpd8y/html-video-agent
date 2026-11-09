import {copyFile,mkdir,readFile,writeFile} from "node:fs/promises";
import {basename,resolve} from "node:path";
import {createCanvas,DOMMatrix,ImageData,Path2D} from "@napi-rs/canvas";
import {writeJson} from "../core/io.js";
import type {NormalizedSource,SourceAsset,SourceElement,SourceNarration,SourceSection} from "./normalized-source.js";
import {appendNormalizedSource,contentSourceId} from "./source-storage.js";
import {loadNormalizedSourceIndex,normalizedSourcesRoot} from "./source-loader.js";

export interface PdfEmbeddedImage {id:string;png:Uint8Array;width:number;height:number;bbox?:{x:number;y:number;width:number;height:number};}
export interface PdfPageRender {png:Uint8Array;width:number;height:number;pageWidth:number;pageHeight:number;text:string;elements:SourceElement[];images:PdfEmbeddedImage[];}
export interface PdfImportOptions {narrationBySection?:Record<string,SourceNarration>;}
export interface PdfRenderOptions {extractImages?:boolean;}

function configureCanvasRuntime():void{
  const runtime=globalThis as unknown as Record<string,unknown>;
  runtime.DOMMatrix??=DOMMatrix;runtime.ImageData??=ImageData;runtime.Path2D??=Path2D;
}
export function assertPdfPreviewRuntime(version=process.versions.node):void{
  const match=/^(\d+)\.(\d+)\.(\d+)/.exec(version),major=match?Number(match[1]):0,minor=match?Number(match[2]):0;
  if(!match||major<22||(major===22&&minor<18))throw new Error(`PDF import requires Node.js >=22.18.0 to render page previews; current runtime is ${version}.`);
}

function imagePng(image:any):Uint8Array|undefined{
  const width=Number(image?.width),height=Number(image?.height);if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)return undefined;
  const canvas=createCanvas(width,height),context=canvas.getContext("2d");
  try{
    if(image.bitmap){context.drawImage(image.bitmap,0,0,width,height);return new Uint8Array(canvas.toBuffer("image/png"));}
    const source=image.data;if(!source||typeof source.length!=="number")return undefined;
    const target=context.createImageData(width,height),output=target.data,pixels=width*height,kind=Number(image.kind);
    if(kind===3&&source.length>=pixels*4)output.set(source.subarray(0,pixels*4));
    else if(kind===2&&source.length>=pixels*3){for(let i=0,j=0;i<pixels;i++,j+=3){const k=i*4;output[k]=source[j];output[k+1]=source[j+1];output[k+2]=source[j+2];output[k+3]=255;}}
    else if(kind===1&&source.length>=Math.ceil(pixels/8)){for(let i=0;i<pixels;i++){const value=(source[i>>3]>>(7-(i&7)))&1?255:0,k=i*4;output[k]=value;output[k+1]=value;output[k+2]=value;output[k+3]=255;}}
    else return undefined;
    context.putImageData(target,0,0);return new Uint8Array(canvas.toBuffer("image/png"));
  }catch{return undefined;}
}
async function resolvedPdfObject(page:any,id:string):Promise<any>{
  const store=id.startsWith("g_")?page.commonObjs:page.objs;
  if(store.has(id))return store.get(id);
  return new Promise(resolvePromise=>store.get(id,(value:any)=>resolvePromise(value)));
}
async function extractPageImages(page:any,pdfjs:any,renderScale:number,renderWidth:number,renderHeight:number,pageNumber:number):Promise<{images:PdfEmbeddedImage[];elements:SourceElement[]}>{
  const operators=await page.getOperatorList(),imageOps=new Set([pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject]),coords=page.imageCoordinates as Float32Array|undefined,images:PdfEmbeddedImage[]=[],elements:SourceElement[]=[],unique=new Map<string,PdfEmbeddedImage>();let drawIndex=0;
  for(let index=0;index<operators.fnArray.length;index++){
    if(!imageOps.has(operators.fnArray[index]))continue;
    const args=operators.argsArray[index]??[],arg=args[0],objectId=typeof arg==="string"?arg:undefined,image=objectId?await resolvedPdfObject(page,objectId):arg,png=imagePng(image),imageNumber=drawIndex+1;
    let bbox:{x:number;y:number;width:number;height:number}|undefined;
    if(coords&&coords.length>=(drawIndex+1)*6){const points=[0,1,2].map(point=>({x:coords[drawIndex*6+point*2]*renderWidth,y:coords[drawIndex*6+point*2+1]*renderHeight})),xs=points.map(point=>point.x),ys=points.map(point=>point.y);bbox={x:Math.min(...xs)/renderScale,y:Math.min(...ys)/renderScale,width:(Math.max(...xs)-Math.min(...xs))/renderScale,height:(Math.max(...ys)-Math.min(...ys))/renderScale};}
    drawIndex++;
    if(!png)continue;
    const key=objectId??`${pageNumber}-${imageNumber}`,assetId=`image-page-${String(pageNumber).padStart(3,"0")}-${String(images.length+1).padStart(3,"0")}`,existing=unique.get(key);
    let asset=existing;
    if(!asset){asset={id:assetId,png,width:Number(image.width),height:Number(image.height),...(bbox?{bbox}:{})};unique.set(key,asset);images.push(asset);}
    elements.push({id:`page-${pageNumber}-image-${String(imageNumber).padStart(3,"0")}`,type:"image",assetRef:asset.id,...(bbox?{bbox}:{}),metadata:{kind:"embedded-image",objectId,operatorIndex:index,pageNumber}});
  }
  return {images,elements};
}

/** Extract text positions and render complete PDF pages. Used for PDF imports and office-rendered PPTX previews. */
export async function renderPdfPages(bytes:Uint8Array,options:PdfRenderOptions={}):Promise<PdfPageRender[]>{
  assertPdfPreviewRuntime();configureCanvasRuntime();
  const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs"),loading=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false});
  const document=await loading.promise,pages:PdfPageRender[]=[];
  try{
    for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
      const page=await document.getPage(pageNumber),viewport=page.getViewport({scale:1}),renderScale=Math.min(2,1280/viewport.width),renderViewport=page.getViewport({scale:renderScale}),canvas=createCanvas(Math.ceil(renderViewport.width),Math.ceil(renderViewport.height)),context=canvas.getContext("2d");
      await page.render({canvasContext:context,viewport:renderViewport,canvas,recordImages:options.extractImages!==false} as never).promise;
      const extractedImages=options.extractImages===false?{images:[],elements:[]}:await extractPageImages(page,pdfjs,renderScale,renderViewport.width,renderViewport.height,pageNumber);
      const content=await page.getTextContent(),items=content.items.filter((item:any)=>typeof item.str==="string"&&item.str.trim()),elements:SourceElement[]=[],lines:string[]=[];let previousY:number|undefined,sequence=0;
      for(const item of items as Array<{str:string;transform:number[];width:number;height:number;hasEOL?:boolean}>){
        const transform=pdfjs.Util.transform(viewport.transform,item.transform),x=transform[4],baseline=transform[5],height=Math.max(0,item.height||Math.hypot(transform[2],transform[3])),y=baseline-height;
        if(previousY!==undefined&&Math.abs(baseline-previousY)>Math.max(4,height*.6))lines.push("\n");
        lines.push(item.str);lines.push(item.hasEOL?"\n":" ");previousY=baseline;
        elements.push({id:`page-${pageNumber}-text-${String(++sequence).padStart(3,"0")}`,type:"text",text:item.str,bbox:{x,y,width:Math.max(0,item.width),height},metadata:{source:"pdf-text-content",pageNumber}});
      }
      const text=lines.join("").replace(/[ \t]+\n/g,"\n").replace(/\n[ \t]+/g,"\n").replace(/[ \t]{2,}/g," ").trim();
      pages.push({png:new Uint8Array(canvas.toBuffer("image/png")),width:Math.ceil(renderViewport.width),height:Math.ceil(renderViewport.height),pageWidth:viewport.width,pageHeight:viewport.height,text,elements:[...elements,...extractedImages.elements],images:extractedImages.images});
      page.cleanup();
    }
  }finally{await loading.destroy();}
  if(pages.length===0)throw new Error("PDF source contains no pages.");
  return pages;
}

export async function getPdfPageCount(bytes:Uint8Array):Promise<number>{
  assertPdfPreviewRuntime();
  const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs"),loading=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false}),document=await loading.promise;
  try{return document.numPages;}finally{await loading.destroy();}
}

export async function importPdf(root:string,inputPath:string,options:PdfImportOptions={}):Promise<NormalizedSource>{
  assertPdfPreviewRuntime();
  const bytes=await readFile(inputPath),id=contentSourceId("document",bytes);
  if((await loadNormalizedSourceIndex(root)).sources.some(item=>item.id===id))throw new Error(`Normalized source '${id}' already exists.`);
  const pages=await renderPdfPages(bytes),directory=resolve(normalizedSourcesRoot(root),id),assetDirectory=resolve(directory,"assets"),textDirectory=resolve(directory,"text");
  await mkdir(assetDirectory,{recursive:true});await mkdir(textDirectory,{recursive:true});await copyFile(inputPath,resolve(directory,"original.pdf"));
  const assets:SourceAsset[]=[],elements:SourceElement[]=[],sections:SourceSection[]=[];
  for(let index=0;index<pages.length;index++){
    const page=pages[index],pageNumber=index+1,sectionId=`slide-${pageNumber}`,textPath=`text/slide-${String(pageNumber).padStart(3,"0")}.txt`,previewId=`preview-page-${String(pageNumber).padStart(3,"0")}`,previewPath=`assets/${previewId}.png`;
    await writeFile(resolve(directory,textPath),page.text,"utf8");await writeFile(resolve(directory,previewPath),page.png);
    for(const image of page.images){const imagePath=`assets/${image.id}.png`;await writeFile(resolve(directory,imagePath),image.png);assets.push({id:image.id,path:imagePath,type:"image/png",width:image.width,height:image.height,metadata:{kind:"embedded-image",pageNumber,sourceElementId:`page-${pageNumber}-image`}});}
    const previewElement:SourceElement={id:`page-${pageNumber}-preview`,type:"image",assetRef:previewId,bbox:{x:0,y:0,width:page.width,height:page.height},metadata:{kind:"page-preview",pageNumber}};
    const elementIds=page.elements.map(element=>element.id);elements.push(...page.elements,previewElement);elementIds.push(previewElement.id);
    assets.push({id:previewId,path:previewPath,type:"image/png",width:page.width,height:page.height,metadata:{kind:"page-preview",pageNumber,renderer:"pdfjs-dist",fidelity:"full-page PDF render"}});
    const narration=options.narrationBySection?.[sectionId];
    sections.push({id:sectionId,label:page.text.split("\n").find(line=>line.trim()),text:page.text,textPath,elementIds,...(narration?{narration}:{}),metadata:{pageNumber,width:page.pageWidth,height:page.pageHeight,coordinateSpace:"PDF viewport points"}});
  }
  const {version}=await import("pdfjs-dist/legacy/build/pdf.mjs"),source:NormalizedSource={id,kind:"document",title:sections[0]?.label||basename(inputPath),sections,elements,assets,metadata:{parser:"pdfjs-dist",version,sourceFile:"original.pdf",previewRenderer:"pdfjs-dist + @napi-rs/canvas",visualFallback:"full-page render; text items retain page-relative bounds"}};
  await writeJson(resolve(directory,"source.json"),source);await appendNormalizedSource(root,source);return source;
}
