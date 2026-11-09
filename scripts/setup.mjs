import {spawnSync} from "node:child_process";
import {existsSync,mkdirSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {assertRemotionFamily,installOfficialSkills} from "./remotion-skills-setup.mjs";

// Prepares repository-local directories, installs selected pinned renderer packages, and sets up Remotion authoring skills.
const root=process.cwd();
const major=Number(process.versions.node.split(".")[0]);
if(major<22||major===22&&Number(process.versions.node.split(".")[1])<18)throw new Error(`Node.js >=22.18.0 is required. Found ${process.versions.node}.`);
const requested=process.argv.slice(2).find(arg=>arg.startsWith("--renderer="))?.split("=",2)[1]??"all";
if(!["all","remotion","hyperframes"].includes(requested))throw new Error("Usage: npm run setup -- [--renderer=all|remotion|hyperframes]");
for(const dir of [".video/candidates","assets","output","hyperframes/projects","hyperframes/kit","remotion/generated","remotion/public/assets"])mkdirSync(resolve(root,dir),{recursive:true});

const command=process.platform==="win32"?(process.env.ComSpec||"cmd.exe"):"npm";
const renderers=requested==="all"?["hyperframes","remotion"]:[requested];
// Checks the installed renderer CLI against its nested lockfile version.
function rendererRuntimeReady(renderer){
  const packageName=renderer==="hyperframes"?"hyperframes":"remotion";
  const cwd=resolve(root,renderer);
  try{
    const lock=JSON.parse(readFileSync(resolve(cwd,"package-lock.json"),"utf8"));
    const installed=JSON.parse(readFileSync(resolve(cwd,"node_modules",packageName,"package.json"),"utf8"));
    const lockedVersion=lock.packages?.[`node_modules/${packageName}`]?.version;
    const binary=resolve(cwd,"node_modules/.bin",process.platform==="win32"?`${packageName}.cmd`:packageName);
    return typeof lockedVersion==="string"&&installed.version===lockedVersion&&existsSync(binary);
  }catch{return false;}
}

for(const renderer of renderers){
  const cwd=resolve(root,renderer);
  if(rendererRuntimeReady(renderer)){
    console.log(`Pinned ${renderer} runtime is already ready; skipping reinstall.`);
    continue;
  }
  console.log(`Installing pinned ${renderer} dependencies from ${renderer}/package-lock.json; install scripts are disabled.`);
  const args=process.platform==="win32"?["/d","/s","/c","npm","ci","--ignore-scripts","--no-audit","--no-fund"]:["ci","--ignore-scripts","--no-audit","--no-fund"];
  const result=spawnSync(command,args,{cwd,stdio:"inherit",env:{...process.env,npm_config_registry:"https://registry.npmjs.org/"}});
  if(result.error||result.status!==0){
    console.error(`\nPinned ${renderer} dependency installation failed. Setup accesses npmjs.org only and runs no package install scripts.`);
    throw result.error??new Error(`npm ci exited ${result.status}`);
  }
  if(!rendererRuntimeReady(renderer))throw new Error(`Pinned ${renderer} package or local CLI does not match ${renderer}/package-lock.json after installation.`);
}
if(renderers.includes("remotion")){
  const source=JSON.parse(readFileSync(resolve(root,"remotion-skills-source.json"),"utf8"));
  if(source.runtimeVersion!==JSON.parse(readFileSync(resolve(root,"remotion/package.json"),"utf8")).dependencies.remotion)throw new Error(`Remotion skills source runtime ${source.runtimeVersion} does not match remotion/package.json. Update the pinned source metadata before setup.`);
  assertRemotionFamily(root,source.runtimeVersion);
  console.log(`Installing official Remotion Agent Skills from ${source.repo} at ${source.revision} for Codex...`);
  try{installOfficialSkills(root,source);}catch(error){
    console.error("\nPinned official Remotion skill installation failed. Check GitHub/npm access and the source metadata, then rerun `npm run setup -- --renderer=remotion`.\n");
    throw error;
  }
}
console.log("Setup complete. Both renderers use an already-installed local browser; this setup downloads no browser or FFmpeg binary.");
