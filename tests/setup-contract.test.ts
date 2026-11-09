import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import test from "node:test";
import {pathToFileURL} from "node:url";

const root=process.cwd();
const {installOfficialSkills}=await import(pathToFileURL(resolve(root,"scripts/remotion-skills-setup.mjs")).href);
const {writeFileSync}=await import("node:fs") as unknown as {writeFileSync:(path:string,contents:string)=>void};

test("root setup installs the complete Codex Remotion skill set from the immutable configured source",async()=>{
  const packageJson=JSON.parse(await readFile(resolve(root,"package.json"),"utf8"));
  const setup=await readFile(resolve(root,"scripts/setup.mjs"),"utf8");
  const installer=await readFile(resolve(root,"scripts/remotion-skills-setup.mjs"),"utf8");
  const source=JSON.parse(await readFile(resolve(root,"remotion-skills-source.json"),"utf8"));
  assert.equal(packageJson.scripts.postinstall,"npm run setup -- --renderer=all","plain npm ci must run the existing pinned setup flow");
  const dependencyInstall=setup.indexOf("Installing pinned ${renderer} dependencies");
  const skillInstall=setup.indexOf("installOfficialSkills(root,source)");
  assert.ok(dependencyInstall>=0,"setup must install the Remotion dependencies");
  assert.ok(skillInstall>dependencyInstall,"official skills must install after Remotion dependencies");
  assert.deepEqual(source,{runtimeVersion:"4.0.538",repo:"https://github.com/remotion-dev/skills",revision:"6c67adcd9cdbe6eb84d76342da89b225f9161cb2"});
  assert.match(installer,/"skills@1\.5\.20","add",checkout/);
  assert.match(installer,/checkout","--quiet","--detach",source\.revision/);
  assert.match(setup,/source\.runtimeVersion!==JSON\.parse/);
  assert.match(installer,/installedVersion!==source\.runtimeVersion/);
  assert.match(setup,/assertRemotionFamily\(root,source\.runtimeVersion\)/);
  assert.match(installer,/manifest, lockfile, and installed runtime/);
  assert.match(installer,/Installed Remotion skill metadata mismatch/);
  assert.doesNotMatch(installer,/localVersion!==source\.runtimeVersion/);
  assert.match(installer,/--agent[\s\S]{0,40}codex|codex[\s\S]{0,40}--agent/i);
  assert.match(installer,/--copy/);
  assert.match(installer,/--skill","\*"/);
  assert.match(installer,/const installer=windows[\s\S]{0,100}ComSpec/);
  assert.match(installer,/"--yes","--loglevel=error","skills@1\.5\.20","add",checkout/);
  assert.doesNotMatch(setup,/remotion\/node_modules\/\@remotion\/cli/);
  assert.match(setup,/Pinned official Remotion skill installation failed/i);
  const ignore=await readFile(resolve(root,".gitignore"),"utf8");
  assert.match(ignore,/^\.agents\/skills\/remotion-\*\/$/m);
  for(const name of ["3d","mediabunny","remotion"])assert.match(ignore,new RegExp(`^\\.agents/skills/${name}/$`,"m"));
  assert.match(ignore,/^skills-lock\.json$/m);
});

test("the official skills installer repeats from the immutable local checkout and cleans temporary state",async()=>{
  const rootDir=await mkdtemp(resolve(tmpdir(),"remotion-skills-contract-"));
  const skillPath=resolve(rootDir,".agents/skills/remotion-best-practices/SKILL.md");
  const source={runtimeVersion:"4.0.538",repo:"https://github.com/remotion-dev/skills",revision:"6c67adcd9cdbe6eb84d76342da89b225f9161cb2"};
  try{
    await mkdir(resolve(rootDir,".agents/skills/remotion-best-practices"),{recursive:true});
    for(let attempt=0;attempt<2;attempt++){
      const calls:{command:string;args:string[];cwd?:string}[]=[];
      installOfficialSkills(rootDir,source,{platform:"linux",env:{},run:(command:string,args:string[],options:Record<string,unknown>)=>{
        calls.push({command,args,cwd:String(options.cwd)});
        if(command==="npx")writeFileSync(skillPath,"---\nversion: 4.0.538\n---\n");
        return {status:0};
      }});
      assert.equal(calls.length,3);
      assert.equal(calls[0].args.at(-1)?.startsWith(resolve(tmpdir(),"remotion-skills-")),true);
      assert.deepEqual(calls[1].args.slice(-3),["--quiet","--detach",source.revision]);
      assert.equal(calls[2].args[3],"add");
      const checkout=calls[0].args.at(-1);
      if(!checkout)throw new Error("git clone call did not include its temporary checkout path");
      assert.equal(existsSync(checkout),false,"temporary checkout must be removed after installation");
    }
  }finally{await rm(rootDir,{recursive:true,force:true});}
});

test("the pinned install replaces an old local skill and validates the installed version",async()=>{
  const rootDir=await mkdtemp(resolve(tmpdir(),"remotion-skills-failure-"));
  const skillPath=resolve(rootDir,".agents/skills/remotion-best-practices/SKILL.md");
  const source={runtimeVersion:"4.0.538",repo:"https://github.com/remotion-dev/skills",revision:"6c67adcd9cdbe6eb84d76342da89b225f9161cb2"};
  try{
    await mkdir(resolve(rootDir,".agents/skills/remotion-best-practices"),{recursive:true});
    await writeFile(skillPath,"---\nversion: 4.0.527\n---\n");
    let calls=0;
    installOfficialSkills(rootDir,source,{platform:"linux",env:{},run:(command:string,args:string[])=>{
      calls++;
      if(command==="npx")writeFileSync(skillPath,"---\nversion: 4.0.538\n---\n");
      return {status:0};
    }});
    assert.equal(calls,3,"stale local content must reach the immutable source installer");
    assert.match(await readFile(skillPath,"utf8"),/version: 4\.0\.538/);

    await writeFile(skillPath,"---\nversion: 4.0.527\n---\n");
    calls=0;
    assert.throws(()=>installOfficialSkills(rootDir,source,{platform:"linux",env:{},run:()=>{calls++;return {status:0};}}),/installed Remotion skill metadata mismatch/i);
    assert.equal(calls,3,"a successful but ineffective install must fail at post-install validation");

    calls=0;
    assert.throws(()=>installOfficialSkills(rootDir,source,{platform:"linux",env:{},run:()=>{calls++;return {status:1};}}),/repository clone exited 1/);
    assert.equal(calls,1,"a failing clone must stop before checkout or install");
  }finally{await rm(rootDir,{recursive:true,force:true});}
});
