import {createHash, randomUUID} from "node:crypto";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import ts from "typescript";

const catalogPath = ".agents/skills/storyboard-enhance/references/shotcraft/catalog.json";
const indexPath = ".agents/skills/storyboard-enhance/references/shotcraft/search-index.json";
const importedRoot = "third-party/video-shotcraft/source";
const importedManifestPath = "third-party/video-shotcraft/SOURCE.json";
const digest = value => createHash("sha256").update(value).digest("hex");
const isRecord = value => typeof value === "object" && value !== null && !Array.isArray(value);
const posix = value => value.split(sep).join("/");
const componentNamePattern = /^[A-Za-z_$][\w$]*$/;

function assertSourcePath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes(":") || value.startsWith("/") || value.split("/").some(part => !part || part === "." || part === "..")) throw new Error(`Unsafe Shotcraft source path: ${String(value)}`);
  return value;
}

function sceneText(project, scene, key) {
  if (key === "project.meta.title") return project.meta?.title;
  if (key === "scene.screenText") return scene.screenText;
  if (key === "scene.audio.voiceoverText") return scene.audio?.voiceoverText;
  throw new Error(`Canonical text key '${key}' is not supported.`);
}

function checkBindings({bindings, scene, project, manifest, sceneId, closure}) {
  if (!isRecord(bindings) || !Array.isArray(bindings.assets) || !Array.isArray(bindings.text) || !Array.isArray(bindings.palette) || !Array.isArray(bindings.targets)) throw new Error("Bindings require sourceDemo, componentExport, integrationMarker, assets, text, palette, and targets.");
  if(typeof bindings.componentExport!=="string"||!componentNamePattern.test(bindings.componentExport))throw new Error("Bindings require an explicit componentExport identifier.");
  if(bindings.integrationMarker!==`shotcraft-slot:${sceneId}`)throw new Error(`Bindings require the exact integrationMarker 'shotcraft-slot:${sceneId}'.`);
  if (/https?:\/\//i.test(JSON.stringify(bindings))) throw new Error("Bindings cannot contain remote media URLs.");
  const seen = new Set();
  for (const item of bindings.assets) {
    if (!isRecord(item) || typeof item.target !== "string" || typeof item.assetId !== "string" || typeof item.role !== "string" || typeof item.sourcePath!=="string" || typeof item.sourceValue!=="string") throw new Error("Each asset binding requires target, assetId, role, sourcePath, and sourceValue.");
    if(!closure.includes(item.sourcePath))throw new Error(`Asset target '${item.target}' sourcePath is outside the selected closure.`);
    if (seen.has(`asset:${item.target}`)) throw new Error(`Duplicate asset binding target '${item.target}'.`);
    seen.add(`asset:${item.target}`);
    const asset = manifest.assets.find(entry => entry.id === item.assetId);
    if (!asset) throw new Error(`Binding '${item.target}' references missing asset '${item.assetId}'.`);
    if (asset.role !== item.role || !Array.isArray(asset.sceneIds) || !asset.sceneIds.includes(sceneId)) throw new Error(`Asset '${item.assetId}' scene/role mismatch for scene '${sceneId}' and role '${item.role}'.`);
    if (!asset.publicPath?.startsWith("/assets/") || asset.publicPath.includes("..") || asset.publicPath.includes("\\")) throw new Error(`Asset '${item.assetId}' is not an approved local manifest asset.`);
  }
  for (const item of bindings.text) {
    if (!isRecord(item) || typeof item.target !== "string" || typeof item.canonicalKey !== "string" || typeof item.sourcePath!=="string" || typeof item.sourceValue!=="string") throw new Error("Each text binding requires target, sourcePath, sourceValue, and canonicalKey.");
    if(!closure.includes(item.sourcePath))throw new Error(`Text target '${item.target}' sourcePath is outside the selected closure.`);
    if (seen.has(`text:${item.target}`)) throw new Error(`Duplicate text binding target '${item.target}'.`);
    seen.add(`text:${item.target}`);
    const value = sceneText(project, scene, item.canonicalKey);
    if (typeof value !== "string" || !value.trim()) throw new Error(`Canonical text key '${item.canonicalKey}' is missing or empty.`);
  }
  for (const item of bindings.palette) {
    if (!isRecord(item) || typeof item.target !== "string" || typeof item.token !== "string" || typeof item.sourcePath!=="string" || typeof item.sourceValue!=="string") throw new Error("Each palette binding requires target, sourcePath, sourceValue, and token.");
    if(!closure.includes(item.sourcePath))throw new Error(`Palette target '${item.target}' sourcePath is outside the selected closure.`);
    if (seen.has(`palette:${item.target}`)) throw new Error(`Duplicate palette binding target '${item.target}'.`);
    seen.add(`palette:${item.target}`);
    if (!project.meta?.theme?.palette?.includes(item.token)) throw new Error(`Palette token '${item.token}' is not present in the canonical project theme.`);
  }
  for(const target of bindings.targets){
    if(!isRecord(target)||typeof target.target!=="string"||typeof target.sourcePath!=="string"||!closure.includes(target.sourcePath)||!["remove_jsx_component","remove_text","canonical_expression_replace"].includes(target.kind))throw new Error("Each explicit target requires a supported kind, sourcePath, and target name inside the selected closure.");
    if(target.kind==="remove_jsx_component"&&typeof target.componentName!=="string")throw new Error(`Removal target '${target.target}' requires componentName.`);
    if(target.kind==="remove_text"&&typeof target.sourceValue!=="string")throw new Error(`Removal target '${target.target}' requires sourceValue.`);
    if(target.kind==="canonical_expression_replace"&&(typeof target.sourceExpression!=="string"||typeof target.canonicalKey!=="string"))throw new Error(`Expression target '${target.target}' requires sourceExpression and canonicalKey.`);
  }
}

function resolveBindings(bindings, scene, project, manifest) {
  return {
    assets: bindings.assets.map(item => { const asset=manifest.assets.find(entry=>entry.id===item.assetId); return {target:item.target,assetId:asset.id,role:item.role,publicPath:asset.publicPath}; }),
    text: bindings.text.map(item => ({target:item.target,canonicalKey:item.canonicalKey,value:sceneText(project,scene,item.canonicalKey)})),
    palette: bindings.palette.map(item => ({target:item.target,token:item.token})),
  };
}

export function resolveSelectedDemo(variant, sourceDemo) {
  const candidates=variant?.source?.demo;
  if(!Array.isArray(candidates)||!candidates.length)throw new Error("Selected variant has no exact source demo mapping.");
  const selected=sourceDemo??(candidates.length===1?candidates[0]:undefined);
  if(!selected&&candidates.length>1)throw new Error("This card reference maps multiple demos; an explicit sourceDemo binding is required.");
  if(!candidates.includes(selected))throw new Error(`sourceDemo '${String(selected)}' is not an exact demo path in the selected variant mapping.`);
  return assertSourcePath(selected);
}

function parseTsx(sourcePath,source) {
  return ts.createSourceFile(sourcePath,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
}

function constantMap(sourceFile) {
  const map=new Map();
  for(const statement of sourceFile.statements){
    if(!ts.isVariableStatement(statement))continue;
    for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name)&&declaration.initializer)map.set(declaration.name.text,declaration.initializer);
  }
  return map;
}

