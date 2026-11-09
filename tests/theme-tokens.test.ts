import test from "node:test";
import assert from "node:assert/strict";
import {mkdir,rm,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {productionAssetPreflight,productionAssetPreflightFromDisk} from "../src/authoring/preflight.js";
import {deriveTheme,fontStack,renderFontsModule,renderMotionModule,renderThemeModule,resolveFontBindings,themeFontBindingWarning} from "../src/harness/theme.js";
import {validateProject} from "../src/authoring/validator.js";
import type {AssetManifestItem} from "../src/harness/remotion-manifest.js";
import type {VideoProject,VideoTheme} from "../src/core/types.js";

const root=process.cwd();
const COMFORTABLE_PALETTE=["#0B1930","#76E6C4","#F8FAFC"];

function projectWithPalette(palette:string[],font="Inter",extra:Partial<VideoTheme>={}):VideoProject{
  return {meta:{title:"Theme fixture",width:1920,height:1080,durationsInFrames:60,fps:30,theme:{palette,font,...extra},constraints:{style:"documentary",disallowed:[],motionTone:"measured"}},scenes:[{id:"scene-1",durationInFrames:60,screenText:"Frame",visualConcept:"One approved visual claim is shown on a staged canvas."}]};
}

test("palette order does not change derived roles, and accents come from measured chroma",()=>{
  const base=deriveTheme(projectWithPalette(COMFORTABLE_PALETTE));
  const shuffledProject=projectWithPalette(["#F8FAFC","#0B1930","#76E6C4"]);
  const shuffled=deriveTheme(shuffledProject);
  assert.deepEqual(shuffled.tokens.palette,shuffledProject.meta.theme.palette);
  assert.equal(shuffled.tokens.page,base.tokens.page);
  assert.equal(shuffled.tokens.text,base.tokens.text);
  assert.equal(shuffled.tokens.accent,base.tokens.accent);
  assert.equal(shuffled.tokens.accentAlt,base.tokens.accentAlt);
  assert.equal(shuffled.tokens.surface,base.tokens.surface);
  assert.equal(shuffled.tokens.borderLit,base.tokens.borderLit);
  assert.equal(shuffled.tokens.textMuted,base.tokens.textMuted);
  assert.equal(base.tokens.page,"#0B1930");
  assert.equal(base.tokens.text,"#F8FAFC");
  assert.equal(base.tokens.accent,"#76E6C4");
  assert.equal(base.warnings.length,0);
});

test("a near-monochrome palette reports legibility warnings but still yields complete tokens",()=>{
  const derived=deriveTheme(projectWithPalette(["#111111","#1A1A1A"]));
  const codes=derived.warnings.map(warning=>warning.code);
  assert.ok(codes.includes("THEME_NO_DISTINCT_ACCENT"),JSON.stringify(codes));
  assert.ok(codes.includes("THEME_ACCENT_LOW_CONTRAST")||codes.includes("THEME_CONTRAST_LOW"),JSON.stringify(codes));
  assert.equal(derived.tokens.page,"#111111");
  assert.equal(derived.tokens.text,"#1A1A1A");
  assert.match(derived.tokens.accent,/^#[0-9A-F]{6}$/);
  assert.match(derived.tokens.onAccent,/^#[0-9A-F]{6}$/);
});

test("a single-color palette still produces a usable token set",()=>{
  const derived=deriveTheme(projectWithPalette(["#204060"]));
  const codes=derived.warnings.map(warning=>warning.code);
  assert.ok(codes.includes("THEME_SINGLE_COLOR"),JSON.stringify(codes));
  assert.ok(codes.includes("THEME_NO_DISTINCT_ACCENT"),JSON.stringify(codes));
  assert.match(derived.tokens.text,/^#[0-9A-F]{6}$/);
  assert.notEqual(derived.tokens.text,derived.tokens.page);
});

test("derived tokens publish the neutral contract and the vendored component aliases",()=>{
  const derived=deriveTheme(projectWithPalette(COMFORTABLE_PALETTE,"Inter"));
  assert.equal(derived.cssVars["--video-page"],derived.tokens.page);
  assert.equal(derived.cssVars["--video-text"],derived.tokens.text);
  assert.equal(derived.cssVars["--video-accent"],derived.tokens.accent);
  assert.equal(derived.cssVars["--video-font-display"],'"Inter", sans-serif');
  assert.equal(derived.cssVars["--onda-bg"],derived.tokens.page);
  assert.equal(derived.cssVars["--onda-surface"],derived.tokens.surface);
  assert.equal(derived.cssVars["--onda-border"],derived.tokens.border);
  assert.equal(derived.cssVars["--onda-border-lit"],derived.tokens.borderLit);
  assert.equal(derived.cssVars["--onda-text"],derived.tokens.text);
  assert.equal(derived.cssVars["--onda-accent"],derived.tokens.accent);
  assert.equal(derived.cssVars["--onda-font-display"],derived.cssVars["--video-font-display"]);
});

test("theme and font modules are deterministic pure functions of canonical input",()=>{
  const project=projectWithPalette(COMFORTABLE_PALETTE,"Inter");
  const derived=deriveTheme(project);
  assert.equal(renderThemeModule(project,derived),renderThemeModule(project,deriveTheme(project)));
  const fonts:AssetManifestItem[]=[{id:"font-inter-regular",publicPath:"/assets/fonts/Inter-Regular.woff2",type:"font/woff2",role:"font",family:"Inter"}];
  assert.equal(renderFontsModule(project,fonts),renderFontsModule(project,fonts));
  assert.notEqual(renderFontsModule(project,fonts),renderFontsModule(project,[]));
  // faces load from the root component, never at import time (an import-time delayRender is orphaned by Remotion's render entry)
  const module=renderFontsModule(project,fonts);
  assert.match(module,/export const loadRegisteredFonts = \(\): void => \{\n  if \(fontsRequested\) return;/);
  assert.doesNotMatch(module,/^for \(const face/m);
  assert.match(renderFontsModule(project,[]),/export const loadRegisteredFonts = \(\): void => \{\};/);
  assert.equal(renderMotionModule(project),renderMotionModule(project));
});

test("light mode puts the lightest color on the canvas and the highest-contrast color on text",()=>{
  const palette=["#FFFFFF","#111111","#0066FF"];
  const dark=deriveTheme(projectWithPalette(palette));
  assert.equal(dark.tokens.mode,"dark");
  assert.equal(dark.tokens.page,"#111111");
  const light=deriveTheme(projectWithPalette(palette,"Inter",{mode:"light"}));
  assert.equal(light.tokens.mode,"light");
  assert.equal(light.tokens.page,"#FFFFFF");
  assert.equal(light.tokens.text,"#111111");
  assert.equal(light.tokens.accent,"#0066FF");
  assert.equal(light.warnings.length,0,JSON.stringify(light.warnings));
  const mismatch=deriveTheme(projectWithPalette(["#101010","#303030","#E02020"],"Inter",{mode:"light"}));
  assert.ok(mismatch.warnings.some(warning=>warning.code==="THEME_MODE_MISMATCH"),JSON.stringify(mismatch.warnings));
});

test("pinned roles override measurement and unpinned roles are still derived",()=>{
  const palette=["#1D1D21","#7A7A7A","#79553A","#5DBB3C","#E8B923","#F2F2F2"];
  const derived=deriveTheme(projectWithPalette(palette,"Inter",{roles:{accent:"#e8b923"}}));
  assert.equal(derived.tokens.page,"#1D1D21");
  assert.equal(derived.tokens.text,"#F2F2F2");
  assert.equal(derived.tokens.accent,"#E8B923");
  assert.equal(derived.tokens.accentAlt,"#5DBB3C");
  const pinnedPage=deriveTheme(projectWithPalette(palette,"Inter",{roles:{page:"#79553A",text:"#F2F2F2"}}));
  assert.equal(pinnedPage.tokens.page,"#79553A");
  assert.equal(pinnedPage.tokens.text,"#F2F2F2");
});

test("canonical validation accepts theme mode and roles only when they are coherent with the palette",async()=>{
  const palette=["#FFFFFF","#111111","#0066FF"];
  const ok=await validateProject(projectWithPalette(palette,"Inter",{mode:"light",roles:{page:"#ffffff",accent:"#0066FF"}}));
  assert.equal(ok.valid,true,JSON.stringify(ok.issues));
  const codes=async(extra:Record<string,unknown>)=>(await validateProject(projectWithPalette(palette,"Inter",extra as Partial<VideoTheme>))).issues.map(issue=>issue.code);
  assert.ok((await codes({mode:"sepia"})).includes("THEME_MODE_INVALID"));
  assert.ok((await codes({roles:{accent:"#FF0000"}})).includes("THEME_ROLE_NOT_IN_PALETTE"));
  assert.ok((await codes({roles:{page:"#111111",text:"#111111"}})).includes("THEME_ROLE_DUPLICATE"));
  assert.ok((await codes({roles:{muted:"#111111"}})).includes("FIELD_UNKNOWN"));
});

test("font tokens carry a generic fallback, and generic families need no font asset",()=>{
  assert.equal(fontStack("Monocraft"),'"Monocraft", sans-serif');
  assert.equal(fontStack("Monospace"),"monospace");
  assert.equal(themeFontBindingWarning(projectWithPalette(COMFORTABLE_PALETTE,"sans-serif"),[]),undefined);
});

test("font registration binds only matching manifest font assets",()=>{
  const project=projectWithPalette(COMFORTABLE_PALETTE,"Inter");
  const assets:AssetManifestItem[]=[
    {id:"font-inter-regular",publicPath:"/assets/fonts/Inter-Regular.woff2",type:"font/woff2",role:"font",family:"Inter",weight:"400"},
    {id:"font-inter-bold",publicPath:"/assets/fonts/Inter-Bold.woff2",type:"font/woff2",role:"font",family:"Inter",weight:"700"},
    {id:"photo",publicPath:"/assets/photos/one.png",type:"image/png",role:"evidence",sceneIds:["scene-1"]},
  ];
  const bindings=resolveFontBindings(assets);
  assert.deepEqual(bindings.map(binding=>binding.assetId),["font-inter-bold","font-inter-regular"]);
  assert.equal(bindings[0].publicPath,"/assets/fonts/Inter-Bold.woff2");
  assert.equal(bindings[0].weight,"700");
  assert.equal(themeFontBindingWarning(project,assets),undefined);

  const unbound=themeFontBindingWarning(projectWithPalette(COMFORTABLE_PALETTE,"Clash Display"),assets);
  assert.equal(unbound?.code,"THEME_FONT_UNBOUND");
  assert.match(unbound!.message,/Clash Display/);

  const noneRegistered=themeFontBindingWarning(project,[]);
  assert.equal(noneRegistered?.code,"THEME_FONT_UNBOUND");
  assert.match(noneRegistered!.message,/role 'font'/);
});

const WOFF2_HEADER=new Uint8Array([0x77,0x4F,0x46,0x32,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]);

test("production preflight accepts a WOFF2-signature fixture without a scene binding",async()=>{
  const tmp=resolve(root,"tests/.tmp-theme-fonts");await rm(tmp,{recursive:true,force:true});
  try{
    await mkdir(resolve(tmp,"assets/fonts"),{recursive:true});
    await writeFile(resolve(tmp,"assets/fonts/Inter-Regular.woff2"),WOFF2_HEADER);
    const project=projectWithPalette(COMFORTABLE_PALETTE,"Inter");
    const manifest={version:"1",assets:[{id:"font-inter-regular",publicPath:"/assets/fonts/Inter-Regular.woff2",type:"font/woff2",source:"local-test-fixture",provenance:"synthetic WOFF2 header used by this preflight test",rights:"Synthetic test fixture; no external font rights asserted",permittedUse:"Automated test only",role:"font",family:"Inter",weight:"400"}]};
    const result=await productionAssetPreflight(project,manifest,tmp);
    assert.equal(result.report.valid,true,JSON.stringify(result.report.issues));
  }finally{await rm(tmp,{recursive:true,force:true});}
});

test("production preflight rejects fonts with a wrong type, missing family, or forged bytes",async()=>{
  const tmp=resolve(root,"tests/.tmp-theme-font-invalid");await rm(tmp,{recursive:true,force:true});
  try{
    await mkdir(resolve(tmp,"assets/fonts"),{recursive:true});
    await writeFile(resolve(tmp,"assets/fonts/NotAFont.woff2"),"plain text pretending to be a font","utf8");
    await writeFile(resolve(tmp,"assets/fonts/Inter-Regular.woff2"),WOFF2_HEADER);
    const project=projectWithPalette(COMFORTABLE_PALETTE,"Inter");
    const wrongType={id:"font-image",publicPath:"/assets/fonts/Inter-Regular.woff2",type:"image/png",role:"font",family:"Inter",source:"fixture"};
    const missingFamily={id:"font-nofamily",publicPath:"/assets/fonts/Inter-Regular.woff2",type:"font/woff2",role:"font",source:"fixture"};
    const forged={id:"font-forged",publicPath:"/assets/fonts/NotAFont.woff2",type:"font/woff2",role:"font",family:"Inter",source:"fixture"};
    const result=await productionAssetPreflight(project,{version:"1",assets:[wrongType,missingFamily,forged]},tmp);
    const codes=new Set(result.report.issues.map(issue=>issue.code));
    assert.equal(result.report.valid,false);
    assert.ok(codes.has("ASSET_FONT_TYPE_INVALID"),JSON.stringify([...codes]));
    assert.ok(codes.has("ASSET_FONT_FAMILY_REQUIRED"),JSON.stringify([...codes]));
    assert.ok(codes.has("ASSET_DETECTED_TYPE_MISMATCH"),JSON.stringify([...codes]));
    assert.ok(!codes.has("ASSET_DERIVATIVE_REQUIRED"),JSON.stringify([...codes]));

    await writeFile(resolve(tmp,"assets/manifest.json"),JSON.stringify({version:"1",assets:[forged]}),"utf8");
    const fromDisk=await productionAssetPreflightFromDisk(project,tmp);
    assert.equal(fromDisk.report.valid,false);
    assert.ok(fromDisk.report.issues.some(issue=>issue.code==="ASSET_DETECTED_TYPE_MISMATCH"));
  }finally{await rm(tmp,{recursive:true,force:true});}
});
