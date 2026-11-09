import {existsSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join} from "node:path";

function browserExecutable(){
  const explicit=process.env.REMOTION_BROWSER_EXECUTABLE;
  if(explicit&&existsSync(explicit))return explicit;
  const candidates=[];
  if(process.platform==="win32"){
    for(const base of [process.env.PROGRAMFILES,process.env["PROGRAMFILES(X86)"],process.env.LOCALAPPDATA].filter(Boolean)){
      candidates.push(join(base,"Google","Chrome","Application","chrome.exe"));
      candidates.push(join(base,"Microsoft","Edge","Application","msedge.exe"));
    }
  } else if(process.platform==="darwin"){
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome","/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge","/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else {
    candidates.push("/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser","/usr/bin/microsoft-edge");
  }
  return candidates.find(existsSync);
}

const [mode,output,...extra]=process.argv.slice(2);
if(!mode)throw new Error("Usage: run-remotion.mjs <studio|still|render> [output] [...args]");
const bin=join(process.cwd(),"node_modules",".bin",process.platform==="win32"?"remotion.cmd":"remotion");
let args=[];
if(mode==="studio")args=["studio","index.ts",...extra];
else if(mode==="still")args=["still","index.ts","MainVideo",output??"../output/preview.png","--props=generated/project.json",...extra];
else if(mode==="render")args=["render","index.ts","MainVideo",output??"../output/final.mp4","--props=generated/project.json",...extra];
else throw new Error(`Unknown Remotion wrapper mode '${mode}'.`);
const browser=browserExecutable();if(browser)args.push(`--browser-executable=${browser}`);
const result=process.platform==="win32"
  ? spawnSync(process.env.ComSpec||"cmd.exe",["/d","/s","/c",bin,...args],{stdio:"inherit",cwd:process.cwd()})
  : spawnSync(bin,args,{stdio:"inherit",cwd:process.cwd()});
if(result.error)throw result.error;
process.exit(result.status??1);