function evaluateConstant(node,constants,stack=new Set()) {
  if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isTypeAssertionExpression(node))return evaluateConstant(node.expression,constants,stack);
  if(ts.isNumericLiteral(node))return Number(node.text);
  if(ts.isPrefixUnaryExpression(node)&&(node.operator===ts.SyntaxKind.MinusToken||node.operator===ts.SyntaxKind.PlusToken)){const value=evaluateConstant(node.operand,constants,stack);return node.operator===ts.SyntaxKind.MinusToken?-value:value;}
  if(ts.isIdentifier(node)){
    if(stack.has(node.text)||!constants.has(node.text))throw new Error(`Duration expression uses unresolved constant '${node.text}'.`);
    const next=new Set(stack);next.add(node.text);return evaluateConstant(constants.get(node.text),constants,next);
  }
  if(ts.isPropertyAccessExpression(node)&&node.name.text==="length"&&ts.isIdentifier(node.expression)){
    const value=constants.get(node.expression.text);
    if(value&&ts.isArrayLiteralExpression(value))return value.elements.length;
    throw new Error(`Duration expression uses unresolved array length '${node.expression.text}.length'.`);
  }
  if(ts.isBinaryExpression(node)){
    const left=evaluateConstant(node.left,constants,stack),right=evaluateConstant(node.right,constants,stack);
    switch(node.operatorToken.kind){case ts.SyntaxKind.PlusToken:return left+right;case ts.SyntaxKind.MinusToken:return left-right;case ts.SyntaxKind.AsteriskToken:return left*right;case ts.SyntaxKind.SlashToken:return left/right;case ts.SyntaxKind.PercentToken:return left%right;default:break;}
  }
  throw new Error("Duration expression is not statically resolvable.");
}

export async function resolveShotDuration(sourceRoot,sourceDemo) {
  const path=assertSourcePath(sourceDemo),source=await readFile(resolve(sourceRoot,path),"utf8"),file=parseTsx(path,source),constants=constantMap(file),candidates=[];
  for(const statement of file.statements){
    if(!ts.isVariableStatement(statement)||!statement.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword))continue;
    for(const declaration of statement.declarationList.declarations){
      if(!ts.isIdentifier(declaration.name)||!/(?:DUR|DURATION)(?:_IN_FRAMES)?$/i.test(declaration.name.text)||!declaration.initializer)continue;
      candidates.push({name:declaration.name.text,initializer:declaration.initializer});
    }
  }
  if(candidates.length!==1)throw new Error(`Selected demo '${path}' has ${candidates.length} explicit exported duration values; exact action duration is ambiguous.`);
  const frames=evaluateConstant(candidates[0].initializer,constants);
  if(!Number.isInteger(frames)||frames<1)throw new Error(`Selected demo '${path}' duration '${candidates[0].name}' did not resolve to a positive integer frame count.`);
  return frames;
}

export async function validateShotBudget(sourceRoot,sourceDemo,scene) {
  const frames=await resolveShotDuration(sourceRoot,sourceDemo);
  if(frames>scene.durationInFrames)throw new Error(`Canonical scene budget ${scene.durationInFrames} frames cannot contain the original action arc of ${frames} frames; choose a shot that fits this scene.`);
  return frames;
}

function editsForTarget(sourceFile,source,sourcePath,target,matchNode,renderReplacement) {
  const hits=[];
  const visit=node=>{if(matchNode(node))hits.push(node);ts.forEachChild(node,visit);};visit(sourceFile);
  let selected;
  if(target.occurrence!==undefined){if(!Number.isInteger(target.occurrence)||target.occurrence<0||target.occurrence>=hits.length)throw new Error(`${target.kind} target '${target.target}' occurrence ${target.occurrence} in '${sourcePath}' is out of range (${hits.length} matches).`);selected=hits[target.occurrence];}
  else {if(hits.length!==1)throw new Error(`${target.kind} target '${target.target}' in '${sourcePath}' matched ${hits.length} times; exactly one source target is required or provide occurrence.`);selected=hits[0];}
  const node=selected,replacement=renderReplacement(node);
  return {start:node.getStart(sourceFile),end:node.end,replacement,diff:{kind:target.kind,target:target.target,sourcePath,sourceText:source.slice(node.getStart(sourceFile),node.end),generatedText:replacement}};
}

