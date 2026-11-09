import test from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdir,readFile,readdir,rm,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {resetVideoWorkspace} from "../src/harness/archive.js";
import {cropSlideRegion,deckIdFrom,extractDeck} from "../src/sources/extract.js";
import {bindNarrationScript,parseNarrationScript} from "../src/sources/narration.js";
import {assessmentTemplate,checkAssessment,legibilityRating} from "../src/sources/assessment.js";
import {parseBboxLayout,parsePdfToHtmlXml} from "../src/sources/poppler.js";
import {readPptx} from "../src/sources/pptx.js";
import type {DeckIndex,SlideRecord} from "../src/sources/types.js";
import {parseXml,textContent} from "../src/sources/xml.js";
import {openZip} from "../src/sources/zip.js";

const root=process.cwd();
const PPTX="tests/fixtures/pptx/sample-deck.pptx",PDF="tests/fixtures/pptx/sample-deck.pdf";
function available(command:string,args:string[]):Promise<boolean>{return new Promise(done=>execFile(command,args,{timeout:60_000},(error:any)=>done(!error||error.code!=="ENOENT")));}
const readJsonFile=async<T>(path:string)=>JSON.parse(await readFile(path,"utf8")) as T;

test("xml reader keeps mixed-content order and decodes entities",()=>{
  const doc=parseXml(`<?xml version="1.0"?><!-- c --><r a="x &amp; y"><t>one <b>two</b> three&#x21; &lt;4&gt;</t><e/></r>`);
  const r=doc.children.find(c=>c.name==="r")!;
  assert.equal(r.attrs.a,"x & y");
  assert.equal(textContent(r),"one two three! <4>");
});

test("poppler parsers: bullet glyph blocks are dropped and fontspecs are document-global",()=>{
  const blocks=parseBboxLayout(`<html><body><doc><page width="720" height="540"><flow>
    <block xMin="10" yMin="10" xMax="20" yMax="20"><line xMin="10" yMin="10" xMax="20" yMax="20"><word xMin="10" yMin="10" xMax="20" yMax="20">◼</word></line></block>
    <block xMin="30" yMin="10" xMax="200" yMax="40"><line xMin="30" yMin="10" xMax="200" yMax="24"><word xMin="30" yMin="10" xMax="80" yMax="24">Working</word><word xMin="85" yMin="10" xMax="200" yMax="24">software</word></line></block>
  </flow></page></doc></body></html>`);
  assert.equal(blocks[0].length,1);assert.equal(blocks[0][0].text,"Working software");
  assert.deepEqual(blocks[0][0].bounds,{x:30,y:10,width:170,height:30});
  const styled=parsePdfToHtmlXml(`<pdf2xml><page number="1"><fontspec id="0" size="24" color="#000"/><text top="1" left="1" width="9" height="9" font="0">a</text></page>
    <page number="2"><text top="5" left="5" width="50" height="30" font="0"><b>Reused font</b></text><image top="100" left="50" width="40" height="30" src="doc-2_1.png"/></page>
    <outline><item page="2">Slide 2: Second Title</item></outline></pdf2xml>`);
  assert.equal(styled.pages.get(2)!.runs[0].fontSizePt,24);
  assert.equal(styled.pages.get(2)!.runs[0].bold,true);
  assert.deepEqual(styled.pages.get(2)!.images[0].bounds,{x:50,y:100,width:40,height:30});
  assert.equal(styled.outline.get(2),"Second Title");
});

