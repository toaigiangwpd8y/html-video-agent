import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {createCanvas} from "@napi-rs/canvas";
import {buildCatalog, resolveDemoClosure} from "./shotcraft-library.mjs";

export const RENDER_SAMPLES = [
  {sampleId:"typography-blur-slide",cardId:"blur-slide",variantId:"blur-slide",category:"typography",demo:"demos/typography/blur-slide/BlurSlide.tsx",component:"BlurSlide",duration:120,peakFrame:56},
  {sampleId:"ui-entrance-card-stack",cardId:"card-stack",variantId:"card-stack",category:"ui-entrance",demo:"demos/ui-entrance/card-stack/CardStack.tsx",component:"CardStack",duration:150,peakFrame:78},
  {sampleId:"camera-cursor-flyover",cardId:"cursor-flyover",variantId:"cursor-flyover",category:"camera",demo:"demos/camera/cursor-flyover/CursorFlyover.tsx",component:"CursorFlyover",duration:240,peakFrame:100},
  {sampleId:"transition-gradient-transition",cardId:"gradient-transition",variantId:"gradient-transition",category:"transition",demo:"demos/transition/gradient-transition/GradientTransition.tsx",component:"GradientTransition",duration:200,peakFrame:100},
  {sampleId:"rhythm-beat-step-list-theme-cycle",cardId:"beat-step-list-theme-cycle",variantId:"beat-step-list-theme-cycle",category:"rhythm",demo:"demos/rhythm/beat-step-list-theme-cycle/BeatStepListThemeCycle.tsx",component:"BeatStepListThemeCycle",duration:140,peakFrame:84},
  {sampleId:"interaction-glass-pill-dictation-typing",cardId:"glass-pill-dictation-typing",variantId:"glass-pill-dictation-typing",category:"interaction",demo:"demos/interaction/glass-pill-dictation-typing/GlassPillDictationTyping.tsx",component:"GlassPillDictationTyping",duration:100,peakFrame:50},
  {sampleId:"helper-fixtures-icon-flip-bloom",cardId:"ui-to-brand-morph",variantId:"icon-flip-bloom",category:"helper-Fixtures",demo:"demos/outro/ui-to-brand-morph/IconFlipBloomLogo.tsx",component:"IconFlipBloomLogo",duration:130,peakFrame:65,helper:"Fixtures.tsx"},
  {sampleId:"helper-motion-logo-shrink",cardId:"logo-shrink-wordmark-lockup",variantId:"logo-shrink-wordmark-lockup",category:"helper-Motion",demo:"demos/outro/logo-shrink-wordmark-lockup/LogoShrinkWordmarkLockup.tsx",component:"LogoShrinkWordmarkLockup",duration:132,peakFrame:66,helper:"Motion.tsx"},
  {sampleId:"helper-pagecam-row-embed",cardId:"row-embed",variantId:"row-embed",category:"helper-PageCam2D",demo:"demos/ui-entrance/row-embed/RowEmbed.tsx",component:"RowEmbed",duration:68,peakFrame:46,helper:"PageCam2D.tsx"},
];

const sanitize = value => value.replace(/[^A-Za-z0-9_$]/g, "_");
const esc = value => JSON.stringify(value);
const SOURCE_TEXTURES = new Map([
  ["helper-pagecam-row-embed", new Map([["textures/live/detail-full.png", "demos/_textures/detail-full.png"]])],
]);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function pngDimensions(bytes) {
  if(bytes.length<24||bytes.toString("ascii",1,4)!=="PNG"||bytes.toString("ascii",12,16)!=="IHDR")throw new Error("Expected an upstream PNG with a valid IHDR header.");
  return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
}

function targetFixtureSource() {
  return `import React from "react";
import {AbsoluteFill, Img, staticFile} from "remotion";
export const TARGET_DURATION = 30;
export const TargetShot:React.FC = () => <AbsoluteFill style={{background:"#f3f5f8",fontFamily:"Arial,sans-serif"}}>
  <div data-copy-target="headline" style={{position:"absolute",left:100,top:130,width:500,height:100,overflow:"hidden",whiteSpace:"nowrap",font:"600 64px Arial",lineHeight:1.1,color:"#17181c"}}>Sample text</div>
  <div style={{position:"absolute",left:100,top:300,width:640,height:360,overflow:"hidden",borderRadius:18}}><Img data-asset-target="hero" src={staticFile("textures/source.svg")} style={{width:"100%",height:"100%",objectFit:"cover"}} /></div>
</AbsoluteFill>;
`;
}

