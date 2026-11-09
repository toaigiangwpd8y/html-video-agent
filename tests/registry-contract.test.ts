import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {readFile} from "node:fs/promises";
import {relative, resolve} from "node:path";
import test from "node:test";

const root=process.cwd();
const pathSeparator=process.platform==="win32"?"\\":"/";
const catalogPath=resolve(root,".agents/skills/storyboard-enhance/references/registry/catalog.json");
const registryPocFixtureRoot=resolve(root,"tests/fixtures/registry-poc");
const fixturePath=resolve(registryPocFixtureRoot,"cases.json");
const enhanceSkillPath=resolve(root,".agents/skills/storyboard-enhance/SKILL.md");
const fixtureProjectPath=resolve(registryPocFixtureRoot,"remotion/project.json");
const fixtureVideoPath=resolve(registryPocFixtureRoot,"remotion/Video.tsx");
const validatorModulePath=new URL(`file:///${resolve(root,"scripts/validate-registry.mjs").replaceAll("\\","/")}`).href;
const readJson=async(file:string):Promise<any>=>JSON.parse(await readFile(file,"utf8"));
type RegistryCase={id:string;storyJob:string;temporalProgression?:string;blueprint?:string;workflow?:string[];evidenceObject?:string;expected:{candidate?:string;resolution:string[];authoring?:string}};

const contract={
  blueprint_precedes_registry: true,
  registry_is_optional: true,
  none_is_valid: true,
  registry_does_not_override_story_truth: true,
  registry_does_not_override_asset_fit: true,
  direct_remotion_remains_final_authoring_model: true
};

const catalogForSourcePath=(sourcePath:string)=>({
  version:"0.1.0",
  purpose:"test catalog",
  selection_contract:contract,
  items:[{
    id:"test-item",
    provider:"remotionui",
    kind:"primitive",
    description:"test item",
    capabilities:["test"],
    inputs:["test input"],
    constraints:[],
    sourcePath,
    origin:{repo:"https://example.test/repo",revision:"abc123"}
  }]
});

const loadValidator=async()=>import(validatorModulePath);

function runRegistryCheck():Promise<{error:any;stdout:string;stderr:string}>{
  const file=process.platform==="win32"?"cmd.exe":"npm";
  const args=process.platform==="win32"?["/d","/s","/c","npm run registry:check"]:["run","registry:check"];
  return new Promise(done=>execFile(file,args,{cwd:root},(error,stdout,stderr)=>done({error,stdout:stdout??"",stderr:stderr??""})));
}

test("registry catalog has the fixed compact contract",async()=>{
  const catalog=await readJson(catalogPath);
  assert.deepEqual(Object.keys(catalog).sort(),["items","purpose","selection_contract","version"]);
  assert.equal(typeof catalog.version,"string");
  assert.equal(typeof catalog.purpose,"string");
  assert.ok(Array.isArray(catalog.items));

  assert.deepEqual(catalog.selection_contract,contract);
});

test("Storyboard Enhance resolves asset needs before selecting its final blueprint",async()=>{
  const skill=await readFile(enhanceSkillPath,"utf8");
  const orderStart=skill.indexOf("Full Enhance reasoning order:");
  const asset=skill.indexOf("asset resolution",orderStart);
  const blueprint=skill.indexOf("candidate layout/blueprint",orderStart);
  const motion=skill.indexOf("motion reasoning",orderStart);
  const optional=skill.indexOf("## Optional Onda retrieval");
  const catalog=skill.indexOf(".agents/skills/storyboard-enhance/references/registry/catalog.json",optional);
  assert.ok(orderStart>=0&&asset>orderStart&&blueprint>asset&&motion>blueprint);
  assert.ok(optional>motion&&catalog>optional);
  assert.match(skill,/Registry availability cannot influence scene meaning, asset requirements, blueprint choice, or motion design/i);
  assert.match(skill,/Custom direct Remotion authoring[\s\S]*NONE.*valid outcome/i);
});
test("registry POC tests use isolated fixture paths",async()=>{
  assert.match(fixtureProjectPath,/tests[\\/]fixtures[\\/]registry-poc[\\/]remotion[\\/]project\.json$/i);
  assert.match(fixtureVideoPath,/tests[\\/]fixtures[\\/]registry-poc[\\/]remotion[\\/]Video\.tsx$/i);
  assert.doesNotMatch(fixtureProjectPath,/remotion[\\/]generated/i);
  assert.doesNotMatch(fixtureVideoPath,/remotion[\\/]generated/i);
  assert.notEqual(fixtureProjectPath,resolve(root,"remotion/generated/project.json"));
  assert.notEqual(fixtureVideoPath,resolve(root,"remotion/generated/Video.tsx"));
});

