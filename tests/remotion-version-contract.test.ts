import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import test from "node:test";
import {rendererAvailability} from "../src/harness/renderer-selection.js";
import {readPinnedRemotionVersion} from "../src/harness/remotion-version.js";
import {pathToFileURL} from "node:url";

const root=process.cwd();

test("Remotion family validator accepts manifest, lockfile, and installed version agreement",async()=>{
  const {assertRemotionFamily}=await import(pathToFileURL(resolve(root,"scripts/remotion-skills-setup.mjs")).href);
  const projectRoot=await makeRemotionFamilyFixture("4.0.538");
  try{assert.doesNotThrow(()=>assertRemotionFamily(projectRoot,"4.0.538"));}
  finally{await rm(projectRoot,{recursive:true,force:true});}
});

for(const mismatch of ["manifest","lockfile","installed"] as const){
  test(`Remotion family validator rejects ${mismatch} version mismatch`,async()=>{
    const {assertRemotionFamily}=await import(pathToFileURL(resolve(root,"scripts/remotion-skills-setup.mjs")).href);
    const projectRoot=await makeRemotionFamilyFixture("4.0.538");
    try{
      const target=mismatch==="manifest"?"remotion/package.json":mismatch==="lockfile"?"remotion/package-lock.json":"remotion/node_modules/remotion/package.json";
      const path=resolve(projectRoot,target),data=JSON.parse(await readFile(path,"utf8"));
      if(mismatch==="manifest")data.dependencies.remotion="4.0.537";
      else if(mismatch==="lockfile")data.packages["node_modules/remotion"].version="4.0.537";
      else data.version="4.0.537";
      await writeFile(path,JSON.stringify(data));
      assert.throws(()=>assertRemotionFamily(projectRoot,"4.0.538"),/Remotion version mismatch/);
    }finally{await rm(projectRoot,{recursive:true,force:true});}
  });
}

async function makeRemotionFamilyFixture(version:string):Promise<string>{
  const projectRoot=await mkdtemp(join(tmpdir(),"remotion-family-validator-")),remotion=resolve(projectRoot,"remotion");
  await mkdir(resolve(remotion,"node_modules/remotion"),{recursive:true});
  const manifest={dependencies:{remotion:version,"@remotion/cli":version}},lock={packages:{"node_modules/remotion":{version},"node_modules/@remotion/cli":{version}}};
  await writeFile(resolve(remotion,"package.json"),JSON.stringify(manifest));await writeFile(resolve(remotion,"package-lock.json"),JSON.stringify(lock));
  await writeFile(resolve(remotion,"node_modules/remotion/package.json"),JSON.stringify({version}));await mkdir(resolve(remotion,"node_modules/@remotion/cli"),{recursive:true});await writeFile(resolve(remotion,"node_modules/@remotion/cli/package.json"),JSON.stringify({version}));
  return projectRoot;
}

test("Remotion runtime selection follows the version in its package manifest",async()=>{
  const projectRoot=await mkdtemp(join(tmpdir(),"remotion-version-contract-")),remotionRoot=resolve(projectRoot,"remotion"),futureVersion="8.4.1";
  const browser=resolve(projectRoot,"chrome.exe"),originalBrowser=process.env.REMOTION_BROWSER_EXECUTABLE;
  try{
    await mkdir(resolve(remotionRoot,"node_modules/remotion"),{recursive:true});
    await mkdir(resolve(remotionRoot,"node_modules/.bin"),{recursive:true});
    await mkdir(resolve(remotionRoot,"scripts"),{recursive:true});
    await mkdir(resolve(projectRoot,".agents/skills/agent-video/references"),{recursive:true});
    await writeFile(resolve(remotionRoot,"package.json"),JSON.stringify({dependencies:{remotion:futureVersion}}));
    await writeFile(resolve(remotionRoot,"node_modules/remotion/package.json"),JSON.stringify({version:futureVersion}));
    await writeFile(resolve(remotionRoot,"node_modules/.bin/remotion.cmd"),"");
    await writeFile(resolve(remotionRoot,"AUTHORING.md"),"");
    await writeFile(resolve(remotionRoot,"scripts/loopback-only.mjs"),"");
    await writeFile(resolve(projectRoot,".agents/skills/agent-video/references/remotion-handoff.md"),"");
    await writeFile(browser,"");
    process.env.REMOTION_BROWSER_EXECUTABLE=browser;

    const remotion=(await rendererAvailability(projectRoot)).find(option=>option.id==="remotion");
    if(!remotion)throw new Error("Remotion availability was not reported.");
    assert.equal(remotion.version,futureVersion);
    assert.equal(remotion.available,Number(process.versions.node.split(".")[0])>=22);
  }finally{
    if(originalBrowser===undefined)delete process.env.REMOTION_BROWSER_EXECUTABLE;
    else process.env.REMOTION_BROWSER_EXECUTABLE=originalBrowser;
    await rm(projectRoot,{recursive:true,force:true});
  }
});

test("renderer availability reports a missing Remotion pin instead of throwing",async()=>{
  const projectRoot=await mkdtemp(join(tmpdir(),"remotion-version-missing-"));
  try{
    const remotion=(await rendererAvailability(projectRoot)).find(option=>option.id==="remotion");
    if(!remotion)throw new Error("Remotion availability was not reported.");
    assert.equal(remotion.available,false);
    assert.match(remotion.reason??"",/remotion\/package\.json must pin an exact Remotion version/i);
  }finally{await rm(projectRoot,{recursive:true,force:true});}
});

