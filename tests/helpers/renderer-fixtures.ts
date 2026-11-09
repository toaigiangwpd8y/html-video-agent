import {mkdir,readFile,stat,writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";

async function exists(path:string):Promise<boolean>{try{return (await stat(path)).isFile();}catch{return false;}}

/** Makes the pinned Remotion runtime appear installed while a test records its explicit human choice. */
export async function withAvailableRemotion<T>(root:string,operation:()=>Promise<T>):Promise<T>{
  const mainPackage=JSON.parse(await readFile(resolve(process.cwd(),"remotion/package.json"),"utf8")) as {dependencies?:Record<string,string>};
  const version=mainPackage.dependencies?.remotion;
  if(!version)throw new Error("The repository Remotion manifest must pin a version for this renderer fixture.");

  const remotionRoot=resolve(root,"remotion"),handoff=resolve(root,".agents/skills/agent-video/references/remotion-handoff.md"),browser=resolve(root,".test-browser.exe");
  const addedHandoff=!(await exists(handoff)),browserExecutable=process.platform==="win32"?"remotion.cmd":"remotion";
  await mkdir(resolve(remotionRoot,"node_modules/remotion"),{recursive:true});
  await mkdir(resolve(remotionRoot,"node_modules/.bin"),{recursive:true});
  await mkdir(resolve(remotionRoot,"scripts"),{recursive:true});
  await writeFile(resolve(remotionRoot,"package.json"),JSON.stringify({private:true,type:"module",dependencies:{remotion:version}}),"utf8");
  await writeFile(resolve(remotionRoot,"node_modules/remotion/package.json"),JSON.stringify({name:"remotion",version}),"utf8");
  await writeFile(resolve(remotionRoot,"node_modules/.bin",browserExecutable),"test fixture; never executed\n","utf8");
  await writeFile(resolve(remotionRoot,"AUTHORING.md"),"# Test authoring contract\n","utf8");
  await writeFile(resolve(remotionRoot,"scripts/loopback-only.mjs"),"// Test fixture\n","utf8");
  await writeFile(browser,"test fixture; never executed\n","utf8");
  if(addedHandoff){
    await mkdir(dirname(handoff),{recursive:true});
    await writeFile(handoff,"# Test Remotion handoff\n","utf8");
  }

  const previousBrowser=process.env.REMOTION_BROWSER_EXECUTABLE;
  process.env.REMOTION_BROWSER_EXECUTABLE=browser;
  try{return await operation();}
  finally{if(previousBrowser===undefined)delete process.env.REMOTION_BROWSER_EXECUTABLE;else process.env.REMOTION_BROWSER_EXECUTABLE=previousBrowser;}
}