export function adaptSourceFile({sourcePath,source,bindings,scene,project,manifest}) {
  const file=parseTsx(sourcePath,source),edits=[];
  for(const binding of bindings.text??[]){
    if(binding.sourcePath!==sourcePath)continue;
    const value=sceneText(project,scene,binding.canonicalKey);
    if(String(value).length!==binding.sourceValue.length)throw new Error(`Text target '${binding.target}' changes the source text length and may alter its per-character motion; choose an equal-length canonical target or another shot.`);
    const match=node=>(ts.isJsxText(node)&&node.getText(file).trim()===binding.sourceValue)||((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))&&node.text===binding.sourceValue);
    edits.push(editsForTarget(file,source,sourcePath,{...binding,kind:"canonical_text_replace"},match,node=>{
      if(ts.isJsxText(node)){
        const raw=source.slice(node.getStart(file),node.end),leading=raw.match(/^\s*/)?.[0]??"",trailing=raw.match(/\s*$/)?.[0]??"";
        return `${leading}${String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}${trailing}`;
      }
      if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return JSON.stringify(value);
      throw new Error(`Text target '${binding.target}' is not a JSX text or string literal.`);
    }));
  }
  for(const binding of bindings.assets??[]){
    if(binding.sourcePath!==sourcePath)continue;
    const asset=manifest.assets.find(entry=>entry.id===binding.assetId),localPath=asset.publicPath.slice("/".length);
    edits.push(editsForTarget(file,source,sourcePath,{...binding,kind:"approved_asset_staticFile"},node=>ts.isStringLiteral(node)&&node.text===binding.sourceValue&&ts.isCallExpression(node.parent)&&ts.isIdentifier(node.parent.expression)&&node.parent.expression.text==="staticFile"&&node.parent.arguments.length===1,()=>JSON.stringify(localPath)));
  }
  for(const binding of bindings.palette??[]){
    if(binding.sourcePath!==sourcePath)continue;
    edits.push(editsForTarget(file,source,sourcePath,{...binding,kind:"canonical_palette_token"},node=>(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))&&node.text===binding.sourceValue,()=>JSON.stringify(binding.token)));
  }
  for(const target of bindings.targets??[]){
    if(target.sourcePath!==sourcePath)continue;
    if(target.kind==="remove_jsx_component"){
      edits.push(editsForTarget(file,source,sourcePath,target,node=>{
        const name=ts.isJsxElement(node)?node.openingElement.tagName:node.tagName;
        return (ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node))&&name.getText(file)===target.componentName;
      },()=>"{null}"));
    } else if(target.kind==="remove_text") {
      edits.push(editsForTarget(file,source,sourcePath,target,node=>(ts.isJsxText(node)&&node.getText(file).trim()===target.sourceValue)||(ts.isStringLiteral(node)&&node.text===target.sourceValue),()=>""));
    } else if(target.kind==="canonical_expression_replace") {
      const value=sceneText(project,scene,target.canonicalKey);
      if(typeof value!=="string"||!value.trim())throw new Error(`Canonical text key '${target.canonicalKey}' is missing or empty.`);
      edits.push(editsForTarget(file,source,sourcePath,target,node=>ts.isPropertyAccessExpression(node)&&node.getText(file)===target.sourceExpression,()=>JSON.stringify(value)));
    } else throw new Error(`Unsupported explicit target kind '${target.kind}'.`);
  }
  const ordered=edits.filter(Boolean).sort((a,b)=>b.start-a.start);
  for(let i=1;i<ordered.length;i++)if(ordered[i-1].start<ordered[i].end)throw new Error(`Overlapping Shotcraft source targets in '${sourcePath}' are not allowed.`);
  let output=source;
  for(const edit of ordered)output=output.slice(0,edit.start)+edit.replacement+output.slice(edit.end);
  return {source:output,diffs:edits.filter(Boolean).map(({diff})=>diff)};
}

export function integrateSelectedScene({source,sceneId,modulePath,componentExport}) {
  if(!componentNamePattern.test(componentExport??""))throw new Error("Selected demo componentExport must be a valid exported component identifier.");
  if(typeof modulePath!=="string"||!modulePath.startsWith("./shotcraft/")||modulePath.includes(".."))throw new Error("Selected Shotcraft import must remain under generated/shotcraft.");
  const marker=`{/* shotcraft-slot:${sceneId} */}`,count=source.split(marker).length-1;
  if(count!==1)throw new Error(`Canonical scene integration slot '${sceneId}' matched ${count} times; exactly one slot is required.`);
  const file=parseTsx("GeneratedVideo.tsx",source),markerIndex=source.indexOf(marker),wrappers=[];
  const visit=node=>{if(ts.isJsxElement(node)&&node.getStart(file)<=markerIndex&&node.end>=markerIndex){const attr=node.openingElement.attributes.properties.find(item=>ts.isJsxAttribute(item)&&item.name.text==="data-scene-id");if(attr&&ts.isJsxAttribute(attr)&&attr.initializer&&ts.isJsxExpression(attr.initializer)&&ts.isPropertyAccessExpression(attr.initializer.expression)&&attr.initializer.expression.name.text==="id"&&ts.isIdentifier(attr.initializer.expression.expression))wrappers.push({node,sceneVariable:attr.initializer.expression.expression.text});}ts.forEachChild(node,visit);};visit(file);
  const wrapper=wrappers.sort((a,b)=>(a.node.end-a.node.getStart(file))-(b.node.end-b.node.getStart(file)))[0];
  if(!wrapper)throw new Error(`Shotcraft slot '${sceneId}' is not inside a runtime scene identity wrapper.`);
  let sceneScopeProven=false,sceneMapCallback;
  for(let ancestor=wrapper.node.parent;ancestor;ancestor=ancestor.parent){
    if(!ts.isCallExpression(ancestor)||!ts.isPropertyAccessExpression(ancestor.expression)||ancestor.expression.name.text!=="map"||ancestor.expression.expression.getText(file)!=="project.scenes")continue;
    const callback=ancestor.arguments[0],parameter=callback&&(ts.isArrowFunction(callback)||ts.isFunctionExpression(callback))?callback.parameters[0]?.name:undefined;
    if(ts.isIdentifier(parameter)&&parameter.text===wrapper.sceneVariable){sceneScopeProven=true;sceneMapCallback=callback;}
    break;
  }
  if(!sceneScopeProven)throw new Error(`Shotcraft slot '${sceneId}' must be inside project.scenes.map() and use that callback's scene ID wrapper.`);
  const bindingHasSceneName=name=>ts.isIdentifier(name)?name.text===wrapper.sceneVariable:ts.isObjectBindingPattern(name)||ts.isArrayBindingPattern(name)?name.elements.some(element=>!ts.isOmittedExpression(element)&&bindingHasSceneName(ts.isBindingElement(element)?element.name:element)):false;
  let shadowed=false;
  const inspectDeclarations=node=>{
    let name;
    if(ts.isVariableDeclaration(node)||ts.isParameter(node)||ts.isBindingElement(node))name=node.name;
    else if(ts.isFunctionDeclaration(node)||ts.isFunctionExpression(node)||ts.isClassDeclaration(node)||ts.isClassExpression(node)||ts.isEnumDeclaration(node)||ts.isModuleDeclaration(node))name=node.name;
    else if(ts.isCatchClause(node))name=node.variableDeclaration?.name;
    if(name&&bindingHasSceneName(name))shadowed=true;
    ts.forEachChild(node,inspectDeclarations);
  };
  inspectDeclarations(sceneMapCallback.body);
  if(shadowed)throw new Error(`Shotcraft scene variable '${wrapper.sceneVariable}' is shadowed in its canonical map callback; target binding cannot be proven.`);
  const safeId=sceneId.replace(/[^A-Za-z0-9_$]/g,"_");
  const importLine=`import { ${componentExport} as Shotcraft_${safeId} } from ${JSON.stringify(modulePath)};`;
  if(source.includes(importLine)||source.includes(`Shotcraft_${safeId}`))throw new Error(`GeneratedVideo already contains Shotcraft integration for scene '${sceneId}'.`);
  const imports=[...source.matchAll(/^import .*;\s*$/gm)],insertAt=imports.length?imports.at(-1).index+imports.at(-1)[0].length:0;
  const withImport=source.slice(0,insertAt)+`\n${importLine}`+source.slice(insertAt);
  const generatedSlot=`{${wrapper.sceneVariable}.id === ${JSON.stringify(sceneId)} ? <Shotcraft_${safeId} /> : null}`;
  return {source:withImport.replace(marker,generatedSlot),diffs:[
    {kind:"generated_video_import",sourcePath:"remotion/generated/Video.tsx",target:`scene:${sceneId}`,sourceText:"",generatedText:importLine},
    {kind:"canonical_scene_slot_bind",sourcePath:"remotion/generated/Video.tsx",target:`scene:${sceneId}`,sourceText:marker,generatedText:generatedSlot},
  ]};
}