export async function createCompatibilityFixtures({root, outputRoot, generatedRoot: generatedRootArg}) {
  const sourceRoot=resolve(root,"third-party/video-shotcraft/source");
  const generatedRoot=resolve(generatedRootArg??resolve(root,"remotion/generated/compatibility"));
  await rm(generatedRoot,{recursive:true,force:true});
  await mkdir(generatedRoot,{recursive:true});
  const catalog=await buildCatalog(sourceRoot);
  const sourceManifest=JSON.parse(await readFile(resolve(root,"third-party/video-shotcraft/SOURCE.json"),"utf8"));
  const imports=[],compositions=[],sampleRecords=[];
  for(const sample of RENDER_SAMPLES){
    const card=catalog.cards.find(item=>item.id===sample.cardId);
    const variant=card?.variants.find(item=>item.id===sample.variantId);
    if(!variant||!variant.source.demo.includes(sample.demo))throw new Error(`Compatibility sample ${sample.sampleId} is not an exact catalog variant/demo mapping.`);
    const closure=await resolveDemoClosure(sourceRoot,[sample.demo]);
    if(!closure.every(path=>variant.source.closure.includes(path)))throw new Error(`Compatibility sample ${sample.sampleId} closure is outside its catalog record.`);
    const assets=[];
    for(const path of closure){
      const destination=join(generatedRoot,"adapted",path);
      await mkdir(dirname(destination),{recursive:true});
      await writeFile(destination,await readFile(join(sourceRoot,path)));
      const source=await readFile(join(sourceRoot,path),"utf8");
      for(const match of source.matchAll(/staticFile\s*\(\s*['"]([^'"]+)['"]\s*\)/g)){
        const publicPath=match[1],publicFile=join(generatedRoot,"public",publicPath);
        await mkdir(dirname(publicFile),{recursive:true});
        const sourcePath=SOURCE_TEXTURES.get(sample.sampleId)?.get(publicPath);
        if(sourcePath){
          const sourceBytes=await readFile(join(sourceRoot,sourcePath));
          const sourceRecord=sourceManifest.files.find(file=>file.path===sourcePath);
          const actualSha256=sha256(sourceBytes);
          if(!sourceRecord||sourceRecord.sha256!==actualSha256)throw new Error(`Upstream source manifest does not authenticate fixture asset ${sourcePath}.`);
          const fixtureDimensions=pngDimensions(sourceBytes);
          await writeFile(publicFile,sourceBytes);
          if(!assets.some(asset=>asset.publicPath===publicPath))assets.push({publicPath,sourcePath,sha256:actualSha256,dimensions:fixtureDimensions,bytes:sourceBytes.length,upstreamRepo:sourceManifest.repo,upstreamRevision:sourceManifest.revision,fixtureSha256:sha256(await readFile(publicFile))});
          continue;
        }
        try{await readFile(publicFile);}catch(error){
          if(error.code!=="ENOENT")throw error;
          await writeFile(publicFile,makePlaceholderPng());
        }
      }
    }
    const key=sanitize(sample.sampleId),originalName=`Original_${key}`,adaptedName=`Adapted_${key}`;
    imports.push(`import {${sample.component} as ${originalName}} from ${esc(`../../../third-party/video-shotcraft/source/${sample.demo}`)};`);
    imports.push(`import {${sample.component} as ${adaptedName}} from ${esc(`./adapted/${sample.demo}`)};`);
    for(const [side,component] of [["original",originalName],["adapted",adaptedName]])compositions.push(`<Composition id="${sample.sampleId}-${side}" component={${component}} durationInFrames={${sample.duration}} fps={30} width={1920} height={1080}/>`);
    const frames=[...new Set([0,Math.floor(sample.duration/2),Math.min(sample.duration-1,sample.peakFrame),sample.duration-1])];
    sampleRecords.push({...sample,closure,frames,...(assets.length?{assets}:{})});
  }

  const targetSource=targetFixtureSource();
  const targetPath=join(generatedRoot,"target/TargetShot.tsx");
  await mkdir(dirname(targetPath),{recursive:true});
  await writeFile(targetPath,targetSource,"utf8");
  const targetAsset=`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90"><rect x="12" y="8" width="136" height="74" rx="14" fill="#4166c1"/><circle cx="80" cy="45" r="18" fill="#fff" fill-opacity="0.55"/></svg>`;
  await mkdir(join(generatedRoot,"public/assets"),{recursive:true});
  await writeFile(join(generatedRoot,"public/assets/canonical.svg"),targetAsset,"utf8");
  await writeFile(join(generatedRoot,"public/assets/square.svg"),`<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 90 90"><rect width="90" height="90" fill="#4166c1"/></svg>`,"utf8");
  const project={meta:{title:"Disposable target fixture",width:1920,height:1080,durationsInFrames:30,fps:30,theme:{palette:["#f3f5f8","#17181c"],font:"Arial"}},scenes:[{id:"scene-a",durationInFrames:30,screenText:"Launch anew",visualConcept:"Target adapter proof"}]};
  const manifest={version:"1",assets:[{id:"canonical-hero",publicPath:"/assets/canonical.svg",type:"image/svg+xml",role:"product-ui",sceneIds:["scene-a"]}]};
  await writeFile(join(generatedRoot,"target/video.json"),JSON.stringify(project,null,2));
  await writeFile(join(generatedRoot,"target/assets-manifest.json"),JSON.stringify(manifest,null,2));
  const {adaptSourceFile}=await import("./shotcraft-prepare.mjs");
  const bindings={text:[{target:"headline",sourcePath:"demos/target/TargetShot.tsx",sourceValue:"Sample text",canonicalKey:"scene.screenText"}],assets:[{target:"hero",sourcePath:"demos/target/TargetShot.tsx",sourceValue:"textures/source.svg",assetId:"canonical-hero",role:"product-ui"}],palette:[],targets:[]};
  const adapted=adaptSourceFile({sourcePath:"demos/target/TargetShot.tsx",source:targetSource,bindings,scene:project.scenes[0],project,manifest});
  if(!adapted.source.includes("Launch anew")||!adapted.source.includes('staticFile("assets/canonical.svg")'))throw new Error("Task 3 adapter did not bind canonical target copy/local asset as expected.");
  const adaptedTarget=join(generatedRoot,"target/TargetShotAdapted.tsx");
  await writeFile(adaptedTarget,adapted.source,"utf8");
  imports.push(`import {TargetShot as TargetProductGood} from "./target/TargetShotAdapted";`);
  const overflowProject={...project,scenes:[{...project.scenes[0],screenText:"WWWWWWWWWWW"}]};
  const overflow=adaptSourceFile({sourcePath:"demos/target/TargetShot.tsx",source:targetSource,bindings,scene:overflowProject.scenes[0],project:overflowProject,manifest});
  await writeFile(join(generatedRoot,"target/TargetShotOverflow.tsx"),overflow.source,"utf8");
  imports.push(`import {TargetShot as TargetProductOverflow} from "./target/TargetShotOverflow";`);
  const badRatioManifest={version:"1",assets:[{...manifest.assets[0],publicPath:"/assets/square.svg"}]};
  const badRatioBindings={...bindings,assets:[{...bindings.assets[0],assetId:"canonical-hero"}]};
  const badRatio=adaptSourceFile({sourcePath:"demos/target/TargetShot.tsx",source:targetSource,bindings:badRatioBindings,scene:project.scenes[0],project,manifest:badRatioManifest});
  await writeFile(join(generatedRoot,"target/TargetShotAspect.tsx"),badRatio.source,"utf8");
  imports.push(`import {TargetShot as TargetProductAspect} from "./target/TargetShotAspect";`);
  for(const [id,component] of [["target-product-good","TargetProductGood"],["target-product-overflow","TargetProductOverflow"],["target-product-aspect","TargetProductAspect"]])compositions.push(`<Composition id="${id}" component={${component}} durationInFrames={30} fps={30} width={1920} height={1080}/>`);

  await writeFile(join(generatedRoot,"Root.tsx"),`import React from "react";\nimport {Composition} from "remotion";\n${imports.join("\n")}\nexport const RemotionRoot:React.FC=()=> <>\n${compositions.join("\n")}\n</>;\n`);
  await writeFile(join(generatedRoot,"index.ts"),`import {registerRoot} from "remotion";\nimport {RemotionRoot} from "./Root";\nregisterRoot(RemotionRoot);\n`);
  await writeFile(join(outputRoot,"render-samples.json"),JSON.stringify(sampleRecords,null,2));
  return {generatedRoot,samples:sampleRecords,target:{project,manifest,source:targetSource,adaptedSource:adapted.source,adaptedDiffs:adapted.diffs,overflowSource:overflow.source,assetSvg:targetAsset}};
}

function makePlaceholderPng(){
  const canvas=createCanvas(640,360),ctx=canvas.getContext("2d");
  ctx.fillStyle="#dce4f6";ctx.fillRect(0,0,640,360);ctx.fillStyle="#4166c1";ctx.fillRect(40,40,560,280);
  return canvas.toBuffer("image/png");
}
