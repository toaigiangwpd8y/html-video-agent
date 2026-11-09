import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";
import {commitClarification} from "../src/harness/clarification.js";
import {approveScriptReview,approveStoryboardReview,approveVideoBrief,commitScriptReview,commitStoryboardReview,commitVideoBrief,videoBriefTemplate} from "../src/harness/preproduction-hitl.js";
import {loadRemotionInstructions,prepareRemotion,remotionHitlStatus,reviseRemotion,typecheckRemotion} from "../src/harness/remotion.js";
import {generatedHash} from "../src/harness/remotion-evidence.js";
import {commitProductionProfile,loadProductionProfile,productionProfileTemplate} from "../src/harness/production-profile.js";
import {readJson} from "../src/core/io.js";
import type {VideoProject} from "../src/core/types.js";
import {withAvailableRemotion} from "./helpers/renderer-fixtures.js";
import {approveProductionAssetPreflight,runProductionAssetPreflight} from "../src/harness/production-preflight-hitl.js";
import {synthesizeNarration} from "../src/tts/cache.js";

const root=process.cwd();
const sha256=(value:string)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;

test("main skill routes approved Storyboard through the selected renderer",async()=>{
  const skill=await readFile(resolve(root,".agents/skills/agent-video/SKILL.md"),"utf8");
  const enhance=skill.indexOf("11. Perform one complete Storyboard Enhance pass");
  const review=skill.indexOf("12. Fix materially unresolved authoring findings",enhance);
  const render=skill.indexOf("13. After the human approves through the host checkpoint",review);
  assert.ok(enhance>=0&&review>enhance&&render>review);
  const enhanceStep=skill.slice(enhance,review),reviewStep=skill.slice(review,render),renderStep=skill.slice(render);
  assert.match(enhanceStep,/resolve production asset needs.*first/i);
  assert.match(enhanceStep,/optional Onda retrieval.*never drives/i);
  assert.match(enhanceStep,/`video renderer prepare` only after that fresh approval is recorded/i);
  assert.match(enhanceStep,/Request Changes[\s\S]*revision_requested[\s\S]*fresh snapshot/i);
  assert.match(reviewStep,/surface the preview link\/source hash at `VISUAL_REVIEW` and stop/i);
  assert.match(renderStep,/video renderer render[\s\S]*video renderer finalize/i);
  assert.doesNotMatch(enhanceStep,/spawn exactly one|additional HITL checkpoint/i);
});

test("Remotion handoff read order follows canonical assets and selected runtime authority",async()=>{
  const handoff=await readFile(resolve(root,".agents/skills/agent-video/references/remotion-handoff.md"),"utf8");
  const reading=handoff.slice(handoff.indexOf("## Read order"),handoff.indexOf("## Generated implementation"));
  const normalized=reading.toLowerCase();
  const ordered=["complete canonical `video.json`","approved `assets/manifest.json`","this handoff","storyboard-enhance/skill.md","layouts/readme.md","production profile `renderer guidance`","remotion-best-practices/skill.md","after asset resolution, read `blueprints-index.md`","generated snapshots"];
  let previous=-1;
  for(const phrase of ordered){const position=normalized.indexOf(phrase);assert.ok(position>previous,`handoff must place ${phrase} after the prior dependency`);previous=position;}
});

