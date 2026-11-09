import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {mkdtemp, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import test from "node:test";

const root = process.cwd();
const searchScript = resolve(root, "scripts/search-shotcraft-library.mjs");
const inspectScript = resolve(root, "scripts/inspect-shotcraft-item.mjs");
const node = process.execPath;
const run = (script: string, args: string[]) => new Promise<{error: any; stdout: string; stderr: string}>(done =>
  execFile(node, [script, ...args], {cwd: root}, (error, stdout, stderr) => done({error, stdout: stdout ?? "", stderr: stderr ?? ""})));

test("Shotcraft search finds English typography, split UI, zoom, beat, and transition concepts", async () => {
  for (const [query, expected] of [
    ["typography", "blur-slide"],
    ["split screen UI", "quad-split-parallel-scenes"],
    ["zoom punch", "crash-zoom-punch"],
    ["beat sync", "beat-step-list-theme-cycle"],
    ["transition wipe", "wipe-transitions"],
  ]) {
    const result = await run(searchScript, ["--query", query, "--top", "8"]);
    assert.ifError(result.error);
    assert.ok(JSON.parse(result.stdout).results.some((item: any) => item.id === expected), `${query} should find ${expected}`);
  }
});

test("Shotcraft low-energy results preserve upstream limitation constraints", async () => {
  const result = await run(searchScript, ["--query", "low energy", "--top", "8"]);
  assert.ifError(result.error);
  const item = JSON.parse(result.stdout).results.find((candidate: any) => candidate.id === "blur-slide");
  assert.ok(item, "low-energy retrieval vocabulary should find the low-energy title shot");
  assert.ok(item.constraints.energy.startsWith("低（一次性收敛"));
});

test("Shotcraft high-energy filter keeps only high-energy catalog cards", async () => {
  const result = await run(searchScript, ["--query", "typography", "--category", "typography", "--energy", "high", "--top", "8"]);
  assert.ifError(result.error);
  const items = JSON.parse(result.stdout).results;
  assert.ok(items.length > 0);
  assert.ok(items.every((item: any) => /高|high|极高/.test(item.constraints.energy)));
  assert.ok(items.every((item: any) => item.category === "typography"));
  assert.ok(items.some((item: any) => item.id === "outline-word-fill"));
  for (const id of ["paper-title-card", "document-typewriter-reveal"]) {
    const low = await run(searchScript, ["--query", id, "--energy", "high", "--top", "8"]);
    assert.ifError(low.error);
    assert.ok(!JSON.parse(low.stdout).results.some((item: any) => item.id === id), `${id} is low/medium despite high-energy wording`);
  }
  const energyIndex = JSON.parse(await readFile(resolve(root, ".agents/skills/storyboard-enhance/references/shotcraft/search-index.json"), "utf8"));
  assert.equal(energyIndex.cards.find((item: any) => item.id === "paper-title-card").energyBand, "low");
  assert.equal(energyIndex.cards.find((item: any) => item.id === "document-typewriter-reveal").energyBand, "low_medium");
  assert.equal(energyIndex.cards.find((item: any) => item.id === "outline-word-fill").energyBand, "high");
});

test("Shotcraft search has stable tie ordering, category filtering, and excludes retired cards", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "shotcraft-search-"));
  const indexPath = resolve(directory, "index.json");
  try {
    await writeFile(indexPath, JSON.stringify({version: 1, cards: [
      {id: "z-card", category: "typography", name: "z-card", retrieval: ["same"], constraints: [], energy: "high", variants: 1, compatibility: "source_only", retired: false},
      {id: "a-card", category: "typography", name: "a-card", retrieval: ["same"], constraints: [], energy: "high", variants: 2, compatibility: "source_only", retired: false},
      {id: "retired-card", category: "typography", name: "retired-card", retrieval: ["same"], constraints: [], energy: "high", variants: 1, compatibility: "blocked", retired: true},
      {id: "other-category", category: "transition", name: "other-category", retrieval: ["same"], constraints: [], energy: "high", variants: 1, compatibility: "source_only", retired: false},
    ]}));
    const first = await run(searchScript, ["--index", indexPath, "--query", "same", "--top", "8", "--category", "typography"]);
    const second = await run(searchScript, ["--index", indexPath, "--query", "same", "--top", "8", "--category", "typography"]);
    assert.ifError(first.error);
    assert.ifError(second.error);
    const result = JSON.parse(first.stdout).results;
    assert.deepEqual(result.map((item: any) => item.id), ["a-card", "z-card"]);
    assert.deepEqual(JSON.parse(second.stdout).results, result);
    assert.ok(result.every((item: any) => item.category === "typography"));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("Shotcraft empty query is rejected and unknown inspect IDs fail clearly", async () => {
  const empty = await run(searchScript, ["--query", "   "]);
  assert.notEqual(empty.error, null);
  assert.match(empty.stderr, /query.*non-empty/i);
  const unknown = await run(inspectScript, ["--", "not-a-shot"]);
  assert.notEqual(unknown.error, null);
  assert.match(unknown.stderr, /not found/i);
});

test("Shotcraft search index is compact metadata with English retrieval terms and unchanged upstream text", async () => {
  const index = JSON.parse(await readFile(resolve(root, ".agents/skills/storyboard-enhance/references/shotcraft/search-index.json"), "utf8"));
  const catalog = JSON.parse(await readFile(resolve(root, ".agents/skills/storyboard-enhance/references/shotcraft/catalog.json"), "utf8"));
  assert.equal(index.version, 1);
  assert.equal(index.cards.length, catalog.cards.length);
  for (const item of index.cards) {
    const source = catalog.cards.find((card: any) => card.id === item.id);
    assert.ok(source, item.id);
    assert.equal(item.summary, source.summary);
    assert.equal(item.use, source.use);
    assert.ok(item.retrieval.every((term: string) => /^[a-z0-9 -]+$/.test(term)), item.id);
    assert.ok(!("closure" in item) && !("source" in item), "search index must not duplicate source metadata");
  }
});

test("Shotcraft inspect resolves the requested variant and keeps multi-variant card demos explicitly card-level", async () => {
  const selected = await run(inspectScript, ["--", "wall-reveal-moves", "--variant", "wireframe-draw-on"]);
  assert.ifError(selected.error);
  const result = JSON.parse(selected.stdout);
  assert.equal(result.card.id, "wall-reveal-moves");
  assert.equal(result.selection.id, "wireframe-draw-on");
  assert.equal(result.selection.source.mapping, "card_reference");
  assert.ok(result.selection.source.demo.includes("demos/ui-entrance/wall-reveal-moves/WireframeDrawOn.tsx"));
  assert.ok(result.selection.source.closure.includes("demos/ui-entrance/wall-reveal-moves/WireframeDrawOn.tsx"));
  assert.ok(result.inputs.parameters.some((value: string) => value.startsWith("A 节拍")));
  assert.ok(result.inputs.constraints.some((value: string) => value.includes("暗态 opacity 0.18")));

  const unresolved = await run(inspectScript, ["--", "wall-reveal-moves"]);
  assert.ifError(unresolved.error);
  const full = JSON.parse(unresolved.stdout);
  assert.equal(full.selection, null);
  assert.equal(full.selectionRequired, true);
  assert.deepEqual(full.variants.map((variant: any) => variant.id), ["bento-light-up", "wireframe-draw-on"]);
});

test("Shotcraft inspect exposes a recorded preview reference but does not imply a preview is fetched", async () => {
  const result = await run(inspectScript, ["--", "wall-reveal-moves", "--variant", "wireframe-draw-on"]);
  assert.ifError(result.error);
  const preview = JSON.parse(result.stdout).preview;
  assert.match(preview.source, /releases\/download\/gallery-media\/wireframe-draw-on\.mp4$/);
  assert.equal(preview.status, "not_fetched");
  assert.equal(preview.ready, false);
  assert.equal(preview.kind, "motion_video");
  const single = await run(inspectScript, ["--", "blur-slide"]);
  assert.ifError(single.error);
  const singlePreview = JSON.parse(single.stdout).preview;
  assert.match(singlePreview.source, /blur-slide\.mp4$/);
  assert.equal(singlePreview.ready, false);
  assert.equal(singlePreview.status, "not_fetched");
});

test("Shotcraft preview for an automatically resolved sole variant is available without a variant key", async () => {
  const {resolvePreviewForSelection} = await import(pathToFileURL(resolve(root, "scripts/shotcraft-inspection.mjs")).href);
  const card = {variants: [{id: "only-variant"}]};
  const indexed = {variants: [{id: "only-variant", preview: {source: "https://example.invalid/only.mp4"}}]};
  assert.deepEqual(resolvePreviewForSelection(card, indexed), indexed.variants[0].preview);
  assert.equal(resolvePreviewForSelection({variants: [{id: "a"}, {id: "b"}]}, indexed), null);
});

test("Shotcraft fetches a sole card variant preview without a redundant variant key", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "shotcraft-single-fetch-"));
  try {
    const {inspectShotcraftItem} = await import(pathToFileURL(resolve(root, "scripts/shotcraft-inspection.mjs")).href);
    const bytes = await readFile(resolve(root, "tests/fixtures/shotcraft/tiny-preview.mp4"));
    const result = await inspectShotcraftItem(root, "blur-slide", {
      fetchPreview: true,
      previewDirectory: directory,
      fetchImpl: async () => new Response(new Uint8Array(bytes), {status: 200, headers: {"content-type": "video/mp4", "content-length": String(bytes.length)}}),
    });
    assert.equal(result.selection.id, "blur-slide");
    assert.equal(result.preview.status, "fetched");
    assert.equal(result.preview.ready, true);
    assert.equal(result.preview.record.source, result.preview.source);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("Shotcraft search implementation reads only the compact index", async () => {
  const source = await readFile(searchScript, "utf8");
  assert.match(source, /search-index\.json/);
  assert.doesNotMatch(source, /third-party[\\/]video-shotcraft[\\/]source/);
});

test("Shotcraft preview fetch writes only a motion preview with source, size, and checksum provenance", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "shotcraft-preview-"));
  try {
    const {fetchPreviewAsset} = await import(pathToFileURL(resolve(root, "scripts/shotcraft-preview.mjs")).href);
    const bytes = await readFile(resolve(root, "tests/fixtures/shotcraft/tiny-preview.mp4"));
    const record = await fetchPreviewAsset({
      source: "https://github.com/Vincentwei1021/video-shotcraft/releases/download/gallery-media/example.mp4",
      upstreamPath: "gallery/media/example.mp4",
    }, directory, async () => new Response(new Uint8Array(bytes), {status: 200, headers: {"content-type": "video/mp4", "content-length": String(bytes.length)}}));
    assert.equal(record.kind, "motion_video");
    assert.equal(record.sizeBytes, bytes.length);
    assert.equal(record.sha256, (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"));
    assert.equal(record.upstreamPath, "gallery/media/example.mp4");
    assert.deepEqual(await readFile(record.localPath), bytes);
    await assert.rejects(readFile(resolve(root, ".video/assets.json")));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("Shotcraft preview fetch is idempotent for a matching cached media and provenance pair", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "shotcraft-preview-repeat-"));
  const preview = {
    source: "https://github.com/Vincentwei1021/video-shotcraft/releases/download/gallery-media/repeat.mp4",
    upstreamPath: "gallery/media/repeat.mp4",
  };
  try {
    const {fetchPreviewAsset} = await import(pathToFileURL(resolve(root, "scripts/shotcraft-preview.mjs")).href);
    const bytes = await readFile(resolve(root, "tests/fixtures/shotcraft/tiny-preview.mp4"));
    const fetchImpl = async () => new Response(new Uint8Array(bytes), {status: 200, headers: {"content-type": "video/mp4"}});
    const first = await fetchPreviewAsset(preview, directory, fetchImpl);
    const second = await fetchPreviewAsset(preview, directory, fetchImpl);
    assert.deepEqual(second, first);
    assert.deepEqual(await readFile(first.localPath), bytes);
    assert.deepEqual(JSON.parse(await readFile(`${first.localPath}.json`, "utf8")), first);
    assert.deepEqual((await readdir(directory)).sort(), ["repeat.mp4", "repeat.mp4.json"]);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("Shotcraft preview fetch rejects a stale sidecar without changing either cached file", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "shotcraft-preview-stale-"));
  const preview = {
    source: "https://github.com/Vincentwei1021/video-shotcraft/releases/download/gallery-media/stale.mp4",
    upstreamPath: "gallery/media/stale.mp4",
  };
  try {
    const {fetchPreviewAsset} = await import(pathToFileURL(resolve(root, "scripts/shotcraft-preview.mjs")).href);
    const bytes = await readFile(resolve(root, "tests/fixtures/shotcraft/tiny-preview.mp4"));
    const fetchImpl = async () => new Response(new Uint8Array(bytes), {status: 200, headers: {"content-type": "video/mp4"}});
    const record = await fetchPreviewAsset(preview, directory, fetchImpl);
    const stale = {...record, sha256: "f".repeat(64)};
    await writeFile(`${record.localPath}.json`, `${JSON.stringify(stale)}\n`);
    const sidecarBefore = await readFile(`${record.localPath}.json`);
    await assert.rejects(fetchPreviewAsset(preview, directory, fetchImpl), /cached preview pair is inconsistent/i);
    assert.deepEqual(await readFile(record.localPath), bytes);
    assert.deepEqual(await readFile(`${record.localPath}.json`), sidecarBefore);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("Shotcraft preview fetch repairs a media-only artifact left by an interrupted prior fetch", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "shotcraft-preview-incomplete-"));
  const preview = {
    source: "https://github.com/Vincentwei1021/video-shotcraft/releases/download/gallery-media/incomplete.mp4",
    upstreamPath: "gallery/media/incomplete.mp4",
  };
  try {
    const {fetchPreviewAsset} = await import(pathToFileURL(resolve(root, "scripts/shotcraft-preview.mjs")).href);
    const bytes = await readFile(resolve(root, "tests/fixtures/shotcraft/tiny-preview.mp4"));
    const fetchImpl = async () => new Response(new Uint8Array(bytes), {status: 200, headers: {"content-type": "video/mp4"}});
    await writeFile(resolve(directory, "incomplete.mp4"), Buffer.from("incomplete old media"));
    const record = await fetchPreviewAsset(preview, directory, fetchImpl);
    assert.deepEqual(await readFile(record.localPath), bytes);
    assert.deepEqual(JSON.parse(await readFile(`${record.localPath}.json`, "utf8")), record);
    assert.deepEqual((await readdir(directory)).sort(), ["incomplete.mp4", "incomplete.mp4.json"]);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("Shotcraft preview fetch repairs a provenance-only artifact left by an interrupted prior fetch", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "shotcraft-preview-sidecar-only-"));
  const preview = {
    source: "https://github.com/Vincentwei1021/video-shotcraft/releases/download/gallery-media/sidecar-only.mp4",
    upstreamPath: "gallery/media/sidecar-only.mp4",
  };
  try {
    const {fetchPreviewAsset} = await import(pathToFileURL(resolve(root, "scripts/shotcraft-preview.mjs")).href);
    const bytes = await readFile(resolve(root, "tests/fixtures/shotcraft/tiny-preview.mp4"));
    const fetchImpl = async () => new Response(new Uint8Array(bytes), {status: 200, headers: {"content-type": "video/mp4"}});
    await writeFile(resolve(directory, "sidecar-only.mp4.json"), JSON.stringify({source: preview.source}));
    const record = await fetchPreviewAsset(preview, directory, fetchImpl);
    assert.deepEqual(await readFile(record.localPath), bytes);
    assert.deepEqual(JSON.parse(await readFile(`${record.localPath}.json`, "utf8")), record);
    assert.deepEqual((await readdir(directory)).sort(), ["sidecar-only.mp4", "sidecar-only.mp4.json"]);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("Shotcraft preview fetch refuses changed bytes for an already cached release path", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "shotcraft-preview-conflict-"));
  const preview = {
    source: "https://github.com/Vincentwei1021/video-shotcraft/releases/download/gallery-media/conflict.mp4",
    upstreamPath: "gallery/media/conflict.mp4",
  };
  try {
    const {fetchPreviewAsset} = await import(pathToFileURL(resolve(root, "scripts/shotcraft-preview.mjs")).href);
    const bytes = await readFile(resolve(root, "tests/fixtures/shotcraft/tiny-preview.mp4"));
    const changed = Buffer.concat([bytes, Buffer.from("different release bytes")]);
    const fetchBytes = (body: Buffer) => async () => new Response(new Uint8Array(body), {status: 200, headers: {"content-type": "video/mp4"}});
    const record = await fetchPreviewAsset(preview, directory, fetchBytes(bytes));
    await assert.rejects(fetchPreviewAsset(preview, directory, fetchBytes(changed)), /conflict|different bytes/i);
    assert.deepEqual(await readFile(record.localPath), bytes);
    assert.equal(JSON.parse(await readFile(`${record.localPath}.json`, "utf8")).sha256, createHash("sha256").update(bytes).digest("hex"));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("Shotcraft preview fetch rolls back media when provenance promotion fails", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "shotcraft-preview-rollback-"));
  const preview = {
    source: "https://github.com/Vincentwei1021/video-shotcraft/releases/download/gallery-media/rollback.mp4",
    upstreamPath: "gallery/media/rollback.mp4",
  };
  try {
    const {fetchPreviewAsset} = await import(pathToFileURL(resolve(root, "scripts/shotcraft-preview.mjs")).href);
    const bytes = await readFile(resolve(root, "tests/fixtures/shotcraft/tiny-preview.mp4"));
    const fetchImpl = async () => new Response(new Uint8Array(bytes), {status: 200, headers: {"content-type": "video/mp4"}});
    const renameWithSidecarFailure = async (from: string, to: string) => {
      if (to.endsWith("rollback.mp4.json")) throw new Error("injected provenance promotion failure");
      await rename(from, to);
    };
    await assert.rejects(fetchPreviewAsset(preview, directory, fetchImpl, {rename: renameWithSidecarFailure}), /provenance promotion failure/i);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("Shotcraft preview fetch rejects still bytes labeled octet-stream and corrupt video/mp4", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "shotcraft-preview-invalid-"));
  const preview = {
    source: "https://github.com/Vincentwei1021/video-shotcraft/releases/download/gallery-media/invalid.mp4",
    upstreamPath: "gallery/media/invalid.mp4",
  };
  try {
    const {fetchPreviewAsset} = await import(pathToFileURL(resolve(root, "scripts/shotcraft-preview.mjs")).href);
    const still = await readFile(resolve(root, "tests/fixtures/shotcraft/tiny-preview-still.png"));
    for (const [body, contentType] of [[still, "application/octet-stream"], [Buffer.from("corrupt video"), "video/mp4"]] as const) {
      await assert.rejects(fetchPreviewAsset(preview, directory, async () => new Response(new Uint8Array(body), {status: 200, headers: {"content-type": contentType}})), /invalid|video|ffprobe|decode/i);
    }
    assert.deepEqual(await (await import("node:fs/promises")).readdir(directory), []);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("Shotcraft preview reports validation unavailable when local media tools are absent", async () => {
  const {validatePreviewVideo} = await import(pathToFileURL(resolve(root, "scripts/shotcraft-preview.mjs")).href);
  await assert.rejects(validatePreviewVideo("missing.mp4", {ffprobePath: undefined, ffmpegPath: undefined}), /validation unavailable.*no binary is downloaded/i);
});

test("Shotcraft preview fetch failure does not create a ready artifact", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "shotcraft-preview-fail-"));
  try {
    const {fetchPreviewAsset} = await import(pathToFileURL(resolve(root, "scripts/shotcraft-preview.mjs")).href);
    await assert.rejects(fetchPreviewAsset({
      source: "https://github.com/Vincentwei1021/video-shotcraft/releases/download/gallery-media/missing.mp4",
      upstreamPath: "gallery/media/missing.mp4",
    }, directory, async () => new Response("missing", {status: 404})));
    assert.deepEqual(await (await import("node:fs/promises")).readdir(directory), []);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
