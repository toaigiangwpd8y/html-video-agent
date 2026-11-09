import test from "node:test";
import assert from "node:assert/strict";
import {execFile as execFileCallback} from "node:child_process";
import {copyFile,mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {resolve} from "node:path";

const repo=process.cwd(),cli=resolve(repo,"dist/src/cli.js"),fixture=resolve(repo,"tests/fixtures/pptx/two-slides.pptx");
async function runVideo(cwd:string,...args:string[]):Promise<string>{return new Promise((resolvePromise,reject)=>execFileCallback(process.argv[0],[cli,...args],{cwd},(error,stdout,stderr)=>error?reject(new Error(stderr||error.message)):resolvePromise(stdout)));}

test("input package auto-routes its only deck and maps exact narration to labeled slides",async()=>{
  const tmp=resolve(repo,"tests/.tmp-input-package-import");await rm(tmp,{recursive:true,force:true});await mkdir(resolve(tmp,"video-input/sources"),{recursive:true});
  try{
    await copyFile(fixture,resolve(tmp,"video-input/sources/lesson.pptx"));
    await writeFile(resolve(tmp,"video-input/script.md"),"## slide-1\nFirst narration, unchanged.\n\n## slide-2\nSecond narration, unchanged.\n","utf8");
    await writeFile(resolve(tmp,"video-input/manifest.json"),JSON.stringify({version:1,workflow:"slides-to-video",script:"script.md",sources:[{id:"lesson",type:"pptx",path:"sources/lesson.pptx"}]}),"utf8");
    const result=JSON.parse(await runVideo(tmp,"source","import-input"));
    assert.equal(result.imported.length,1);
    const source=JSON.parse(await readFile(resolve(tmp,result.imported[0].sourcePath),"utf8"));
    assert.equal(source.sections.length,2);
    assert.equal(source.sections[0].narration.text,"First narration, unchanged.");
    assert.equal(source.sections[1].narration.text,"Second narration, unchanged.");
    for(const section of source.sections){assert.match(section.textPath,/^text\/slide-\d{3}\.txt$/);assert.ok((await readFile(resolve(tmp,".video/sources",source.id,section.textPath),"utf8")).length>0);}
    assert.equal(await readFile(resolve(tmp,".video/request.txt"),"utf8").catch(()=>null),null,"source intake does not resolve or approve preproduction HITL");
  }finally{await rm(tmp,{recursive:true,force:true});}
});

test("input package rejects paths that escape its drop folder",async()=>{
  const tmp=resolve(repo,"tests/.tmp-input-package-traversal");await rm(tmp,{recursive:true,force:true});await mkdir(resolve(tmp,"video-input"),{recursive:true});
  try{
    await writeFile(resolve(tmp,"video-input/manifest.json"),JSON.stringify({version:1,workflow:"slides-to-video",sources:[{id:"outside",type:"pptx",path:"../outside.pptx"}]}),"utf8");
    await assert.rejects(()=>runVideo(tmp,"source","import-input"),/escapes video-input|inside video-input/i);
  }finally{await rm(tmp,{recursive:true,force:true});}
});

test("input package rejects ambiguous auto-detection and init preserves user input",async()=>{
  const tmp=resolve(repo,"tests/.tmp-input-package-ambiguous");await rm(tmp,{recursive:true,force:true});await mkdir(resolve(tmp,"video-input"),{recursive:true});
  try{
    await copyFile(fixture,resolve(tmp,"video-input/one.pptx"));await copyFile(fixture,resolve(tmp,"video-input/two.pptx"));
    await assert.rejects(()=>runVideo(tmp,"source","import-input"),/ambiguous|exactly one/i);
    await writeFile(resolve(tmp,"video-input/keep.txt"),"user input survives init","utf8");
    await runVideo(tmp,"init");
    assert.equal(await readFile(resolve(tmp,"video-input/keep.txt"),"utf8"),"user input survives init");
  }finally{await rm(tmp,{recursive:true,force:true});}
});