async function resolveImport(sourceRoot, importer, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(sourceRoot, dirname(importer), specifier);
  for (const candidate of [base, ...[".tsx", ".ts", ".jsx", ".js"].map(ext => `${base}${ext}`), join(base, "index.tsx"), join(base, "index.ts")]) {
    try { return {path: posix(relative(sourceRoot, candidate)), bytes: await readFile(candidate)}; } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return undefined;
}

async function resolveSelectedClosure(sourceRoot,entry) {
  const files=new Set();
  const visit=async path=>{
    if(files.has(path))return;
    const safe=assertSourcePath(path),source=await readFile(resolve(sourceRoot,safe),"utf8");files.add(safe);
    const imports=[...source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(match=>match[1]).filter(specifier=>specifier.startsWith("."));
    for(const specifier of imports){const resolved=await resolveImport(sourceRoot,safe,specifier);if(!resolved)throw new Error(`Selected demo '${safe}' has unresolved dependency '${specifier}'.`);await visit(resolved.path);}
  };
  await visit(entry);return [...files].sort();
}

async function resolveRenderedCopyNodes({sourceRoot,sourceDemo,componentExport,closure,sourceTextByPath}) {
  const parsed=new Map(closure.map(path=>[path,parseTsx(path,sourceTextByPath.get(path))])),declarations=new Map(),imports=new Map(),nodesByPath=new Map(),pending=[{path:sourceDemo,name:componentExport}],visited=new Set();
  for(const [path,file] of parsed){
    const local=new Map();
    for(const statement of file.statements){
      if(ts.isVariableStatement(statement)){for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name))local.set(declaration.name.text,declaration);}
      else if((ts.isFunctionDeclaration(statement)||ts.isClassDeclaration(statement))&&statement.name)local.set(statement.name.text,statement);
    }
    declarations.set(path,local);
    const names=new Map();
    for(const statement of file.statements){
      if(!ts.isImportDeclaration(statement)||!ts.isStringLiteral(statement.moduleSpecifier)||!ts.isImportClause(statement.importClause))continue;
      const specifier=statement.moduleSpecifier.text;if(!specifier.startsWith("."))continue;
      const imported=await resolveImport(sourceRoot,path,specifier);if(!imported||!parsed.has(imported.path))continue;
      const named=statement.importClause.namedBindings;
      if(named&&ts.isNamedImports(named))for(const element of named.elements)names.set(element.name.text,{path:imported.path,name:(element.propertyName??element.name).text});
      else if(named&&ts.isNamespaceImport(named))names.set(named.name.text,{path:imported.path,namespace:true});
      if(statement.importClause.name)names.set(statement.importClause.name.text,{path:imported.path,name:"default"});
    }
    imports.set(path,names);
  }
  const declarationFor=(path,name)=>{
    const local=declarations.get(path)?.get(name);if(local)return {path,name,node:local};
    const imported=imports.get(path)?.get(name);if(!imported||imported.namespace)return undefined;
    const target=declarations.get(imported.path)?.get(imported.name);return target?{path:imported.path,name:imported.name,node:target}:undefined;
  };
  const declarationForTag=(path,tag)=>{
    if(ts.isIdentifier(tag))return declarationFor(path,tag.text);
    if(ts.isPropertyAccessExpression(tag)&&ts.isIdentifier(tag.expression)){
      const imported=imports.get(path)?.get(tag.expression.text);
      if(imported?.namespace){const target=declarations.get(imported.path)?.get(tag.name.text);return target?{path:imported.path,name:tag.name.text,node:target}:undefined;}
    }
    return undefined;
  };
  const canonicalTagName=(path,tag,stack=new Set())=>{
    if(ts.isIdentifier(tag)){
      if(stack.has(`${path}:${tag.text}`))return tag.text;
      const next=new Set(stack);next.add(`${path}:${tag.text}`);
      const imported=imports.get(path)?.get(tag.text);if(imported&&!imported.namespace)return imported.name;
      const local=declarations.get(path)?.get(tag.text);
      if(local&&ts.isVariableDeclaration(local)&&local.initializer&&(ts.isIdentifier(local.initializer)||ts.isPropertyAccessExpression(local.initializer)))return canonicalTagName(path,local.initializer,next);
      return tag.text;
    }
    if(ts.isPropertyAccessExpression(tag)&&ts.isIdentifier(tag.expression)){
      const imported=imports.get(path)?.get(tag.expression.text);if(imported?.namespace)return tag.name.text;
    }
    return tag.getText(parsed.get(path));
  };
  const brandUses=[];
  while(pending.length){
    const item=pending.pop(),key=`${item.path}:${item.name}`;if(visited.has(key))continue;visited.add(key);
    const resolved=declarationFor(item.path,item.name);if(!resolved)continue;
    const list=nodesByPath.get(resolved.path)??[];list.push(resolved.node);nodesByPath.set(resolved.path,list);
    const file=parsed.get(resolved.path);
    const scan=node=>{
      const tag=ts.isJsxElement(node)?node.openingElement.tagName:ts.isJsxSelfClosingElement(node)?node.tagName:undefined;
      if(tag){
        const canonicalName=canonicalTagName(resolved.path,tag);
        if(["ShotcraftMark","ShotcraftWordmark"].includes(canonicalName))brandUses.push({sourcePath:resolved.path,componentName:tag.getText(file),brandName:canonicalName});
        const child=declarationForTag(resolved.path,tag);if(child)pending.push({path:child.path,name:child.name});
      }
      if(ts.isIdentifier(node)){
        const child=declarationFor(resolved.path,node.text);if(child&&child.node!==resolved.node)pending.push({path:child.path,name:child.name});
      }
      ts.forEachChild(node,scan);
    };scan(resolved.node);
  }
  return {rendered:[...nodesByPath].map(([sourcePath,nodes])=>({sourcePath,sourceText:sourceTextByPath.get(sourcePath),nodes})),brandUses};
}