test("Remotion handoff routes to official guidance without loading a legacy snapshot",async()=>{
  const handoff=await readFile(resolve(root,".agents/skills/agent-video/references/remotion-handoff.md"),"utf8");
  const reading=handoff.slice(handoff.indexOf("## Read order"),handoff.indexOf("## Generated implementation"));
  assert.match(reading,/\.agents\/skills\/remotion-best-practices\/SKILL\.md/);
  assert.match(reading,/official Remotion router/i);
  assert.match(reading,/After runtime selection, load only that runtime's official implementation guidance/i);
  assert.doesNotMatch(reading,/remotion-markup|remotion-docs/i);
  assert.doesNotMatch(handoff,/skills-lock\.json|remotion-best-practices\/rules|rules\/\*\.md/i);
  const trustedRoot=root.replaceAll("\\","/");
  const trackedSnapshot=await new Promise<string>((resolveOutput,reject)=>execFile("git",["-c",`safe.directory=${trustedRoot}`,"ls-files","--",".agents/skills/remotion-best-practices"],{cwd:root},(error,stdout)=>error?reject(error):resolveOutput(stdout.trim())));
  assert.equal(trackedSnapshot,"");
});

test("Remotion handoff keeps final rendering and finalization as separate steps",async()=>{
  const handoff=await readFile(resolve(root,".agents/skills/agent-video/references/remotion-handoff.md"),"utf8");
  assert.match(handoff,/After the host approves that exact source hash, run `video renderer render`[\s\S]*Then run `video renderer finalize`/i);
  assert.match(handoff,/validates the already-rendered MP4/i);
  assert.match(handoff,/Finalize does not start another video render/i);
});

test("main skill requires existing asset and visual review checkpoints",async()=>{
  const skill=await readFile(resolve(root,".agents/skills/agent-video/SKILL.md"),"utf8");
  const enhance=await readFile(resolve(root,".agents/skills/storyboard-enhance/SKILL.md"),"utf8");
  assert.match(skill,/ASSET_PREFLIGHT/);
  assert.match(skill,/VISUAL_REVIEW/);
  assert.match(skill,/If preview startup fails, stop on the error/i);
  assert.match(enhance,/the host owns that record/i);
  assert.match(enhance,/Do not create candidate loops, a Critic round, or additional HITL checkpoints/i);
});

test("Storyboard Enhance uses the layout library after asset resolution",async()=>{
  const skill=await readFile(resolve(root,".agents/skills/storyboard-enhance/SKILL.md"),"utf8");
  const reading=skill.slice(skill.indexOf("## Required reading"),skill.indexOf("## Canonical preservation"));
  assert.ok(reading.indexOf("complete approved `video.json` first")<reading.indexOf("references/layouts/README.md"));
  assert.ok(reading.indexOf("references/layouts/README.md")<reading.indexOf("Renderer Guidance"));
  assert.ok(reading.indexOf("Renderer Guidance")<reading.indexOf("remotion-best-practices/SKILL.md"));
  assert.ok(reading.indexOf("blueprints-index.md")>=0);
  const asset=skill.indexOf("**Asset resolution:**"),blueprint=skill.indexOf("**Candidate layout/blueprint:**"),runtime=skill.indexOf("**Runtime choice:**");
  assert.ok(asset>=0&&blueprint>asset&&runtime>blueprint);
  assert.match(skill,/Read the complete selected blueprint, including its failure modes and Materialization Test/i);
  assert.match(skill,/Do not create a persisted motion plan or artifact/i);
  assert.doesNotMatch(skill,/composition-plan\.json/i);
});

test("Storyboard Author requires semantic normalization and a layout-substitutability review",async()=>{
  const authoring=await readFile(resolve(root,".agents/skills/agent-video/references/authoring.md"),"utf8");
  assert.match(authoring,/story job \+ approved claim \+ evidence\/source \+ approved copy \+ explicit constraints[\s\S]*derive semantic visual requirement[\s\S]*discard any upstream implementation manifestation[\s\S]*write semantic-only visualConcept/i);
  assert.match(authoring,/Could a different valid layout, blueprint, or rendering technique\s+still satisfy this visualConcept\?/i);
  assert.match(authoring,/Do not preserve a presentation choice merely because it appears in the Script/i);
});

test("Remotion guidance resolves voice-over from manifest-bound scene and role",async()=>{
  const enhance=await readFile(resolve(root,".agents/skills/storyboard-enhance/SKILL.md"),"utf8");
  const handoff=await readFile(resolve(root,".agents/skills/agent-video/references/remotion-handoff.md"),"utf8");
  for(const text of [enhance,handoff]){
    assert.match(text,/resolveSceneVoiceover|resolveSceneAsset/i);
    assert.match(text,/scene id.*role.*voiceover|role.*voiceover.*sceneId/i);
    assert.match(text,/never infer scene, filename, or path conventions|Do not infer scene, filename, or path conventions/i);
  }
  const productionSources=["remotion/core/video-utils.ts","src/harness/remotion.ts",".agents/skills/storyboard-enhance/SKILL.md",".agents/skills/agent-video/references/remotion-handoff.md"];
  for(const file of productionSources){
    const source=await readFile(resolve(root,file),"utf8");
    assert.doesNotMatch(source,/scene-\$\{[^}]+\}\.mp3|scene-\d+\.mp3|voice-\$\{[^}]+\}\.wav|voiceoverFile/i,file);
  }
});
async function fixture(guidance:string,withHandoff:boolean,tmpName=".tmp-remotion-contract",selection:{primary?:string;supporting?:string[]}={}):Promise<{tmp:string;cleanup:()=>Promise<void>}>{
  const tmp=resolve(root,"tests",tmpName);await rm(tmp,{recursive:true,force:true});
  await mkdir(resolve(tmp,".video/candidates"),{recursive:true});
  const primaryId=selection.primary??"neutral",supportingIds=selection.supporting??[],profileIds=[primaryId,...supportingIds];
  await mkdir(resolve(tmp,".agents/skills/video-types"),{recursive:true});
  await mkdir(resolve(tmp,".agents/skills/remotion-best-practices"),{recursive:true});
  await mkdir(resolve(tmp,".agents/skills/remotion-editorial-motion"),{recursive:true});
  await mkdir(resolve(tmp,".agents/skills/agent-video/references"),{recursive:true});
  await mkdir(resolve(tmp,"assets"),{recursive:true});
  await writeFile(resolve(tmp,".video/request.txt"),"Make a neutral test video.","utf8");
  await writeFile(resolve(tmp,".agents/skills/video-types/catalog.json"),JSON.stringify({version:"1",profiles:profileIds.map(id=>({id,description:`${id} test profile`}))}),"utf8");
  for(const id of profileIds){
    await mkdir(resolve(tmp,".agents/skills/video-types",id),{recursive:true});
    await writeFile(resolve(tmp,".agents/skills/video-types",id,"SKILL.md"),`# ${id}\n\n## Renderer Guidance\n\n${id===primaryId?guidance:"Supporting profile guidance."}\n`,`utf8`);
  }
  await writeFile(resolve(tmp,".agents/skills/remotion-best-practices/SKILL.md"),"# Official Remotion\n\nUse the supported implementation APIs.\n","utf8");
  await writeFile(resolve(tmp,".agents/skills/remotion-editorial-motion/SKILL.md"),"# Optional Editorial Motion Helpers\n\nThese helpers are available for the selected primary profile.\n","utf8");
  if(withHandoff)await writeFile(resolve(tmp,".agents/skills/agent-video/references/remotion-handoff.md"),"# Direct Remotion handoff\n\nPreserve canonical semantic meaning.\n","utf8");
  await writeFile(resolve(tmp,"assets/manifest.json"),JSON.stringify({version:"1",assets:[]}),"utf8");
  const request=await readFile(resolve(tmp,".video/request.txt"),"utf8");
  const clarification={version:"2",requestHash:sha256(request),status:"resolved",decisions:[{id:"objective",label:"Objective",value:"Make a neutral test video",source:"CONTEXT_INFERRED",confidence:.9,materiality:"high",reason:"The request is concrete for this runtime contract test.",alternatives:[]}],questions:[],answers:[]};
  await writeFile(resolve(tmp,".video/candidates/clarification.json"),JSON.stringify(clarification),"utf8");await commitClarification(tmp,".video/candidates/clarification.json");
  const template=await videoBriefTemplate(tmp);const brief={...template,objective:"Make a neutral test video",audience:"Test viewer",durationSeconds:30,aspectRatio:"16:9",language:"English",angle:"Direct",tone:"Clear",pacing:"Readable",mustInclude:[],mustAvoid:[],sourceNotes:[],rendererRecommendation:{renderer:"remotion",rationale:"Remotion fits a deterministic neutral test composition.",alternativeTradeoff:"HyperFrames would use a different authoring model that this Remotion contract fixture does not exercise."}};
  await writeFile(resolve(tmp,".video/candidates/brief.json"),JSON.stringify(brief),"utf8");await commitVideoBrief(tmp,".video/candidates/brief.json");await withAvailableRemotion(tmp,()=>approveVideoBrief(tmp,"HUMAN","remotion"));
  const profile=await productionProfileTemplate(tmp);await writeFile(resolve(tmp,".video/candidates/profile.json"),JSON.stringify({...profile,primary:{id:primaryId,source:"MODEL_INFERRED",reason:`The approved brief selects ${primaryId} for this fixture.`},...(supportingIds.length?{supporting:supportingIds.map(id=>({id,source:"MODEL_INFERRED",reason:`Supporting accuracy for ${id}.`}))}:{})}),"utf8");await commitProductionProfile(tmp,".video/candidates/profile.json");
  await writeFile(resolve(tmp,".video/candidates/script.md"),"This is a complete reviewable script with enough content to pass the minimum length requirement for the checkpoint.","utf8");await synthesizeNarration(tmp,{version:"1",scriptFile:".video/candidates/script.md",language:"en",segments:[]});await commitScriptReview(tmp,".video/candidates/script.md");await approveScriptReview(tmp,"HUMAN");
  const project=await readJson<VideoProject>(resolve(root,"tests/fixtures-valid-project.json"));await writeFile(resolve(tmp,".video/candidates/project.json"),JSON.stringify(project),"utf8");await commitStoryboardReview(tmp,".video/candidates/project.json");await approveStoryboardReview(tmp,"HUMAN");await runProductionAssetPreflight(tmp);await approveProductionAssetPreflight(tmp);
  if(!withHandoff)await rm(resolve(tmp,".agents/skills/agent-video/references/remotion-handoff.md"),{force:true});
  return {tmp,cleanup:()=>rm(tmp,{recursive:true,force:true})};
}

