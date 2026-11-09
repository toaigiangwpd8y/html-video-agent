import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import test from "node:test";
import {pathToFileURL} from "node:url";

const root = process.cwd();
const sourceRoot = resolve(root, "third-party/video-shotcraft/source");
const catalog = JSON.parse(await readFile(resolve(root, ".agents/skills/storyboard-enhance/references/shotcraft/catalog.json"), "utf8"));
const card = catalog.cards.find((item: any) => item.id === "assemble-then-type-flyin");
const variant = card.variants[0];
const textHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const api = await import(pathToFileURL(resolve(root, "scripts/shotcraft-prepare.mjs")).href).catch(() => ({} as any));
const typescript = (await import("typescript")).default;

const project = {meta:{title:"Canonical",width:1920,height:1080,durationsInFrames:200,fps:30,theme:{palette:["#101010","#eeeeee"],font:"Inter"},constraints:{style:"x",disallowed:[],motionTone:"calm"}},scenes:[{id:"scene-a",durationInFrames:200,screenText:"Canonical title",visualConcept:"A scene"}]};
const manifest = {version:"1",assets:[{id:"logo",publicPath:"/assets/logo.svg",type:"image/svg+xml",role:"product-logo",sceneIds:["scene-a"]}]};
const bindings = {sourceDemo:variant.source.demo[0],componentExport:"AssembleThenTypeFlyin",integrationMarker:"shotcraft-slot:scene-a",assets:[],text:[],palette:[],targets:[]};
const gates = {renderer:"remotion",rendererAuthorized:true,authoringApproved:true,assetsApproved:true};
const generatedVideoSource='import React from "react";\nexport const GeneratedVideo = ({project}) => project.scenes.map((scene) => scene.id === "scene-a" ? <div data-scene-id={scene.id}>{/* shotcraft-slot:scene-a */}</div> : <div data-scene-id={scene.id}>{scene.screenText}</div>);\n';
const base = (overrides: any = {}) => ({root,sourceRoot,dependencyRoot:root,card,variant,sceneId:"scene-a",project,manifest,bindings,gates,generatedVideoSource,outputRelative:"remotion/generated/shotcraft/scene-a",...overrides});

test("duration resolves only the explicitly selected demo and statically evaluates its exported expression", async () => {
  const {resolveShotDuration} = api;
  assert.equal(await resolveShotDuration(sourceRoot,"demos/camera/crash-zoom-punch/CrashZoomReal.tsx"),132);
  assert.equal(await resolveShotDuration(sourceRoot,"demos/typography/pill-slot-cycle/PillSlotCycle.tsx"),200);
  assert.equal(await resolveShotDuration(sourceRoot,"demos/data/chart-live-moves/OscilloscopeStreamV2.tsx"),165);
});

test("exact selected action arcs reject one frame for crash/pill while fitting oscilloscope at 165", async () => {
  const {validateShotBudget}=api;
  await assert.rejects(validateShotBudget(sourceRoot,"demos/camera/crash-zoom-punch/CrashZoomReal.tsx",{durationInFrames:1}),/original action arc of 132 frames/i);
  await assert.rejects(validateShotBudget(sourceRoot,"demos/typography/pill-slot-cycle/PillSlotCycle.tsx",{durationInFrames:1}),/original action arc of 200 frames/i);
  assert.equal(await validateShotBudget(sourceRoot,"demos/data/chart-live-moves/OscilloscopeStreamV2.tsx",{durationInFrames:165}),165);
});

test("multi-demo card requires explicit source evidence for the selected entry", () => {
  const {resolveSelectedDemo}=api;
  const chartCard=catalog.cards.find((item:any)=>item.id==="chart-live-moves"),chartVariant=chartCard.variants.find((item:any)=>item.id==="oscilloscope-stream");
  assert.throws(()=>resolveSelectedDemo(chartVariant),/explicit sourceDemo binding/i);
  assert.equal(resolveSelectedDemo(chartVariant,"demos/data/chart-live-moves/OscilloscopeStreamV2.tsx"),"demos/data/chart-live-moves/OscilloscopeStreamV2.tsx");
});