test("the canonical Remotion version pin rejects semver ranges",async()=>{
  const projectRoot=await mkdtemp(join(tmpdir(),"remotion-version-range-"));
  try{
    await mkdir(resolve(projectRoot,"remotion"),{recursive:true});
    await writeFile(resolve(projectRoot,"remotion/package.json"),JSON.stringify({dependencies:{remotion:"^4.0.527"}}));
    await assert.rejects(readPinnedRemotionVersion(resolve(projectRoot,"remotion")),/must pin an exact Remotion version/);
  }finally{await rm(projectRoot,{recursive:true,force:true});}
});

test("the Remotion manifest and lockfile keep the runtime packages and GSAP aligned",async()=>{
  const manifest=JSON.parse(await readFile(resolve(root,"remotion/package.json"),"utf8")) as {dependencies:Record<string,string>};
  const lock=JSON.parse(await readFile(resolve(root,"remotion/package-lock.json"),"utf8")) as {packages:Record<string,{dependencies?:Record<string,string>;version?:string}>};
  const version=manifest.dependencies.remotion,remotionDependencies=Object.entries(manifest.dependencies).filter(([name])=>name.startsWith("@remotion/"));

  assert.ok(version,"remotion/package.json must declare the canonical Remotion version");
  assert.ok(remotionDependencies.some(([name])=>name==="@remotion/gsap"),"the @remotion/gsap integration must remain installed");
  assert.ok(manifest.dependencies.gsap,"GSAP must remain a direct dependency");
  for(const [name,dependencyVersion] of remotionDependencies){
    assert.equal(dependencyVersion,version,`${name} must match the canonical remotion dependency`);
    assert.equal(lock.packages[""]?.dependencies?.[name],dependencyVersion,`lockfile root dependency ${name} must match package.json`);
    assert.equal(lock.packages[`node_modules/${name}`]?.version,version,`lockfile package ${name} must match the canonical version`);
  }
  assert.equal(lock.packages[""]?.dependencies?.gsap,manifest.dependencies.gsap,"lockfile root GSAP dependency must match package.json");
  assert.equal(lock.packages["node_modules/gsap"]?.version,manifest.dependencies.gsap,"lockfile GSAP package must match package.json");

  const selectionSource=await readFile(resolve(root,"src/harness/renderer-selection.ts"),"utf8");
  const remotionSource=await readFile(resolve(root,"src/harness/remotion.ts"),"utf8");
  assert.match(selectionSource,/readPinnedRemotionVersion\(p\.remotion\)/);
  assert.match(remotionSource,/readPinnedRemotionVersion\(p\.remotion\)/);
  assert.doesNotMatch(selectionSource,/remotion\s*:\s*["']\d+\.\d+\.\d+/);
  assert.doesNotMatch(remotionSource,/REMOTION_VERSION\s*=|rendererVersion\s*:\s*["']\d+\.\d+\.\d+/);
});

test("all installed Remotion packages use the canonical exact runtime pin",async()=>{
  const manifest=JSON.parse(await readFile(resolve(root,"remotion/package.json"),"utf8")) as {dependencies:Record<string,string>};
  const version=manifest.dependencies.remotion;
  for(const [name,pin] of Object.entries(manifest.dependencies).filter(([name])=>name==="remotion"||name.startsWith("@remotion/"))){
    assert.equal(pin,version,`${name} must use the canonical Remotion version`);
  }
  assert.equal(version,"4.0.538");
});

test("the current Remotion review pointer follows the canonical pinned release",async()=>{
  const manifest=JSON.parse(await readFile(resolve(root,"remotion/package.json"),"utf8")) as {dependencies:Record<string,string>};
  const pointer=await readFile(resolve(root,"docs/compliance/remotion-current-review.md"),"utf8");
  const reportLink=pointer.match(/\[exact-version review\]\(\.\/([^\)]+)\)/i);

  assert.ok(pointer.includes("Current pinned release: `"+manifest.dependencies.remotion+"`"));
  assert.ok(reportLink,"current review pointer must link an exact-version review document");
  if(!reportLink)throw new Error("Current review pointer has no exact-version review link.");
  const report=await readFile(resolve(root,"docs/compliance",reportLink[1]),"utf8");
  assert.ok(report.includes(manifest.dependencies.remotion),"the linked review must cover the canonical pinned release");
  for(const file of ["README.md","docs/ARCHITECTURE.md"]){
    const documentation=await readFile(resolve(root,file),"utf8");
    assert.ok(documentation.includes("remotion-current-review.md"),`${file} must link the current review pointer`);
    assert.doesNotMatch(documentation,/Remotion `?4\.0\.\d+/i,`${file} must not freeze the current Remotion release in general guidance`);
  }
  const oldReview=await readFile(resolve(root,"docs/compliance/remotion-4.0.506-preliminary-review.md"),"utf8");
  assert.match(oldReview,/historical/i);
  assert.doesNotMatch(oldReview,/exact Remotion package versions in .*lockfile are `4\.0\.506`/i);
});