test("Remotion prepare fails when the mandatory handoff is not loaded",async()=>{
  const f=await fixture("Presentation may choose layout and motion.",false);
  try{await assert.rejects(()=>prepareRemotion(f.tmp),/remotion handoff/i);}finally{await f.cleanup();}
});

test("Remotion prepare reports hashes for handoff, official skill, and active Renderer Guidance",async()=>{
  const f=await fixture("Presentation may choose layout and motion.",true);
  const original=await fixture("Presentation may choose layout and motion.",true,".tmp-remotion-contract-unprefixed-original");
  const updated=await fixture("Presentation may choose layout and motion.",true,".tmp-remotion-contract-unprefixed-updated");
  try{
    const result=await prepareRemotion(f.tmp) as any;
    assert.match(result.instructions.remotionHandoff,/^sha256:/);
    assert.match(result.instructions.remotionSkill,/^sha256:/);
    assert.match(result.instructions.rendererGuidance,/^sha256:/);
    for(const [target,content] of [[original,"Original guidance."],[updated,"Updated guidance."]] as const){
      await mkdir(resolve(target.tmp,".agents/skills/mediabunny"),{recursive:true});
      await writeFile(resolve(target.tmp,".agents/skills/mediabunny/SKILL.md"),`# Mediabunny\n${content}\n`,`utf8`);
      await writeFile(resolve(target.tmp,"skills-lock.json"),JSON.stringify({version:1,skills:{"remotion-best-practices":{source:"remotion-dev/skills"},mediabunny:{sourceUrl:"https://github.com/remotion-dev/skills"}}}),"utf8");
    }
    const withUnprefixedSkill=await prepareRemotion(original.tmp) as any;
    const afterChange=await prepareRemotion(updated.tmp) as any;
    assert.notEqual(withUnprefixedSkill.instructions.remotionSkill,afterChange.instructions.remotionSkill,"official unprefixed subskills must participate in the recorded official-skill hash");
  }finally{await Promise.all([f.cleanup(),original.cleanup(),updated.cleanup()]);}
});

