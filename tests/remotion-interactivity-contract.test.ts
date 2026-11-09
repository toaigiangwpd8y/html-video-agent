import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";

const root = process.cwd();

test("Remotion authoring contract pairs official Studio structure guidance with project boundaries", async () => {
  const [authoring, handoff, interactivity, timeline] = await Promise.all([
    readFile(resolve(root, "remotion/AUTHORING.md"), "utf8"),
    readFile(resolve(root, ".agents/skills/agent-video/references/remotion-handoff.md"), "utf8"),
    readFile(resolve(root, ".agents/skills/remotion-interactivity/SKILL.md"), "utf8"),
    readFile(resolve(root, ".agents/skills/remotion-interactivity/timeline-structure.md"), "utf8"),
  ]);

  assert.match(interactivity, /Studio edits the JSX nodes that create timeline items/i);
  assert.match(timeline, /Write each independently editable instance as its own JSX node/i);
  assert.match(authoring, /literal, descriptive `name`[\s\S]*timing and appearance inline/i);
  assert.match(authoring, /layout containers.*plain elements/i);
  assert.match(authoring, /\.map\(\).*generated group/i);
  assert.match(authoring, /Do not flatten every animation\/helper/i);
  assert.match(authoring, /canonical copy verbatim[\s\S]*read-only/i);
  assert.match(authoring, /screenshot is a single bitmap layer/i);
  assert.match(authoring, /natural playback rate `1\.0`[\s\S]*full measured interval/i);
  assert.match(authoring, /Imported templates[\s\S]*without a deep rewrite/i);
  assert.match(authoring, /opening a template in Studio does not by itself make its internals independently editable/i);

  const readOrder = handoff.slice(handoff.indexOf("## Read order"), handoff.indexOf("## Generated implementation"));
  const canonical = readOrder.indexOf("complete canonical `video.json`");
  const assets = readOrder.indexOf("approved `assets/manifest.json`");
  const authority = readOrder.indexOf("active Production Profile `Renderer Guidance`");
  const runtimeAuthority = readOrder.indexOf("`.video/renderer-selection.json`");
  const officialRouter = readOrder.indexOf(".agents/skills/remotion-best-practices/SKILL.md");
  const studioGuidance = readOrder.indexOf(".agents/skills/remotion-interactivity/SKILL.md");
  const timelineStructure = readOrder.indexOf("timeline-structure.md");
  assert.ok(canonical >= 0 && assets > canonical, "canonical project and approved assets must be read first");
  assert.ok(authority > assets && runtimeAuthority > authority, "profile and selected renderer establish runtime authority after canonical inputs");
  assert.ok(officialRouter > runtimeAuthority && studioGuidance > officialRouter && timelineStructure > studioGuidance, "implementation guidance follows runtime authority");
});

