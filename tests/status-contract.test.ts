import assert from "node:assert/strict";
import {execFile as execFileCallback} from "node:child_process";
import {mkdir,rm,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";

const root=process.cwd();

function runCli(cwd:string):Promise<string>{
  return new Promise((resolvePromise,reject)=>execFileCallback(process.argv[0],[resolve(root,"dist/src/cli.js"),"status"],{cwd},(error,stdout,stderr)=>{
    if(error){reject(new Error(stderr||error.message));return;}
    resolvePromise(stdout);
  }));
}

test("video status exposes canonical project load errors",async()=>{
  const tmp=resolve(root,"tests/.tmp-status-project-error");await rm(tmp,{recursive:true,force:true});await mkdir(resolve(tmp,".video"),{recursive:true});await mkdir(resolve(tmp,".agents/skills/video-types/neutral"),{recursive:true});
  try{
    await writeFile(resolve(tmp,"video.json"),"{ broken json","utf8");
    await writeFile(resolve(tmp,".agents/skills/video-types/catalog.json"),JSON.stringify({version:"1",profiles:[{id:"neutral",description:"test profile"}]}),"utf8");
    await writeFile(resolve(tmp,".agents/skills/video-types/neutral/SKILL.md"),"# Neutral\n","utf8");
    const output=JSON.parse(await runCli(tmp));
    assert.equal(output.project,null);
    assert.match(output.projectError,/JSON|Unexpected|position/i);
  }finally{await rm(tmp,{recursive:true,force:true});}
});