test("OOXML reader: inherited placeholder geometry, group transforms, pictures, tables, notes, hidden slides",async()=>{
  const deck=readPptx(openZip(await readFile(resolve(root,PPTX))));
  assert.deepEqual(deck.slideSize,{width:720,height:540});
  assert.equal(deck.title,"Fixture Deck");
  assert.equal(deck.slides.length,4);
  const [s1,s2,s3,s4]=deck.slides;
  assert.equal(s1.title,"Fixture Deck");
  assert.deepEqual(s1.textBlocks[0].bounds,{x:48,y:30,width:624,height:80},"title geometry is inherited from the layout");
  assert.equal(s1.textBlocks[1].role,"subtitle");
  assert.equal(s1.notes,"Welcome to the fixture deck.");
  const body=s2.textBlocks.find(b=>b.role==="body")!;
  assert.deepEqual(body.paragraphs!.map(p=>[p.level,p.fontSizePt]),[[0,24],[1,18],[0,24]]);
  assert.equal(s2.textBlocks[0].fontSizePt,36);
  assert.equal(s2.pictures[0].mediaPart,"ppt/media/image1.png");
  assert.equal(s2.pictures[0].description,"A red square");
  assert.deepEqual(s2.pictures[0].bounds,{x:500,y:300,width:160,height:120});
  const boxA=s3.textBlocks.find(b=>b.text==="Build")!,boxB=s3.textBlocks.find(b=>b.text==="Test")!;
  assert.deepEqual(boxA.bounds,{x:100,y:200,width:100,height:100},"group child scaled x2 and offset");
  assert.deepEqual(boxB.bounds,{x:400,y:200,width:100,height:100});
  const table=s3.shapes.find(s=>s.kind==="table")!;
  assert.deepEqual((table.detail as {rows:string[][]}).rows,[["Stage","Owner"],["Test","Developer"]]);
  assert.ok(s3.shapes.some(s=>s.kind==="connector"));
  assert.equal(s4.hidden,true);
});

test("narration script binding covers every slide exactly once",()=>{
  const deck={id:"d",slideCount:6,slides:[1,2,3,4,5,6].map(n=>({slide:n,id:`slide-00${n}`,text:"",json:"",wordCount:0,imageCount:0,warnings:0}))};
  const ok=parseNarrationScript(`# Script\n\n## Slides 1, 2 [skip]\nTitle and outline are covered by the intro.\n\n## Slide 3: Intro\n> keep it short\nHello there, students.\n\n## Slides 4-6 — Details\nOne two three four five.\n`,deck,"script.md");
  assert.deepEqual(ok.errors,[]);
  assert.deepEqual(ok.segments.map(s=>s.slides),[[3],[4,5,6]]);
  assert.equal(ok.segments[1].title,"Details");
  assert.deepEqual(ok.segments[0].notes,["keep it short"]);
  assert.equal(ok.segments[0].narration,"Hello there, students.");
  assert.deepEqual(ok.skipped,[{slides:[1,2],reason:"Title and outline are covered by the intro."}]);
  assert.equal(ok.totals.words,8);
  const bad=parseNarrationScript(`## Slide 1\nHi.\n## Slides 1-2\nAgain.\n## Slide 9\nNope.\n## Notes\n`,deck,"script.md");
  assert.ok(bad.errors.some(e=>/Slide 1 is covered twice/.test(e)),bad.errors.join("\n"));
  assert.ok(bad.errors.some(e=>/slide 9/.test(e)));
  assert.ok(bad.errors.some(e=>/not a slide label/.test(e)));
  assert.ok(bad.errors.some(e=>/not covered.*3, 4, 5, 6/.test(e)));
});

test("deck ids are filesystem-safe slugs",()=>{
  assert.equal(deckIdFrom("video-input/sources/LN04/LN04 - Agile Methods.pdf"),"ln04-agile-methods");
  assert.equal(deckIdFrom("Bài giảng 5.pptx"),"bai-giang-5");
});

