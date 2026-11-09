import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";

const root = process.cwd();
const vendorScript = resolve(root, "scripts/vendor-onda-item.mjs");
const fixtureRoot = resolve(root, "tests/fixtures/onda-vendor");

const run = (args: string[]): Promise<{error: any; stdout: string; stderr: string}> =>
  new Promise(done => execFile(process.argv[0], [vendorScript, ...args], {cwd: root}, (error, stdout, stderr) =>
    done({error, stdout: stdout ?? "", stderr: stderr ?? ""})));

test("vendor copies an accepted item transactionally into an isolated workspace", async () => {
  const {mkdtemp, rm} = await import("node:fs/promises") as any;
  const dir = await mkdtemp(resolve(process.env.TEMP ?? ".", "onda-vendor-test-"));
  const catalogPath = resolve(dir, "catalog.json");
  const projectRoot = dir;
  const catalog = {
    version: "0.1.0",
    purpose: "test catalog",
    selection_contract: {
      blueprint_precedes_registry: true,
      registry_is_optional: true,
      none_is_valid: true,
      registry_does_not_override_story_truth: true,
      registry_does_not_override_asset_fit: true,
      direct_remotion_remains_final_authoring_model: true,
    },
    items: [],
  };
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  const rootMarker = resolve(dir, "root.tsx");
  await writeFile(rootMarker, "export const untouched = true;\n", "utf8");

  try {
    const result = await run([
      "test-fade",
      "--project-root", projectRoot,
      "--snapshot", resolve(fixtureRoot, "snapshot.json"),
      "--catalog", catalogPath,
      "--source-dir", resolve(fixtureRoot, "source"),
      "--dependency-root", root,
      "--metadata", resolve(fixtureRoot, "metadata.json"),
      "--skip-typecheck",
    ]);
    assert.ifError(result.error);
    const output = JSON.parse(result.stdout);
    assert.equal(output.compatibility, "ACCEPT");
    assert.equal(output.vendor, "installed");
    assert.ok(output.sourcePath.endsWith("remotion/registry/onda/test-fade/TestFade.tsx") ||
      output.sourcePath.endsWith("remotion\\registry\\onda\\test-fade\\TestFade.tsx"));

    const sourcePath = resolve(dir, "remotion/registry/onda/test-fade/TestFade.tsx");
    assert.match(await readFile(sourcePath, "utf8"), /export const TestFade/);
    const updatedCatalog = JSON.parse(await readFile(catalogPath, "utf8"));
    assert.equal(updatedCatalog.items[0].id, "onda:test-fade");
    assert.equal(updatedCatalog.items[0].origin.upstreamItem, "test-fade");
    assert.deepEqual(updatedCatalog.items[0].capabilities, ["test-fade-reviewed"]);
    assert.deepEqual(updatedCatalog.items[0].inputs, ["children"]);
    assert.deepEqual(updatedCatalog.items[0].constraints, []);
    assert.match(updatedCatalog.items[0].origin.sourceHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(await readFile(rootMarker, "utf8"), "export const untouched = true;\n");
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test("vendor requires reviewed metadata before mutating the isolated workspace", async () => {
  const {mkdtemp, rm} = await import("node:fs/promises") as any;
  const dir = await mkdtemp(resolve(process.env.TEMP ?? ".", "onda-vendor-metadata-test-"));
  const catalogPath = resolve(dir, "catalog.json");
  await writeFile(catalogPath, `${JSON.stringify({version: "0.1.0", items: []}, null, 2)}\n`, "utf8");
  try {
    const result = await run([
      "test-fade",
      "--project-root", dir,
      "--snapshot", resolve(fixtureRoot, "snapshot.json"),
      "--catalog", catalogPath,
      "--source-dir", resolve(fixtureRoot, "source"),
      "--dependency-root", root,
      "--skip-typecheck",
    ]);
    assert.ok(result.error);
    assert.match(result.stderr, /reviewed metadata|--metadata/i);
    await assert.rejects(() => readFile(resolve(dir, "remotion/registry/onda/test-fade/TestFade.tsx"), "utf8"));
    assert.deepEqual(JSON.parse(await readFile(catalogPath, "utf8")).items, []);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test("vendor rolls back copied source and catalog when validation fails after mutation", async () => {
  const {mkdtemp, rm} = await import("node:fs/promises") as any;
  const dir = await mkdtemp(resolve(process.env.TEMP ?? ".", "onda-vendor-rollback-test-"));
  const catalogPath = resolve(dir, "catalog.json");
  const catalog = {
    version: "0.1.0",
    purpose: "test catalog",
    selection_contract: {
      blueprint_precedes_registry: true,
      registry_is_optional: true,
      none_is_valid: true,
      registry_does_not_override_story_truth: true,
      registry_does_not_override_asset_fit: true,
      direct_remotion_remains_final_authoring_model: true,
    },
    items: [],
  };
  const catalogBefore = `${JSON.stringify(catalog, null, 2)}\n`;
  await writeFile(catalogPath, catalogBefore, "utf8");
  const badSnapshotPath = resolve(dir, "bad-snapshot.json");
  const badSnapshot = JSON.parse(await readFile(resolve(fixtureRoot, "snapshot.json"), "utf8"));
  badSnapshot.items[0].kind = "bad-kind";
  await writeFile(badSnapshotPath, `${JSON.stringify(badSnapshot, null, 2)}\n`, "utf8");
  try {
    const result = await run([
      "test-fade",
      "--project-root", dir,
      "--snapshot", badSnapshotPath,
      "--catalog", catalogPath,
      "--source-dir", resolve(fixtureRoot, "source"),
      "--dependency-root", root,
      "--metadata", resolve(fixtureRoot, "metadata.json"),
      "--skip-typecheck",
    ]);
    assert.ok(result.error);
    assert.match(result.stderr, /kind must be one of/i);
    await assert.rejects(() => readFile(resolve(dir, "remotion/registry/onda/test-fade/TestFade.tsx"), "utf8"));
    assert.equal(await readFile(catalogPath, "utf8"), catalogBefore);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