function hasExport(sourceFile,name) {
  return sourceFile.statements.some(statement=>{
    if(ts.isVariableStatement(statement)&&statement.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword))return statement.declarationList.declarations.some(declaration=>ts.isIdentifier(declaration.name)&&declaration.name.text===name);
    return (ts.isFunctionDeclaration(statement)||ts.isClassDeclaration(statement))&&statement.name?.text===name&&statement.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword);
  });
}

function validateRequiredSourceTargets({closure,sourceTextByPath,bindings}) {
  for(const path of closure){
    const source=sourceTextByPath.get(path),file=parseTsx(path,source),staticFiles=[];
    const visit=node=>{
      const content=ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isJsxText(node)?(ts.isJsxText(node)?node.getText(file).trim():node.text):"";
      if(/^https?:\/\//i.test(content))throw new Error(`Remote media/resource URL is not allowed in selected Shotcraft source '${path}'. Bind approved local manifest assets instead.`);
      if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==="staticFile"){
        if(node.arguments.length!==1||!ts.isStringLiteral(node.arguments[0]))throw new Error(`Selected Shotcraft source '${path}' contains a dynamic staticFile() argument '${node.arguments.map(argument=>argument.getText(file)).join(", ")}'; resolve it to explicit approved asset bindings before preparation.`);
        staticFiles.push(node.arguments[0].text);
      }
      ts.forEachChild(node,visit);
    };visit(file);
    for(const value of new Set(staticFiles)){
      const count=staticFiles.filter(candidate=>candidate===value).length,bound=bindings.assets.filter(item=>item.sourcePath===path&&item.sourceValue===value);
      if(count!==bound.length)throw new Error(`Shotcraft local media target '${value}' in '${path}' requires one exact approved asset binding per callsite; repeated or unbound targets block preparation.`);
      if(count>1){const occurrences=bound.map(item=>item.occurrence).sort((a,b)=>a-b);if(occurrences.some((value,index)=>!Number.isInteger(value)||value!==index))throw new Error(`Repeated local media target '${value}' in '${path}' requires distinct occurrence values from 0 to ${count-1}.`);}
    }
  }
}

function validateReachedBrandTargets(brandUses,bindings) {
  for(const {sourcePath,componentName,brandName} of brandUses)if(!bindings.targets.some(item=>item.sourcePath===sourcePath&&item.kind==="remove_jsx_component"&&item.componentName===componentName))throw new Error(`Reached source retains sample branding component '${brandName}' at '${sourcePath}' (JSX tag '${componentName}'); add an explicit remove_jsx_component target or choose another demo.`);
}

function validateRequiredCopyTargets({sourcePath,sourceText,bindings,nodes=[parseTsx(sourcePath,sourceText)]}) {
  const file=parseTsx(sourcePath,sourceText),textBySource=bindings.text.filter(item=>item.sourcePath===sourcePath),targets=bindings.targets.filter(item=>item.sourcePath===sourcePath),copyProperties=new Set(["s","label","title","text","caption","headline","subtitle","description","placeholder","eyebrow","cta","value"]),unbound=[];
  const textBound=value=>textBySource.some(item=>item.sourceValue===value),textRemoved=value=>targets.some(item=>item.kind==="remove_text"&&item.sourceValue===value),expressionBound=value=>targets.some(item=>item.kind==="canonical_expression_replace"&&item.sourceExpression===value);
  const localBoundString=value=>{
    if(!ts.isIdentifier(value))return false;
    const declarationsFor=name=>{const declarations=[];const scan=node=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name)declarations.push(node);ts.forEachChild(node,scan);};scan(file);return declarations;};
    const seen=new Set();let name=value.text;
    while(!seen.has(name)){
      seen.add(name);const declarations=declarationsFor(name);if(declarations.length!==1)return false;
      const declaration=declarations[0],list=declaration.parent;
      if(!ts.isVariableDeclarationList(list)||!(list.flags&ts.NodeFlags.Const)||!declaration.initializer)return false;
      if(ts.isStringLiteral(declaration.initializer)||ts.isNoSubstitutionTemplateLiteral(declaration.initializer))return textBound(declaration.initializer.text)||textRemoved(declaration.initializer.text);
      if(!ts.isIdentifier(declaration.initializer))return false;
      name=declaration.initializer.text;
    }
    return false;
  };
  const containsJsx=node=>{let found=false;const inspect=child=>{if(ts.isJsxElement(child)||ts.isJsxSelfClosingElement(child)){found=true;return;}if(!found)ts.forEachChild(child,inspect);};inspect(node);return found;};
  const isChildrenLayoutSlot=expression=>{
    const isFunctionLike=node=>ts.isArrowFunction(node)||ts.isFunctionExpression(node)||ts.isFunctionDeclaration(node)||ts.isMethodDeclaration(node)||ts.isGetAccessorDeclaration(node)||ts.isSetAccessorDeclaration(node);
    let owner=expression.parent;while(owner&&!isFunctionLike(owner))owner=owner.parent;
    if(!owner)return false;
    if(ts.isIdentifier(expression))return owner.parameters.some(parameter=>ts.isObjectBindingPattern(parameter.name)&&parameter.name.elements.some(element=>{
      const property=element.propertyName??element.name;
      return (ts.isIdentifier(property)||ts.isStringLiteral(property))&&property.text==="children"&&ts.isIdentifier(element.name)&&element.name.text===expression.text;
    }));
    return ts.isPropertyAccessExpression(expression)&&expression.name.text==="children"&&ts.isIdentifier(expression.expression)&&owner.parameters.some(parameter=>ts.isIdentifier(parameter.name)&&parameter.name.text===expression.expression.text);
  };
  const checkCopyExpression=node=>{
    if(containsJsx(node))return;
    const value=node.getText(file);
    if((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))&&!textBound(node.text)&&!textRemoved(node.text))unbound.push(node.text);
    else if((ts.isPropertyAccessExpression(node)||ts.isIdentifier(node)||ts.isCallExpression(node)||ts.isConditionalExpression(node)||ts.isBinaryExpression(node))&&!expressionBound(value)&&!localBoundString(node))unbound.push(value);
  };
  const visit=node=>{
    if(ts.isJsxText(node)){
      const value=node.getText(file).trim();if(value&&!textBound(value)&&!textRemoved(value))unbound.push(value);
    } else if(ts.isPropertyAssignment(node)){
      const key=ts.isIdentifier(node.name)||ts.isStringLiteral(node.name)?node.name.text:undefined;
      if(key&&copyProperties.has(key)){
        if(ts.isStringLiteral(node.initializer)&&!textBound(node.initializer.text)&&!textRemoved(node.initializer.text))unbound.push(node.initializer.text);
        if(ts.isPropertyAccessExpression(node.initializer)||ts.isIdentifier(node.initializer))checkCopyExpression(node.initializer);
      }
    } else if(ts.isJsxAttribute(node)&&node.initializer){
      if(ts.isStringLiteral(node.initializer)&&([...copyProperties,"alt","aria-label"].includes(node.name.text))){
        const value=node.initializer.text;if(!textBound(value)&&!textRemoved(value))unbound.push(value);
      } else if(ts.isJsxExpression(node.initializer)&&node.initializer.expression&&([...copyProperties,"alt","aria-label"].includes(node.name.text))){
        checkCopyExpression(node.initializer.expression);
      }
    } else if(ts.isJsxExpression(node)&&node.expression&&(ts.isJsxElement(node.parent)||ts.isJsxFragment(node.parent))&&node.parent.children.includes(node)){
      if(!isChildrenLayoutSlot(node.expression))checkCopyExpression(node.expression);
    }
    ts.forEachChild(node,visit);
  };for(const node of nodes)visit(node);
  if(unbound.length)throw new Error(`Selected rendered source '${sourcePath}' contains unbound sample copy targets (${[...new Set(unbound)].slice(0,5).join(", ")}); add explicit canonical text/removal targets or choose another demo.`);
}

