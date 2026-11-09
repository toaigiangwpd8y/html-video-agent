import {copyFile,cp,mkdir,readdir,rm} from "node:fs/promises";
import {basename,relative,resolve,sep} from "node:path";
import {readJson,writeJson} from "../core/io.js";
import {exists} from "./fs.js";
import {harnessPaths} from "./paths.js";
import {copyBoundResearchArchive} from "../app-explorer/research-binding.js";
import {copyPromotedExplorerAssetsArchive} from "../app-explorer/promote.js";

export interface ArchiveEntry {id:string;path:string;title:string;createdAt:string;video:string;}

/** Clear request-specific state while keeping user-provided source decks. */
export async function resetVideoWorkspace(root=process.cwd()):Promise<void>{
  const dir=resolve(root,".video");let entries:string[]=[];try{entries=await readdir(dir);}catch{return;}
  for(const entry of entries)if(entry!=="sources"&&entry!=="web-capture")await rm(resolve(dir,entry),{recursive:true,force:true});
}

function slug(value:string):string{return value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60)||"video";}
function stamp(date:Date):string{return date.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");}
async function uniqueDirectory(base:string,id:string):Promise<{id:string;path:string}>{let candidate=id,index=2;while(await exists(resolve(base,candidate)))candidate=`${id}-${index++}`;return {id:candidate,path:resolve(base,candidate)};}

export async function archiveCurrentVideo(root=process.cwd(),now=new Date()):Promise<ArchiveEntry|null>{
  const p=harnessPaths(root);if(!(await exists(p.finalVideo)))return null;
  let title="video";try{const project=await readJson<{meta?:{title?:string}}>(p.video);if(project.meta?.title)title=project.meta.title;}catch{}
  await mkdir(p.archive,{recursive:true});const target=await uniqueDirectory(p.archive,`${stamp(now)}-${slug(title)}`);await mkdir(target.path,{recursive:true});
  const copies:Array<[string,string]>=[[p.finalVideo,"final.mp4"],[p.preview,"preview.png"],[p.video,"video.json"],[p.request,"request.txt"],[p.productionProfile,"production-profile.json"],[p.scriptDraft,"script.md"],[p.storyboardDraft,"storyboard.json"],[p.projectState,"project-state.json"],[p.rendererSelection,"renderer-selection.json"],[p.rendererState,"hyperframes-state.json"],[p.remotionRendererState,"remotion-state.json"],[p.manifest,"hyperframes-implementation-manifest.json"],[p.remotionManifest,"remotion-implementation-manifest.json"],[p.finalManifest,"final-manifest.json"],[p.candidateManifest,"implementation-manifest.candidate.json"],[p.boundaryEvidenceIndex,"boundary-evidence.json"]];
  for(const[source,name]of copies)if(await exists(source))await copyFile(source,resolve(target.path,name));
  if(await exists(p.remotionGenerated))await cp(p.remotionGenerated,resolve(target.path,"remotion-generated"),{recursive:true});
  if(await exists(p.remotionPublicAssets))await cp(p.remotionPublicAssets,resolve(target.path,"remotion-public-assets"),{recursive:true});
  await copyBoundResearchArchive(root,target.path);
  await copyPromotedExplorerAssetsArchive(root,target.path);
  if(await exists(p.webCaptureRuns))await cp(p.webCaptureRuns,resolve(target.path,"web-capture-runs"),{recursive:true});
  if(await exists(p.rendererState)){
    try{
      const state=await readJson<{projectDir?:string}>(p.rendererState),projectDir=state.projectDir?resolve(root,state.projectDir):"",fromRoot=projectDir?relative(p.hyperframesProjects,projectDir):"..";
      if(projectDir&&fromRoot!=="."&&fromRoot!==".."&&!fromRoot.startsWith(`..${sep}`)&&!fromRoot.startsWith(sep))await cp(projectDir,resolve(target.path,"hyperframes-project"),{recursive:true});
    }catch{}
  }
  const archivePath=relative(root,target.path).replaceAll("\\","/");const entry:ArchiveEntry={id:target.id,path:archivePath,title,createdAt:now.toISOString(),video:`${archivePath}/final.mp4`};
  await writeJson(resolve(target.path,"archive.json"),entry);return entry;
}

export async function listArchivedVideos(root=process.cwd()):Promise<ArchiveEntry[]>{
  const p=harnessPaths(root);if(!(await exists(p.archive)))return [];
  const dirs=(await readdir(p.archive,{withFileTypes:true})).filter(x=>x.isDirectory()).map(x=>x.name).sort().reverse(),entries:ArchiveEntry[]=[];
  for(const dir of dirs){const metadata=resolve(p.archive,dir,"archive.json");if(await exists(metadata)){try{entries.push(await readJson<ArchiveEntry>(metadata));continue;}catch{}}const video=resolve(p.archive,dir,"final.mp4");if(await exists(video))entries.push({id:dir,path:relative(root,resolve(p.archive,dir)).replaceAll("\\","/"),title:basename(dir),createdAt:"",video:relative(root,video).replaceAll("\\","/")});}
  return entries;
}