test("registry POC fixture cleanup stays isolated to fixture paths",async()=>{
  const fixturePaths=[fixtureProjectPath,fixtureVideoPath];
  assert.ok(fixturePaths.every(file=>file.startsWith(`${registryPocFixtureRoot}${pathSeparator}`)));
  assert.equal(new Set(fixturePaths.map(file=>relative(registryPocFixtureRoot,file))).size,fixturePaths.length);
});

test("registry catalog validator command passes",async()=>{
  const result=await runRegistryCheck();
  assert.equal(result.error,null,`${result.stdout}\n${result.stderr}`);
});

test("registry validator rejects absolute source paths",async()=>{
  const {validateCatalog}=await loadValidator();
  await assert.rejects(
    ()=>validateCatalog(catalogForSourcePath(resolve(root,"package.json")),root,catalogPath),
    /sourcePath must be relative and contained under repo root/
  );
});

test("registry validator rejects traversal source paths",async()=>{
  const {validateCatalog}=await loadValidator();
  await assert.rejects(
    ()=>validateCatalog(catalogForSourcePath("..\\package.json"),root,catalogPath),
    /sourcePath must be relative and contained under repo root/
  );
});

test("registry validator rejects empty purpose and extra top-level keys",async()=>{
  const {validateCatalog}=await loadValidator();
  await assert.rejects(
    ()=>validateCatalog({...catalogForSourcePath("package.json"),purpose:"   "},root,catalogPath),
    /purpose must be a non-empty string/
  );
  await assert.rejects(
    ()=>validateCatalog({...catalogForSourcePath("package.json"),extra:true},root,catalogPath),
    /top-level keys/
  );
});

test("registry validator requires inputs and constraints arrays",async()=>{
  const {validateCatalog}=await loadValidator();
  const catalog=catalogForSourcePath("package.json");
  await assert.rejects(
    ()=>validateCatalog({...catalog,items:[{...catalog.items[0],inputs:undefined}]},root,catalogPath),
    /inputs must be a non-empty array/
  );
  await assert.rejects(
    ()=>validateCatalog({...catalog,items:[{...catalog.items[0],constraints:undefined}]},root,catalogPath),
    /constraints must be an array/
  );
});

