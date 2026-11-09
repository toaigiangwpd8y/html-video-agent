import {readFile,writeFile,mkdir,stat} from "node:fs/promises";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {createCanvas,loadImage} from "@napi-rs/canvas";
import {adaptSourceFile} from "./shotcraft-prepare.mjs";
import {captureBrowserAndFonts} from "./shotcraft-compatibility-render.mjs";

const fail=message=>{throw new Error(`Target-product probe failed: ${message}`);};
export function assertNoRemoteMedia(source){if(/https?:\/\//i.test(source))throw new Error("Target-adapted source contains a remote media/resource URL.");return true;}

function render(root,id,output,publicDirectory,browserExecutable){
  const cli=resolve(root,"remotion/node_modules/@remotion/cli/remotion-cli.js");
  return spawnSync(process.execPath,[cli,"still","generated/compatibility/index.ts",id,output,"--frame=0",`--public-dir=${publicDirectory}`,`--browser-executable=${browserExecutable}`,"--log=error"],{cwd:resolve(root,"remotion"),encoding:"utf8",windowsHide:true,maxBuffer:8_000_000});
}
async function pixels(path){const image=await loadImage(path),canvas=createCanvas(image.width,image.height),ctx=canvas.getContext("2d");ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,image.width,image.height).data,at=(x,y)=>Array.from(data.slice((y*image.width+x)*4,(y*image.width+x)*4+4));return {width:image.width,height:image.height,pixel:at,darkPixels:(x0,y0,x1,y1)=>{let n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const [r,g,b]=at(x,y);if(r<80&&g<80&&b<80)n++;}return n;},bluePixels:(x0,y0,x1,y1)=>{let n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const [r,g,b]=at(x,y);if(b>120&&b>r*1.25&&b>g*1.05)n++;}return n;}};}
const sameRgb=(a,b)=>a.slice(0,3).join(",")===b.join(",");

