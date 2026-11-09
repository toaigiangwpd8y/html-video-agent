import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {resolve} from "node:path";
import {requireFile} from "./fs.js";
import {harnessPaths} from "./paths.js";
import {stopLocalPlayer} from "./local-player.js";

/** Process/environment plumbing shared by every pinned HyperFrames CLI invocation and preview server. */

export function cliEnvironment():NodeJS.ProcessEnv {
  return {...process.env,HYPERFRAMES_NO_TELEMETRY:"1",HYPERFRAMES_NO_UPDATE_CHECK:"1",HYPERFRAMES_SKIP_SKILLS:"1",HYPERFRAMES_PREVIEW_HOST:"127.0.0.1"};
}

export function cliEntrypoint(root:string):string {
  return resolve(harnessPaths(root).hyperframes,"node_modules/hyperframes/bin/hyperframes.mjs");
}

export async function findAvailablePort():Promise<number> {
  const {promise,resolve:resolvePort,reject}=Promise.withResolvers<number>();
  const server=createServer();
  server.once("error",reject);
  server.listen(0,"127.0.0.1",()=>{
    const address=server.address();
    if(!address||typeof address==="string"){server.close();reject(new Error("Could not allocate a loopback port."));return;}
    server.close((error)=>error?reject(error):resolvePort(address.port));
  });
  return promise;
}

/** Waits until the pinned CLI serves its local Studio page or exits with an error. */
export async function waitForLocalStudio(url:string,child:ReturnType<typeof spawn>):Promise<void> {
  let last="Studio server did not become ready.";
  const {promise,resolve:resolveReady,reject}=Promise.withResolvers<void>();
  const fail=(error:Error)=>{child.off("error",onError);reject(error);};
  const onError=(error:Error)=>fail(error);
  child.once("error",onError);
  // Cold Studio startup can exceed ten seconds on Windows; keep a bounded thirty-second retry window.
  void (async()=>{for(let attempt=0;attempt<120;attempt++){
    if(child.exitCode!==null||child.signalCode!==null){fail(new Error(`HyperFrames Studio exited before startup (code ${child.exitCode??child.signalCode}).`));return;}
    try{
      const response=await fetch(url,{signal:AbortSignal.timeout(1200)}),contentType=response.headers.get("content-type")??"";
      if(response.ok&&contentType.includes("text/html")){child.off("error",onError);resolveReady();return;}
      last=`Studio endpoint returned HTTP ${response.status} with content type '${contentType}'.`;
    }catch(error){last=error instanceof Error?error.message:String(error);}
    await new Promise((done)=>setTimeout(done,250));
  }fail(new Error(last));})();
  return promise;
}

/** Starts the pinned preview server on loopback without opening a browser; used by the layout probe. */
export async function startHyperFramesPreviewServer(root:string,projectDir:string):Promise<{url:string;pid:number;port:number}> {
  const port=await findAvailablePort(),baseUrl=`http://127.0.0.1:${port}`,entry=cliEntrypoint(root);
  await requireFile(entry,"Pinned HyperFrames CLI entrypoint");
  const child=spawn(process.execPath,[entry,"preview",projectDir,"--port",String(port),"--no-open","--foreground"],{cwd:root,env:cliEnvironment(),detached:process.platform!=="win32",stdio:"ignore",windowsHide:true});
  try{await waitForLocalStudio(baseUrl,child);}catch(error){stopLocalPlayer({previewPid:child.pid});throw error;}
  child.on("error",()=>{});child.unref();
  return {url:baseUrl,pid:child.pid??0,port};
}
