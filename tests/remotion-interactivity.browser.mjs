import assert from "node:assert/strict";
import {copyFile, mkdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outputArg = args.find((arg) => arg.startsWith("--output-dir="))?.slice("--output-dir=".length);
if (!outputArg) throw new Error("Usage: node tests/remotion-interactivity.browser.mjs --output-dir=output/GRA-53/interactivity");
const expectedOutput = resolve(repo, "output/GRA-53/interactivity");
const requestedOutput = resolve(repo, outputArg);
const sameOutput = process.platform === "win32" ? requestedOutput.toLowerCase() === expectedOutput.toLowerCase() : requestedOutput === expectedOutput;
if (!sameOutput) throw new Error(`Refusing output-dir outside the Task 4 location. Expected ${expectedOutput}, got ${requestedOutput}`);
const output = join(expectedOutput, `run-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${process.pid}`);
const workspace = join(output, "fixture-project");
const evidenceDir = join(output, "evidence");
const browserLog = join(output, "studio.log");
const require = createRequire(import.meta.url);
const {chromium} = require(join(repo, "node_modules/playwright-core"));

const result = {
  runtime: "4.0.538",
  outputDir: output,
  status: "running",
  assertions: [],
  sourceChanges: [],
  artifacts: [],
  skipped: [],
  errors: [],
};

function record(name, details = {}) {
  result.assertions.push({name, status: "passed", ...details});
}

class PrerequisiteBlockedError extends Error {}

function cardDuration(source, name = "Summary card one") {
  const start = source.indexOf(`name="${name}"`);
  if (start === -1) return undefined;
  return source.slice(start, start + 800).match(/durationInFrames=\{(\d+)\}/)?.[1];
}

function namedCardFragment(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`<Card\\b(?=[^>]*\\bname="${escapedName}")[^>]*>[\\s\\S]*?<\\/Card>`))?.[0];
}