test("registry:check rejects a repo-contained symlink escaping the repository",async()=>{
  const fsPromises:any=await import("node:fs/promises");
  const {mkdtemp,mkdir,rm,symlink,writeFile}=fsPromises;
  let tempRepoRoot:string|undefined;
  let outsideDir:string|undefined;
  try{
    const createdRepoRoot=await mkdtemp(resolve(root,"tests/.tmp-registry-repo-"));
    tempRepoRoot=createdRepoRoot;
    const createdOutsideDir=await mkdtemp(resolve(root,"tests/.tmp-registry-outside-"));
    outsideDir=createdOutsideDir;
    const catalogDir=resolve(createdRepoRoot,".agents/skills/storyboard-enhance/references/registry");
    const linkParent=resolve(createdRepoRoot,"sources");
    const tempCatalogPath=resolve(catalogDir,"catalog.json");
    const outsideFile=resolve(createdOutsideDir,"outside.tsx");
    const linkPath=resolve(linkParent,"escaped");
    await mkdir(catalogDir,{recursive:true});
    await mkdir(linkParent,{recursive:true});
    await writeFile(outsideFile,"export const outside=1;\n","utf8");
    await symlink(createdOutsideDir,linkPath,process.platform==="win32"?"junction":"dir");
    const sourcePath=relative(createdRepoRoot,resolve(linkPath,"outside.tsx"));
    const catalog=catalogForSourcePath(sourcePath);
    await writeFile(tempCatalogPath,JSON.stringify(catalog,null,2)+"\n","utf8");

    const {validateCatalog}=await loadValidator();
    await assert.rejects(
      ()=>validateCatalog(catalog,createdRepoRoot,tempCatalogPath),
      /sourcePath must remain contained under repo root/
    );
  }finally{
    await Promise.allSettled([
      ...(tempRepoRoot?[rm(tempRepoRoot,{recursive:true,force:true})]:[]),
      ...(outsideDir?[rm(outsideDir,{recursive:true,force:true})]:[]),
    ]);
  }
});

test("Onda retrieval remains optional and follows asset and blueprint review",async()=>{
  const skill=await readFile(enhanceSkillPath,"utf8");
  const optional=skill.slice(skill.indexOf("## Optional Onda retrieval"));
  assert.ok(skill.indexOf("Full Enhance reasoning order:")<skill.indexOf("## Optional Onda retrieval"));
  assert.match(optional,/Only after real asset inspection and final blueprint confirmation/i);
  assert.match(optional,/npm run registry:search.*--provider onda.*--query.*--top 8/is);
  assert.match(optional,/inspect only returned top candidates/i);
  assert.match(optional,/ACCEPT.*REJECT.*NEEDS_REVIEW/is);
  assert.match(optional,/drop rejected or unresolved candidates.*NONE/i);
  assert.match(optional,/NONE.*valid outcome/i);
  assert.match(optional,/Do not read `upstream\/onda\.snapshot\.json` for every scene/i);
});

