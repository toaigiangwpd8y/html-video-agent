import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";

const root = process.cwd();
const snapshotPath = resolve(root, ".agents/skills/storyboard-enhance/references/registry/upstream/onda.snapshot.json");
const fixturePath = resolve(root, "tests/fixtures/onda-list.json");
const syncScript = resolve(root, "scripts/sync-onda-registry.mjs");

const run = (args: string[], cwd = root): Promise<{error: any; stdout: string; stderr: string}> =>
  new Promise(done => execFile(process.argv[0], [syncScript, ...args], {cwd}, (error, stdout, stderr) =>
    done({error, stdout: stdout ?? "", stderr: stderr ?? ""})));

const readJson = async (path: string): Promise<any> => JSON.parse(await readFile(path, "utf8"));

test("pinned Onda CLI package uses the snapshot version", async () => {
  const sourceUrl = `file:///${resolve(root, "scripts/onda-registry-utils.mjs").replaceAll("\\", "/")}`;
  const {ondaPackage} = await import(sourceUrl);
  assert.equal(ondaPackage("0.9.2"), "ondajs@0.9.2");
  assert.equal(ondaPackage(undefined), "ondajs");
  assert.throws(() => ondaPackage("latest"), /Unsafe Onda CLI version/);
});

test("Onda snapshot has the provider discovery contract and a full-ish catalog", async () => {
  const snapshot = await readJson(snapshotPath);
  assert.equal(snapshot.provider, "onda");
  assert.equal(typeof snapshot.revision, "string");
  assert.equal(typeof snapshot.cliVersion, "string");
  assert.equal("generatedAt" in snapshot, false);
  assert.equal(snapshot.itemCount, snapshot.items.length);
  assert.ok(snapshot.items.length >= 50);
  assert.equal(JSON.stringify(snapshot).includes("sourcePath"), false);

  const ids = snapshot.items.map((item: any) => item.id);
  const slugs = snapshot.items.map((item: any) => item.slug);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.deepEqual(slugs, [...slugs].sort());

  for (const item of snapshot.items) {
    assert.match(item.id, /^onda:[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.match(item.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(typeof item.name, "string");
    assert.equal(typeof item.category, "string");
    assert.ok(["primitive", "scene", "transition", "effect"].includes(item.kind));
    assert.equal(typeof item.description, "string");
    assert.ok(Array.isArray(item.tags));
    assert.ok(Array.isArray(item.dependencies));
    assert.ok(Array.isArray(item.registryDependencies));
  }

  const bySlug = new Map<string, any>(snapshot.items.map((item: any) => [item.slug, item]));
  assert.equal(bySlug.get("image-reveal").category, "media");
  assert.equal(bySlug.get("cross-fade").kind, "transition");
  assert.equal(bySlug.get("title-card").kind, "scene");
  assert.equal(bySlug.get("dynamic-grid").kind, "effect");
});

test("sync normalizes fixture metadata deterministically without installing source", async () => {
  const {mkdtemp, rm} = await import("node:fs/promises") as any;
  const dir = await mkdtemp(resolve(process.env.TEMP ?? ".", "onda-sync-test-"));
  const outputPath = resolve(dir, "onda.snapshot.json");
  try {
    const result = await run(["--input", fixturePath, "--output", outputPath]);
    assert.ifError(result.error);
    const snapshot = await readJson(outputPath);
    assert.deepEqual(snapshot.items.map((item: any) => item.slug), ["alpha-reveal", "wipe", "zeta-card"]);
    assert.equal(snapshot.items.find((item: any) => item.slug === "wipe").kind, "transition");
    assert.equal(snapshot.items.find((item: any) => item.slug === "zeta-card").kind, "scene");
    assert.equal(snapshot.items.find((item: any) => item.slug === "alpha-reveal").kind, "primitive");
    assert.equal("generatedAt" in snapshot, false);
    const firstOutput = await readFile(outputPath, "utf8");
    const secondResult = await run(["--input", fixturePath, "--output", outputPath]);
    assert.ifError(secondResult.error);
    assert.equal(await readFile(outputPath, "utf8"), firstOutput);
    assert.match(result.stdout, /synced 3 Onda items/i);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