test("Remotion interactivity fixture keeps canonical copy and independent local card instances", async () => {
  const fixturePath = resolve(root, "tests/fixtures/remotion-interactivity/Video.tsx");
  const fixture = await readFile(fixturePath, "utf8");
  const manifest = JSON.parse(await readFile(resolve(root, "tests/fixtures/remotion-interactivity/assets/manifest.json"), "utf8")) as {version: string; assets: Array<{id: string; publicPath: string; type: string; sceneIds: string[]; role: string}>};
  const image = await readFile(resolve(root, "tests/fixtures/remotion-interactivity/assets/remotion-interactivity-local.svg"), "utf8");
  const canonical = await readFile(resolve(root, "tests/fixtures-valid-project.json"), "utf8");
  const canonicalProject = JSON.parse(canonical) as {scenes: Array<{id: string; screenText: string}>};
  const scene = canonicalProject.scenes[0];
  const boundImages = manifest.assets.filter((asset) => asset.role === "illustration" && asset.sceneIds.includes(scene.id));

  assert.match(canonical, /"screenText": "Where did my money go\?"/);
  assert.match(fixture, /fixtures-valid-project\.json/);
  assert.match(fixture, /scene\.screenText/);
  assert.equal((fixture.match(/\{scene\.screenText\}/g)??[]).length,3,"every visible fixture copy instance must come from canonical scene copy");
  assert.doesNotMatch(fixture,/Summary one|Summary two/);
  assert.match(fixture, /data-scene-id=\{scene\.id\}/);
  assert.match(fixture, /assets\/manifest\.json/);
  assert.match(fixture, /resolveSceneAsset\(scene\.id, "illustration", assetManifest\.assets\)/);
  assert.match(fixture, /const localImage = staticFile\(resolveSceneAsset\([\s\S]*?\.slice\(1\)\)/);
  assert.equal(manifest.version, "1");
  assert.equal(boundImages.length, 1, "the canonical scene must have exactly one illustration asset binding");
  assert.equal(boundImages[0].publicPath, "/assets/remotion-interactivity-local.svg");
  assert.equal(boundImages[0].type, "image/svg+xml");
  assert.equal(boundImages[0].id, "remotion-interactivity-local");
  assert.match(fixture, /const Card = Interactive\.create\(/);
  assert.match(fixture, /export const EditableSceneFixture = Interactive\.create\(/);
  assert.match(fixture, /layout: "absolute-fill"/);
  assert.match(fixture, /"style\.width": \{type: "number", default: 420, description: "Card width"/);
  assert.match(fixture, /<Card name="Summary card one" from=\{0\} durationInFrames=\{scene\.durationInFrames\}/);
  assert.match(fixture, /<Card name="Summary card two" from=\{0\} durationInFrames=\{scene\.durationInFrames\}/);
  assert.equal((fixture.match(/<Card name=/g) ?? []).length, 2, "each card must have its own named JSX instance");
  assert.match(fixture, /<Interactive\.Div name="Scene title" from=\{0\} durationInFrames=\{scene\.durationInFrames\}/);
  assert.match(fixture, /<Img name="Local supporting image" src=\{localImage\} from=\{0\} durationInFrames=\{scene\.durationInFrames\}/);
  assert.doesNotMatch(fixture, /\.map\s*\(/, "independently editable cards must not be hidden in a map");
  assert.doesNotMatch(fixture, /https?:\/\//i, "the fixture must use only local media and fonts");
  assert.match(image, /<svg\b/);
});

test("connected fixture registers the same standalone-ready scene used by its parent", async () => {
  const [registration,parent,rootSource]=await Promise.all([
    readFile(resolve(root,"tests/fixtures/remotion-interactivity/Compositions.tsx"),"utf8"),
    readFile(resolve(root,"tests/fixtures/remotion-interactivity/Parent.tsx"),"utf8"),
    readFile(resolve(root,"remotion/root.tsx"),"utf8"),
  ]);
  assert.match(registration,/id="EditableSceneFixture"/);
  assert.match(registration,/component=\{EditableSceneFixture\}/);
  assert.match(registration,/width=\{canonicalProject\.meta\.width\}[\s\S]*height=\{canonicalProject\.meta\.height\}[\s\S]*fps=\{canonicalProject\.meta\.fps\}[\s\S]*durationInFrames=\{scene\.durationInFrames\}[\s\S]*defaultProps=\{\{\}\}/);
  assert.match(parent,/<EditableSceneFixture\/>/);
  assert.equal((registration.match(/id="EditableSceneFixture"/g)??[]).length,1);
  assert.doesNotMatch(registration,/id="MainVideo"/);
  assert.match(rootSource,/id="MainVideo" component=\{GeneratedVideo\} defaultProps=\{\{project:typedProject,assetManifest:typedAssetManifest\}\}/);
  assert.match(rootSource,/<GeneratedCompositions\s*\/>/);
  assert.match(rootSource,/import \{GeneratedCompositions\} from "\.\/generated\/Compositions"/);
});
