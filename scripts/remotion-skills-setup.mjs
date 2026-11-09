import {spawnSync} from "node:child_process";
import {existsSync,mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve} from "node:path";

export function assertRemotionFamily(rootDir,expectedVersion){
  const manifest=JSON.parse(readFileSync(resolve(rootDir,"remotion/package.json"),"utf8"));
  const lock=JSON.parse(readFileSync(resolve(rootDir,"remotion/package-lock.json"),"utf8"));
  const family=Object.entries(manifest.dependencies??{}).filter(([name])=>name==="remotion"||name.startsWith("@remotion/"));
  for(const [name,pin] of family){
    if(pin!==expectedVersion)throw new Error(`Remotion version mismatch: remotion/package.json pins ${name}@${pin}, expected ${expectedVersion}.`);
    const installed=JSON.parse(readFileSync(resolve(rootDir,"remotion/node_modules",name,"package.json"),"utf8"));
    const locked=lock.packages?.[`node_modules/${name}`]?.version;
    if(locked!==expectedVersion||installed.version!==expectedVersion)throw new Error(`Remotion version mismatch: ${name} must be ${expectedVersion} in the manifest, lockfile, and installed runtime.`);
  }
}

function readSkillVersion(skillPath){
  if(!existsSync(skillPath))return null;
  const source=readFileSync(skillPath,"utf8");
  return source.match(/^version:\s*([^\r\n]+)\s*$/m)?.[1]?.trim()??null;
}

export function installOfficialSkills(rootDir,source,{run=spawnSync,platform=process.platform,env=process.env}={}){
  const checkout=mkdtempSync(resolve(tmpdir(),"remotion-skills-"));
  try{
    const windows=platform==="win32";
    const git=windows?(env.ComSpec||"cmd.exe"):"git";
    const cloneArgs=windows?["/d","/s","/c","git","clone","--quiet",source.repo,checkout]:["clone","--quiet",source.repo,checkout];
    const cloned=run(git,cloneArgs,{cwd:rootDir,stdio:"inherit"});
    if(cloned.error||cloned.status!==0)throw cloned.error??new Error(`Pinned Remotion skills repository clone exited ${cloned.status}`);
    const checkoutArgs=windows?["/d","/s","/c","git","-C",checkout,"checkout","--quiet","--detach",source.revision]:["-C",checkout,"checkout","--quiet","--detach",source.revision];
    const checkedOut=run(git,checkoutArgs,{cwd:rootDir,stdio:"inherit"});
    if(checkedOut.error||checkedOut.status!==0)throw checkedOut.error??new Error(`Pinned Remotion skills revision ${source.revision} checkout exited ${checkedOut.status}`);
    const installerArgs=["--yes","--loglevel=error","skills@1.5.20","add",checkout,"--agent","codex","--copy","--skill","*","--yes","--full-depth"];
    const installer=windows?(env.ComSpec||"cmd.exe"):"npx";
    const args=windows?["/d","/s","/c","npx",...installerArgs]:installerArgs;
    const installed=run(installer,args,{cwd:rootDir,stdio:"inherit",env:{...env,npm_config_registry:"https://registry.npmjs.org/"}});
    if(installed.error||installed.status!==0)throw installed.error??new Error(`Remotion skills installer exited ${installed.status}`);
    const skillPaths=[resolve(rootDir,".agents/skills/remotion-best-practices/SKILL.md"),resolve(rootDir,".agents/skills/remotion-best-practices.md")];
    const installedVersion=skillPaths.map(readSkillVersion).find((version)=>version!==null)??null;
    if(installedVersion!==source.runtimeVersion)throw new Error(`Installed Remotion skill metadata mismatch: found ${installedVersion??"no version metadata"}, expected ${source.runtimeVersion}. The pinned installer completed but did not install the configured skill version.`);
  }finally{rmSync(checkout,{recursive:true,force:true});}
}