test("discovered Onda candidates document inspect, reviewed metadata, and vendor handoff",async()=>{
  const skill=await readFile(enhanceSkillPath,"utf8");
  const optional=skill.slice(skill.indexOf("## Optional Onda retrieval"));
  assert.match(optional,/For a `DISCOVERED` Onda item, read `.agents\/skills\/storyboard-enhance\/references\/registry\/README\.md`/i);
  assert.match(optional,/registry:onda:inspect\s+--\s+<slug>/i);
  assert.match(optional,/ACCEPT.*capabilities.*inputs.*constraints/is);
  assert.match(optional,/registry:onda:vendor\s+--\s+<slug>\s+--metadata\s+<temporary-file>/i);
  assert.match(optional,/Delete temporary metadata after use; it is not a canonical artifact/i);
  assert.match(optional,/sourcePath.*direct authored import/i);
});
test("registry assisted authoring fixture uses direct sources and preserves custom Case C",async()=>{
  const project=await readJson(fixtureProjectPath);
  const source=await readFile(fixtureVideoPath,"utf8");
  const cases=await readJson(fixturePath) as RegistryCase[];

  assert.deepEqual(Object.keys(project).sort(),["meta","scenes"]);
  assert.equal(cases.length,3);
  assert.equal(project.scenes.length,3);
  assert.deepEqual(project.scenes.map((scene:any)=>scene.id),cases.map(entry=>entry.id));
  assert.equal(project.scenes.reduce((sum:number,scene:any)=>sum+scene.durationInFrames,0),project.meta.durationsInFrames);
  assert.ok(project.scenes.every((scene:any)=>scene.audio===undefined));
  assert.match(project.scenes[0].screenText,/headline/i);
  assert.match(project.scenes[0].visualConcept,/progressive reveal/i);
  assert.match(project.scenes[1].screenText,/difference|comparison/i);
  assert.match(project.scenes[1].visualConcept,/comparable subjects|shared frame/i);
  assert.match(project.scenes[2].screenText,/proof|change/i);
  assert.match(project.scenes[2].visualConcept,/causal|mechanical/i);

  assert.match(source,/import\s*\{\s*BlurReveal\s*\}\s*from\s*["']\.\.\/\.\.\/\.\.\/\.\.\/remotion\/registry\/onda\/blur-reveal\/BlurReveal["']/);
  assert.match(source,/import\s*\{\s*SplitScreen\s*\}\s*from\s*["']\.\.\/\.\.\/\.\.\/\.\.\/remotion\/registry\/remotionui\/split-screen\/SplitScreen["']/);
  assert.match(source,/REGISTRY_SOURCE:\s*onda-blur-reveal/i);
  assert.match(source,/REGISTRY_SOURCE:\s*remotionui-split-screen\s*\(adapted\)/i);
  assert.equal((source.match(/SOURCE_SCENE:/g)??[]).length,3);
  assert.equal((source.match(/LAYOUT_BLUEPRINT:/g)??[]).length,3);
  assert.equal((source.match(/MATERIALIZATION:/g)??[]).length,3);
  assert.equal((source.match(/REGISTRY_SOURCE:/g)??[]).length,2);
  assert.doesNotMatch(source,/component\s*(?:resolver|map|context)|registry\s*(?:resolver|map|context|plan)|componentId|dynamic\s+lookup/i);

  const causalCase=cases.find(entry=>entry.id==="causal-mechanical-evidence") as RegistryCase;
  assert.equal(causalCase.expected.authoring,"custom");
  assert.deepEqual(causalCase.expected.resolution,["NONE"]);
  const causalStart=source.indexOf("// SOURCE_SCENE: causal-mechanical-evidence");
  assert.notEqual(causalStart,-1);
  assert.doesNotMatch(source.slice(causalStart),/REGISTRY_SOURCE:/i);
});

test("registry POC Case B records asset-first rejection and selected media authoring",async()=>{
  const cases=await readJson(fixturePath) as RegistryCase[];
  const comparison=cases.find(entry=>entry.id==="comparison-after-asset-inspection") as RegistryCase & {
    probeCandidates:string[];
    assetInspection:{actualEvidence:{inputs:Array<{role:string;kind:string;path:string;width:number;height:number}>;numericComparisonAvailable:boolean};rejectedCandidate:string;selectedCandidate:string;selectedMediaItem:{id:string;paths:string[]};remotionSourcePath:string};
  };
  assert.ok(comparison.probeCandidates.includes("remotionui-comparison-bars"));
  const evidence=comparison.assetInspection.actualEvidence;
  assert.deepEqual(evidence.inputs.map(input=>input.role),["subject_a","subject_b"]);
  assert.ok(evidence.inputs.every(input=>input.kind==="image"));
  assert.deepEqual(evidence.inputs.map(input=>[input.width,input.height]),[[1600,1200],[1920,1080]]);
  assert.equal(evidence.numericComparisonAvailable,false);
  for(const input of evidence.inputs){
    const content=await readFile(resolve(registryPocFixtureRoot,input.path),"utf8");
    assert.ok(content.length>0,input.path);
  }
  assert.equal(comparison.assetInspection.rejectedCandidate,"remotionui-comparison-bars");
  assert.equal(comparison.assetInspection.selectedCandidate,"remotionui-split-screen");
  assert.notEqual(comparison.assetInspection.selectedMediaItem.id,comparison.assetInspection.rejectedCandidate);

  const sourcePath=resolve(registryPocFixtureRoot,comparison.assetInspection.remotionSourcePath);
  const source=await readFile(sourcePath,"utf8");
  assert.match(source,new RegExp(comparison.assetInspection.selectedMediaItem.id,"i"));
  assert.match(source,/SplitScreen/);
  assert.match(source,/staticFile\(["']media[\\/]subject-a\.svg["']/);
  assert.match(source,/staticFile\(["']media[\\/]subject-b\.svg["']/);
  assert.doesNotMatch(source,new RegExp(comparison.assetInspection.rejectedCandidate,"i"));
  assert.doesNotMatch(source,/ComparisonBars|remotionui-comparison-bars/);
});

test("registry catalog items declare semantic inputs and constraints arrays",async()=>{
  const catalog=await readJson(catalogPath);
  for(const item of catalog.items){
    assert.ok(Array.isArray(item.inputs)&&item.inputs.length>0,`${item.id} inputs`);
    assert.ok(Array.isArray(item.constraints),`${item.id} constraints`);
  }
});

test("registry catalog maintains provider, kind, capability, and job diversity",async()=>{
  const catalog=await readJson(catalogPath);
  assert.ok(catalog.items.length>=10&&catalog.items.length<=14);

  const providerCounts=new Map<string,number>();
  const kindCounts=new Map<string,number>();
  const capabilityText=catalog.items.map((item:any)=>[
    item.id,item.description,...(item.capabilities??[])
  ].join(" ").toLowerCase()).join(" ");
  for(const item of catalog.items){
    providerCounts.set(item.provider,(providerCounts.get(item.provider)??0)+1);
    kindCounts.set(item.kind,(kindCounts.get(item.kind)??0)+1);
  }
  for(const provider of ["onda","remotionui","remotionbits"]){
    assert.ok((providerCounts.get(provider)??0)>=2,`${provider} provider count`);
  }
  for(const kind of ["scene","transition","effect"]){
    assert.ok((kindCounts.get(kind)??0)>=1,`${kind} kind count`);
  }
  assert.ok((kindCounts.get("primitive")??0)>=4);
  for(const coverage of [
    /text|reveal/,
    /numeric|data/,
    /media|image/,
    /comparison/,
    /scene/,
    /transition/,
    /background|effect/
  ]){
    assert.match(capabilityText,coverage,`missing catalog coverage ${coverage}`);
  }

  const primaryJobs=new Map<string,number>();
  for(const item of catalog.items){
    const primaryJob=item.capabilities?.[0]??"";
    primaryJobs.set(primaryJob,(primaryJobs.get(primaryJob)??0)+1);
  }
  for(const [job,count] of primaryJobs){
    assert.ok(count<=2,`duplicate primary job ${job}: ${count}`);
  }
});

test("registry fixture contains exactly three contract cases",async()=>{
  const cases=await readJson(fixturePath) as RegistryCase[];
  assert.ok(Array.isArray(cases));
  assert.equal(cases.length,3);

  const byId=new Map<string,RegistryCase>(cases.map(entry=>[entry.id,entry]));
  assert.deepEqual(cases.map(entry=>entry.id),[
    "headline-progressive-reveal",
    "comparison-after-asset-inspection",
    "causal-mechanical-evidence"
  ]);

  const headline=byId.get("headline-progressive-reveal") as RegistryCase;
  assert.match(headline.storyJob,/headline/i);
  assert.match(headline.temporalProgression,/progressive reveal/i);
  assert.ok(headline.expected.candidate);
  assert.deepEqual(headline.expected.resolution,["USE","ADAPT"]);

  const comparison=byId.get("comparison-after-asset-inspection") as RegistryCase;
  assert.match(comparison.storyJob,/two comparable subjects/i);
  assert.equal(comparison.blueprint,"comparison-split");
  assert.deepEqual(comparison.workflow,["blueprint","probe","asset-inspection","resolution"]);
  assert.deepEqual(comparison.expected.resolution,["REJECT remotionui-comparison-bars","USE remotionui-split-screen"]);

  const causal=byId.get("causal-mechanical-evidence") as RegistryCase;
  assert.match(causal.storyJob,/causal|mechanical/i);
  assert.match(causal.evidenceObject,/evidence object/i);
  assert.deepEqual(causal.expected.resolution,["NONE"]);
  assert.equal(causal.expected.authoring,"custom");
});
