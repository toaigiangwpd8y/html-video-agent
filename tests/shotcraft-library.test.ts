import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import test from "node:test";

const root = process.cwd();
const importer = resolve(root, "scripts/import-shotcraft-library.mjs");
const pinnedCatalogRevision = "43bd349a136651865ecfa6ea1cf012f6e957d304";
const repo = "https://github.com/Vincentwei1021/video-shotcraft";
const {execFileSync} = (await import("node:child_process")) as any;

const commitFixture = (source: string): string => {
  const git = (args: string[]) => execFileSync("git", args, {cwd: source, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  git(["init"]);
  git(["config", "user.name", "Shotcraft fixture"]);
  git(["config", "user.email", "shotcraft-fixture@example.invalid"]);
  git(["config", "core.autocrlf", "false"]);
  git(["add", "-A"]);
  git(["commit", "-m", "fixture"]);
  return git(["rev-parse", "HEAD"]);
};

const run = (args: string[], cwd = root): Promise<{error: any; stdout: string; stderr: string}> =>
  new Promise(done => execFile(process.execPath, [importer, ...args], {cwd}, (error, stdout, stderr) =>
    done({error, stdout: stdout ?? "", stderr: stderr ?? ""})));

test("pinned Shotcraft import preserves bytes with deterministic source hashes", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "shotcraft-import-"));
  const source = resolve(dir, "upstream");
  const output = resolve(dir, "snapshot");
  await mkdir(resolve(source, "demos/example"), {recursive: true});
  await writeFile(resolve(source, "demos/example/Shot.tsx"), Uint8Array.from([0xEF, 0xBB, 0xBF, 0x61, 0x0D, 0x0A]));
  await writeFile(resolve(source, "LICENSE"), "original license bytes\n");
  await writeFile(resolve(dir, "files.json"), JSON.stringify(["LICENSE", "demos/example/Shot.tsx"]));
  const revision = commitFixture(source);
  try {
    const first = await run(["--source", source, "--repo", repo, "--revision", revision, "--files", resolve(dir, "files.json"), "--output", output]);
    assert.ifError(first.error);
    const sourceBytes = await readFile(resolve(output, "source/demos/example/Shot.tsx"));
    assert.deepEqual([...sourceBytes], [...Uint8Array.from([0xEF, 0xBB, 0xBF, 0x61, 0x0D, 0x0A])]);
    assert.equal(await readFile(resolve(output, "LICENSE"), "utf8"), "original license bytes\n");
    const firstManifest = await readFile(resolve(output, "SOURCE.json"), "utf8");
    const sourceManifest = JSON.parse(firstManifest);
    const sourceBytesHash = createHash("sha256").update(Uint8Array.from([0xEF, 0xBB, 0xBF, 0x61, 0x0D, 0x0A])).digest("hex");
    assert.deepEqual(Object.keys(sourceManifest), ["repo", "revision", "importedAt", "files", "exclusions"]);
    assert.equal(sourceManifest.repo, repo);
    assert.equal(sourceManifest.revision, revision);
    assert.equal(sourceManifest.files.find((file: any) => file.path === "demos/example/Shot.tsx").sha256, sourceBytesHash);

    const secondOutput = resolve(dir, "snapshot-copy");
    const second = await run(["--source", source, "--repo", repo, "--revision", revision, "--files", resolve(dir, "files.json"), "--output", secondOutput]);
    assert.ifError(second.error);
    const secondManifest = JSON.parse(await readFile(resolve(secondOutput, "SOURCE.json"), "utf8"));
    assert.deepEqual(secondManifest.files, sourceManifest.files);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test("Shotcraft import requires a full immutable commit pin", async () => {
  const result = await run(["--repo", repo, "--source", root, "--revision", "main", "--files", "missing.json", "--output", "missing-output"]);
  assert.notEqual(result.error, null);
  assert.match(result.stderr, /40-character commit revision/i);
});

test("Shotcraft import rejects path traversal without writing a partial snapshot", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "shotcraft-import-traversal-"));
  const source = resolve(dir, "upstream");
  const output = resolve(dir, "snapshot");
  await mkdir(source, {recursive: true});
  await writeFile(resolve(source, "safe.txt"), "pinned\n");
  const revision = commitFixture(source);
  await writeFile(resolve(dir, "files.json"), JSON.stringify(["../outside.txt"]));
  try {
    const result = await run(["--source", source, "--repo", repo, "--revision", revision, "--files", resolve(dir, "files.json"), "--output", output]);
    assert.notEqual(result.error, null);
    assert.match(result.stderr, /unsafe source path/i);
    await assert.rejects(readFile(resolve(output, "SOURCE.json")));
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test("Shotcraft import rejects symlinked source paths", async t => {
  const dir = await mkdtemp(resolve(tmpdir(), "shotcraft-import-symlink-"));
  const source = resolve(dir, "upstream");
  const outside = resolve(dir, "outside");
  const output = resolve(dir, "snapshot");
  await mkdir(source, {recursive: true});
  await writeFile(resolve(source, "safe.txt"), "pinned\n");
  const revision = commitFixture(source);
  await mkdir(outside);
  await writeFile(resolve(outside, "target.txt"), "outside");
  try {
    try {
      await symlink(outside, resolve(source, "link-dir"), "junction");
    } catch (error: any) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        t.skip(`junction creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await writeFile(resolve(dir, "files.json"), JSON.stringify(["link-dir/target.txt"]));
    const result = await run(["--source", source, "--repo", repo, "--revision", revision, "--files", resolve(dir, "files.json"), "--output", output]);
    assert.notEqual(result.error, null);
    assert.match(result.stderr, /symlink/i);
    await assert.rejects(readFile(resolve(output, "SOURCE.json")));
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test("Shotcraft import rejects selected working-tree bytes that differ from the pinned Git blob", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "shotcraft-import-modified-"));
  const source = resolve(dir, "upstream");
  const output = resolve(dir, "snapshot");
  await mkdir(source, {recursive: true});
  await writeFile(resolve(source, "selected.tsx"), "committed source\n");
  const revision = commitFixture(source);
  await writeFile(resolve(source, "selected.tsx"), "altered working tree\n");
  await writeFile(resolve(dir, "files.json"), JSON.stringify(["selected.tsx"]));
  try {
    const result = await run(["--source", source, "--repo", repo, "--revision", revision, "--files", resolve(dir, "files.json"), "--output", output]);
    assert.notEqual(result.error, null);
    assert.match(result.stderr, /differs from pinned Git tree/i);
    await assert.rejects(readFile(resolve(output, "SOURCE.json")));
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test("checked-in Shotcraft catalog maps every current card and variant to existing sources", async () => {
  const catalogPath = resolve(root, ".agents/skills/storyboard-enhance/references/shotcraft/catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const sourceManifest = JSON.parse(await readFile(resolve(root, "third-party/video-shotcraft/SOURCE.json"), "utf8"));
  assert.equal(catalog.version, 1);
  assert.equal(catalog.sourceRevision, pinnedCatalogRevision);
  assert.equal(catalog.cards.length, 124);
  assert.equal(catalog.cards.reduce((sum: number, card: any) => sum + card.variants.length, 0), 150);
  assert.equal(new Set(catalog.cards.map((card: any) => card.id)).size, 124);
  assert.deepEqual(catalog.categoryCounts, {
    typography: {cards: 22, variants: 25},
    "ui-entrance": {cards: 21, variants: 22},
    transition: {cards: 15, variants: 19},
    effects: {cards: 15, variants: 23},
    opening: {cards: 11, variants: 11},
    interaction: {cards: 11, variants: 13},
    camera: {cards: 10, variants: 13},
    rhythm: {cards: 8, variants: 8},
    outro: {cards: 6, variants: 7},
    data: {cards: 5, variants: 9},
  });

  const snapshotRoot = resolve(root, "third-party/video-shotcraft/source");
  const inventoriedFiles = new Map<string, string>(sourceManifest.files.map((file: any) => [file.path, file.sha256]));
  for (const card of catalog.cards) {
    assert.ok(card.source.card && card.source.reference, card.id);
    for (const variant of card.variants) assert.equal(variant.source.mapping, "card_reference", card.id);
    for (const path of [card.source.card, card.source.reference, ...card.variants.flatMap((variant: any) => [...variant.source.demo, ...variant.source.closure])]) {
      await readFile(resolve(snapshotRoot, path));
      assert.ok(inventoriedFiles.has(path), `missing source inventory entry: ${path}`);
    }
  }
  for (const [path, expectedHash] of inventoriedFiles) {
    const bytes = await readFile(resolve(snapshotRoot, path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash, `source checksum mismatch: ${path}`);
  }
});
