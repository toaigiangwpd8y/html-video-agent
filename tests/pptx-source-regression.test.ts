import test from "node:test";
import assert from "node:assert/strict";
import {execFile as execFileCallback} from "node:child_process";
import {mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {invalidateProjectDerived} from "../src/harness/canonical-promotion.js";

const repo=process.cwd();
const cli=resolve(repo,"dist/src/cli.js");
const fixture=resolve(repo,"tests/fixtures/pptx/smartart.pptx");

async function runVideo(cwd:string,...args:string[]):Promise<string>{
  return new Promise((resolvePromise,reject)=>execFileCallback(process.argv[0],[cli,...args],{cwd},(error,stdout,stderr)=>error?reject(new Error(stderr||error.message)):resolvePromise(stdout)));
}

test("native SmartArt import keeps structure, slide text, and a full-slide PNG preview that can be selected",async()=>{
  const tmp=resolve(repo,"tests/.tmp-pptx-smartart-regression");
  await rm(tmp,{recursive:true,force:true});await mkdir(tmp,{recursive:true});
  try{
    await mkdir(resolve(tmp,"assets"),{recursive:true});
    await writeFile(resolve(tmp,"assets/manifest.json"),JSON.stringify({version:"1",assets:[]}));
    const imported=JSON.parse(await runVideo(tmp,"source","import-pptx",fixture)) as {sourceId:string;sourcePath:string};
    const source=JSON.parse(await readFile(resolve(tmp,imported.sourcePath),"utf8"));
    const diagram=source.elements.find((element:any)=>element.type==="diagram");
    assert.ok(diagram,"native graphicFrame must be normalized as a diagram");
    assert.deepEqual(diagram.bbox,{x:360,y:108,width:288,height:216});
    assert.deepEqual(diagram.textList,["SMARTART_ALPHA","SMARTART_BETA"]);
    assert.equal(diagram.children.length,2);
    assert.match(diagram.children[0].text,/SMARTART_ALPHA/);
    assert.deepEqual(diagram.children[1].bbox,{x:144,y:0,width:108,height:72});

    const preview=source.assets.find((asset:any)=>asset.metadata?.kind==="slide-preview");
    assert.ok(preview,"every imported slide must retain a rendered preview asset");
    assert.equal(preview.type,"image/png");
    const previewBytes=await readFile(resolve(tmp,".video/sources",source.id,preview.path));
    assert.deepEqual([...previewBytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    assert.ok(previewBytes.length>1000,"preview must contain rendered slide pixels");
    assert.match(source.sections[0].textPath,/text\/slide-001\.txt$/);
    assert.match(await readFile(resolve(tmp,".video/sources",source.id,source.sections[0].textPath),"utf8"),/SMARTART_ALPHA/);

    await runVideo(tmp,"source","materialize",source.id,preview.id,"scene-1","SmartArt slide reference");
    const manifest=JSON.parse(await readFile(resolve(tmp,"assets/manifest.json"),"utf8"));
    assert.equal(manifest.assets.length,1,"only explicitly selected preview is promoted");
    assert.match(manifest.assets[0].provenance,/sourceId=/);
    assert.match(manifest.assets[0].provenance,/sourceElementId=/);
    const copied=await readFile(resolve(tmp,manifest.assets[0].publicPath.slice(1)));
    assert.deepEqual([...copied.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    const embedded=source.assets.find((asset:any)=>asset.metadata?.kind==="embedded-image");assert.ok(embedded,"embedded slide images are extracted as source assets");
    assert.ok((await readFile(resolve(tmp,".video/sources",source.id,embedded!.path))).length>0);
    await runVideo(tmp,"source","materialize",source.id,embedded!.id,"scene-2","selected source photo");
    const withImage=JSON.parse(await readFile(resolve(tmp,"assets/manifest.json"),"utf8"));
    assert.equal(withImage.assets.length,2);
    assert.match(withImage.assets[1].provenance,/sourceElementId=/);
    await invalidateProjectDerived(tmp);
    assert.ok((await readFile(resolve(tmp,".video/sources",source.id,"original.pptx"))).length>0);
    assert.ok((await readFile(resolve(tmp,".video/sources",source.id,preview.path))).length>1000);
    assert.deepEqual(JSON.parse(await readFile(resolve(tmp,"assets/manifest.json"),"utf8")),{version:"1",assets:[]});
    assert.equal(source.kind,"presentation");
    assert.equal(await readFile(resolve(tmp,"video.json"),"utf8").catch(()=>null),null,"PPTX source remains outside canonical video.json");
  }finally{await rm(tmp,{recursive:true,force:true});}
});

test("prompt-only source inspection stays empty",async()=>{
  const tmp=resolve(repo,"tests/.tmp-pptx-prompt-only");
  await rm(tmp,{recursive:true,force:true});await mkdir(tmp,{recursive:true});
  try{
    assert.deepEqual(JSON.parse(await runVideo(tmp,"source","inspect")),[]);
    assert.equal(await readFile(resolve(tmp,".video/request.txt"),"utf8").catch(()=>null),null);
  }finally{await rm(tmp,{recursive:true,force:true});}
});

test("slide sources are extracted before Brief and are consumed selectively after Storyboard approval",async()=>{
  const enhance=await readFile(resolve(repo,".agents/skills/storyboard-enhance/SKILL.md"),"utf8");
  const authoring=await readFile(resolve(repo,".agents/skills/agent-video/references/authoring.md"),"utf8");
  const scriptwriting=await readFile(resolve(repo,".agents/skills/agent-video/references/scriptwriting.md"),"utf8");
  const agentVideo=await readFile(resolve(repo,".agents/skills/agent-video/SKILL.md"),"utf8");
  const slideSkill=await readFile(resolve(repo,".agents/skills/slide-to-video/SKILL.md"),"utf8");
  const sourceImport=agentVideo.indexOf("video source import-input");
  const briefAuthoring=agentVideo.indexOf("4. Create and commit one Video Brief");
  assert.ok(sourceImport>=0&&briefAuthoring>sourceImport,"slide-source intake must happen before Brief authoring");
  assert.match(agentVideo,/slide-to-video\/SKILL\.md/);
  assert.match(enhance,/existing normalized source/i);
  assert.match(enhance,/materializeNormalizedSourceAsset|video source materialize/i);
  assert.doesNotMatch(enhance,/Never seed Video Brief or Script content from the presentation by default/);
  assert.match(slideSkill,/narration coverage/i);
  assert.match(slideSkill,/preserve the full slide|crop|rebuild/i);
  assert.doesNotMatch(authoring,/normalized source|source import-pptx/i);
  assert.doesNotMatch(scriptwriting,/normalized source|source import-pptx/i);
});

test("PPTX import advertises its runtime floor without loading the renderer for other CLI commands",async()=>{
  const adapter=await import("../src/sources/pptx-adapter.js") as unknown as {assertPptxPreviewRuntime:(version:string)=>void};
  assert.equal(typeof adapter.assertPptxPreviewRuntime,"function");
  assert.throws(()=>adapter.assertPptxPreviewRuntime("20.0.0"),/PPTX import requires Node\.js >=22\.18\.0/);
  assert.doesNotThrow(()=>adapter.assertPptxPreviewRuntime("22.18.0"));
  const importer=await readFile(resolve(repo,"src/sources/pptx-adapter.ts"),"utf8");
  assert.doesNotMatch(importer,/import\s+\{\s*renderPptxSlidePreviews\s*\}\s+from/);
  assert.match(importer,/await import\(["']\.\/pptx-preview-adapter\.js["']\)/);
});