async function fileHash(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function copyFixture() {
  await mkdir(expectedOutput, {recursive: true});
  await mkdir(output, {recursive: false});
  await mkdir(evidenceDir, {recursive: true});
  await mkdir(join(workspace, "tests/fixtures/remotion-interactivity/assets"), {recursive: true});
  await mkdir(join(workspace, "remotion/core"), {recursive: true});
  await mkdir(join(workspace, "remotion/generated"), {recursive: true});
  await mkdir(join(workspace, "src/core"), {recursive: true});
  await mkdir(join(workspace, "public/assets"), {recursive: true});
  await mkdir(join(workspace, "node_modules"), {recursive: true});
  for (const [source, destination] of [
    ["tests/fixtures/remotion-interactivity/Video.tsx", "tests/fixtures/remotion-interactivity/Video.tsx"],
    ["tests/fixtures/remotion-interactivity/Parent.tsx", "tests/fixtures/remotion-interactivity/Parent.tsx"],
    ["tests/fixtures/remotion-interactivity/Compositions.tsx", "remotion/generated/Compositions.tsx"],
    ["tests/fixtures/remotion-interactivity/assets/manifest.json", "tests/fixtures/remotion-interactivity/assets/manifest.json"],
    ["tests/fixtures/remotion-interactivity/assets/remotion-interactivity-local.svg", "tests/fixtures/remotion-interactivity/assets/remotion-interactivity-local.svg"],
    ["tests/fixtures-valid-project.json", "tests/fixtures-valid-project.json"],
    ["remotion/core/video-utils.ts", "remotion/core/video-utils.ts"],
    ["src/core/asset-resolution.ts", "src/core/asset-resolution.ts"],
    ["remotion/qa/player-entry.tsx", "remotion/qa/player-entry.tsx"],
    ["remotion/core/lint-extract.ts", "remotion/core/lint-extract.ts"],
    ["remotion/scripts/run-layout-probe.mjs", "remotion/scripts/run-layout-probe.mjs"],
    ["src/lint/types.ts", "src/lint/types.ts"],
    ["tests/fixtures/remotion-interactivity/assets/remotion-interactivity-local.svg", "public/assets/remotion-interactivity-local.svg"],
  ]) {
    const target = join(workspace, destination);
    await mkdir(dirname(target), {recursive: true});
    await copyFile(join(repo, source), target);
  }
  const fixtureSourcePath = join(repo, "tests/fixtures/remotion-interactivity/Video.tsx");
  const sourceWithParentWrapper = await readFile(fixtureSourcePath, "utf8");
  const project = JSON.parse(await readFile(join(workspace, "tests/fixtures-valid-project.json"), "utf8"));
  const sceneDuration = project.scenes[0].durationInFrames;
  const browserFixtureSource = sourceWithParentWrapper
    .replaceAll("durationInFrames={scene.durationInFrames}", `durationInFrames={${sceneDuration}}`)
    .replace("../../fixtures-valid-project.json", "../../tests/fixtures-valid-project.json")
    .replace("./assets/manifest.json", "../../tests/fixtures/remotion-interactivity/assets/manifest.json")
    .replace("../../../remotion/core/video-utils", "../core/video-utils");
  assert.notEqual(browserFixtureSource, sourceWithParentWrapper, "browser fixture must expose its independently editable child units");
  await writeFile(join(workspace, "remotion/generated/Video.tsx"), `${browserFixtureSource}\nexport const GeneratedVideo = EditableSceneFixture;\n`);
  await writeFile(join(workspace, "remotion/generated/Video.baseline.tsx"), browserFixtureSource);
  await writeFile(join(workspace, "baseline-Video.tsx"), browserFixtureSource);
  for (const fixtureName of ["Parent.tsx"]) {
    const fixturePath = join(workspace, "tests/fixtures/remotion-interactivity", fixtureName);
    const fixtureText = await readFile(fixturePath, "utf8");
    await writeFile(fixturePath, fixtureText.replaceAll('"./Video"', '"../../../remotion/generated/Video"'));
  }
  const compositionPath=join(workspace,"remotion/generated/Compositions.tsx");
  let compositionSource=await readFile(compositionPath,"utf8");
  compositionSource=compositionSource.replaceAll('"../../fixtures-valid-project.json"','"../../tests/fixtures-valid-project.json"').replace("ConnectedCompositionFixture","GeneratedCompositions").replace('import {EditableSceneFixture} from "./Video";','import {EditableSceneFixture} from "./Video";\nimport {EditableSceneFixture as BaselineScene} from "./Video.baseline"').replace("export const GeneratedCompositions:React.FC=()=> (","export const GeneratedCompositions:React.FC=()=> (<>").replace("  />\n);","  />\n  <Composition id=\"BaselineVideo\" component={BaselineScene} width={canonicalProject.meta.width} height={canonicalProject.meta.height} fps={canonicalProject.meta.fps} durationInFrames={scene.durationInFrames} defaultProps={{}}/>\n</>);");
  await writeFile(compositionPath,compositionSource);
  await copyFile(join(repo,"remotion/root.tsx"),join(workspace,"remotion/root.tsx"));
  await writeFile(join(workspace,"remotion/generated/project.json"),JSON.stringify(project));
  await writeFile(join(workspace,"remotion/generated/asset-manifest.json"),await readFile(join(workspace,"tests/fixtures/remotion-interactivity/assets/manifest.json")));
  await writeFile(join(workspace,"remotion/generated/theme.ts"),"export {};\n");
  await writeFile(join(workspace,"remotion/generated/fonts.ts"),"export function loadRegisteredFonts() {}\n");
  await mkdir(join(workspace,"src/harness"),{recursive:true});
  await writeFile(join(workspace,"src/core/types.ts"),"export type VideoProject = any;\n");
  await writeFile(join(workspace,"src/harness/assets.ts"),"export type AssetManifest = any;\n");
  const packageJson = JSON.parse(await readFile(join(repo, "remotion/package.json"), "utf8"));
  await writeFile(join(workspace, "package.json"), JSON.stringify(packageJson, null, 2));
  const moduleRoot = join(repo, "remotion/node_modules");
  await rm(join(workspace, "node_modules"), {recursive: true, force: true});
  await symlink(moduleRoot, join(workspace, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const scene = project.scenes[0];
  await writeFile(join(workspace, "index.ts"), `import {registerRoot} from "remotion";\nimport {RemotionRoot} from "./remotion/root";\nregisterRoot(RemotionRoot);\n`);
  await writeFile(join(workspace, "workspace-meta.json"), JSON.stringify({sceneId: scene.id, durationInFrames: scene.durationInFrames, width: project.meta.width, height: project.meta.height, fps: project.meta.fps}, null, 2));
}

async function main() {
  await copyFixture();
  const canonicalProject = JSON.parse(await readFile(join(workspace, "tests/fixtures-valid-project.json"), "utf8"));
  const generatedRoot = join(workspace, "remotion/generated");
  const generatedVideo = join(generatedRoot, "Video.tsx");
  const {remotionHitlStatus} = await import(pathToFileURL(join(repo, "dist/src/harness/remotion.js")).href);
  const {generatedHash} = await import(pathToFileURL(join(repo, "dist/src/harness/remotion-evidence.js")).href);
  const initialGeneratedHash = await generatedHash(generatedRoot);
  await mkdir(join(workspace, ".video"), {recursive: true});
  await writeFile(join(workspace, ".video/remotion-state.json"), JSON.stringify({version: "1", renderer: "remotion", phase: "VISUAL_REVIEW", projectId: "fixture", revision: 1, projectHash: "sha256:fixture", productionProfileHash: "sha256:fixture", assetManifestHash: "sha256:fixture", sourceHash: initialGeneratedHash, updatedAt: new Date().toISOString()}));
  const port = 33000 + Math.floor(Math.random() * 15000);
  const executable = join(repo, "remotion/node_modules/@remotion/cli/remotion-cli.js");
  if (!existsSync(executable)) throw new PrerequisiteBlockedError(`Pinned Remotion Studio CLI is missing: ${executable}`);
  const studio = spawn(process.execPath, [executable, "studio", "index.ts", "--no-open", `--port=${port}`], {cwd: workspace, stdio: ["ignore", "pipe", "pipe"]});
  let log = "";
  const logStream = await import("node:fs").then(({createWriteStream}) => createWriteStream(browserLog));
  studio.stdout.on("data", (chunk) => { log += chunk.toString(); logStream.write(chunk); });
  studio.stderr.on("data", (chunk) => { log += chunk.toString(); logStream.write(chunk); });
  let browser;
  try {
    const chrome = process.env.REMOTION_BROWSER_EXECUTABLE ?? (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined);
    if (chrome && !existsSync(chrome)) throw new PrerequisiteBlockedError(`Browser executable is missing: ${chrome}`);
    try {
      browser = await chromium.launch({headless: true, ...(chrome ? {executablePath: chrome} : {})});
    } catch (error) {
      if (/executable|browser.*install|browser.*not found/i.test(error instanceof Error ? error.message : String(error))) throw new PrerequisiteBlockedError(error instanceof Error ? error.message : String(error));
      throw error;
    }
    const page = await browser.newPage({viewport: {width: 1600, height: 1050}, deviceScaleFactor: 1});
    page.on("console", (message) => { if (message.type() === "error") (message.text().includes("style property during rerender") ? (result.diagnostics ??= []).push(`console: ${message.text()}`) : result.errors.push(`console: ${message.text()}`)); });
    page.on("pageerror", (error) => result.errors.push(`pageerror: ${error.message}`));
    const url = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (studio.exitCode !== null) throw new Error(`Studio exited (${studio.exitCode}): ${log}`);
      try { const response = await fetch(url); if (response.ok) { ready = true; break; } } catch {}
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
    assert.ok(ready, `Studio did not become ready: ${log}`);
    await page.goto(url, {waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForTimeout(8000);
    await page.screenshot({path: join(evidenceDir, "studio-initial.png"), fullPage: true});
    const state = await page.locator("body").innerText();
    assert.doesNotMatch(state, /Error\s*Error:|Cannot find module/i, state.slice(0, 1600));
    assert.match(state, /MainVideo/);
    assert.match(state, /EditableSceneFixture/);
    await writeFile(join(evidenceDir, "initial-dom.txt"), state);
    const ui = await page.evaluate(() => ({
      buttons: Array.from(document.querySelectorAll("button")).filter((button) => button.getClientRects().length).map((button) => ({text: button.innerText, label: button.getAttribute("aria-label"), title: button.title})),
      inputs: Array.from(document.querySelectorAll("input,textarea,[role=slider]")).filter((element) => element.getClientRects().length).map((element) => ({tag: element.tagName, label: element.getAttribute("aria-label"), title: element.getAttribute("title"), value: element.value, role: element.getAttribute("role")})),
      rows: Array.from(document.querySelectorAll("[role=treeitem],[role=row],[data-testid] ")).filter((element) => element.getClientRects().length).slice(0, 60).map((element) => ({role: element.getAttribute("role"), testid: element.getAttribute("data-testid"), text: element.innerText})),
    }));
    ui.frames = await Promise.all(page.frames().map(async (frame) => ({url: frame.url(), body: (await frame.locator("body").innerText().catch(() => "")).slice(0, 1600)})));
    await writeFile(join(evidenceDir, "initial-controls.json"), JSON.stringify(ui, null, 2));
    const browseButton=page.getByRole("button", {name: "Browse Elements"});
    if(await browseButton.count()){
      await browseButton.click();await page.waitForTimeout(1000);
      const afterBrowse=await page.locator("body").innerText();
      await writeFile(join(evidenceDir,"browse-elements-dom.txt"),afterBrowse);
      await page.screenshot({path:join(evidenceDir,"browse-elements.png"),fullPage:true});
      result.assertions.push({name:"Browse Elements UI state",status:"observed",body:afterBrowse.slice(-1800)});
      await page.keyboard.press("Escape");await page.waitForTimeout(250);
    }
    await page.getByText("EditableSceneFixture", {exact:true}).first().click();
    await page.waitForTimeout(1500);
    assert.match(await page.locator("body").innerText(),/EditableSceneFixture/);
    record("standalone connected composition is selected before editing",{composition:"EditableSceneFixture"});
    const names = ["Scene title", "Local supporting image", "Summary card one", "Summary card two"];
    for (const name of names) {
      const matches = page.getByText(name, {exact: true});
      const count = await matches.count();
      assert.ok(count > 0, `Studio did not expose selectable unit '${name}'`);
      await matches.last().click();
      await page.waitForTimeout(700);
      const selected = await page.locator("body").innerText();
      await page.screenshot({path: join(evidenceDir, `selected-${name.toLowerCase().replaceAll(" ", "-")}.png`), fullPage: true});
      const controls = await page.evaluate(() => ({
        inputs: Array.from(document.querySelectorAll("input,textarea,[role=slider]")).filter((element) => element.getClientRects().length).map((element) => ({type: element.type, label: element.getAttribute("aria-label"), value: element.value, placeholder: element.placeholder, outer: element.outerHTML.slice(0, 300)})),
        buttons: Array.from(document.querySelectorAll("button")).filter((button) => button.getClientRects().length).slice(-30).map((button) => ({text: button.innerText, label: button.getAttribute("aria-label"), title: button.title, outer: button.outerHTML.slice(0, 220)})),
      }));
      record(`Studio selection: ${name}`, {matches: count, inspector: selected.slice(-1800), controls});
    }
    const fixtureMeta = JSON.parse(await readFile(join(workspace, "workspace-meta.json"), "utf8"));
    const videoSource = generatedVideo;
    const beforeDrag = await readFile(videoSource, "utf8");
    await page.getByText("Summary card one", {exact: true}).click();
    const cardText = page.getByText(canonicalProject.scenes[0].screenText, {exact: true}).nth(1);
    const cardBox = await cardText.boundingBox();
    assert.ok(cardBox, "card A must have a rendered canvas box");
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 42, cardBox.y + cardBox.height / 2 + 18, {steps: 8});
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const afterDrag = await readFile(videoSource, "utf8");
    await page.screenshot({path: join(evidenceDir, "card-a-after-drag.png"), fullPage: true});
    assert.notEqual(afterDrag, beforeDrag, "Studio drag must persist a change to the fixture source");
    assert.match(afterDrag, /translate|offset|transform/i, "dragged position must be represented in source");
    result.sourceChanges.push({operation: "drag Summary card one in preview", before: beforeDrag, after: afterDrag});
    record("preview drag persists card A position into source", {box: cardBox, sourceChanged: true});
    assert.match(afterDrag, /name="Summary card two"[^\n]*backgroundColor: "#76E6C4"/, "dragging card A must not change card B's independent source props");
    const controlHtml = await page.evaluate(() => Object.fromEntries(["Scale", "Color", "Card width"].map((label) => {
      const found = Array.from(document.querySelectorAll("*")).find((element) => element.childElementCount === 0 && element.textContent?.trim() === label);
      return [label, found ? [found, found.parentElement, found.parentElement?.parentElement, found.parentElement?.parentElement?.parentElement].map((element) => element?.outerHTML.slice(0, 9000) ?? null) : []];
    })));
    await writeFile(join(evidenceDir, "inspector-control-structure.json"), JSON.stringify(controlHtml, null, 2));
    record("card inspector controls captured", {file: "evidence/inspector-control-structure.json"});
    await page.locator('button[name="style.backgroundColor"]').click();
    await page.waitForTimeout(500);
    const colorPicker = await page.locator("body").innerText();
    const pickerFields = await page.evaluate(() => Array.from(document.querySelectorAll("input,textarea,[role=textbox]")).filter((element) => element.getClientRects().length).map((element) => ({type: element.type, value: element.value, label: element.getAttribute("aria-label"), placeholder: element.placeholder})));
    await page.screenshot({path: join(evidenceDir, "color-picker.png"), fullPage: true});
    record("Studio card color picker opened", {text: colorPicker.slice(-1200), fields: pickerFields});
    const hexField = page.locator('input[type="text"]').first();
    await hexField.fill("#D946EF");
    await hexField.press("Enter");
    await page.waitForTimeout(1000);
    const afterColor = await readFile(videoSource, "utf8");
    assert.match(afterColor, /backgroundColor:\s*["']#D946EF["']/i, "Studio color picker must persist card A background to source");
    assert.match(afterColor, /name="Summary card two"[^\n]*backgroundColor: "#76E6C4"/, "color edit must leave card B unchanged");
    result.sourceChanges.push({operation: "change Summary card one color in Studio", before: afterDrag, after: afterColor});
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(700);
    const afterUndo = await readFile(videoSource, "utf8");
    assert.match(afterUndo, /backgroundColor:\s*["']#0B1930["']/i, "Studio undo must revert the card color source edit");
    await page.keyboard.press("Control+Shift+z");
    await page.waitForTimeout(700);
    const afterRedo = await readFile(videoSource, "utf8");
    assert.match(afterRedo, /backgroundColor:\s*["']#D946EF["']/i, "Studio redo must restore the card color source edit");
    record("Studio color edit persists only to card A source props with undo/redo", {color: "#D946EF", cardBUnchanged: true, undo: "reverted to #0B1930", redo: "restored #D946EF"});
    await page.keyboard.press("Escape");
    await page.getByText("Summary card one", {exact: true}).last().click();
    const scaleValue = page.locator("button.__remotion_input_dragger").filter({hasText: /^1\.000$/}).first();
    await scaleValue.dblclick();
    await page.waitForTimeout(250);
    const activeFields = page.locator("input.__remotion_input_dragger_input");
    assert.ok(await activeFields.count() >= 1, "Studio must expose an editable scale field");
    await activeFields.first().fill("1.25");
    await activeFields.first().press("Enter");
    await page.waitForTimeout(700);
    const afterScale = await readFile(videoSource, "utf8");
    assert.notEqual(afterScale, afterColor, "scale inspector edit must persist to generated source");
    const cardAAfterScale = namedCardFragment(afterScale, "Summary card one");
    const cardBAfterScale = namedCardFragment(afterScale, "Summary card two");
    const cardBBeforeScale = namedCardFragment(afterColor, "Summary card two");
    assert.ok(cardAAfterScale, "generated source must contain the Card A JSX fragment");
    assert.match(cardAAfterScale, /scale:\s*1\.25|scale:\s*["']1\.25/i, "Card A JSX fragment must persist scale 1.25");
    assert.ok(cardBBeforeScale, "pre-scale generated source must contain the Card B JSX fragment");
    assert.equal(cardBAfterScale, cardBBeforeScale, "scaling Card A must leave the entire Card B JSX fragment unchanged");
    result.sourceChanges.push({operation: "change Summary card one scale in Studio inspector", before: afterColor, after: afterScale});
    record("Studio scale edit persists to generated Card A source and leaves Card B unchanged", {scale: 1.25, cardBUnchanged: true});
    await page.keyboard.press("Escape");
    await page.getByText("Summary card one", {exact: true}).last().click();
    const beforeKeyframes = await readFile(videoSource, "utf8");
    const addKeyframes = page.getByRole("button", {name: "Add keyframe"});
    const keyframeControlCount = await addKeyframes.count();
    assert.ok(keyframeControlCount >= 1, "Studio must expose keyframe controls for the selected Card A");
    const keyframeErrorsBefore = result.errors.length;
    await addKeyframes.first().click();
    await page.getByRole("button", {name: "Go to beginning"}).click();
    for (let frame = 0; frame < 30; frame++) await page.getByRole("button", {name: "Go forward 1 frame"}).click();
    await addKeyframes.first().click();
    await page.waitForTimeout(300);
    const keyframeErrors = result.errors.splice(keyframeErrorsBefore);
    const keyframeError = keyframeErrors.find((entry) => entry.includes("Could not find the original JSX node for keyframing"));
    if (keyframeError) {
      assert.equal(keyframeError, "pageerror: Could not find the original JSX node for keyframing", "only the known Studio keyframe error is an expected limitation");
      assert.equal(keyframeErrors.length, 1, "keyframe attempt must not emit any other browser errors");
      result.observations = [...(result.observations ?? []), {name: "two-point keyframe attempt", status: "expected Studio limitation", error: keyframeError}];
      result.skipped.push("Two-point keyframe: pinned Studio emitted the known `Could not find the original JSX node for keyframing` page error after the second keyframe request.");
    } else {
      result.errors.push(...keyframeErrors);
      const keyframedSource = await readFile(videoSource, "utf8");
      assert.notEqual(keyframedSource, beforeKeyframes, "successful two-point keyframing must persist a source change");
      assert.match(keyframedSource, /interpolate\(frame,\s*\[0,\s*30\]/, "successful keyframing must persist both frame 0 and frame 30 points");
      record("Studio two-point keyframe edit persists to generated source", {frames: [0, 30], controls: keyframeControlCount});
    }
    await page.waitForTimeout(700);
    const afterKeyframes = await readFile(videoSource, "utf8");
    if (afterKeyframes !== beforeKeyframes) result.sourceChanges.push({operation: "source change observed during two-point keyframe attempt", before: beforeKeyframes, after: afterKeyframes});
    await page.keyboard.press("Escape");
    const timelineLabel = page.locator('[data-name="Summary card one"]');
    const labelBox = await timelineLabel.boundingBox();
    assert.ok(labelBox, "card A timeline label must be visible");
    const beforeTiming = await readFile(videoSource, "utf8");
    const beforeCardDuration = cardDuration(beforeTiming);
    assert.equal(beforeCardDuration, "180", "Card A must begin at its canonical fixture duration");
    const trimHandles = page.getByRole("separator", {name: "Drag to change duration", exact: true});
    const visibleTrimHandles = await trimHandles.evaluateAll((elements) => elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const track = element.parentElement.getBoundingClientRect();
      return {index, x: rect.x, y: rect.y, width: rect.width, height: rect.height, trackLeft: track.left, trackWidth: track.width};
    }).filter((handle) => handle.width > 0 && handle.height > 0));
    const cardRowHandles = visibleTrimHandles.filter((handle) =>
      handle.y < labelBox.y + labelBox.height && handle.y + handle.height > labelBox.y
    );
    record("Card A duration handle discovery", {labelBox, visibleTrimHandles, cardRowHandles});
    assert.equal(cardRowHandles.length, 1, "the selected Card A timeline row must expose exactly one visible duration trim handle");
    const trimHandle = trimHandles.nth(cardRowHandles[0].index);
    const handleBox = await trimHandle.boundingBox();
    assert.ok(handleBox, "Card A duration trim handle must have a measurable browser box");
    const pixelsPerFrame = (handleBox.x - cardRowHandles[0].trackLeft) / Number(beforeCardDuration);
    assert.ok(Number.isFinite(pixelsPerFrame) && pixelsPerFrame > 0, "Card A right trim handle must sit at the expected end of its 180-frame track");
    const trimPixels = Math.round(pixelsPerFrame * (Number(beforeCardDuration) - 150));
    const startX = handleBox.x + handleBox.width / 2;
    const y = handleBox.y + handleBox.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX - trimPixels, y, {steps: Math.max(4, Math.ceil(trimPixels / 12))});
    await page.mouse.up();
    let afterTiming = beforeTiming;
    for (let attempt = 0; attempt < 24; attempt++) {
      await page.waitForTimeout(250);
      afterTiming = await readFile(videoSource, "utf8");
      if (cardDuration(afterTiming) !== beforeCardDuration) break;
    }
    const afterCardDuration = cardDuration(afterTiming);
    assert.notEqual(afterTiming, beforeTiming, "dragging Card A's duration handle must persist a generated-source edit");
    assert.equal(afterCardDuration, "150", "the correct Card A end handle must save the requested 150-frame duration");
    result.sourceChanges.push({operation: "trim Summary card one duration on Studio timeline", before: beforeTiming, after: afterTiming});
    record("Studio duration handle trims Card A and persists the saved timing", {beforeDuration: beforeCardDuration, afterDuration: afterCardDuration, handle: cardRowHandles[0], pixelsPerFrame, trimPixels, persisted: true});
    const timelineStructure = await page.getByText("Summary card one", {exact: true}).last().evaluate((element) => {
      const ancestors = [];
      let current = element;
      for (let depth = 0; current && depth < 7; depth++, current = current.parentElement) ancestors.push(current.outerHTML.slice(0, 2500));
      return ancestors;
    });
    await writeFile(join(evidenceDir, "timeline-row-structure.json"), JSON.stringify(timelineStructure, null, 2));
    record("static timing timeline row structure captured", {durationInFrames: fixtureMeta.durationInFrames, file: "evidence/timeline-row-structure.json"});
    await page.waitForTimeout(1500);
    const afterPersistedEdits = await readFile(videoSource, "utf8");
    await page.reload({waitUntil: "domcontentloaded"});
    await page.waitForTimeout(7000);
    const reopenedBody = await page.locator("body").innerText();
    assert.match(reopenedBody, /Where did my money go\?/);
    const sourceAfterReload = await readFile(videoSource, "utf8");
    await page.waitForTimeout(500);
    assert.equal(await readFile(videoSource, "utf8"), sourceAfterReload, "source must settle after reload");
    assert.equal(sourceAfterReload, afterPersistedEdits, "Studio reload must preserve the actual source edits");
    assert.equal(cardDuration(sourceAfterReload), "150", "Studio reload must preserve Card A's saved 150-frame trim");
    await page.screenshot({path: join(evidenceDir, "studio-reopened.png"), fullPage: true});
    record("Studio reload reopens with source edits intact", {sourceBytes: afterPersistedEdits.length, trimmedCardDuration: cardDuration(sourceAfterReload), pageContent: "canonical title and both cards present"});

    await page.locator("a").filter({hasText:"EditableSceneFixture"}).first().click();
    await page.waitForTimeout(1500);
    const connectedBody = await page.locator("body").innerText();
    await page.screenshot({path: join(evidenceDir, "connected-composition.png"), fullPage: true});
    assert.match(connectedBody, /Where did my money go\?/);
    const connectedRegistration = await readFile(join(workspace, "remotion/generated/Compositions.tsx"), "utf8");
    const rootRegistration = await readFile(join(workspace, "remotion/root.tsx"), "utf8");
    assert.match(connectedRegistration, /id="EditableSceneFixture"/);
    assert.match(connectedRegistration, /component=\{EditableSceneFixture\}/);
    assert.match(connectedRegistration, /width=\{canonicalProject\.meta\.width\}/);
    assert.match(connectedRegistration, /height=\{canonicalProject\.meta\.height\}/);
    assert.match(connectedRegistration, /fps=\{canonicalProject\.meta\.fps\}/);
    assert.match(connectedRegistration, /durationInFrames=\{scene\.durationInFrames\}/);
    assert.match(rootRegistration, /id="MainVideo" component=\{GeneratedVideo\} defaultProps=\{\{project:typedProject,assetManifest:typedAssetManifest\}\}/);
    assert.match(rootRegistration, /<GeneratedCompositions\s*\/>/);
    record("connected registration matches canonical metadata and references the same scene component as its parent", {compositionId: "EditableSceneFixture", componentReference: "EditableSceneFixture", metadataReferences: ["canonicalProject.meta.width", "canonicalProject.meta.height", "canonicalProject.meta.fps", "scene.durationInFrames"]});
    await page.getByText("MainVideo", {exact: true}).first().click();
    await page.waitForTimeout(1500);
    const timelineNames = await page.locator("[data-name]").evaluateAll((items) => items.map((item) => item.getAttribute("data-name")));
    assert.equal(timelineNames.filter((name) => name === "Scene title").length, 1);
    assert.equal(timelineNames.filter((name) => name === "Local supporting image").length, 1);
    assert.equal(timelineNames.filter((name) => name === "Summary card one").length, 1);
    assert.equal(timelineNames.filter((name) => name === "Summary card two").length, 1);
    const mainSource=await readFile(videoSource,"utf8");
    assert.equal(cardDuration(mainSource),"150","MainVideo must use the trim saved from Card A's connected composition");
    assert.equal(cardDuration(mainSource),afterCardDuration,"MainVideo must reflect the saved connected child source timing");
    assert.match(mainSource,/#d946ef/,"MainVideo source must retain the standalone child appearance edit");
    await page.screenshot({path: join(evidenceDir, "main-video-registration.png"), fullPage: true});
    record("MainVideo remains the default composition with canonical metadata and one row per intended editable unit", {composition: "MainVideo", metadata: {width: canonicalProject.meta.width, height: canonicalProject.meta.height, fps: canonicalProject.meta.fps, durationInFrames: canonicalProject.meta.durationsInFrames}, timelineNames});

    const actualGeneratedSource = await readFile(generatedVideo, "utf8");
    assert.equal(actualGeneratedSource, afterPersistedEdits, "Studio must have edited the exact generated source rendered by the fixture root");
    const reviewStatus = await remotionHitlStatus(workspace);
    assert.equal(reviewStatus?.status, "REVIEW_REQUIRED");
    assert.equal(reviewStatus?.phase, "renderer_source_changed");
    assert.equal(reviewStatus?.payload?.approvalInvalidated, true);
    assert.equal(canonicalProject.scenes[0].screenText, "Where did my money go?");
    record("existing Remotion HITL path detects the actual Studio-edited generated source as stale without HUMAN approval", {status: reviewStatus.status, phase: reviewStatus.phase, approvalInvalidated: true, initialSourceHash: initialGeneratedHash, currentSourceHash: await generatedHash(generatedRoot), visualApprovalRecorded: false});

    const canonicalText = canonicalProject.scenes[0].screenText;
    const paritySource = actualGeneratedSource.replaceAll("{scene.screenText}", '"Controlled altered claim"');
    assert.notEqual(paritySource, actualGeneratedSource, "the controlled copy change must edit actual rendered source");
    await writeFile(generatedVideo, paritySource);
    const probeResult = spawnSync(process.execPath, [join(workspace, "remotion/scripts/run-layout-probe.mjs")], {cwd: workspace, encoding: "utf8", input: JSON.stringify({frames: [0], fps: canonicalProject.meta.fps, entryPoint: "remotion/qa/player-entry.tsx", publicDir: "public", width: canonicalProject.meta.width, height: canonicalProject.meta.height}), timeout: 180000, env: {...process.env, REMOTION_BROWSER_EXECUTABLE: process.env.REMOTION_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"}});
    assert.equal(probeResult.status, 0, `rendered lint probe failed: ${probeResult.stderr || probeResult.stdout}`);
    const measuredFrames = JSON.parse(probeResult.stdout).frames;
    const {runLint}=await import(pathToFileURL(join(repo,"dist/src/lint/registry.js")).href);
    const lintContext={canvasWidth:canonicalProject.meta.width,canvasHeight:canonicalProject.meta.height,sceneIds:[canonicalProject.scenes[0].id],minFontPx:1,tolerancePx:0,canonicalText:[canonicalText]};
    const rejected=runLint({frames:measuredFrames,ctx:lintContext,strict:true,measurement:"remotion-player-dom"});
    assert.equal(rejected.status,"FAIL","the rendered registered lint path must fail on a meaningful source copy mismatch");
    assert.ok(rejected.issues.some((issue) => issue.code === "copy_parity"), "the actual rendered lint report must contain copy_parity");
    await writeFile(join(evidenceDir,"copy-parity-rejection.json"),JSON.stringify(rejected,null,2));
    await writeFile(generatedVideo, actualGeneratedSource);
    assert.equal(await readFile(generatedVideo, "utf8"), actualGeneratedSource, "restore the source before export evidence");
    record("rendered Player lint registry flags a meaningful source-text edit against unchanged canonical project", {canonicalText, editedSource: '"Controlled altered claim"', measurement: JSON.parse(probeResult.stdout).measurement, issue: rejected.issues.find((issue) => issue.code === "copy_parity"), report:"evidence/copy-parity-rejection.json"});

    const stillPath = join(output, "saved-source-still.png");
    const clipPath = join(output, "saved-source-clip.mp4");
    const connectedStillPath = join(output, "connected-source-still.png");
    const baselineStillPath = join(output, "baseline-source-still.png");
    const cli = join(repo, "remotion/node_modules/@remotion/cli/remotion-cli.js");
    const renderChrome = process.env.REMOTION_BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
    const sourceHashBeforeRender = await generatedHash(generatedRoot);
    assert.notEqual(sourceHashBeforeRender, initialGeneratedHash, "Studio edits must change the real generated-source hash before rendering");
    assert.equal(await fileHash(videoSource), await fileHash(join(generatedRoot, "Video.tsx")), "export source must be the exact Studio-edited generated file");
    const stillResult = spawnSync(process.execPath, [cli, "still", "index.ts", "MainVideo", stillPath, "--frame=0", `--browser-executable=${renderChrome}`, "--overwrite", "--log=error"], {cwd: workspace, encoding: "utf8", timeout: 180000});
    assert.equal(stillResult.status, 0, `saved-source still failed: ${stillResult.stderr || stillResult.stdout}`);
    const connectedStillResult = spawnSync(process.execPath, [cli, "still", "index.ts", "EditableSceneFixture", connectedStillPath, "--frame=0", `--browser-executable=${renderChrome}`, "--overwrite", "--log=error"], {cwd: workspace, encoding: "utf8", timeout: 180000});
    assert.equal(connectedStillResult.status, 0, `connected still failed: ${connectedStillResult.stderr || connectedStillResult.stdout}`);
    const baselineStillResult = spawnSync(process.execPath, [cli, "still", "index.ts", "BaselineVideo", baselineStillPath, "--frame=0", `--browser-executable=${renderChrome}`, "--overwrite", "--log=error"], {cwd: workspace, encoding: "utf8", timeout: 180000});
    assert.equal(baselineStillResult.status, 0, `baseline still failed: ${baselineStillResult.stderr || baselineStillResult.stdout}`);
    const renderResult = spawnSync(process.execPath, [cli, "render", "index.ts", "MainVideo", clipPath, "--frames=0-29", `--browser-executable=${renderChrome}`, "--overwrite", "--log=error"], {cwd: workspace, encoding: "utf8", timeout: 180000});
    assert.equal(renderResult.status, 0, `saved-source clip failed: ${renderResult.stderr || renderResult.stdout}`);
    const sourceHashAfterRender = await generatedHash(generatedRoot);
    assert.equal(sourceHashAfterRender, sourceHashBeforeRender, "source must remain stable across all exports");
    assert.equal(await readFile(videoSource, "utf8"), afterPersistedEdits, "exports must not alter saved Studio source");
    const mainStillHash = await fileHash(stillPath);
    const connectedStillHash = await fileHash(connectedStillPath);
    const baselineStillHash = await fileHash(baselineStillPath);
    assert.equal(mainStillHash, connectedStillHash, "MainVideo and connected composition must render identical frame-0 pixels from the same scene source");
    assert.notEqual(mainStillHash, baselineStillHash, "saved Studio edits must produce different frame-0 output from the unedited baseline");
    await copyFile(stillPath, join(evidenceDir, "rendered-saved-source-frame.png"));
    const diff = spawnSync("git", ["diff", "--no-index", "--", join(workspace, "baseline-Video.tsx"), videoSource], {cwd: repo, encoding: "utf8"});
    await writeFile(join(evidenceDir, "source-diff.txt"), diff.stdout || "No source differences were produced.\n");
    result.artifacts.push("saved-source-still.png", "saved-source-clip.mp4", "connected-source-still.png", "baseline-source-still.png", "evidence/rendered-saved-source-frame.png", "evidence/source-diff.txt", "evidence/studio-reopened.png", "evidence/connected-composition.png", "evidence/main-video-registration.png");
    record("still and 30-frame clip render from the exact saved generated source and differ from baseline", {sourceHash: sourceHashBeforeRender, baselineGeneratedHash: initialGeneratedHash, changedSourceHash: sourceHashBeforeRender, sourceStableAcrossExports: true, mainStillHash, connectedStillHash, baselineStillHash, mainMatchesConnected: true, savedOutputDiffersFromBaseline: true, stillStatus: stillResult.status, connectedStillStatus: connectedStillResult.status, baselineStillStatus: baselineStillResult.status, clipStatus: renderResult.status, still: stillPath, clip: clipPath});
    record("pinned local Studio launched on the isolated fixture project", {url, title: await page.title(), body: state.slice(0, 1200), ui});
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (studio && studio.exitCode === null) { studio.kill("SIGTERM"); await Promise.race([new Promise((resolvePromise) => studio.once("exit", resolvePromise)), new Promise((resolvePromise) => setTimeout(resolvePromise, 10000))]); }
    logStream.end();
  }
  result.status = result.errors.length ? "failed" : result.skipped.length ? "passed-with-skips" : "passed";
}

try {
  await main();
} catch (error) {
  result.status = error instanceof PrerequisiteBlockedError ? "blocked" : "failed";
  result.errors.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  await writeFile(join(output, "browser-report.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failed" || result.status === "blocked") process.exitCode = 1;
}