test("Editorial Motion helper instructions activate only for the frozen illustrated-explainer primary",async()=>{
  const primary=await fixture("Use an approved treatment.",true,".tmp-editorial-primary",{primary:"illustrated-explainer"});
  const supporting=await fixture("Use an approved treatment.",true,".tmp-editorial-supporting",{primary:"product-demo",supporting:["illustrated-explainer"]});
  const neutral=await fixture("Use an approved treatment.",true,".tmp-editorial-neutral");
  const other=await fixture("Use an approved treatment.",true,".tmp-editorial-other",{primary:"product-demo"});
  try{
    const prepared=await prepareRemotion(primary.tmp) as any;
    assert.equal(prepared.editorialMotionSkillPath.replaceAll("\\","/"),".agents/skills/remotion-editorial-motion/SKILL.md");
    assert.match(prepared.instructions.editorialMotion,/^sha256:/);

    const helperPath=resolve(primary.tmp,".agents/skills/remotion-editorial-motion/SKILL.md");
    const original=await loadRemotionInstructions(primary.tmp,await loadProductionProfile(primary.tmp));
    await writeFile(helperPath,"# Updated optional illustrated-explainer helpers\n","utf8");
    const updated=await loadRemotionInstructions(primary.tmp,await loadProductionProfile(primary.tmp));
    assert.notEqual(original.editorialMotion,updated.editorialMotion,"activated helper changes must update the instruction hash");

    for(const target of [supporting,neutral,other]){
      await rm(resolve(target.tmp,".agents/skills/remotion-editorial-motion/SKILL.md"),{force:true});
      const result=await prepareRemotion(target.tmp) as any;
      assert.equal(result.instructions.editorialMotion,undefined,`${target.tmp} should not hash the helper`);
      assert.equal(result.editorialMotionSkillPath,undefined,`${target.tmp} should not return the helper path`);
    }
  }finally{await Promise.all([primary.cleanup(),supporting.cleanup(),neutral.cleanup(),other.cleanup()]);}
});