export async function runTargetProductProbe({root,outputRoot,generatedRoot}){
  const targetDir=join(generatedRoot,"target"),project=JSON.parse(await readFile(join(targetDir,"video.json"),"utf8")),manifest=JSON.parse(await readFile(join(targetDir,"assets-manifest.json"),"utf8"));
  const source=await readFile(join(targetDir,"TargetShot.tsx"),"utf8"),bindings={text:[{target:"headline",sourcePath:"demos/target/TargetShot.tsx",sourceValue:"Sample text",canonicalKey:"scene.screenText"}],assets:[{target:"hero",sourcePath:"demos/target/TargetShot.tsx",sourceValue:"textures/source.svg",assetId:"canonical-hero",role:"product-ui"}],palette:[],targets:[]};
  const adapt=(scene=project.scenes[0],boundManifest=manifest,baseSource=source)=>adaptSourceFile({sourcePath:"demos/target/TargetShot.tsx",source:baseSource,bindings,scene,project,manifest:boundManifest});
  const adapted=adapt(),canonical=project.scenes[0].screenText;
  const generatedAdapted=await readFile(join(targetDir,"TargetShotAdapted.tsx"),"utf8");
  if(generatedAdapted!==adapted.source||!adapted.source.includes(`>${canonical}</div>`)||!adapted.source.includes('staticFile("assets/canonical.svg")'))fail("Rendered target component is not the exact adapter output with canonical copy and local asset.");
  assertNoRemoteMedia(adapted.source);

  const rootFile=join(generatedRoot,"Root.tsx");let rootSource=await readFile(rootFile,"utf8");const additions=[];
  const register=async(name,variantSource,boundManifest,componentName)=>{
    const result=adapt(project.scenes[0],boundManifest,variantSource),path=join(targetDir,`${name}.tsx`);
    await writeFile(path,result.source,"utf8");additions.push(`import {TargetShot as ${componentName}} from "./target/${name}";`);
    return result;
  };
  const overflowProject={...project,scenes:[{...project.scenes[0],screenText:"WWWWWWWWWWW"}]};
  const overflowAdapted=adaptSourceFile({sourcePath:"demos/target/TargetShot.tsx",source,bindings,scene:overflowProject.scenes[0],project:overflowProject,manifest});
  await writeFile(join(targetDir,"TargetShotOverflow.tsx"),overflowAdapted.source,"utf8");additions.push('import {TargetShot as TargetProductOverflow} from "./target/TargetShotOverflow";');

  const aspectManifest={version:"1",assets:[{...manifest.assets[0],publicPath:"/assets/square.svg"}]};
  const aspect=await register("TargetShotAspect",source,aspectManifest,"TargetProductAspect");
  const missingManifest={version:"1",assets:[{...manifest.assets[0],publicPath:"/assets/missing.svg"}]};
  const missing=await register("TargetShotMissing",source,missingManifest,"TargetProductMissing");
  const opaqueManifest={version:"1",assets:[{...manifest.assets[0],publicPath:"/assets/opaque.svg"}]};
  const opaque=await register("TargetShotOpaque",source,opaqueManifest,"TargetProductOpaque");
  const containSource=source.replace('objectFit:"cover"','objectFit:"contain"');
  const contain=await register("TargetShotContain",containSource,aspectManifest,"TargetProductContain");
  const compositionLines=[
    '<Composition id="target-product-missing" component={TargetProductMissing} durationInFrames={30} fps={30} width={1920} height={1080}/>',
    '<Composition id="target-product-opaque" component={TargetProductOpaque} durationInFrames={30} fps={30} width={1920} height={1080}/>',
    '<Composition id="target-product-contain" component={TargetProductContain} durationInFrames={30} fps={30} width={1920} height={1080}/>',
  ].join("\n");
  rootSource=rootSource.replace("export const RemotionRoot",`${additions.join("\n")}\nexport const RemotionRoot`).replace("</>;",`${compositionLines}\n</>;`);
  await writeFile(rootFile,rootSource,"utf8");
  const changedLength={...project,scenes:[{...project.scenes[0],screenText:"Canonical copy with a different length"}]};let lengthBlocked=false;
  try{adaptSourceFile({sourcePath:"demos/target/TargetShot.tsx",source,bindings,scene:changedLength.scenes[0],project:changedLength,manifest});}catch(error){lengthBlocked=/changes the source text length/i.test(String(error));}
  if(!lengthBlocked)fail("Changed-length canonical copy did not block in the selected-source adapter.");

  const provenance=await captureBrowserAndFonts(root),pub="generated/compatibility/public";
  await mkdir(join(generatedRoot,"public/assets"),{recursive:true});
  await writeFile(join(generatedRoot,"public/assets/opaque.svg"),`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#4166c1"/></svg>`,"utf8");
  const renderOne=async(id,file,pubDir=pub)=>{const result=render(root,id,`../output/GRA-54/${file}`,pubDir,provenance.browser.executable);return {result,path:join(outputRoot,file)};};
  const good=await renderOne("target-product-good","target-product-good.png");if(good.result.status!==0)fail(`Adapted target composition failed to render: ${good.result.stderr}${good.result.stdout}`);
  const overflowResult=await renderOne("target-product-overflow","target-product-overflow.png");if(overflowResult.result.status!==0)fail("Overflow adapted target failed to render.");
  const aspectResult=await renderOne("target-product-aspect","target-product-aspect.png");if(aspectResult.result.status!==0)fail("Aspect-ratio negative target failed to render.");
  const opaqueResult=await renderOne("target-product-opaque","target-product-opaque.png");if(opaqueResult.result.status!==0)fail("Opaque alpha negative target failed to render.");
  const containResult=await renderOne("target-product-contain","target-product-contain.png");if(containResult.result.status!==0)fail("Contain crop negative target failed to render.");
  const missingPublic=join(generatedRoot,"missing-public");await mkdir(missingPublic,{recursive:true});
  const missingResult=await renderOne("target-product-missing","target-product-missing.png",missingPublic);
  const missingOutput=`${missingResult.result.stdout??""}\n${missingResult.result.stderr??""}`;
  const missingAssetDetected=missingResult.result.status!==0&&/assets[\\/]missing\.svg/i.test(missingOutput);
  if(!missingAssetDetected)fail(`Missing manifest-bound asset did not fail for the expected runtime resource: status=${missingResult.result.status}; ${missingOutput}`);

  const goodPixels=await pixels(good.path),overflowPixels=await pixels(overflowResult.path),aspectPixels=await pixels(aspectResult.path),opaquePixels=await pixels(opaqueResult.path),containPixels=await pixels(containResult.path);
  const canonicalBoundaryInk=goodPixels.darkPixels(596,130,600,230),overflowBoundaryInk=overflowPixels.darkPixels(596,130,600,230);
  const canonicalTransparentCorner=goodPixels.pixel(140,305),opaqueCorner=opaquePixels.pixel(140,305),background=[243,245,248];
  const blueBounds={canonical:goodPixels.bluePixels(100,300,740,660),squareCover:aspectPixels.bluePixels(100,300,740,660),squareContain:containPixels.bluePixels(100,300,740,660)};
  const canonicalFit=canonicalBoundaryInk===0,overflowDetected=overflowBoundaryInk>0;
  const alphaRendered=sameRgb(canonicalTransparentCorner,background)&&!sameRgb(opaqueCorner,background);
  const aspectRendered=blueBounds.canonical>0&&blueBounds.squareCover>blueBounds.canonical;
  const cropRendered=blueBounds.squareContain<blueBounds.squareCover;
  let remoteBlocked=false;try{assertNoRemoteMedia(adapted.source.replace(canonical,"https://example.invalid/image.png"));}catch{remoteBlocked=true;}
  const checks={
    canonicalCopy:{pass:adapted.source.includes(`>${canonical}</div>`)&&canonicalFit,source:canonical,adapterDiffs:adapted.diffs,renderedBoundaryInkPixels:canonicalBoundaryInk},
    overflow:{pass:canonicalFit,negativeCaseDetected:overflowDetected,canonicalBoundaryInkPixels:canonicalBoundaryInk,negativeBoundaryInkPixels:overflowBoundaryInk,renderedOutput:"target-product-overflow.png"},
    missingAsset:{negativeCaseDetected:missingAssetDetected,renderExitCode:missingResult.result.status,runtimeError:missingOutput.slice(-1200)},
    aspectRatio:{pass:aspectRendered,renderedBluePixelCounts:blueBounds,negativeCaseDetected:aspectRendered,negativeOutput:"target-product-aspect.png"},
    alphaAndCrop:{pass:alphaRendered&&cropRendered,canonicalTransparentCorner:canonicalTransparentCorner.slice(0,3),opaqueNegativeCorner:opaqueCorner.slice(0,3),cropPixelCounts:blueBounds,negativeOpaqueCaseDetected:alphaRendered,negativeCropCaseDetected:cropRendered},
    noRemoteMedia:{pass:!(/https?:\/\//i.test(adapted.source)),negativeCaseDetected:remoteBlocked},
    adapterFailures:{changedLengthCanonicalCopyBlocked:lengthBlocked},
    rendered:{good:"target-product-good.png",overflow:"target-product-overflow.png",aspect:"target-product-aspect.png",opaque:"target-product-opaque.png",contain:"target-product-contain.png",adaptedSource:"remotion/generated/compatibility/target/TargetShotAdapted.tsx"},
    limitations:"All pixel metrics inspect rendered PNGs from the Task 3 adapter output. Missing asset is checked against the renderer's resource-load error for the explicitly bound missing path. Fixture files remain disposable.",
  };
  const failures=Object.entries(checks).filter(([key,value])=>["canonicalCopy","overflow","aspectRatio","alphaAndCrop","noRemoteMedia"].includes(key)&&value.pass!==true).map(([key])=>key);
  if(!checks.overflow.negativeCaseDetected||!checks.missingAsset.negativeCaseDetected||!checks.aspectRatio.negativeCaseDetected||!checks.alphaAndCrop.negativeOpaqueCaseDetected||!checks.alphaAndCrop.negativeCropCaseDetected||!checks.noRemoteMedia.negativeCaseDetected||!checks.adapterFailures.changedLengthCanonicalCopyBlocked)fail("One or more rendered target-product negative cases did not trigger expected evidence.");
  if(failures.length)fail(`Target checks failed: ${failures.join(", ")}`);
  await writeFile(join(outputRoot,"target-product-evidence.json"),JSON.stringify({browser:provenance,checks},null,2));
  return checks;
}
