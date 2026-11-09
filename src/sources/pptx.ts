import {posix} from "node:path";
import type {Bounds,ShapeElement,TextBlock,TextParagraph,TextRole} from "./types.js";
import {child,children,descendants,local,parseXml,path,textContent,type XmlNode} from "./xml.js";
import type {ZipArchive} from "./zip.js";

/** OOXML (PresentationML) reader: slide order, shape tree with bounds, text, pictures, tables, charts, SmartArt text, and speaker notes. */
const EMU_PER_PT=12700;
const pt=(emu:number)=>Math.round(emu/EMU_PER_PT*100)/100;

export interface PptxPicture {id:string;name?:string;description?:string;bounds?:Bounds;mediaPart:string;crop?:Record<string,number>;}
export interface PptxSlide {
  index:number;partName:string;hidden:boolean;title?:string;
  textBlocks:TextBlock[];pictures:PptxPicture[];shapes:ShapeElement[];
  /** Extra parts to copy as element assets (chart XML, embedded objects, media). */
  parts:Array<{id:string;part:string;kind:ShapeElement["kind"]}>;
  notes?:string;warnings:string[];
}
export interface PptxDeck {slideSize:{width:number;height:number};slides:PptxSlide[];title?:string;}

interface Rel {type:string;target:string;external:boolean;}
function relsFor(zip:ZipArchive,part:string):Map<string,Rel>{
  const relsPath=posix.join(posix.dirname(part),"_rels",`${posix.basename(part)}.rels`),out=new Map<string,Rel>();
  if(!zip.has(relsPath))return out;
  for(const r of descendants(parseXml(zip.readText(relsPath)),"Relationship")){
    const external=r.attrs.TargetMode==="External";
    out.set(r.attrs.Id,{type:r.attrs.Type.replace(/^.*\//,""),external,target:external?r.attrs.Target:r.attrs.Target.startsWith("/")?r.attrs.Target.slice(1):posix.normalize(posix.join(posix.dirname(part),r.attrs.Target))});
  }
  return out;
}
const relOfType=(rels:Map<string,Rel>,type:string)=>[...rels.values()].find(r=>r.type===type&&!r.external);

interface Transform {offX:number;offY:number;scaleX:number;scaleY:number;chOffX:number;chOffY:number;}
const IDENTITY:Transform={offX:0,offY:0,scaleX:1,scaleY:1,chOffX:0,chOffY:0};
function rawXfrm(node:XmlNode|undefined):{x:number;y:number;cx:number;cy:number;chX?:number;chY?:number;chCx?:number;chCy?:number}|undefined{
  const xfrm=node&&(child(node,"xfrm"));if(!xfrm)return undefined;const off=child(xfrm,"off"),ext=child(xfrm,"ext");if(!off||!ext)return undefined;
  const chOff=child(xfrm,"chOff"),chExt=child(xfrm,"chExt");
  return {x:Number(off.attrs.x),y:Number(off.attrs.y),cx:Number(ext.attrs.cx),cy:Number(ext.attrs.cy),...(chOff&&chExt?{chX:Number(chOff.attrs.x),chY:Number(chOff.attrs.y),chCx:Number(chExt.attrs.cx),chCy:Number(chExt.attrs.cy)}:{})};
}
function apply(t:Transform,x:{x:number;y:number;cx:number;cy:number}):Bounds{
  return {x:pt(t.offX+(x.x-t.chOffX)*t.scaleX),y:pt(t.offY+(x.y-t.chOffY)*t.scaleY),width:pt(x.cx*t.scaleX),height:pt(x.cy*t.scaleY)};
}

interface Placeholder {type:string;idx?:string;}
function placeholderOf(node:XmlNode):Placeholder|undefined{
  const nv=node.children.find(c=>local(c.name).startsWith("nv"));const ph=nv&&path(nv,"nvPr","ph");if(!ph)return undefined;
  return {type:ph.attrs.type??"body",...(ph.attrs.idx!==undefined?{idx:ph.attrs.idx}:{})};
}
/** Placeholder geometry inherited from a layout/master shape tree. */
function placeholderGeometry(tree:XmlNode|undefined):Array<{ph:Placeholder;xfrm:{x:number;y:number;cx:number;cy:number}}>{
  const out:Array<{ph:Placeholder;xfrm:{x:number;y:number;cx:number;cy:number}}>=[];if(!tree)return out;
  for(const sp of descendants(tree,"sp")){const ph=placeholderOf(sp),xfrm=rawXfrm(child(sp,"spPr"));if(ph&&xfrm)out.push({ph,xfrm});}
  return out;
}
const normType=(t:string)=>t==="ctrTitle"?"title":t==="subTitle"?"body":t==="obj"?"body":t;
function inherit(ph:Placeholder,sources:Array<ReturnType<typeof placeholderGeometry>>):{x:number;y:number;cx:number;cy:number}|undefined{
  for(const list of sources){
    const byIdx=ph.idx!==undefined?list.find(e=>e.ph.idx===ph.idx):undefined;if(byIdx)return byIdx.xfrm;
    const byType=list.find(e=>normType(e.ph.type)===normType(ph.type));if(byType)return byType.xfrm;
  }
  return undefined;
}

function paragraphsOf(txBody:XmlNode|undefined):TextParagraph[]{
  if(!txBody)return [];const out:TextParagraph[]=[];
  for(const p of children(txBody,"p")){
    let text="",size:number|undefined,bold:boolean|undefined;
    for(const c of p.children){
      const n=local(c.name);
      if(n==="r"||n==="fld"){text+=textContent(child(c,"t"));const rPr=child(c,"rPr");if(rPr?.attrs.sz){const s=Number(rPr.attrs.sz)/100;size=size===undefined?s:Math.max(size,s);}if(rPr?.attrs.b==="1")bold=true;}
      else if(n==="br")text+="\n";
    }
    const pPr=child(p,"pPr");text=text.replace(/\u000b/g,"\n");
    if(text.trim())out.push({text:text.trim(),level:Number(pPr?.attrs.lvl??0),...(size!==undefined?{fontSizePt:size}:{}),...(bold?{bold}:{})});
  }
  return out;
}
function roleFor(ph:Placeholder|undefined):TextRole{
  if(!ph)return "other";const t=ph.type;
  if(t==="title"||t==="ctrTitle")return "title";if(t==="subTitle")return "subtitle";
  if(t==="ftr"||t==="dt"||t==="sldNum"||t==="hdr")return "footer";return "body";
}

export function readPptx(zip:ZipArchive):PptxDeck{
  const presPart="ppt/presentation.xml";if(!zip.has(presPart))throw new Error("Not a PowerPoint (PresentationML) package: ppt/presentation.xml is missing.");
  const pres=parseXml(zip.readText(presPart)),presRels=relsFor(zip,presPart),sz=descendants(pres,"sldSz")[0];
  const slideSize={width:pt(Number(sz?.attrs.cx??9144000)),height:pt(Number(sz?.attrs.cy??6858000))};
  const slideParts=descendants(pres,"sldId").map(s=>presRels.get(s.attrs["r:id"])?.target).filter((t):t is string=>!!t&&zip.has(t));
  let title:string|undefined;if(zip.has("docProps/core.xml"))title=textContent(descendants(parseXml(zip.readText("docProps/core.xml")),"title")[0]).trim()||undefined;
  const layoutCache=new Map<string,ReturnType<typeof placeholderGeometry>>();
  const geometryOf=(part:string|undefined)=>{if(!part||!zip.has(part))return [];if(!layoutCache.has(part))layoutCache.set(part,placeholderGeometry(path(parseXml(zip.readText(part)),"sldLayout","cSld","spTree")??path(parseXml(zip.readText(part)),"sldMaster","cSld","spTree")));return layoutCache.get(part)!;};
  const slides=slideParts.map((part,i)=>readSlide(zip,part,i+1,geometryOf));
  return {slideSize,slides,...(title?{title}:{})};
}

function readSlide(zip:ZipArchive,part:string,index:number,geometryOf:(part:string|undefined)=>ReturnType<typeof placeholderGeometry>):PptxSlide{
  const doc=parseXml(zip.readText(part)),sld=child(doc,"sld")!,rels=relsFor(zip,part),warnings:string[]=[];
  const layoutPart=relOfType(rels,"slideLayout")?.target,masterPart=layoutPart?relOfType(relsFor(zip,layoutPart),"slideMaster")?.target:undefined;
  const inheritFrom=[geometryOf(layoutPart),geometryOf(masterPart)];
  const textBlocks:TextBlock[]=[],pictures:PptxPicture[]=[],shapes:ShapeElement[]=[],parts:PptxSlide["parts"]=[];
  let counter=0;const nextId=(kind:string)=>`s${String(index).padStart(3,"0")}-${kind}-${String(++counter).padStart(2,"0")}`;
  const cNvPr=(node:XmlNode)=>node.children.find(c=>local(c.name).startsWith("nv"))?.children.find(c=>local(c.name)==="cNvPr");
  const boundsFor=(node:XmlNode,t:Transform,prop:string):Bounds|undefined=>{
    const x=rawXfrm(child(node,prop))??(local(node.name)==="graphicFrame"?rawXfrm(node):undefined);if(x)return apply(t,x);
    const ph=placeholderOf(node);const inh=ph?inherit(ph,inheritFrom):undefined;return inh?apply(IDENTITY,inh):undefined;
  };
  const blipTarget=(node:XmlNode)=>{const blip=descendants(node,"blip")[0];const id=blip?.attrs["r:embed"]??blip?.attrs["r:link"];return id?rels.get(id):undefined;};

  const walk=(tree:XmlNode,t:Transform)=>{
    for(const node of tree.children){
      const kind=local(node.name),nv=cNvPr(node),name=nv?.attrs.name,descr=nv?.attrs.descr;
      if(kind==="sp"){
        const bounds=boundsFor(node,t,"spPr"),ph=placeholderOf(node),paragraphs=paragraphsOf(child(node,"txBody"));
        const blip=blipTarget(child(node,"spPr")??node);
        if(blip&&!blip.external)pictures.push({id:nextId("img"),...(name?{name}:{}),...(descr?{description:descr}:{}),...(bounds?{bounds}:{}),mediaPart:blip.target});
        if(paragraphs.length){
          const sizes=paragraphs.map(p=>p.fontSizePt).filter((s):s is number=>s!==undefined);
          textBlocks.push({id:nextId("text"),role:roleFor(ph),text:paragraphs.map(p=>p.text).join("\n"),...(bounds?{bounds}:{}),...(sizes.length?{fontSizePt:Math.max(...sizes),minFontSizePt:Math.min(...sizes)}:{}),...(paragraphs.some(p=>p.bold)?{bold:true}:{}),paragraphs,...(name?{shapeName:name}:{}),...(ph?{placeholder:ph.type}:{}),source:"ooxml"});
        }else if(!ph)shapes.push({id:nextId("shape"),kind:"shape",...(name?{name}:{}),...(bounds?{bounds}:{}),detail:{geometry:descendants(child(node,"spPr"),"prstGeom")[0]?.attrs.prst??"custom"}});
      }else if(kind==="pic"){
        const bounds=boundsFor(node,t,"spPr"),target=blipTarget(node);
        const media=descendants(node,"videoFile")[0]??descendants(node,"audioFile")[0];
        if(media){const r=rels.get(media.attrs["r:link"]??media.attrs["r:embed"]);if(r&&!r.external){const id=nextId("media");parts.push({id,part:r.target,kind:"media"});shapes.push({id,kind:"media",...(name?{name}:{}),...(bounds?{bounds}:{}),asset:r.target});}else if(r)warnings.push(`Linked external media not extracted: ${r.target}`);}
        if(target&&!target.external){const src=descendants(node,"srcRect")[0];const crop=src?Object.fromEntries(Object.entries(src.attrs).map(([k,v])=>[k,Number(v)/1000])):undefined;pictures.push({id:nextId("img"),...(name?{name}:{}),...(descr?{description:descr}:{}),...(bounds?{bounds}:{}),mediaPart:target.target,...(crop&&Object.keys(crop).length?{crop}:{})});}
        else if(target)warnings.push(`Linked external image not extracted: ${target.target}`);
      }else if(kind==="grpSp"){
        const x=rawXfrm(child(node,"grpSpPr"));const bounds=x?apply(t,x):undefined;
        shapes.push({id:nextId("group"),kind:"group",...(name?{name}:{}),...(bounds?{bounds}:{})});
        if(x&&x.chCx&&x.chCy){const sx=x.cx/x.chCx*t.scaleX,sy=x.cy/x.chCy*t.scaleY;walk(node,{offX:t.offX+(x.x-t.chOffX)*t.scaleX,offY:t.offY+(x.y-t.chOffY)*t.scaleY,scaleX:sx,scaleY:sy,chOffX:x.chX!,chOffY:x.chY!});}
        else walk(node,t);
      }else if(kind==="cxnSp"){
        const bounds=boundsFor(node,t,"spPr");shapes.push({id:nextId("connector"),kind:"connector",...(name?{name}:{}),...(bounds?{bounds}:{})});
      }else if(kind==="graphicFrame"){
        const bounds=boundsFor(node,t,"xfrm"),data=descendants(node,"graphicData")[0],uri=data?.attrs.uri??"";
        if(uri.endsWith("/table")){
          const rows=descendants(data,"tr").map(tr=>children(tr,"tc").map(tc=>paragraphsOf(child(tc,"txBody")).map(p=>p.text).join("\n")));
          const text=rows.map(r=>r.join(" | ")).join("\n");
          shapes.push({id:nextId("table"),kind:"table",...(name?{name}:{}),...(bounds?{bounds}:{}),text,detail:{rows}});
          if(text.trim())textBlocks.push({id:nextId("text"),role:"body",text,...(bounds?{bounds}:{}),...(name?{shapeName:name}:{}),source:"ooxml"});
        }else if(uri.endsWith("/chart")){
          const r=rels.get(descendants(data,"chart")[0]?.attrs["r:id"]??"");const id=nextId("chart");
          const detail=r&&!r.external&&zip.has(r.target)?chartSummary(zip.readText(r.target)):undefined;
          if(r&&!r.external)parts.push({id,part:r.target,kind:"chart"});
          shapes.push({id,kind:"chart",...(name?{name}:{}),...(bounds?{bounds}:{}),...(detail?{text:detail.text,detail}:{}),...(r&&!r.external?{asset:r.target}:{})});
          if(detail?.text)textBlocks.push({id:nextId("text"),role:"body",text:detail.text,...(bounds?{bounds}:{}),...(name?{shapeName:name}:{}),source:"ooxml"});
        }else if(uri.endsWith("/diagram")){
          const r=rels.get(descendants(data,"relIds")[0]?.attrs["r:dm"]??"");
          const lines=r&&zip.has(r.target)?descendants(parseXml(zip.readText(r.target)),"pt").map(p=>descendants(p,"t").map(x=>textContent(x)).join("").trim()).filter(Boolean):[];
          const id=nextId("diagram");shapes.push({id,kind:"diagram",...(name?{name}:{}),...(bounds?{bounds}:{}),text:lines.join("\n"),...(r?{asset:r.target}:{})});
          if(r&&!r.external)parts.push({id,part:r.target,kind:"diagram"});
          if(lines.length)textBlocks.push({id:nextId("text"),role:"body",text:lines.join("\n"),...(bounds?{bounds}:{}),...(name?{shapeName:name}:{}),source:"ooxml"});
        }else{
          const ole=descendants(data,"oleObj")[0];const r=ole?rels.get(ole.attrs["r:id"]??""):undefined;const id=nextId("ole");
          shapes.push({id,kind:"ole",...(name?{name}:{}),...(bounds?{bounds}:{}),detail:{uri,progId:ole?.attrs.progId}});
          if(r&&!r.external){parts.push({id,part:r.target,kind:"ole"});}
          const fallback=blipTarget(node);if(fallback&&!fallback.external)pictures.push({id:nextId("img"),...(name?{name}:{}),...(bounds?{bounds}:{}),mediaPart:fallback.target});
        }
      }else if(kind==="AlternateContent"){
        const choice=child(node,"Choice")??child(node,"Fallback");if(choice)walk(choice,t);
      }
    }
  };
  const tree=path(sld,"cSld","spTree");if(tree)walk(tree,IDENTITY);else warnings.push("Slide has no shape tree.");
  const titleBlock=textBlocks.find(b=>b.role==="title");
  let notes:string|undefined;const notesPart=relOfType(rels,"notesSlide")?.target;
  if(notesPart&&zip.has(notesPart)){
    const nd=parseXml(zip.readText(notesPart));
    const body=descendants(nd,"sp").filter(sp=>placeholderOf(sp)?.type==="body").flatMap(sp=>paragraphsOf(child(sp,"txBody")).map(p=>p.text));
    if(body.length)notes=body.join("\n");
  }
  return {index,partName:part,hidden:sld.attrs.show==="0",...(titleBlock?{title:titleBlock.text.replace(/\s+/g," ").trim()}:{}),textBlocks,pictures,shapes,parts,...(notes?{notes}:{}),warnings};
}

function chartSummary(xml:string):{text:string;chartTypes:string[];title?:string;series:Array<{name?:string;categories:string[];values:number[]}>}{
  const doc=parseXml(xml),plot=descendants(doc,"plotArea")[0];
  const chartTypes=(plot?.children??[]).map(c=>local(c.name)).filter(n=>n.endsWith("Chart"));
  const titleNode=descendants(doc,"title")[0];const title=titleNode?descendants(titleNode,"t").map(t=>textContent(t)).join("").trim()||undefined:undefined;
  const cache=(n:XmlNode|undefined)=>descendants(n,"pt").map(p=>textContent(child(p,"v")).trim());
  const series=descendants(plot,"ser").map(s=>{const name=cache(child(s,"tx")).join(" ")||undefined;return {...(name?{name}:{}),categories:cache(child(s,"cat")),values:cache(child(s,"val")).map(Number)};});
  const text=[title,...series.map(s=>`${s.name??"Series"}: ${s.categories.map((c,i)=>`${c}=${s.values[i]}`).join(", ")}`)].filter(Boolean).join("\n");
  return {text,chartTypes,...(title?{title}:{}),series};
}
