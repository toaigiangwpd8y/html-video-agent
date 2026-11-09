import test from "node:test";
import assert from "node:assert/strict";
import {mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {exists,requireFile} from "../src/harness/fs.js";
import {productionAssetPreflight,semanticPreflight} from "../src/authoring/preflight.js";
import {VIDEO_PROJECT_JSON_SCHEMA} from "../src/authoring/contract-schema.js";
import {validateProject} from "../src/authoring/validator.js";
import {readJson} from "../src/core/io.js";
import type {VideoProject} from "../src/core/types.js";
import {applyHarnessPatch,parsePatchDocument} from "../src/harness/patch.js";
import {advanceProjectState,createProjectState,loadProjectState,videoProjectHash} from "../src/harness/project-state.js";
import {REMOTION_IMPLEMENTATION_MANIFEST_SCHEMA,validateHarnessManifest} from "../src/harness/remotion-manifest.js";
import {generatedHash,plannedBoundaryEvidence,validateBoundaryEvidence} from "../src/harness/remotion-evidence.js";
import {countOfficialSkillFiles,validateVoiceOverBinding} from "../src/harness/remotion.js";
import {validateRemotionTimeline} from "../src/harness/remotion-timeline.js";
import {archiveCurrentVideo,listArchivedVideos} from "../src/harness/archive.js";

const root=process.cwd();
async function project():Promise<VideoProject>{return readJson<VideoProject>(resolve(root,"tests/fixtures-valid-project.json"));}
async function narratedProject():Promise<VideoProject>{return readJson<VideoProject>(resolve(root,"tests/fixtures-valid-narrated-project.json"));}

test("canonical project validates with exactly meta and scenes",async()=>{
  const p=await project(),r=await validateProject(p);assert.equal(r.valid,true);assert.deepEqual(Object.keys(p).sort(),["meta","scenes"]);assert.equal("authoring" in (p as any),false);assert.equal("narrativePatternId" in (p as any),false);assert.equal("visualPlan" in (p.scenes[0] as any),false);
});

test("filesystem helpers distinguish missing paths from non-files",async()=>{
  const tmp=resolve(root,"tests/.tmp-filesystem-errors");await rm(tmp,{recursive:true,force:true});await mkdir(tmp,{recursive:true});
  try{
    assert.equal(await exists(resolve(tmp,"missing.txt")),false);
    assert.equal(await exists(tmp),true);
    await assert.rejects(()=>requireFile(resolve(tmp,"missing.txt"),"Missing file"),/Missing file not found/);
    await assert.rejects(()=>requireFile(tmp,"Directory"),/Directory is not a file/);
  }finally{await rm(tmp,{recursive:true,force:true});}
});

test("published and runtime canonical schemas remain equivalent",async()=>{
  const published=JSON.parse(await readFile(resolve(root,"authoring-kit/schemas/video-project.schema.json"),"utf8"));assert.deepEqual(published,VIDEO_PROJECT_JSON_SCHEMA);
});

test("narrated and silent scenes keep approved narration without production file bindings",async()=>{
  const p=await narratedProject(),r=await validateProject(p);assert.equal(r.valid,true,JSON.stringify(r.issues));assert.ok(p.scenes[0].audio);assert.equal(p.scenes[1].audio,undefined);assert.equal((p.scenes[0].audio as any)[["voiceover","File"].join("")],undefined);
  const preflight=await semanticPreflight(p);assert.equal(preflight.report.valid,true,JSON.stringify(preflight.report.issues));
});

test("canonical validation rejects malformed semantic shapes while production preflight owns files",async()=>{
  const p:any=await narratedProject();p.scenes[0].durationInFrames=1.5;p.meta.theme.palette=["green"];p.meta.theme.font="";delete p.meta.constraints.motionTone;
  const r=await validateProject(p),codes=new Set(r.issues.map(x=>x.code));assert.equal(r.valid,false);assert.ok(codes.has("SCENE_DURATION_INVALID"));assert.ok(codes.has("PALETTE_COLOR_INVALID"));assert.ok(codes.has("FONT_REQUIRED"));assert.ok(codes.has("CONSTRAINT_MOTION_TONE_REQUIRED"));
  const preflight=await productionAssetPreflight(await narratedProject(),{version:"1",assets:[]},process.cwd());assert.equal(preflight.report.valid,false);assert.ok(preflight.report.issues.some(x=>x.code==="VOICEOVER_ASSET_MISSING"));
});

test("project patch and external revision state remain request-bound",async()=>{
  const p=await project(),next=applyHarnessPatch(p,parsePatchDocument({baseRevision:1,operations:[{op:"replace",path:"/meta/constraints/style",oldValue:p.meta.constraints.style,value:"A revised semantic style."}]}),1);assert.match(next.meta.constraints.style,/revised/);assert.deepEqual(Object.keys(next).sort(),["meta","scenes"]);
  const tmp=resolve(root,"tests/.tmp-project-state"),request="state test";await rm(tmp,{recursive:true,force:true});await mkdir(resolve(tmp,".video"),{recursive:true});await writeFile(resolve(tmp,".video/request.txt"),request,"utf8");const state1=await createProjectState(tmp,p);assert.equal(state1.revision,1);const changed=structuredClone(p);changed.meta.title="Revision two";const state2=await advanceProjectState(tmp,p,changed);assert.equal(state2.revision,2);await assert.rejects(()=>loadProjectState(tmp,p),/changed outside/);await rm(tmp,{recursive:true,force:true});
});

test("renderer timeline permits overlaps but rejects gaps",async()=>{
  const p=await project();const valid={version:"3",fps:30,durationInFrames:900,scenes:[{sceneId:"scene-1",startFrame:0,endFrame:180},{sceneId:"scene-2",startFrame:165,endFrame:375},{sceneId:"scene-3",startFrame:360,endFrame:570},{sceneId:"scene-4",startFrame:555,endFrame:750},{sceneId:"scene-5",startFrame:735,endFrame:900}]};assert.equal((await validateRemotionTimeline(valid,p,"unused")).valid,true);
  const gap={...valid,scenes:[...valid.scenes]};gap.scenes[1]={sceneId:"scene-2",startFrame:190,endFrame:375};const result=await validateRemotionTimeline(gap,p,"unused");assert.equal(result.valid,false);assert.ok(result.diagnostics.some(x=>x.code==="TIMELINE_GAP"));
});

test("official skill readiness accepts installed subskills without a flattened rules directory",async()=>{
  const projectRoot=resolve(root,"tests/.tmp-official-skills"),skillsRoot=resolve(projectRoot,".agents/skills");await rm(projectRoot,{recursive:true,force:true});
  try{
    const officialNames=["remotion-best-practices","remotion-markup","mediabunny","3d","remotion"];
    for(const name of [...officialNames,"unrelated-skill"]){await mkdir(resolve(skillsRoot,name),{recursive:true});await writeFile(resolve(skillsRoot,name,"SKILL.md"),`# ${name}\n`,`utf8`);}
    await writeFile(resolve(projectRoot,"skills-lock.json"),JSON.stringify({version:1,skills:Object.fromEntries(officialNames.map((name,index)=>[name,index===3?{sourceUrl:"https://github.com/remotion-dev/skills",sourceType:"github"}:{source:"remotion-dev/skills",sourceType:"github"}]).concat([["unrelated-skill",{source:"another-org/skills",sourceType:"github"}]]))}),"utf8");
    assert.equal(await countOfficialSkillFiles(projectRoot),4,"lock entries should include every unprefixed/prefixed official subskill and exclude unrelated skills");
    const p=await project(),tmp=resolve(root,"tests/.tmp-manifest/remotion"),generated=resolve(tmp,"generated");await rm(resolve(root,"tests/.tmp-manifest"),{recursive:true,force:true});await mkdir(generated,{recursive:true});await writeFile(resolve(generated,"Video.tsx"),"export const x=1;\n","utf8");await writeFile(resolve(generated,"Compositions.tsx"),"export const GeneratedCompositions = () => <></>;\n","utf8");await writeFile(resolve(generated,"timeline.json"),"{}\n","utf8");const candidate={version:"1",projectHash:videoProjectHash(p),skillId:"mvp-remotion-contract",generatedFiles:["generated/Video.tsx","generated/Compositions.tsx","generated/timeline.json"],sceneBindings:p.scenes.map(s=>({sceneId:s.id,sourceFile:"generated/Video.tsx",assets:[]}))};const result=await validateHarnessManifest(candidate,p,{projectAvailable:true,skillAvailable:true,assetManifestAvailable:true,officialSkillFilesAvailable:1,ruleFilesAvailable:1,generatedFilesAvailable:1,typecheckPassed:true,stillPassed:true,renderPassed:true,availableAssetPaths:[],remotionRoot:tmp});assert.equal(result.valid,true);assert.deepEqual(result.manifest?.validation,{typecheck:"passed",stills:"passed",render:"passed"});await rm(resolve(root,"tests/.tmp-manifest"),{recursive:true,force:true});
  }finally{await rm(projectRoot,{recursive:true,force:true});}
  assert.deepEqual((REMOTION_IMPLEMENTATION_MANIFEST_SCHEMA as any).required,["version","projectHash","skillId","generatedFiles","sceneBindings"]);
});

test("boundary evidence binds generated source hash and samples overlap topology",async()=>{
  const p=await project(),base=resolve(root,"tests/.tmp-evidence"),generated=resolve(base,"generated"),evidence=resolve(base,"evidence"),index=resolve(base,"index.json");await rm(base,{recursive:true,force:true});await mkdir(generated,{recursive:true});await mkdir(evidence,{recursive:true});await writeFile(resolve(generated,"Video.tsx"),"export const x=1;\n","utf8");const timeline:any={version:"3",fps:30,durationInFrames:900,scenes:[{sceneId:"scene-1",startFrame:0,endFrame:180},{sceneId:"scene-2",startFrame:165,endFrame:375},{sceneId:"scene-3",startFrame:360,endFrame:570},{sceneId:"scene-4",startFrame:555,endFrame:750},{sceneId:"scene-5",startFrame:735,endFrame:900}]};await writeFile(resolve(generated,"timeline.json"),JSON.stringify(timeline),"utf8");const plan=plannedBoundaryEvidence(timeline,p);assert.deepEqual(plan[0].frames,[164,165,172,179,180]);const boundaries=[] as any[];for(let i=0;i<plan.length;i++){const files=[];for(const frame of plan[i].frames){const name=`b-${i}-${frame}.png`;await writeFile(resolve(evidence,name),"x","utf8");files.push(name);}boundaries.push({...plan[i],files});}await writeFile(resolve(evidence,"opening.png"),"x","utf8");await writeFile(resolve(evidence,"end.png"),"x","utf8");const initialHash=await generatedHash(generated);await writeFile(index,JSON.stringify({version:"1",projectHash:videoProjectHash(p),generatedHash:initialHash,opening:{frame:0,file:"opening.png"},boundaries,ending:{frame:899,file:"end.png"}}),"utf8");assert.deepEqual(await validateBoundaryEvidence(index,evidence,generated,p,timeline),[]);await writeFile(resolve(generated,"Compositions.tsx"),"export const GeneratedCompositions = () => <></>;\n","utf8");const afterExtension=await generatedHash(generated);assert.notEqual(afterExtension,initialHash);assert.ok((await validateBoundaryEvidence(index,evidence,generated,p,timeline)).some(error=>/source changed/i.test(error)));await writeFile(index,JSON.stringify({version:"1",projectHash:videoProjectHash(p),generatedHash:afterExtension,opening:{frame:0,file:"opening.png"},boundaries,ending:{frame:899,file:"end.png"}}),"utf8");await writeFile(resolve(generated,"SceneOne.tsx"),"export const SceneOne = () => null;\n","utf8");assert.notEqual(await generatedHash(generated),afterExtension);assert.ok((await validateBoundaryEvidence(index,evidence,generated,p,timeline)).some(error=>/source changed/i.test(error)));await rm(base,{recursive:true,force:true});
});

test("Remotion candidate manifest hashes extension and scene sources while binding each canonical scene once",async()=>{
  const p=await project(),base=resolve(root,"tests/.tmp-connected-manifest"),generated=resolve(base,"generated");await rm(base,{recursive:true,force:true});await mkdir(generated,{recursive:true});
  try{
    await writeFile(resolve(generated,"Compositions.tsx"),"export const GeneratedCompositions = () => <></>;\n","utf8");
    await writeFile(resolve(generated,"SceneOne.tsx"),"export const SceneOne = () => null;\n","utf8");
    await writeFile(resolve(generated,"timeline.json"),"{}\n","utf8");
    const generatedFiles=["generated/Compositions.tsx","generated/SceneOne.tsx","generated/timeline.json"],sceneBindings=p.scenes.map(scene=>({sceneId:scene.id,sourceFile:"generated/SceneOne.tsx",assets:[]}));
    const readiness={projectAvailable:true,skillAvailable:true,assetManifestAvailable:true,ruleFilesAvailable:1,officialSkillFilesAvailable:1,generatedFilesAvailable:3,typecheckPassed:true,stillPassed:true,renderPassed:true,availableAssetPaths:[],remotionRoot:base};
    const candidate={version:"1",projectHash:videoProjectHash(p),skillId:"mvp-remotion-contract",generatedFiles,sceneBindings};
    assert.equal((await validateHarnessManifest(candidate,p,readiness)).valid,true);
    for(const outsidePath of ["root/SceneOne.tsx","public/SceneOne.tsx","vendor/SceneOne.tsx"]){
      const escaped={...candidate,generatedFiles:[...generatedFiles,outsidePath]};
      const escapedResult=await validateHarnessManifest(escaped,p,readiness);
      assert.ok(escapedResult.diagnostics.some(item=>item.code==="MANIFEST_GENERATED_PATH_UNSAFE"),outsidePath);
    }
    const duplicated={...candidate,sceneBindings:[...sceneBindings,{...sceneBindings[0]}]};
    const rejected=await validateHarnessManifest(duplicated,p,readiness);
    assert.equal(rejected.valid,false);
    assert.ok(rejected.diagnostics.some(item=>item.code==="MANIFEST_SCENE_DUPLICATE"));
    const previewBound={...candidate,sceneBindings:[...sceneBindings,{sceneId:"EditableSceneFixture",sourceFile:"generated/SceneOne.tsx",assets:[]}]};
    const previewRejected=await validateHarnessManifest(previewBound,p,readiness);
    assert.ok(previewRejected.diagnostics.some(item=>item.code==="MANIFEST_SCENE_UNKNOWN"),"standalone connected previews are not canonical project scenes");
  }finally{await rm(base,{recursive:true,force:true});}
});

test("completed video archive preserves output and request",async()=>{
  const tmp=resolve(root,"tests/.tmp-video-archive"),p=await project();await rm(tmp,{recursive:true,force:true});await mkdir(resolve(tmp,"output"),{recursive:true});await mkdir(resolve(tmp,".video"),{recursive:true});await writeFile(resolve(tmp,"output/final.mp4"),"video-bytes","utf8");await writeFile(resolve(tmp,"output/preview.png"),"preview-bytes","utf8");await writeFile(resolve(tmp,"video.json"),JSON.stringify(p),"utf8");await writeFile(resolve(tmp,".video/request.txt"),"archive this request","utf8");const archived=await archiveCurrentVideo(tmp,new Date("2026-08-27T12:34:56.000Z"));assert.ok(archived);assert.match(archived!.id,/^20260827T123456Z-/);assert.equal(await readFile(resolve(tmp,archived!.video),"utf8"),"video-bytes");assert.equal((await listArchivedVideos(tmp)).length,1);await rm(tmp,{recursive:true,force:true});
});

test("voice-over requires an audible Audio implementation",async()=>{
  const voiced=await narratedProject(),tmp=resolve(root,"tests/.tmp-voice/generated");await rm(resolve(root,"tests/.tmp-voice"),{recursive:true,force:true});await mkdir(tmp,{recursive:true});await writeFile(resolve(tmp,"Video.tsx"),"export const x=1;\n","utf8");await assert.rejects(()=>validateVoiceOverBinding(voiced,tmp),/generated Remotion source must play approved manifest audio at natural rate 1\.0/);await writeFile(resolve(tmp,"asset-manifest.json"),JSON.stringify({version:"1",assets:[{id:"voice",publicPath:"/assets/audio/arbitrary-final.wav",type:"audio/wav",sceneIds:["scene-1"],role:"voiceover"}]}),"utf8");await writeFile(resolve(tmp,"Video.tsx"),"import {Audio} from '@remotion/media'; import {resolveSceneVoiceover} from '../core/video-utils'; import assetManifest from './asset-manifest.json'; const src=resolveSceneVoiceover('scene-1',assetManifest.assets); export const X=()=> <Audio src={src}/>;\n","utf8");await validateVoiceOverBinding(voiced,tmp);await rm(resolve(root,"tests/.tmp-voice"),{recursive:true,force:true});
});