test("ambiguous multi-demo selection rejects before generated output exists", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-ambiguous-demo-"));
  try {
    const chartCard=catalog.cards.find((item:any)=>item.id==="chart-live-moves"),chartVariant=chartCard.variants.find((item:any)=>item.id==="oscilloscope-stream"),ambiguousBindings={...bindings};delete (ambiguousBindings as any).sourceDemo;
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,card:chartCard,variant:chartVariant,bindings:ambiguousBindings})),/explicit sourceDemo binding/i);
    await assert.rejects(readdir(resolve(dir,"remotion/generated")),{code:"ENOENT"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("canonical target adaptation replaces sample copy and preserves motion source", async () => {
  const source="export const MOTION = {duration: 24, easing: 'easeOut'};\nexport const Shot = () => <div>Sample title!!!</div>;\n";
  const result=await api.adaptSourceFile({sourcePath:"demos/Shot.tsx",source,bindings:{text:[{target:"headline",sourcePath:"demos/Shot.tsx",sourceValue:"Sample title!!!",canonicalKey:"scene.screenText"}],assets:[],palette:[],targets:[]},scene:project.scenes[0],project,manifest});
  assert.match(result.source,/Canonical title/);assert.doesNotMatch(result.source,/Sample title/);assert.match(result.source,/duration: 24, easing: 'easeOut'/);
  assert.deepEqual(result.diffs.map((diff:any)=>diff.kind),["canonical_text_replace"]);
});

test("canonical copy that changes a character-paced motion target length is blocked", () => {
  const source="export const Shot=()=> <div>Sample title</div>;";
  assert.throws(()=>api.adaptSourceFile({sourcePath:"demos/Shot.tsx",source,bindings:{text:[{target:"headline",sourcePath:"demos/Shot.tsx",sourceValue:"Sample title",canonicalKey:"scene.screenText"}],assets:[],palette:[],targets:[]},scene:project.scenes[0],project,manifest}),/text target 'headline'.*changes the source text length/i);
});

test("approved asset and palette targets resolve to local manifest paths and canonical tokens", () => {
  const source="import {staticFile} from 'remotion';\nexport const Shot=()=> <Img src={staticFile('textures/demo.png')} style={{color:'#123456'}} />;\n";
  const result=api.adaptSourceFile({sourcePath:"demos/Shot.tsx",source,bindings:{text:[],assets:[{target:"texture",sourcePath:"demos/Shot.tsx",sourceValue:"textures/demo.png",assetId:"logo",role:"product-logo"}],palette:[{target:"accent",sourcePath:"demos/Shot.tsx",sourceValue:"#123456",token:"#eeeeee"}],targets:[]},scene:project.scenes[0],project,manifest});
  assert.match(result.source,/staticFile\("assets\/logo\.svg"\)/);assert.match(result.source,/color:"#eeeeee"/);
  assert.deepEqual(result.diffs.map((diff:any)=>diff.kind).sort(),["approved_asset_staticFile","canonical_palette_token"]);
});

test("sample brand JSX is removed only by its explicit target binding", () => {
  const source="export const Shot=()=> <div><ShotcraftWordmark size={24}/><span>Canonical scene</span></div>;";
  const result=api.adaptSourceFile({sourcePath:"demos/Shot.tsx",source,bindings:{text:[],assets:[],palette:[],targets:[{target:"brand-wordmark",sourcePath:"demos/Shot.tsx",kind:"remove_jsx_component",componentName:"ShotcraftWordmark"}]},scene:project.scenes[0],project,manifest});
  assert.doesNotMatch(result.source,/ShotcraftWordmark/);assert.match(result.source,/<div>\{null\}<span>Canonical scene/);
});

test("GeneratedVideo integration renders the selected component only in its target scene", () => {
  const source='import React from "react";\nexport const GeneratedVideo = ({project}) => project.scenes.map((scene) => <div data-scene-id={scene.id}>{/* shotcraft-slot:scene-a */}</div>);\n';
  const result=api.integrateSelectedScene({source,sceneId:"scene-a",modulePath:"./shotcraft/scene-a/demos/Shot",componentExport:"Shot"});
  assert.match(result.source,/import \{ Shot as Shotcraft_scene_a \} from "\.\/shotcraft\/scene-a\/demos\/Shot"/);
  assert.match(result.source,/scene\.id === "scene-a" \? <Shotcraft_scene_a \/> : null/);assert.doesNotMatch(result.source,/shotcraft-slot:scene-a/);assert.match(result.source,/data-scene-id=\{scene\.id\}/);
  const slotDiff=result.diffs.find((diff:any)=>diff.kind==="canonical_scene_slot_bind");
  assert.deepEqual({sourceText:slotDiff.sourceText,generatedText:slotDiff.generatedText},{sourceText:"{/* shotcraft-slot:scene-a */}",generatedText:'{scene.id === "scene-a" ? <Shotcraft_scene_a /> : null}'});
  const compiled=typescript.transpileModule(result.source,{compilerOptions:{jsx:typescript.JsxEmit.React,module:typescript.ModuleKind.CommonJS,target:typescript.ScriptTarget.ES2020}}).outputText;
  const Shot=()=>null,React={createElement:(type:any,props:any,...children:any[])=>({type,props:props??{},children})},exportsObject:any={};
  new Function("require","exports",compiled)((id:string)=>id==="react"?{__esModule:true,default:React}:id==="./shotcraft/scene-a/demos/Shot"?{Shot}:undefined,exportsObject);
  const rendered=exportsObject.GeneratedVideo({project:{scenes:[{id:"scene-a"},{id:"scene-b"}]}});
  const count=(node:any,type:any):number=>!node?0:Array.isArray(node)?node.reduce((sum,item)=>sum+count(item,type),0):typeof node==="object"?(node.type===type?1:0)+count(node.children,type):0;
  assert.deepEqual(rendered.map((node:any)=>node.props["data-scene-id"]),["scene-a","scene-b"]);
  assert.equal(count(rendered[0],Shot),1,JSON.stringify(rendered,(_key,value)=>typeof value==="function"?value.name:value));assert.equal(count(rendered[1],Shot),0);
  assert.throws(()=>api.integrateSelectedScene({source:'import React from "react";\nexport const GeneratedVideo = ({scene}) => <div data-scene-id={scene.id}>{/* shotcraft-slot:scene-a */}</div>;\n',sceneId:"scene-a",modulePath:"./shotcraft/scene-a/demos/Shot",componentExport:"Shot"}),/must be inside project\.scenes\.map\(\)/i);
});

test("single-demo selection normalizes an omitted sourceDemo before validation and materialization", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-single-demo-"));
  try {
    const fixture={...card,variants:[{...variant,source:{...variant.source,demo:["demos/Shot.tsx"],closure:["demos/Shot.tsx"]}}]},sourceDir=resolve(dir,"source");
    await mkdir(resolve(sourceDir,"demos"),{recursive:true});
    await writeFile(resolve(sourceDir,"demos/Shot.tsx"),"export const SHOT_DURATION=1;\nexport const Shot=()=>null;\n");
    const oneBindings={...bindings,sourceDemo:undefined,componentExport:"Shot"};delete (oneBindings as any).sourceDemo;
    await mkdir(resolve(dir,"remotion/generated"),{recursive:true});await writeFile(resolve(dir,"remotion/generated/Video.tsx"),generatedVideoSource);
    const input=base({root:dir,card:fixture,variant:fixture.variants[0],sourceFilesRoot:sourceDir,bindings:oneBindings});
    const validated=await api.validateShotcraftPreparation(input);
    assert.equal(validated.selectedDemo,"demos/Shot.tsx");assert.equal(validated.bindings.sourceDemo,"demos/Shot.tsx");
    const prepared=await api.materializeValidatedShotcraft(validated,{card:fixture,variant:fixture.variants[0],sceneId:"scene-a",bindings:validated.bindings,catalog});
    assert.equal(prepared.selectedDemo,"demos/Shot.tsx");
    assert.doesNotMatch(await readFile(resolve(dir,"remotion/generated/shotcraft/scene-a/demos/Shot.tsx"),"utf8"),/Modified from Apache-2\.0 Video Shotcraft source/);
    assert.match(await readFile(resolve(dir,"remotion/generated/shotcraft/scene-a/LICENSE"),"utf8"),/Apache License/);
    assert.match(await readFile(resolve(dir,"remotion/generated/shotcraft/scene-a/SOURCE-NOTICE.md"),"utf8"),/screenshot textures were replaced/i);
    assert.match(await readFile(resolve(dir,"remotion/generated/Video.tsx"),"utf8"),/scene\.id === "scene-a" \?/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("nested callback shadowing the canonical scene variable rejects before generated output", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-shadowed-scene-"));
  try {
    const fixture={...card,variants:[{...variant,source:{...variant.source,demo:["demos/Shot.tsx"],closure:["demos/Shot.tsx"]}}]},sourceDir=resolve(dir,"source");
    await mkdir(resolve(sourceDir,"demos"),{recursive:true});
    await writeFile(resolve(sourceDir,"demos/Shot.tsx"),"export const SHOT_DURATION=1;\nexport const Shot=()=>null;\n");
    const shadowedVideo='import React from "react";\nexport const GeneratedVideo = ({project,items}) => project.scenes.map((scene) => <div data-scene-id={scene.id}>{items.map((scene) => <span>{/* shotcraft-slot:scene-a */}</span>)}</div>);\n';
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,card:fixture,variant:fixture.variants[0],sourceFilesRoot:sourceDir,bindings:{...bindings,sourceDemo:"demos/Shot.tsx",componentExport:"Shot"},generatedVideoSource:shadowedVideo})),/shadow|nested.*scope|cannot prove/i);
    await assert.rejects(readdir(resolve(dir,"remotion/generated")),{code:"ENOENT"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("missing or ambiguous source targets block before materialization", async () => {
  const source="export const Shot = () => <div>different</div>;";
  assert.throws(()=>api.adaptSourceFile({sourcePath:"demos/Shot.tsx",source,bindings:{text:[{target:"headline",sourcePath:"demos/Shot.tsx",sourceValue:"Sample title!!!",canonicalKey:"scene.screenText"}],assets:[],palette:[],targets:[]},scene:project.scenes[0],project,manifest}),/canonical_text_replace target 'headline'.*matched 0 times/i);
});

test("a JSX identifier bound through a local string constant accepts canonical text replacement", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-bound-copy-"));
  try {
    const sourceDemo="demos/Shot.tsx",fixture={...card,variants:[{...variant,source:{...variant.source,demo:[sourceDemo],closure:[sourceDemo]}}]},sourceDir=resolve(dir,"source"),fixtureProject={...project,scenes:[{...project.scenes[0],screenText:"Target"}]};
    await mkdir(resolve(sourceDir,"demos"),{recursive:true});
    await writeFile(resolve(sourceDir,sourceDemo),"export const SHOT_DURATION=1;\nconst TITLE='Sample';\nexport const Shot=()=> <div>{TITLE}</div>;\n");
    const inputBindings={...bindings,sourceDemo,componentExport:"Shot",text:[{target:"title",sourcePath:sourceDemo,sourceValue:"Sample",canonicalKey:"scene.screenText"}]};
    const validated=await api.validateShotcraftPreparation(base({root:dir,sourceFilesRoot:sourceDir,dependencyRoot:root,card:fixture,variant:fixture.variants[0],project:fixtureProject,bindings:inputBindings}));
    assert.match(validated.files[0].bytes.toString("utf8"),/const TITLE="Target"/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("an unbound string constant rendered directly inside a JSX Fragment is rejected", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-fragment-copy-"));
  try {
    const sourceDemo="demos/Shot.tsx",fixture={...card,variants:[{...variant,source:{...variant.source,demo:[sourceDemo],closure:[sourceDemo]}}]},sourceDir=resolve(dir,"source");
    await mkdir(resolve(sourceDir,"demos"),{recursive:true});
    await writeFile(resolve(sourceDir,sourceDemo),"export const SHOT_DURATION=1;\nconst children='Sample';\nexport const Shot=()=> <>{children}</>;\n");
    const unboundBindings={...bindings,sourceDemo,componentExport:"Shot",text:[]};
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,sourceFilesRoot:sourceDir,dependencyRoot:root,card:fixture,variant:fixture.variants[0],bindings:unboundBindings})),/unbound sample copy targets.*children/i);
    await assert.rejects(readdir(resolve(dir,"remotion/generated")),{code:"ENOENT"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("unbound demo texture or brand callsites block the selected closure before output exists", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-required-targets-"));
  try {
    const fixture={...card,variants:[{...variant,source:{...variant.source,demo:["demos/Shot.tsx"],closure:["demos/Shot.tsx"]}}]},sourceDir=resolve(dir,"source");
    await mkdir(resolve(sourceDir,"demos"),{recursive:true});
    await writeFile(resolve(sourceDir,"demos/Shot.tsx"),"import {staticFile} from 'remotion';\nexport const SHOT_DURATION=1;\nexport const Shot=()=> <div>Sample<Img src={staticFile('textures/demo.png')}/></div>;\n");
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,sourceRoot:dir,card:fixture,variant:fixture.variants[0],sourceFilesRoot:sourceDir,bindings:{...bindings,sourceDemo:"demos/Shot.tsx",componentExport:"Shot"}})),/local media target 'textures\/demo\.png'.*approved asset binding/i);
    await writeFile(resolve(sourceDir,"demos/Shot.tsx"),"export const SHOT_DURATION=1;\nexport const Shot=()=> <div>Sample</div><ShotcraftWordmark/>;\n");
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,sourceRoot:dir,card:fixture,variant:fixture.variants[0],sourceFilesRoot:sourceDir,bindings:{...bindings,sourceDemo:"demos/Shot.tsx",componentExport:"Shot",text:[{target:"sample",sourcePath:"demos/Shot.tsx",sourceValue:"Sample",canonicalKey:"scene.screenText"}]}})),/retains sample branding component 'ShotcraftWordmark'/i);
    await assert.rejects(readdir(resolve(dir,"remotion/generated")),{code:"ENOENT"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("typewriter demo rejects rendered constants and JSX expressions that have no canonical bindings", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-rendered-copy-"));
  try {
    const typewriterCard=catalog.cards.find((item:any)=>item.id==="typewriter-moves"),typewriterVariant=typewriterCard.variants.find((item:any)=>item.id==="error-retype"),sourceDemo="demos/typography/typewriter-moves/TypewriterErrorRetype.tsx";
    const unboundBindings={sourceDemo,componentExport:"TypewriterErrorRetype",integrationMarker:"shotcraft-slot:scene-a",assets:[],text:[],palette:[],targets:[
      {target:"sample-mark",sourcePath:sourceDemo,kind:"remove_jsx_component",componentName:"ShotcraftMark"},
      {target:"sample-eyebrow",sourcePath:sourceDemo,kind:"remove_text",sourceValue:"Introducing"},
    ]};
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,sourceFilesRoot:sourceRoot,dependencyRoot:root,card:typewriterCard,variant:typewriterVariant,bindings:unboundBindings})),/unbound sample copy targets.*BRAND\.name/i);
    await assert.rejects(readdir(resolve(dir,"remotion/generated")),{code:"ENOENT"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("rhythm jump-cut demo rejects unbound visible copy in its imported FakeDashboard", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-imported-copy-"));
  try {
    const rhythmCard=catalog.cards.find((item:any)=>item.id==="rhythm-interrupt-moves"),rhythmVariant=rhythmCard.variants.find((item:any)=>item.id==="jump-cut-punch-in"),sourceDemo="demos/rhythm/rhythm-interrupt-moves/JumpCutPunchIn.tsx";
    const copyUnboundBindings={sourceDemo,componentExport:"JumpCutPunchIn",integrationMarker:"shotcraft-slot:scene-a",assets:[],text:[],palette:[],targets:[{target:"dashboard-brand",sourcePath:"demos/_fixtures/Fixtures.tsx",kind:"remove_jsx_component",componentName:"ShotcraftMark"}]};
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,sourceFilesRoot:sourceRoot,dependencyRoot:root,card:rhythmCard,variant:rhythmVariant,bindings:copyUnboundBindings})),/unbound sample copy targets.*(video-shotcraft|Pro plan|24,812)/i);
    await assert.rejects(readdir(resolve(dir,"remotion/generated")),{code:"ENOENT"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("copy validation skips an imported component that the selected demo never renders", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-unused-copy-module-"));
  try {
    const sourceDemo="demos/Shot.tsx",unusedPath="demos/Unused.tsx",fixture={...card,variants:[{...variant,source:{...variant.source,demo:[sourceDemo],closure:[sourceDemo,unusedPath]}}]},sourceDir=resolve(dir,"source");
    await mkdir(resolve(sourceDir,"demos"),{recursive:true});
    await writeFile(resolve(sourceDir,sourceDemo),"import {Unused} from './Unused';\nexport const SHOT_DURATION=1;\nexport const Shot=()=> <div>Fine</div>;\n");
    await writeFile(resolve(sourceDir,unusedPath),"export const Unused=()=> <div>Unrelated sample slogan</div>;\n");
    const inputBindings={...bindings,sourceDemo,componentExport:"Shot",targets:[{target:"fine",sourcePath:sourceDemo,kind:"remove_text",sourceValue:"Fine"}]};
    const validated=await api.validateShotcraftPreparation(base({root:dir,sourceFilesRoot:sourceDir,dependencyRoot:root,card:fixture,variant:fixture.variants[0],bindings:inputBindings}));
    assert.equal(validated.selectedDemo,sourceDemo);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("copy validation ignores unused exports in a reached imported module", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-unused-export-copy-"));
  try {
    const sourceDemo="demos/Shot.tsx",brandPath="demos/_fixtures/Brand.tsx",fixture={...card,variants:[{...variant,source:{...variant.source,demo:[sourceDemo],closure:[sourceDemo,brandPath]}}]},sourceDir=resolve(dir,"source");
    await mkdir(resolve(sourceDir,"demos/_fixtures"),{recursive:true});
    await writeFile(resolve(sourceDir,sourceDemo),"import {ShotcraftMark as Mark} from './_fixtures/Brand';\nexport const SHOT_DURATION=1;\nexport const Shot=()=> <Mark/>;\n");
    await writeFile(resolve(sourceDir,brandPath),await readFile(resolve(sourceRoot,"demos/_fixtures/Brand.tsx")));
    const inputBindings={...bindings,sourceDemo,componentExport:"Shot",targets:[{target:"mark",sourcePath:sourceDemo,kind:"remove_jsx_component",componentName:"Mark"}]};
    const validated=await api.validateShotcraftPreparation(base({root:dir,sourceFilesRoot:sourceDir,dependencyRoot:root,card:fixture,variant:fixture.variants[0],bindings:inputBindings}));
    assert.equal(validated.selectedDemo,sourceDemo);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("reached helper branding requires removal at its own source path", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-helper-branding-"));
  try {
    const sourceDemo="demos/Shot.tsx",helperPath="demos/Helper.tsx",brandPath="demos/Brand.tsx",fixture={...card,variants:[{...variant,source:{...variant.source,demo:[sourceDemo],closure:[sourceDemo,helperPath,brandPath]}}]},sourceDir=resolve(dir,"source");
    await mkdir(resolve(sourceDir,"demos"),{recursive:true});
    await writeFile(resolve(sourceDir,sourceDemo),"import {Helper} from './Helper';\nexport const SHOT_DURATION=1;\nexport const Shot=()=> <Helper/>;\n");
    await writeFile(resolve(sourceDir,helperPath),"import {ShotcraftMark as Mark} from './Brand';\nexport const Helper=()=> <Mark/>;\n");
    await writeFile(resolve(sourceDir,brandPath),"export const ShotcraftMark=()=> <svg/>;\nexport const ShotcraftWordmark=()=> <div>unused brand copy</div>;\n");
    const sourceBindings={...bindings,sourceDemo,componentExport:"Shot"};
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,sourceFilesRoot:sourceDir,dependencyRoot:root,card:fixture,variant:fixture.variants[0],bindings:sourceBindings})),/sample branding component 'ShotcraftMark'.*demos\/Helper\.tsx.*JSX tag 'Mark'/i);
    const withRemoval={...sourceBindings,targets:[{target:"helper-brand",sourcePath:helperPath,kind:"remove_jsx_component",componentName:"Mark"}]};
    const validated=await api.validateShotcraftPreparation(base({root:dir,sourceFilesRoot:sourceDir,dependencyRoot:root,card:fixture,variant:fixture.variants[0],bindings:withRemoval}));
    assert.equal(validated.files.find((file:any)=>file.path===helperPath).bytes.toString("utf8").includes("<Mark"),false);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("reached helper branding resolves local aliases and namespace tags", async () => {
  const cases=[
    {name:"local alias",helper:"import {ShotcraftMark} from './Brand';\nconst Mark=ShotcraftMark;\nexport const Helper=()=> <Mark/>;\n",componentName:"Mark"},
    {name:"namespace tag",helper:"import * as Brand from './Brand';\nexport const Helper=()=> <Brand.ShotcraftMark/>;\n",componentName:"Brand.ShotcraftMark"},
  ];
  for(const item of cases){
    const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-brand-alias-"));
    try {
      const sourceDemo="demos/Shot.tsx",helperPath="demos/Helper.tsx",brandPath="demos/Brand.tsx",fixture={...card,variants:[{...variant,source:{...variant.source,demo:[sourceDemo],closure:[sourceDemo,helperPath,brandPath]}}]},sourceDir=resolve(dir,"source");
      await mkdir(resolve(sourceDir,"demos"),{recursive:true});
      await writeFile(resolve(sourceDir,sourceDemo),"import {Helper} from './Helper';\nexport const SHOT_DURATION=1;\nexport const Shot=()=> <Helper/>;\n");
      await writeFile(resolve(sourceDir,helperPath),item.helper);
      await writeFile(resolve(sourceDir,brandPath),"export const ShotcraftMark=()=> <svg/>;\n");
      const sourceBindings={...bindings,sourceDemo,componentExport:"Shot"};
      await assert.rejects(api.validateShotcraftPreparation(base({root:dir,sourceFilesRoot:sourceDir,dependencyRoot:root,card:fixture,variant:fixture.variants[0],bindings:sourceBindings})),/sample branding component 'ShotcraftMark'.*Helper\.tsx.*JSX tag/i);
      const withRemoval={...sourceBindings,targets:[{target:"helper-brand",sourcePath:helperPath,kind:"remove_jsx_component",componentName:item.componentName}]};
      const validated=await api.validateShotcraftPreparation(base({root:dir,sourceFilesRoot:sourceDir,dependencyRoot:root,card:fixture,variant:fixture.variants[0],bindings:withRemoval}));
      assert.equal(validated.files.find((file:any)=>file.path===helperPath).bytes.toString("utf8").includes(`<${item.componentName}`),false,item.name);
    } finally { await rm(dir,{recursive:true,force:true}); }
  }
});

test("stroke-segment-build prepares when Stage children are layout content and sample copy is bound", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-stage-children-"));
  try {
    const stageCard=catalog.cards.find((item:any)=>item.id==="stroke-segment-build"),stageVariant=stageCard.variants.find((item:any)=>item.id==="stroke-segment-build"),sourceDemo="demos/opening/stroke-segment-build/StrokeSegmentBuild.tsx";
    const stageBindings={...bindings,sourceDemo,componentExport:"StrokeSegmentBuild",text:[],targets:[
      {target:"brand-name",sourcePath:sourceDemo,kind:"canonical_expression_replace",sourceExpression:"BRAND.name",canonicalKey:"scene.screenText"},
      {target:"brand-separator",sourcePath:sourceDemo,kind:"remove_text",sourceValue:"●"},
      {target:"brand-tagline",sourcePath:sourceDemo,kind:"remove_text",sourceValue:"ONE PROMPT, ONE FILM"},
    ]};
    await mkdir(resolve(dir,"remotion/generated"),{recursive:true});await writeFile(resolve(dir,"remotion/generated/Video.tsx"),generatedVideoSource);
    const validated=await api.validateShotcraftPreparation(base({root:dir,sourceFilesRoot:sourceRoot,dependencyRoot:root,card:stageCard,variant:stageVariant,bindings:stageBindings}));
    const prepared=await api.materializeValidatedShotcraft(validated,{card:stageCard,variant:stageVariant,sceneId:"scene-a",bindings:stageBindings,catalog});
    assert.equal(prepared.selectedDemo,sourceDemo);
    assert.ok(prepared.files.some((file:any)=>file.sourcePath==="demos/_fixtures/Look.tsx"));
    const copiedLook=await readFile(resolve(dir,"remotion/generated/shotcraft/scene-a/demos/_fixtures/Look.tsx"),"utf8");
    assert.match(copiedLook,/\{children\}/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("multiplane demo rejects dynamic staticFile expressions before generated output exists", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-dynamic-static-file-"));
  try {
    const multiplaneCard=catalog.cards.find((item:any)=>item.id==="depth-layer-moves"),multiplaneVariant=multiplaneCard.variants.find((item:any)=>item.id==="multiplane"),sourceDemo="demos/camera/depth-layer-moves/MultiplaneReal.tsx";
    const inputBindings={sourceDemo,componentExport:"MultiplaneReal",integrationMarker:"shotcraft-slot:scene-a",assets:[
      {target:"background",sourcePath:sourceDemo,sourceValue:"textures/live/projects-full.png",assetId:"logo",role:"product-logo"},
    ],text:[],palette:[],targets:[
      {target:"sample-mark",sourcePath:sourceDemo,kind:"remove_jsx_component",componentName:"ShotcraftMark"},
      ...["In focus","2.5D camera moves","Screenshots, split into layers and flown in 2.5D."].map((sourceValue,index)=>({target:`sample-copy-${index}`,sourcePath:sourceDemo,kind:"remove_text",sourceValue})),
    ]};
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,sourceFilesRoot:sourceRoot,dependencyRoot:root,card:multiplaneCard,variant:multiplaneVariant,bindings:inputBindings})),/dynamic.*staticFile|staticFile.*expression|explicit.*asset binding/i);
    await assert.rejects(readdir(resolve(dir,"remotion/generated")),{code:"ENOENT"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("canonical copy with changed length blocks before any generated files are materialized", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-copy-length-"));
  try {
    const fixture={...card,variants:[{...variant,source:{...variant.source,demo:["demos/Shot.tsx"],closure:["demos/Shot.tsx"]}}]},sourceDir=resolve(dir,"source");
    await mkdir(resolve(sourceDir,"demos"),{recursive:true});
    await writeFile(resolve(sourceDir,"demos/Shot.tsx"),"export const SHOT_DURATION=1;\nexport const Shot=()=> <div>Short</div>;\n");
    const preparedBindings={...bindings,sourceDemo:"demos/Shot.tsx",componentExport:"Shot",text:[{target:"headline",sourcePath:"demos/Shot.tsx",sourceValue:"Short",canonicalKey:"scene.screenText"}]};
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,sourceRoot:dir,card:fixture,variant:fixture.variants[0],sourceFilesRoot:sourceDir,bindings:preparedBindings})),/text target 'headline'.*changes the source text length/i);
    await assert.rejects(readdir(resolve(dir,"remotion/generated")),{code:"ENOENT"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("missing canonical GeneratedVideo scene slot blocks before source or scene materialization", async () => {
  const dir=await mkdtemp(resolve(tmpdir(),"shotcraft-prepare-missing-slot-"));
  try {
    const fixture={...card,variants:[{...variant,source:{...variant.source,demo:["demos/Shot.tsx"],closure:["demos/Shot.tsx"]}}]},sourceDir=resolve(dir,"source");
    await mkdir(resolve(sourceDir,"demos"),{recursive:true});
    await writeFile(resolve(sourceDir,"demos/Shot.tsx"),"export const SHOT_DURATION=1;\nexport const Shot=()=>null;\n");
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,sourceRoot:dir,card:fixture,variant:fixture.variants[0],sourceFilesRoot:sourceDir,bindings:{...bindings,sourceDemo:"demos/Shot.tsx",componentExport:"Shot"},generatedVideoSource:"export const GeneratedVideo=()=> <div data-scene-id=\"scene-a\" />;"})),/integration slot 'scene-a' matched 0 times/i);
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,sourceRoot:dir,card:fixture,variant:fixture.variants[0],sourceFilesRoot:sourceDir,bindings:{...bindings,sourceDemo:"demos/Shot.tsx",componentExport:"Shot"},generatedVideoSource:'export const GeneratedVideo = ({scene}) => <div data-scene-id={scene.id}>{/* shotcraft-slot:scene-a */}</div>;'})),/must be inside project\.scenes\.map\(\)/i);
    await assert.rejects(readdir(resolve(dir,"remotion/generated")),{code:"ENOENT"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("Shotcraft preparation rejects an unapproved renderer before writing generated output", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "shotcraft-prepare-gate-"));
  try {
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,gates:{...gates,renderer:"hyperframes"}})), /Remotion renderer must be selected/i);
    await assert.rejects(readdir(resolve(dir,"remotion/generated")), {code:"ENOENT"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("Shotcraft preparation rejects unapproved asset and authoring gates before writing", async () => {
  await assert.rejects(api.validateShotcraftPreparation(base({gates:{...gates,assetsApproved:false}})), /Host-approved production asset preflight/i);
  await assert.rejects(api.validateShotcraftPreparation(base({gates:{...gates,authoringApproved:false}})), /Approved Script and Storyboard authoring gates/i);
});

test("shotcraft:prepare does not write until the host-owned authoring gate is complete", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "shotcraft-prepare-host-gate-"));
  try {
    await assert.rejects(api.prepareShotcraft(dir,{cardId:card.id,variantKey:variant.id,sceneId:"scene-a",bindings:"bindings.json"}), /Approved authoring gates are not complete/i);
    await assert.rejects(readdir(resolve(dir,"remotion/generated")), {code:"ENOENT"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("Shotcraft preparation validates scene and asset role bindings before writing", async () => {
  const selected=variant.source.demo[0];
  await assert.rejects(api.validateShotcraftPreparation(base({manifest:{...manifest,assets:[{...manifest.assets[0],sceneIds:["other"]}]},bindings:{...bindings,assets:[{target:"logo",assetId:"logo",role:"product-logo",sourcePath:selected,sourceValue:"textures/logo.png"}]}})), /scene\/role mismatch/i);
  await assert.rejects(api.validateShotcraftPreparation(base({bindings:{...bindings,assets:[{target:"logo",assetId:"missing",role:"product-logo",sourcePath:selected,sourceValue:"textures/logo.png"}]}})), /missing asset/i);
});

test("Shotcraft preparation rejects output paths outside generated before materialization", async () => {
  await assert.rejects(api.validateShotcraftPreparation(base({outputRelative:"remotion/public/shotcraft"})), /must be under remotion\/generated\/shotcraft/i);
});

test("Shotcraft preparation rejects missing closure dependencies before writing", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "shotcraft-prepare-dependency-"));
  try {
    const fixture = {...card,variants:[{...variant,source:{...variant.source,demo:["demos/Shot.tsx"],closure:["demos/Shot.tsx"]}}]};
    await mkdir(resolve(dir,"demos"),{recursive:true});
    await writeFile(resolve(dir,"demos/Shot.tsx"),"import React from 'react';\nimport {useCurrentFrame} from 'remotion';\nimport {notInstalled} from 'shotcraft-not-installed';\nexport const SHOT_DURATION = 1;\nexport const Shot=()=>null;\n");
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,sourceRoot:dir,card:fixture,variant:fixture.variants[0],bindings:{...bindings,sourceDemo:"demos/Shot.tsx",componentExport:"Shot"}})), /dependency.*shotcraft-not-installed/i);
    await assert.rejects(readdir(resolve(dir,"remotion/generated")), {code:"ENOENT"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("Shotcraft materialization adapts only the selected closure and records every source diff", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "shotcraft-prepare-copy-"));
  try {
    const fixture = {...card,variants:[{...variant,source:{...variant.source,demo:["demos/Shot.tsx"],closure:["demos/Shot.tsx"]}}]};
    const sourceDir = resolve(dir,"source"); await mkdir(resolve(sourceDir,"demos"),{recursive:true});
    const original = Buffer.from("import {staticFile} from 'remotion';\nexport const SHOT_DURATION = 168;\nexport const Shot = () => <div style={{color:'#123456'}}>Sample title!!!<Img src={staticFile('textures/demo.png')}/></div>;\n");
    await writeFile(resolve(sourceDir,"demos/Shot.tsx"),original);
    const inputBindings={...bindings,sourceDemo:"demos/Shot.tsx",componentExport:"Shot",assets:[{target:"product-still",sourcePath:"demos/Shot.tsx",sourceValue:"textures/demo.png",assetId:"logo",role:"product-logo"}],text:[{target:"headline",sourcePath:"demos/Shot.tsx",sourceValue:"Sample title!!!",canonicalKey:"scene.screenText"}],palette:[{target:"accent",sourcePath:"demos/Shot.tsx",sourceValue:"#123456",token:"#eeeeee"}]};
    await mkdir(resolve(dir,"remotion/generated"),{recursive:true});await writeFile(resolve(dir,"remotion/generated/Video.tsx"),generatedVideoSource);
    const successProject={...project,scenes:[{...project.scenes[0],durationInFrames:168},{id:"scene-b",durationInFrames:32,screenText:"Second canonical scene",visualConcept:"Next scene"}]};
    const originalProject=JSON.stringify(successProject);
    const input = {...base({root:dir,sourceRoot,card:fixture,variant:fixture.variants[0],bindings:inputBindings,project:successProject}),sourceFilesRoot:sourceDir};
    const validated = await api.validateShotcraftPreparation(input);
    const result = await api.materializeValidatedShotcraft(validated,{card:fixture,variant:fixture.variants[0],sceneId:"scene-a",bindings:inputBindings,catalog});
    const copied = await readFile(resolve(dir,"remotion/generated/shotcraft/scene-a/demos/Shot.tsx"));
    assert.notDeepEqual(copied,original);assert.match(copied.toString("utf8"),/Canonical title/);assert.doesNotMatch(copied.toString("utf8"),/Sample title/);assert.match(copied.toString("utf8"),/staticFile\("assets\/logo\.svg"\)/);assert.match(copied.toString("utf8"),/color:"#eeeeee"/);
    assert.match(copied.toString("utf8"),/Modified from Apache-2\.0 Video Shotcraft source/);
    assert.equal(result.compatibilityStatus.status,"source_only");
    assert.equal(result.compatibilityStatus.reason,"Generated component is integrated but has not been smoke-tested in the selected Remotion runtime.");
    assert.equal(result.files[0].sourceSha256,textHash(original));
    assert.equal(result.files[0].generatedSha256,textHash(copied));
    assert.deepEqual(result.files[0].diffs.map((diff:any)=>diff.kind).sort(),["approved_asset_staticFile","canonical_palette_token","canonical_text_replace"]);
    assert.equal(result.actionDurationInFrames,168);
    const integratedVideo=await readFile(resolve(dir,"remotion/generated/Video.tsx"),"utf8");assert.match(integratedVideo,/Shotcraft_scene_a/);assert.match(integratedVideo,/\.\/shotcraft\/scene-a\/demos\/Shot/);assert.match(integratedVideo,/scene\.id === "scene-a" \?/);
    assert.deepEqual(result.generatedVideo.diffs.map((diff:any)=>({kind:diff.kind,sourceText:diff.sourceText,generatedText:diff.generatedText})),[
      {kind:"generated_video_import",sourceText:"",generatedText:'import { Shot as Shotcraft_scene_a } from "./shotcraft/scene-a/demos/Shot";'},
      {kind:"canonical_scene_slot_bind",sourceText:"{/* shotcraft-slot:scene-a */}",generatedText:'{scene.id === "scene-a" ? <Shotcraft_scene_a /> : null}'},
    ]);
    assert.equal(result.bindings.text[0].value,"Canonical title");assert.equal(result.bindings.assets[0].publicPath,"/assets/logo.svg");
    assert.deepEqual(result.sceneOrder,["scene-a","scene-b"]);assert.equal(result.sceneFrameBudget,200);assert.equal(JSON.stringify(successProject),originalProject);
    const {generatedHash} = await import(pathToFileURL(resolve(root,"dist/src/harness/remotion-evidence.js")).href);
    const before = await generatedHash(resolve(dir,"remotion/generated"));
    await writeFile(resolve(dir,"remotion/generated/shotcraft/scene-a/selection.json"),"{}\n");
    assert.notEqual(await generatedHash(resolve(dir,"remotion/generated")),before,"the selected Shotcraft record and copied sources must be covered by generatedHash");
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("Shotcraft preparation rejects imported checksum drift before materialization", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "shotcraft-prepare-checksum-"));
  try {
    const fixture = {...card,variants:[{...variant,source:{...variant.source,demo:["demos/Shot.tsx"],closure:["demos/Shot.tsx"]}}]};
    const sourceDir = resolve(dir,"source"), manifestPath=resolve(dir,"SOURCE.json");
    await mkdir(resolve(sourceDir,"demos"),{recursive:true});
    await writeFile(resolve(sourceDir,"demos/Shot.tsx"),"export const SHOT_DURATION=1;\nexport const Shot=()=>null;\n");
    await writeFile(manifestPath,JSON.stringify({files:[{path:"demos/Shot.tsx",sha256:"0".repeat(64)}]}));
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,card:fixture,variant:fixture.variants[0],sourceFilesRoot:sourceDir,sourceManifestPath:manifestPath,bindings:{...bindings,sourceDemo:"demos/Shot.tsx",componentExport:"Shot"}})), /Imported Shotcraft source checksum mismatch/i);
    await assert.rejects(readdir(resolve(dir,"remotion/generated")), {code:"ENOENT"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("Shotcraft preparation rejects a scene budget shorter than the original action arc", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "shotcraft-prepare-budget-"));
  try {
    const fixture = {...card,variants:[{...variant,source:{...variant.source,demo:["demos/Shot.tsx"],closure:["demos/Shot.tsx"]}}]};
    const sourceDir = resolve(dir,"source"); await mkdir(resolve(sourceDir,"demos"),{recursive:true});
    await writeFile(resolve(sourceDir,"demos/Shot.tsx"),"export const SHOT_DURATION = 168;\nexport const Shot=()=>null;\n");
    await assert.rejects(api.validateShotcraftPreparation(base({root:dir,sourceRoot,card:fixture,variant:fixture.variants[0],sourceFilesRoot:sourceDir,bindings:{...bindings,sourceDemo:"demos/Shot.tsx",componentExport:"Shot"},project:{...project,meta:{...project.meta,durationsInFrames:120},scenes:[{...project.scenes[0],durationInFrames:120}]}})), /Canonical scene budget 120 frames cannot contain the original action arc of 168 frames/i);
    await assert.rejects(readdir(resolve(dir,"remotion/generated")), {code:"ENOENT"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});