test("PDF extraction writes renders, per-slide text/JSON, images and a deterministic deck index",async()=>{
  if(!(await available("pdftoppm",["-v"]))){console.log("# skipped: poppler not installed");return;}
  const tmp=resolve(root,"tests/.tmp-sources-pdf");await rm(tmp,{recursive:true,force:true});await mkdir(tmp,{recursive:true});
  try{
    await writeFile(resolve(tmp,"deck.pdf"),await readFile(resolve(root,PDF)));
    const {deck,directory}=await extractDeck(tmp,"deck.pdf",{id:"sample",dpi:48,contactSheets:false});
    assert.equal(deck.format,"pdf");assert.equal(deck.slideCount,3);assert.equal(deck.slideSize.aspectRatio,"4:3");
    for(const s of deck.slides){assert.ok(s.render);await readFile(resolve(directory,s.render!));assert.match(await readFile(resolve(directory,s.text),"utf8"),/\S/);}
    const s2=await readJsonFile<SlideRecord>(resolve(directory,"slides/slide-002.json"));
    assert.equal(s2.title,"Why Tests Matter");
    assert.equal(s2.textBlocks.find(b=>b.role==="title")!.fontSizePt,36);
    assert.equal(s2.images.length,1);assert.equal(s2.images[0].pixelWidth,40);
    assert.ok(s2.images[0].bounds&&Math.abs(s2.images[0].bounds.x-500)<1&&Math.abs(s2.images[0].bounds.width-160)<1);
    assert.equal(s2.metrics.minFontPxAt1080,36,"18 pt on a 540 pt slide is 36 px at 1080p");
    const first=await readFile(resolve(directory,"deck.json"),"utf8");
    await extractDeck(tmp,"deck.pdf",{id:"sample",dpi:48,contactSheets:false});
    assert.equal(await readFile(resolve(directory,"deck.json"),"utf8"),first,"re-extraction is byte-identical");
    const crop=await cropSlideRegion(tmp,"sample",2,{x:500,y:300,width:160,height:120},"red-square");
    assert.match(crop,/elements\/slide-002\/red-square\.png$/);await readFile(resolve(tmp,crop));
  }finally{await rm(tmp,{recursive:true,force:true});}
});

test("PPTX extraction uses OOXML for text/media/notes and LibreOffice for renders",async()=>{
  if(!(await available("soffice",["--version"]))||!(await available("pdftoppm",["-v"]))){console.log("# skipped: LibreOffice or poppler not installed");return;}
  const tmp=resolve(root,"tests/.tmp-sources-pptx");await rm(tmp,{recursive:true,force:true});await mkdir(tmp,{recursive:true});
  try{
    await writeFile(resolve(tmp,"Sample Deck.pptx"),await readFile(resolve(root,PPTX)));
    const {deck,directory}=await extractDeck(tmp,"Sample Deck.pptx",{dpi:48});
    assert.equal(deck.id,"sample-deck");assert.equal(deck.format,"pptx");assert.equal(deck.slideCount,4);
    assert.equal(deck.files.renderedPdf,"rendered.pdf");assert.equal(deck.files.contactSheets.length,1);
    assert.deepEqual(deck.slides.map(s=>!!s.render),[true,true,true,false],"hidden slide is not rendered");
    assert.equal(deck.slides[3].hidden,true);
    assert.equal(await readFile(resolve(directory,deck.slides[0].notes!),"utf8"),"Welcome to the fixture deck.\n");
    assert.equal(deck.images.length,1);assert.equal(deck.images[0].format,"png");assert.deepEqual(deck.images[0].slides,[2]);
    const s1=await readJsonFile<SlideRecord>(resolve(directory,"slides/slide-001.json"));
    assert.equal(s1.textBlocks[0].fontSizePt,44,"font size missing from OOXML is recovered from the render");
    const s3=await readJsonFile<SlideRecord>(resolve(directory,"slides/slide-003.json"));
    assert.match(s3.text,/Stage \| Owner/);
    const index=await readJsonFile<DeckIndex>(resolve(directory,"deck.json"));
    assert.equal(index.source.fileName,"Sample Deck.pptx");assert.match(index.source.sha256,/^[0-9a-f]{64}$/);
    assert.match(await readFile(resolve(directory,"text/deck.txt"),"utf8"),/=== Slide 4: Hidden Backup Slide \(hidden\) ===/);
    await writeFile(resolve(tmp,"script.md"),"## Slide 1\nWelcome.\n## Slides 2-3\nTests and pipelines.\n","utf8");
    const binding=await bindNarrationScript(tmp,"sample-deck","script.md");
    assert.deepEqual(binding.errors,[],"hidden slides need no coverage");
  }finally{await rm(tmp,{recursive:true,force:true});}
});

