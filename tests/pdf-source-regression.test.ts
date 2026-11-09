import test from "node:test";
import assert from "node:assert/strict";
import {execFile as execFileCallback} from "node:child_process";
import {mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {resolve} from "node:path";

const repo=process.cwd(),cli=resolve(repo,"dist/src/cli.js");
async function runVideo(cwd:string,...args:string[]):Promise<string>{return new Promise((resolvePromise,reject)=>execFileCallback(process.argv[0],[cli,...args],{cwd},(error,stdout,stderr)=>error?reject(new Error(stderr||error.message)):resolvePromise(stdout)));}
function makePdf(lines:string[]):Uint8Array{
  const pageIds=lines.map((_,index)=>3+index*2),fontId=3+lines.length*2,objects:string[]=[];
  objects[1]="<< /Type /Catalog /Pages 2 0 R >>";
  objects[2]=`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(" ")}] /Count ${lines.length} >>`;
  for(let index=0;index<lines.length;index++){
    const pageId=pageIds[index],contentId=pageId+1,text=lines[index].replaceAll("\\","\\\\").replaceAll("(","\\(").replaceAll(")","\\)");
    objects[pageId]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    const inlineImage=index===0?"\nq 48 0 0 48 300 400 cm\nBI /W 1 /H 1 /CS /RGB /BPC 8 /F /AHx ID FF0000> EI\nQ":"";
    const stream=`BT /F1 24 Tf 72 700 Td (${text}) Tj ET${inlineImage}`;
    objects[contentId]=`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objects[fontId]="<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let pdf="%PDF-1.4\n";const offsets:number[]=[0];
  for(let id=1;id<objects.length;id++){offsets[id]=pdf.length;pdf+=`${id} 0 obj\n${objects[id]}\nendobj\n`;}
  const xref=pdf.length;pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let id=1;id<objects.length;id++)pdf+=`${String(offsets[id]).padStart(10,"0")} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

test("PDF input creates per-page text, positioned text elements, previews, and exact narration bindings",async()=>{
  const tmp=resolve(repo,"tests/.tmp-pdf-source");await rm(tmp,{recursive:true,force:true});await mkdir(tmp,{recursive:true});
  try{
    await writeFile(resolve(tmp,"lesson.pdf"),makePdf(["PDF_PAGE_ONE","PDF_PAGE_TWO"]));
    await writeFile(resolve(tmp,"voice.md"),"## slide-1\nPage one narration.\n\n## slide-2\nPage two narration.\n","utf8");
    const result=JSON.parse(await runVideo(tmp,"source","import","lesson.pdf","--script","voice.md"));
    const source=JSON.parse(await readFile(resolve(tmp,result.sourcePath),"utf8"));
    assert.equal(source.kind,"document");assert.equal(source.sections.length,2);
    assert.equal(source.sections[0].narration.text,"Page one narration.");assert.equal(source.sections[1].narration.text,"Page two narration.");
    for(const [index,section] of source.sections.entries()){
      const text=await readFile(resolve(tmp,".video/sources",source.id,section.textPath),"utf8");assert.match(text,new RegExp(`PDF_PAGE_${index===0?"ONE":"TWO"}`));
      const preview=source.assets.find((asset:any)=>asset.id===`preview-page-${String(index+1).padStart(3,"0")}`);assert.ok(preview);
      const png=await readFile(resolve(tmp,".video/sources",source.id,preview.path));assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.ok(png.length>1000);
      assert.ok(source.elements.some((element:any)=>element.type==="text"&&element.bbox&&element.text.includes(`PDF_PAGE_${index===0?"ONE":"TWO"}`)));
    }
    const extractedImage=source.assets.find((asset:any)=>asset.metadata?.kind==="embedded-image");assert.ok(extractedImage,"embedded PDF images should become independently selectable source assets");
    const extractedImageBytes=await readFile(resolve(tmp,".video/sources",source.id,extractedImage.path));assert.deepEqual([...extractedImageBytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    assert.ok(source.elements.some((element:any)=>element.type==="image"&&element.assetRef===extractedImage.id&&element.bbox));
    assert.deepEqual(JSON.parse(await readFile(resolve(tmp,"assets/manifest.json"),"utf8").catch(()=>"{\"version\":\"1\",\"assets\":[]}")),{version:"1",assets:[]});
  }finally{await rm(tmp,{recursive:true,force:true});}
});

test("slide narration parser requires explicit labels for multi-page documents",async()=>{
  const tmp=resolve(repo,"tests/.tmp-pdf-narration-labels");await rm(tmp,{recursive:true,force:true});await mkdir(tmp,{recursive:true});
  try{
    await writeFile(resolve(tmp,"lesson.pdf"),makePdf(["ONE","TWO"]));await writeFile(resolve(tmp,"voice.md"),"One unlabelled paragraph.","utf8");
    await assert.rejects(()=>runVideo(tmp,"source","import","lesson.pdf","--script","voice.md"),/label.*slide|per-slide/i);
  }finally{await rm(tmp,{recursive:true,force:true});}
});

test("PDF import enforces the shared Node preview runtime floor",async()=>{
  const adapter=await import("../src/sources/pdf-adapter.js");
  assert.throws(()=>adapter.assertPdfPreviewRuntime("20.0.0"),/PDF import requires Node\.js >=22\.18\.0/);
  assert.doesNotThrow(()=>adapter.assertPdfPreviewRuntime("22.18.0"));
});