test("HyperFrames preparation stays outside the Remotion Editorial Motion helper path",async()=>{
  const renderer=await readFile(resolve(root,"src/harness/renderer.ts"),"utf8");
  const hyperframes=await readFile(resolve(root,"src/harness/hyperframes.ts"),"utf8");
  assert.match(renderer,/renderer\s*===\s*["']hyperframes["']\s*\?\s*prepareHyperFrames\(root\)\s*:\s*prepareRemotion\(root\)/);
  assert.doesNotMatch(hyperframes,/editorialMotion|remotion-editorial-motion/i);
});

test("Remotion prepare emits derived theme and font modules for the canonical theme",async()=>{
  const f=await fixture("Presentation may choose layout and motion.",true);
  try{
    const project=await readJson<VideoProject>(resolve(f.tmp,"video.json"));
    const palette=project.meta.theme.palette;
    const result=await prepareRemotion(f.tmp);
    assert.deepEqual(result.generatedThemeFiles,["generated/theme.ts","generated/fonts.ts","generated/motion.ts"]);
    for(const role of ["page","text","accent"] as const)assert.ok(palette.includes(result.theme.tokens[role]),`${role} '${result.theme.tokens[role]}' is not a canonical palette color`);
    assert.ok(result.theme.tokens.fontText.startsWith(JSON.stringify(project.meta.theme.font)),result.theme.tokens.fontText);
    assert.equal(result.theme.cssVars["--onda-bg"],result.theme.tokens.page);
    assert.equal(result.theme.cssVars["--onda-accent"],result.theme.tokens.accent);
    assert.equal(result.theme.cssVars["--onda-text"],result.theme.tokens.text);
    assert.equal(result.theme.cssVars["--onda-font-display"],result.theme.tokens.fontDisplay);
    assert.equal(result.theme.cssVars["--video-page"],result.theme.tokens.page);
    const motion=await readFile(resolve(f.tmp,"remotion/generated/motion.ts"),"utf8");
    assert.match(motion,/STAGGER_IN_FRAMES/);
    assert.ok(result.theme.warnings.some((warning)=>warning.code==="THEME_FONT_UNBOUND"));
    const fonts=await readFile(resolve(f.tmp,"remotion/generated/fonts.ts"),"utf8");
    assert.ok(fonts.includes(project.meta.theme.font),fonts.slice(0,600));

  }finally{await f.cleanup();}
});

test("Remotion prepare creates the empty generated composition extension and preserves authored code",async()=>{
  const fresh=await fixture("Presentation may choose layout and motion.",true,".tmp-compositions-fresh");
  const authored=await fixture("Presentation may choose layout and motion.",true,".tmp-compositions-authored");
  const frozen=await fixture("Presentation may choose layout and motion.",true,".tmp-compositions-frozen");
  try{
    await prepareRemotion(fresh.tmp);
    const freshModule=await readFile(resolve(fresh.tmp,"remotion/generated/Compositions.tsx"),"utf8");
    assert.match(freshModule,/export const GeneratedCompositions:React\.FC=\(\)=>\s*<><\/>/);

    const authoredPath=resolve(authored.tmp,"remotion/generated/Compositions.tsx"),authoredSource='import React from "react";\nexport const GeneratedCompositions:React.FC=()=> <span data-authored="keep"/>;\n';
    await mkdir(resolve(authored.tmp,"remotion/generated"),{recursive:true});await writeFile(authoredPath,authoredSource,"utf8");
    await prepareRemotion(authored.tmp);
    assert.equal(await readFile(authoredPath,"utf8"),authoredSource,"prepare must leave an authored extension intact");
    await typecheckRemotion(authored.tmp);
    assert.equal(await readFile(authoredPath,"utf8"),authoredSource,"renderer checks must not overwrite the extension");

    await prepareRemotion(frozen.tmp);
    const frozenPath=resolve(frozen.tmp,"remotion/generated/Compositions.tsx"),frozenSource='export const GeneratedCompositions = () => <aside data-frozen="keep"/>;\n';
    await writeFile(frozenPath,frozenSource,"utf8");
    await writeFile(resolve(frozen.tmp,".video/remotion-state.json"),JSON.stringify({version:"1",renderer:"remotion",phase:"FINALIZED",projectId:"frozen",revision:1,projectHash:"sha256:frozen",productionProfileHash:"sha256:frozen",assetManifestHash:"sha256:frozen"}),"utf8");
    await assert.rejects(()=>prepareRemotion(frozen.tmp),/already exists.*does not overwrite/i);
    assert.equal(await readFile(frozenPath,"utf8"),frozenSource,"a frozen delivered workspace must remain untouched until revise");
  }finally{await Promise.all([fresh.cleanup(),authored.cleanup(),frozen.cleanup()]);}
});

test("Remotion prepare refuses to backfill a missing composition extension in an existing workspace",async()=>{
  const f=await fixture("Presentation may choose layout and motion.",true,".tmp-remotion-existing-workspace-no-extension");
  try{
    await prepareRemotion(f.tmp);
    const generatedDir=resolve(f.tmp,"remotion/generated"),extension=resolve(generatedDir,"Compositions.tsx"),videoPath=resolve(generatedDir,"Video.tsx");
    const oldSource="export const LegacyAuthoredVideo = () => <div>kept</div>;\n";
    await writeFile(videoPath,oldSource,"utf8");
    await rm(extension,{force:true});
    const statePath=resolve(f.tmp,".video/remotion-state.json"),state=await readJson<any>(statePath);
    await writeFile(statePath,JSON.stringify({...state,phase:"VISUAL_REVIEW",sourceHash:await generatedHash(generatedDir)}),"utf8");
    const beforeState=await readFile(statePath,"utf8");

    await assert.rejects(()=>prepareRemotion(f.tmp),/existing Remotion workspace is missing.*automatic migration is not supported/i);
    assert.equal(await readFile(videoPath,"utf8"),oldSource,"prepare must preserve existing authored source");
    assert.equal(existsSync(extension),false,"prepare must leave the missing extension absent");
    assert.equal(await readFile(statePath,"utf8"),beforeState,"prepare must leave existing renderer state unchanged");
  }finally{await f.cleanup();}
});

test("Remotion prepare does not mistake pre-existing generated source for a new project",async()=>{
  const f=await fixture("Presentation may choose layout and motion.",true,".tmp-remotion-source-without-state");
  try{
    const generatedDir=resolve(f.tmp,"remotion/generated"),videoPath=resolve(generatedDir,"Video.tsx"),extension=resolve(generatedDir,"Compositions.tsx");
    const oldSource="export const LegacyAuthoredVideo = () => <div>kept before state</div>;\n";
    await mkdir(generatedDir,{recursive:true});
    await writeFile(videoPath,oldSource,"utf8");

    await assert.rejects(()=>prepareRemotion(f.tmp),/existing Remotion workspace is missing.*automatic migration is not supported/i);
    assert.equal(await readFile(videoPath,"utf8"),oldSource,"prepare must preserve pre-existing source even without renderer state");
    assert.equal(existsSync(extension),false,"prepare must not create an extension in an existing source workspace");
    assert.equal(existsSync(resolve(f.tmp,".video/remotion-state.json")),false,"a rejected workspace must not receive new renderer state");
  }finally{await f.cleanup();}
});

test("renderer revise refuses to add the composition extension to an existing delivery",async()=>{
  const f=await fixture("Presentation may choose layout and motion.",true,".tmp-remotion-delivery-no-extension");
  try{
    await prepareRemotion(f.tmp);
    const generatedDir=resolve(f.tmp,"remotion/generated"),extension=resolve(generatedDir,"Compositions.tsx"),videoPath=resolve(generatedDir,"Video.tsx");
    const deliveredSource="export const FrozenAuthoredVideo = () => <div>delivered</div>;\n";
    await writeFile(videoPath,deliveredSource,"utf8");
    await rm(extension,{force:true});
    const statePath=resolve(f.tmp,".video/remotion-state.json"),state=await readJson<any>(statePath);
    await writeFile(statePath,JSON.stringify({...state,phase:"FINALIZED"}),"utf8");
    const beforeState=await readFile(statePath,"utf8");

    await assert.rejects(()=>reviseRemotion(f.tmp),/existing Remotion workspace is missing.*automatic migration is not supported/i);
    assert.equal(await readFile(videoPath,"utf8"),deliveredSource,"revise must preserve the delivered source");
    assert.equal(existsSync(extension),false,"revise must leave the missing extension absent");
    assert.equal(await readFile(statePath,"utf8"),beforeState,"revise must leave the delivery state unchanged");
    assert.equal(existsSync(resolve(f.tmp,"remotion/projects")),false,"revise must fail before preserving a workspace");
  }finally{await f.cleanup();}
});

test("renderer revise preserves the existing composition extension and generated source",async()=>{
  const f=await fixture("Presentation may choose layout and motion.",true,".tmp-remotion-delivery-with-extension");
  try{
    await prepareRemotion(f.tmp);
    const generatedDir=resolve(f.tmp,"remotion/generated"),extension=resolve(generatedDir,"Compositions.tsx"),videoPath=resolve(generatedDir,"Video.tsx");
    const videoSource="export const ExistingAuthoredVideo = () => <div>delivered</div>;\n";
    const extensionSource='import React from "react";\nexport const GeneratedCompositions:React.FC=()=> <aside data-existing="keep"/>;\n';
    await writeFile(videoPath,videoSource,"utf8");
    await writeFile(extension,extensionSource,"utf8");
    const statePath=resolve(f.tmp,".video/remotion-state.json"),state=await readJson<any>(statePath);
    await writeFile(statePath,JSON.stringify({...state,phase:"RENDERED"}),"utf8");

    const result=await reviseRemotion(f.tmp);
    if(!result.preservedWorkspace)throw new Error("revise must archive the delivered generated workspace");
    const preservedGenerated=resolve(f.tmp,result.preservedWorkspace,"generated");
    assert.equal(await readFile(resolve(preservedGenerated,"Video.tsx"),"utf8"),videoSource);
    assert.equal(await readFile(resolve(preservedGenerated,"Compositions.tsx"),"utf8"),extensionSource);
    assert.equal(await readFile(videoPath,"utf8"),videoSource,"revise must leave the active authored source intact");
    assert.equal(await readFile(extension,"utf8"),extensionSource,"revise must leave the active authored extension intact");
    assert.equal((await readJson<any>(statePath)).phase,"AUTHORING");
  }finally{await f.cleanup();}
});

test("visual review status invalidates after connected registration or bound scene source edits",async()=>{
  for(const changedFile of ["Compositions.tsx","SceneOne.tsx"]){
    const f=await fixture("Presentation may choose layout and motion.",true,`.tmp-remotion-review-source-${changedFile.replaceAll(".","-")}`);
    try{
      await prepareRemotion(f.tmp);
      const generated=resolve(f.tmp,"remotion/generated"),extension=resolve(generated,"Compositions.tsx"),scene=resolve(generated,"SceneOne.tsx");
      await writeFile(scene,'export const SceneOne=()=> <div>Bound scene</div>;\n',"utf8");
      await writeFile(extension,'import React from "react";\nimport {Composition} from "remotion";\nimport {SceneOne} from "./SceneOne";\nexport const GeneratedCompositions:React.FC=()=> <Composition id="SceneOne" component={SceneOne} width={1920} height={1080} fps={30} durationInFrames={90} defaultProps={{}}/>;\n',"utf8");
      const sourceHash=await generatedHash(generated),statePath=resolve(f.tmp,".video/remotion-state.json"),state=await readJson<any>(statePath);
      await writeFile(statePath,JSON.stringify({...state,phase:"VISUAL_REVIEW",sourceHash}),"utf8");
      assert.equal((await readJson<any>(statePath)).visualApproval,undefined,"the fixture must not fabricate human approval");

      await writeFile(resolve(generated,changedFile),`// revised ${changedFile}\nexport const ${changedFile==="SceneOne.tsx"?"SceneOne":"GeneratedCompositions"}=()=> <div>Updated</div>;\n`,"utf8");
      const hitl=await remotionHitlStatus(f.tmp),payload=hitl?.payload as {sourceHash?:string;reviewedSourceHash?:string;approvalInvalidated?:boolean}|undefined;
      assert.equal(hitl?.status,"REVIEW_REQUIRED",`${changedFile} edit must require fresh visual review`);
      assert.equal(hitl?.phase,"renderer_source_changed");
      assert.equal(payload?.approvalInvalidated,true);
      assert.equal(payload?.reviewedSourceHash,sourceHash);
      assert.notEqual(payload?.sourceHash,sourceHash);
    }finally{await f.cleanup();}
  }
});

test("Renderer Guidance cannot claim semantic ownership from the active profile",async()=>{
  const f=await fixture("The profile owns semantic meaning and may replace canonical copy.",true);
  try{await assert.rejects(()=>prepareRemotion(f.tmp),/semantic ownership|semantic meaning|renderer guidance/i);}finally{await f.cleanup();}
});
