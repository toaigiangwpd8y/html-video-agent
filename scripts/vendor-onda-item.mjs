import {execFileSync} from "node:child_process";
import {lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {relative, resolve, sep} from "node:path";
import {validateCatalog} from "./validate-registry.mjs";
import {
  defaultCatalogPath,
  defaultSnapshotPath,
  findInstalledItem,
  hashSourceClosure,
  inspectSource,
  isContained,
  loadSnapshot,
  ondaRegistry,
  parseArgs,
  repoRoot,
  readJson,
  runOnda,
  safeSlug,
  sourcePlan,
  copySourcePlan,
  writeJsonAtomic,
  removeIfExists,
} from "./onda-registry-utils.mjs";

function peerDependenciesFrom(output) {
  const line = output.split(/\r?\n/).find(value => value.includes("npm install "));
  return line ? line.slice(line.indexOf("npm install ") + "npm install ".length).trim().split(/\s+/) : [];
}

function resultJson(result) {
  console.log(JSON.stringify(result));
}

async function runTypecheck(projectRoot) {
  const remotionRoot = resolve(projectRoot, "remotion");
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm run typecheck"] : ["run", "typecheck"];
  execFileSync(executable, args, {cwd: remotionRoot, stdio: "pipe", encoding: "utf8"});
}

const {options, positionals} = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log("Usage: npm run registry:onda:vendor -- <slug> --metadata FILE");
  process.exit(0);
}

async function loadReviewedMetadata(metadataPath) {
  if (!metadataPath) {
    throw new Error("Reviewed semantic metadata is required for a new vendor; pass --metadata FILE");
  }
  const metadata = await readJson(resolve(metadataPath));
  for (const field of ["capabilities", "inputs", "constraints"]) {
    if (!Array.isArray(metadata[field]) || !metadata[field].every(value => typeof value === "string" && value.trim())) {
      throw new Error(`Reviewed metadata field ${field} must be an array of non-empty strings`);
    }
  }
  if (metadata.capabilities.length === 0 || metadata.inputs.length === 0) {
    throw new Error("Reviewed metadata must include at least one capability and one input");
  }
  return {
    capabilities: metadata.capabilities,
    inputs: metadata.inputs,
    constraints: metadata.constraints,
  };
}

async function main() {
  const slug = safeSlug(positionals[0]);
  const projectRoot = resolve(options["project-root"] ?? repoRoot);
  const snapshot = await loadSnapshot(resolve(projectRoot, options.snapshot ?? defaultSnapshotPath));
  const item = snapshot.items.find(candidate => candidate.slug === slug);
  if (!item) throw new Error(`Onda slug not found in snapshot: ${slug}`);
  const catalogPath = resolve(projectRoot, options.catalog ?? defaultCatalogPath);
  const installed = await findInstalledItem(slug, catalogPath);
  if (installed) {
    resultJson({provider: "onda", id: item.id, slug, compatibility: "ACCEPT", vendor: "already-installed", localId: installed.id, sourcePath: installed.sourcePath});
    return;
  }

  const registryRoot = resolve(projectRoot, "remotion/registry/onda");
  const targetRoot = resolve(registryRoot, slug);
  if (!isContained(registryRoot, targetRoot)) throw new Error(`Unsafe Onda target path: ${targetRoot}`);
  let sourceRoot;
  let temporaryRoot;
  let cliOutput = "";
  try {
    if (options["source-dir"]) {
      sourceRoot = resolve(options["source-dir"]);
    } else {
      temporaryRoot = await mkdtemp(resolve(tmpdir(), "onda-vendor-"));
      sourceRoot = temporaryRoot;
      cliOutput = runOnda([
        "add", slug, "--no-barrel", "--components-out", "components", "--lib-out", "lib",
        "--registry", options.registry ?? snapshot.sourceRegistry ?? ondaRegistry,
      ], sourceRoot, snapshot.cliVersion);
    }
    const plan = await sourcePlan(sourceRoot, slug);
    const compatibility = await inspectSource(
      sourceRoot,
      resolve(options["dependency-root"] ?? projectRoot),
      peerDependenciesFrom(cliOutput),
    );
    const report = {
      provider: "onda",
      id: item.id,
      slug: item.slug,
      name: item.name,
      compatibility: compatibility.state,
      compatibilityReasons: compatibility.reasons,
      dependencies: peerDependenciesFrom(cliOutput),
    };
    if (compatibility.state !== "ACCEPT") {
      resultJson({...report, vendor: "not-installed"});
      process.exitCode = 1;
      return;
    }
    const reviewedMetadata = await loadReviewedMetadata(options.metadata);
    await mkdir(registryRoot, {recursive: true});
    const realRegistryRoot = await realpath(registryRoot);
    if (!isContained(resolve(projectRoot, "remotion/registry"), realRegistryRoot)) {
      throw new Error(`Onda registry directory escapes the project: ${realRegistryRoot}`);
    }
    const catalogBefore = await readFile(catalogPath, "utf8");
    const catalog = JSON.parse(catalogBefore);
    if (await (async () => { try { await lstat(targetRoot); return true; } catch (error) { return error?.code !== "ENOENT"; } })()) {
      throw new Error(`Target already exists but is not cataloged: ${targetRoot}`);
    }
    try {
      const primaryTarget = await copySourcePlan(plan, sourceRoot, targetRoot, slug);
      const vendorLicense = await readFile(resolve(repoRoot, "remotion/registry/onda/LICENSE"), "utf8");
      const vendorNotice = `# Source notice\n\nThis is the Onda component ${slug}, from ${snapshot.sourceRepo ?? "https://github.com/degueba/onda"} at commit ${snapshot.revision}. Local modifications are recorded in the repository registry source notice.\n\nThe accompanying LICENSE preserves the upstream MIT copyright and permission notice. Keep LICENSE with this component when copying or redistributing it.\n`;
      await writeFile(resolve(targetRoot, "LICENSE"), vendorLicense, "utf8");
      await writeFile(resolve(targetRoot, "SOURCE-NOTICE.md"), vendorNotice, "utf8");
      const sourcePath = relative(projectRoot, primaryTarget).split(sep).join("/");
      const sourceHash = await hashSourceClosure(targetRoot);
      if (!Array.isArray(catalog.items)) throw new Error("Catalog items must be an array");
      catalog.items.push({
        id: item.id,
        provider: "onda",
        kind: item.kind,
        name: item.name,
        description: item.description,
        ...reviewedMetadata,
        sourcePath,
        origin: {
          repo: snapshot.sourceRepo ?? "https://github.com/degueba/onda",
          revision: snapshot.revision,
          sourceHash,
          upstreamItem: slug,
        },
      });
      await writeJsonAtomic(catalogPath, catalog);
      await validateCatalog(catalog, projectRoot, catalogPath);
      if (!options["skip-typecheck"]) await runTypecheck(projectRoot);
      resultJson({...report, vendor: "installed", sourcePath, sourceHash});
    } catch (error) {
      await removeIfExists(targetRoot);
      await writeFile(catalogPath, catalogBefore, "utf8");
      throw error;
    }
  } finally {
    if (temporaryRoot) await rm(temporaryRoot, {recursive: true, force: true});
  }
}

try {
  await main();
} catch (error) {
  console.error(`registry:onda:vendor failed: ${error.message}`);
  process.exitCode = 1;
}