async function validateDependencies({sourceRoot, closure, dependencyRoot}) {
  const closureSet = new Set(closure);
  for (const path of closure) {
    const source = (await readFile(resolve(sourceRoot, path))).toString("utf8");
    const imports = [...source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(match => match[1]);
    for (const specifier of imports) {
      if (specifier.startsWith(".")) {
        const dependency = await resolveImport(sourceRoot, path, specifier);
        if (!dependency || !closureSet.has(dependency.path)) throw new Error(`Selected Shotcraft closure is missing relative dependency '${specifier}' from '${path}'.`);
      } else if (!specifier.startsWith("node:")) {
        const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
        try { await readFile(resolve(dependencyRoot, "remotion/node_modules", packageName, "package.json")); }
        catch { throw new Error(`Selected Shotcraft closure requires dependency '${packageName}', which is absent from the pinned Remotion runtime.`); }
      }
    }
  }
}

export async function validateShotcraftPreparation(input) {
  const {root, card, variant, sceneId, project, manifest, bindings, gates} = input;
  if (!gates || gates.renderer !== "remotion" || gates.rendererAuthorized !== true) throw new Error("Remotion renderer must be selected by the host-authorized renderer gate.");
  if (gates.assetsApproved !== true) throw new Error("Host-approved production asset preflight is required before Shotcraft materialization.");
  if (gates.authoringApproved !== true) throw new Error("Approved Script and Storyboard authoring gates are required before Shotcraft materialization.");
  const outputRelative = posix(input.outputRelative ?? `remotion/generated/shotcraft/${sceneId}`);
  if (!outputRelative.startsWith("remotion/generated/shotcraft/") || outputRelative.split("/").some(part => part === "..")) throw new Error("Shotcraft output must be under remotion/generated/shotcraft.");
  if (!Array.isArray(project?.scenes) || !Array.isArray(manifest?.assets)) throw new Error("Canonical video.json and assets manifest are required.");
  const scene = project.scenes.find(item => item.id === sceneId);
  if (!scene) throw new Error(`Canonical scene '${sceneId}' does not exist.`);
  if (!card || !variant || !Array.isArray(variant.source?.demo) || !Array.isArray(variant.source?.closure) || !variant.source.closure.length) throw new Error("Exact Shotcraft card and variant metadata are required.");
  if (!variant.source.closure.every(path => assertSourcePath(path)) || !variant.source.demo.every(path => variant.source.closure.includes(path))) throw new Error("Selected Shotcraft source closure must include its exact demo entry files.");
  const sourceRoot = resolve(input.sourceFilesRoot ?? input.sourceRoot ?? resolve(root, importedRoot));
  const selectedDemo=resolveSelectedDemo(variant,bindings?.sourceDemo),selectedBindings={...bindings,sourceDemo:selectedDemo};
  const closure=await resolveSelectedClosure(sourceRoot,selectedDemo);
  if(!closure.every(path=>variant.source.closure.includes(path)))throw new Error("Selected demo dependency closure is not covered by the imported catalog closure.");
  checkBindings({bindings:selectedBindings, scene, project, manifest, sceneId, closure});
  if(!Number.isInteger(project.meta?.durationsInFrames)||project.scenes.reduce((sum,item)=>sum+item.durationInFrames,0)!==project.meta.durationsInFrames)throw new Error("Canonical scene identity/order/frame budgets do not sum to meta.durationsInFrames.");
  if(!/^[A-Za-z0-9_-]+$/.test(sceneId))throw new Error(`Canonical scene ID '${sceneId}' cannot be used in a generated import path.`);
  const selectedSource=await readFile(resolve(sourceRoot,selectedDemo),"utf8"),selectedFile=parseTsx(selectedDemo,selectedSource);
  if(!hasExport(selectedFile,selectedBindings.componentExport))throw new Error(`Selected source demo '${selectedDemo}' does not export component '${selectedBindings.componentExport}'.`);
  const actionDurationInFrames=await validateShotBudget(sourceRoot,selectedDemo,scene);
  await validateDependencies({sourceRoot, closure, dependencyRoot: resolve(input.dependencyRoot ?? root)});
  const sourceTextByPath=new Map();for(const path of closure)sourceTextByPath.set(path,await readFile(resolve(sourceRoot,path),"utf8"));
  validateRequiredSourceTargets({closure,sourceTextByPath,bindings:selectedBindings});
  const renderedCopyNodes=await resolveRenderedCopyNodes({sourceRoot,sourceDemo:selectedDemo,componentExport:selectedBindings.componentExport,closure,sourceTextByPath});
  validateReachedBrandTargets(renderedCopyNodes.brandUses,selectedBindings);
  for(const rendered of renderedCopyNodes.rendered)validateRequiredCopyTargets({...rendered,bindings:selectedBindings});
  const files = [];
  for (const path of closure) {
    const bytes = await readFile(resolve(sourceRoot, path)),source=sourceTextByPath.get(path);
    const adapted=adaptSourceFile({sourcePath:path,source,bindings:selectedBindings,scene,project,manifest});
    files.push({path,sourceBytes:bytes,bytes:Buffer.from(adapted.source),sha256:digest(bytes),generatedSha256:digest(adapted.source),diffs:adapted.diffs});
  }
  if (input.sourceManifestPath) {
    const sourceManifest = JSON.parse(await readFile(input.sourceManifestPath, "utf8"));
    for (const file of files) {
      const recorded = sourceManifest.files?.find(item => item.path === file.path);
      if (!recorded || recorded.sha256 !== file.sha256) throw new Error(`Imported Shotcraft source checksum mismatch for '${file.path}'.`);
    }
  }
  if(typeof input.generatedVideoSource!=="string")throw new Error("GeneratedVideo source is required to bind the selected demo into its canonical scene slot.");
  const demoModule=`./shotcraft/${sceneId}/${selectedDemo.replace(/\.(?:tsx?|jsx?)$/i,"")}`;
  const integration=integrateSelectedScene({source:input.generatedVideoSource,sceneId,modulePath:demoModule,componentExport:selectedBindings.componentExport});
  return {root: resolve(root), scene, project, manifest, bindings:selectedBindings, files, sourceRoot, outputRelative, actionDurationInFrames,selectedDemo,demoModule,generatedVideo:integration.source,generatedVideoDiffs:integration.diffs,generatedVideoSource:input.generatedVideoSource,projectHash:digest(JSON.stringify(project)),sceneOrder:project.scenes.map(item=>item.id),sceneFrameBudget:project.meta.durationsInFrames};
}

export async function prepareShotcraft(root, options) {
  const p = resolve(root);
  const gates = await loadHostGates(p);
  const [catalog, index, project, manifest, bindings, generatedVideoSource] = await Promise.all([
    readFile(resolve(p, catalogPath), "utf8").then(JSON.parse),
    readFile(resolve(p, indexPath), "utf8").then(JSON.parse),
    readFile(resolve(p, "video.json"), "utf8").then(JSON.parse),
    readFile(resolve(p, "assets/manifest.json"), "utf8").then(JSON.parse),
    readFile(resolve(p, options.bindings), "utf8").then(JSON.parse),
    readFile(resolve(p,"remotion/generated/Video.tsx"),"utf8"),
  ]);
  const card = catalog.cards.find(item => item.id === options.cardId);
  if (!card) throw new Error(`Shotcraft card not found: ${options.cardId}`);
  const variant = card.variants.find(item => item.id === options.variantKey);
  if (!variant) throw new Error(`Shotcraft variant not found for ${options.cardId}: ${options.variantKey}`);
  const indexed = index.cards.find(item => item.id === card.id);
  if (!indexed) throw new Error(`Shotcraft compact index has no exact card '${card.id}'.`);
  if (!indexed.variants?.some(item => item.id === variant.id)) throw new Error(`Shotcraft compact index has no exact variant '${variant.id}' for '${card.id}'.`);
  const validated = await validateShotcraftPreparation({root: p, card, variant, sceneId: options.sceneId, project, manifest, bindings, gates,
    generatedVideoSource,
    sourceFilesRoot: resolve(p, importedRoot), sourceManifestPath: resolve(p, importedManifestPath), dependencyRoot: p,
    outputRelative: `remotion/generated/shotcraft/${options.sceneId}`});
  return materializeValidatedShotcraft(validated, {card, variant, sceneId: options.sceneId, bindings, catalog});
}

/** Internal staging seam for tests; the CLI path always validates host gates first. */
export async function materializeValidatedShotcraft(validated, {card, variant, sceneId, bindings, catalog}) {
  const p = validated.root;
  const target = resolve(p, validated.outputRelative);
  const generatedRoot = resolve(p, "remotion/generated");
  const fromGenerated = relative(generatedRoot, target);
  if (fromGenerated.startsWith("..") || fromGenerated === "" || fromGenerated.split(sep).includes("..")) throw new Error("Shotcraft output escapes remotion/generated.");
  try { await readFile(resolve(target, "selection.json")); throw new Error(`Shotcraft output already exists: ${validated.outputRelative}`); }
  catch (error) { if (error.message.startsWith("Shotcraft output already exists")) throw error; if (error.code !== "ENOENT") throw error; }
  const videoPath=resolve(generatedRoot,"Video.tsx"),currentVideo=await readFile(videoPath,"utf8");
  if(currentVideo!==validated.generatedVideoSource)throw new Error("GeneratedVideo changed after Shotcraft integration was validated; retry against the current scene source.");
  const stage = resolve(generatedRoot, `.shotcraft-${randomUUID()}`);
  const backup=resolve(generatedRoot,`.shotcraft-video-backup-${randomUUID()}`);
  let targetInstalled=false,videoBackedUp=false;
  try {
    await mkdir(stage, {recursive: true});
    const records = [];
    for (const file of validated.files) {
      const destination = resolve(stage, file.path);
      await mkdir(dirname(destination), {recursive: true});
      let bytes = file.bytes;
      const changed = Array.isArray(file.diffs) && file.diffs.length > 0;
      if (changed && /\.(?:tsx?|jsx?)$/i.test(file.path)) {
        bytes = Buffer.concat([Buffer.from("// Modified from Apache-2.0 Video Shotcraft source; see adjacent SOURCE-NOTICE.md and selection.json for the source revision and change record.\n", "utf8"), bytes]);
      } else if (changed && /\.css$/i.test(file.path)) {
        bytes = Buffer.concat([Buffer.from("/* Modified from Apache-2.0 Video Shotcraft source; see adjacent SOURCE-NOTICE.md and selection.json for the source revision and change record. */\n", "utf8"), bytes]);
      } else if (changed && /\.html?$/i.test(file.path)) {
        bytes = Buffer.concat([Buffer.from("<!-- Modified from Apache-2.0 Video Shotcraft source; see adjacent SOURCE-NOTICE.md and selection.json for the source revision and change record. -->\n", "utf8"), bytes]);
      }
      await writeFile(destination, bytes, {flag: "wx"});
      records.push({sourcePath:file.path,generatedPath:posix(relative(stage,destination)),sourceSha256:file.sha256,generatedSha256:digest(await readFile(destination)),diffs:file.diffs});
      if (changed && !/\.(?:tsx?|jsx?|css|html?)$/i.test(file.path)) {
        const sidecar = `${destination}.NOTICE.md`;
        const notice = `# Modification notice\n\nThis file was modified from Apache-2.0 Video Shotcraft source. The source revision, original source hash, generated hash, and transformation details are recorded for ${file.path} in the adjacent selection.json.\n`;
        await writeFile(sidecar, notice, {flag: "wx"});
      }
    }
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const apacheLicense = await readFile(resolve(repositoryRoot, importedRoot, "LICENSE"), "utf8");
    const localSourceNotice = `# Shotcraft source and modification notice\n\nSelected source code is based on Vincentwei1021/video-shotcraft at commit ${catalog.sourceRevision}. The imported source closure, original and generated hashes, and adaptation diffs are recorded in selection.json. Modified source files carry a per-file notice; non-code files that cannot carry comments receive an adjacent .NOTICE.md sidecar.\n\nThe original PNG screenshot textures were replaced in this repository with deterministic abstract dashboard textures generated by scripts/generate-shotcraft-mock-textures.mjs. Local files retain the upstream file paths for compatibility; the hashes in the repository SOURCE.json identify the generated files and retain the original upstream hash separately.\n\nThe upstream Apache-2.0 license text is included in LICENSE. Separately bound production media remain governed by the applicable asset rights and license metadata.\n`;
    for (const [name, contents, sourcePath] of [["LICENSE", apacheLicense, "LICENSE"], ["SOURCE-NOTICE.md", localSourceNotice, "SOURCE-NOTICE.md"]]) {
      const destination = resolve(stage, name);
      await writeFile(destination, contents, {flag: "wx"});
      const bytes = Buffer.from(contents, "utf8");
      records.push({sourcePath,generatedPath:name,sourceSha256:digest(bytes),generatedSha256:digest(await readFile(destination)),diffs:[]});
    }
    const videoDiffs=validated.generatedVideoDiffs;
    const record = {version:"1",renderer:"remotion",card:{id:card.id,name:card.name},variant:{id:variant.id,label:variant.label},selectedDemo:validated.selectedDemo,componentExport:bindings.componentExport,sceneId,sceneOrder:validated.sceneOrder,sceneFrameBudget:validated.sceneFrameBudget,projectHash:validated.projectHash,actionDurationInFrames:validated.actionDurationInFrames,sceneDurationInFrames:validated.scene.durationInFrames,sourceRepo:catalog.sourceRepo,sourceRevision:catalog.sourceRevision,bindings:resolveBindings(bindings,validated.scene,validated.project,validated.manifest),files:records,generatedVideo:{path:"remotion/generated/Video.tsx",sourceSha256:digest(currentVideo),generatedSha256:digest(validated.generatedVideo),diffs:videoDiffs},compatibilityStatus:{status:"source_only",reason:"Generated component is integrated but has not been smoke-tested in the selected Remotion runtime.",evidence:null,runtimeVersion:null}};
    await writeFile(resolve(stage,".Video.tsx.new"),validated.generatedVideo,{flag:"wx"});
    await writeFile(resolve(stage,"selection.json"),`${JSON.stringify(record,null,2)}\n`,{flag:"wx"});
    await mkdir(dirname(target), {recursive:true});
    await rename(stage,target);
    targetInstalled=true;
    await rename(videoPath,backup);videoBackedUp=true;
    await rename(resolve(target,".Video.tsx.new"),videoPath);
    await rm(backup,{force:true});videoBackedUp=false;
    return {...record,files:records};
  } catch (error) {
    if(videoBackedUp){await rm(videoPath,{force:true});await rename(backup,videoPath).catch(()=>{});}
    if(targetInstalled)await rm(target,{recursive:true,force:true});
    await rm(stage,{recursive:true,force:true});await rm(backup,{force:true});throw error;
  }
}

async function loadHostGates(root) {
  const {preproductionHitlStatus} = await import("../dist/src/harness/preproduction-hitl.js");
  const {assertProductionAssetPreflightApproved} = await import("../dist/src/harness/production-preflight-hitl.js");
  const {selectedRenderer} = await import("../dist/src/harness/renderer.js");
  const {readRemotionState} = await import("../dist/src/harness/remotion.js");
  const authoring = await preproductionHitlStatus(root);
  if (authoring.ready !== true) throw new Error(`Approved authoring gates are not complete (${authoring.phase ?? "unknown"}).`);
  await assertProductionAssetPreflightApproved(root);
  const selection = await selectedRenderer(root);
  if (selection !== "remotion") throw new Error("Remotion renderer must be selected by the host-authorized renderer gate.");
  const renderer = await readRemotionState(root);
  if (renderer.phase !== "AUTHORING") throw new Error(`Remotion renderer must be in AUTHORING phase before Shotcraft preparation (found ${renderer.phase}).`);
  return {renderer:"remotion",rendererAuthorized:true,authoringApproved:true,assetsApproved:true};
}

function parseArgs(args) {
  const result = {};
  for (let index=0; index<args.length; index++) {
    const key=args[index];
    if (!["--variant","--scene","--bindings"].includes(key)) throw new Error(`Unknown option: ${key}`);
    const value=args[++index]; if (!value || value.startsWith("--")) throw new Error(`${key} requires a value.`);
    result[key.slice(2).replace("-","")] = value;
  }
  return result;
}

const usage=`Usage: npm run shotcraft:prepare -- <card-id> --variant <key> --scene <scene-id> --bindings <file.json>
Bindings file keys:
  sourceDemo (required when the selected card_reference maps multiple demos), componentExport, integrationMarker: "shotcraft-slot:<scene-id>"
  assets: [{target, sourcePath, sourceValue, assetId, role}]
  text: [{target, sourcePath, sourceValue, canonicalKey}]
  palette: [{target, sourcePath, sourceValue, token}]
  targets: [{target, sourcePath, kind: "remove_jsx_component", componentName} | {target, sourcePath, kind: "remove_text", sourceValue} | {target, sourcePath, kind: "canonical_expression_replace", sourceExpression, canonicalKey}]
Repeated identical source targets require an explicit zero-based occurrence.`;

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const args=process.argv.slice(2),separator=args.indexOf("--"),input=separator>=0?args.slice(separator+1):args;
    if (input.includes("--help")) console.log(usage);
    else {
      const cardId=input.find(value=>!value.startsWith("--"));
      if (!cardId) throw new Error(usage);
      const options=parseArgs(input.filter((value,index)=>index!==input.indexOf(cardId)));
      if (!options.variant || !options.scene || !options.bindings) throw new Error(`${usage}\nRequired: --variant, --scene, and --bindings.`);
      console.log(JSON.stringify(await prepareShotcraft(process.cwd(),{cardId,variantKey:options.variant,sceneId:options.scene,bindings:options.bindings}),null,2));
    }
  } catch(error) {
    const reason=error instanceof Error?error.message:String(error);
    console.error(JSON.stringify({error:`shotcraft:prepare failed: ${reason}`,compatibilityStatus:{status:"blocked",reason,evidence:null,runtimeVersion:null}},null,2));
    process.exitCode=1;
  }
}