test("video init keeps normalized sources while clearing per-video state",async()=>{
  const tmp=resolve(root,"tests/.tmp-sources-reset");await rm(tmp,{recursive:true,force:true});
  await mkdir(resolve(tmp,".video/sources/deck"),{recursive:true});await mkdir(resolve(tmp,".video/candidates"),{recursive:true});
  await writeFile(resolve(tmp,".video/sources/deck/deck.json"),"{}","utf8");await writeFile(resolve(tmp,".video/request.txt"),"x","utf8");
  try{await resetVideoWorkspace(tmp);assert.deepEqual((await readdir(resolve(tmp,".video"))).sort(),["sources"]);}
  finally{await rm(tmp,{recursive:true,force:true});}
});

test("slide assessment: template pre-fills measured facts and check enforces decisions, coverage and licences",async()=>{
  assert.equal(legibilityRating(36),"good");assert.equal(legibilityRating(24),"marginal");assert.equal(legibilityRating(16),"poor");assert.equal(legibilityRating(undefined),"n/a");
  if(!(await available("pdftoppm",["-v"]))){console.log("# skipped: poppler not installed");return;}
  const tmp=resolve(root,"tests/.tmp-sources-assess");await rm(tmp,{recursive:true,force:true});await mkdir(tmp,{recursive:true});
  try{
    await writeFile(resolve(tmp,"deck.pdf"),await readFile(resolve(root,PDF)));
    const {directory}=await extractDeck(tmp,"deck.pdf",{id:"a",dpi:48,contactSheets:false});
    await writeFile(resolve(tmp,"script.md"),"## Slide 1 [skip]\nTitle only.\n## Slides 2-3\nTests and pipelines.\n","utf8");
    await bindNarrationScript(tmp,"a","script.md");
    const draft=await assessmentTemplate(tmp,"a");
    assert.deepEqual(draft.slides.map(s=>[s.segment,s.decision]),[[null,"omit"],["seg-01",null],["seg-01",null]]);
    assert.equal(draft.slides[1].legibility.rating,"good");
    const image=(await readJsonFile<SlideRecord>(resolve(directory,"slides/slide-002.json"))).images[0].asset;
    const write=async(value:unknown)=>writeFile(resolve(directory,"assessment.json"),JSON.stringify(value),"utf8");
    const done=structuredClone(draft);
    done.slides[0].reason="Title slide.";
    done.slides[1]={...done.slides[1],decision:"crop-elements",reason:"Reuse the picture.",reusableAssets:[{path:image,kind:"embedded-image",use:"whole-with-attribution",license:{id:"CC BY",attribution:"Fixture",constraints:["attribution-required"]}}]};
    done.slides[2]={...done.slides[2],decision:"rebuild-animated",reason:"Animate the pipeline."};
    await write(done);
    const ok=await checkAssessment(tmp,"a");assert.deepEqual(ok.errors,[]);assert.equal((ok.summary.decisions as Record<string,number>)["crop-elements"],1);
    const bad=structuredClone(done);
    bad.slides[0].decision="text-only";
    bad.slides[1].reusableAssets=[{path:image,kind:"embedded-image",use:"crop",license:{id:"CC BY-NC-ND",constraints:["no-derivatives"]}},{path:"images/missing.png",kind:"embedded-image",use:"whole",license:{id:"unknown",constraints:[]}}];
    bad.slides[2].decision="keep-whole";bad.slides[2].reason="two\nlines";
    bad.slides[0].expression={rating:"strong",issues:["wall-of-text"]};
    bad.slides.pop();bad.slides.push({...done.slides[1],slide:2});
    await write(bad);
    const errors=(await checkAssessment(tmp,"a")).errors.join("\n");
    for(const pattern of [/skips this slide/,/no-derivatives/,/does not exist/,/unknown licence/,/contradicts issue\(s\) wall-of-text/,/assessed twice/,/Slides not assessed: 3/])assert.match(errors,pattern);
  }finally{await rm(tmp,{recursive:true,force:true});}
});
