import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {relative, resolve, sep} from "node:path";
import {
  defaultCatalogPath,
  defaultSnapshotPath,
  findInstalledItem,
  inspectSource,
  loadSnapshot,
  ondaRegistry,
  parseArgs,
  repoRoot,
  runOnda,
  sourcePlan,
} from "./onda-registry-utils.mjs";

function peerDependenciesFrom(output) {
  const line = output.split(/\r?\n/).find(value => value.includes("npm install "));
  return line ? line.slice(line.indexOf("npm install ") + "npm install ".length).trim().split(/\s+/) : [];
}

function plannedFiles(sourceRoot, plan) {
  return [...plan.componentFiles, ...plan.libFiles]
    .map(filePath => relative(sourceRoot, filePath).split(sep).join("/"));
}

const {options, positionals} = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log("Usage: npm run registry:onda:inspect -- <slug> [--json]");
  process.exit(0);
}
const slug = positionals[0];
if (!slug) {
  console.error("registry:onda:inspect failed: an Onda slug is required");
  process.exitCode = 1;
} else {
  let temporaryRoot;
  try {
    const projectRoot = resolve(options["project-root"] ?? repoRoot);
    const snapshot = await loadSnapshot(resolve(projectRoot, options.snapshot ?? defaultSnapshotPath));
    const item = snapshot.items.find(candidate => candidate.slug === slug);
    if (!item) throw new Error(`Onda slug not found in snapshot: ${slug}`);
    const installed = await findInstalledItem(slug, resolve(projectRoot, options.catalog ?? defaultCatalogPath));
    let sourceRoot;
    let cliOutput = "";
    if (options["source-dir"]) {
      sourceRoot = resolve(options["source-dir"]);
    } else {
      temporaryRoot = await mkdtemp(resolve(tmpdir(), "onda-inspect-"));
      sourceRoot = temporaryRoot;
      cliOutput = runOnda([
        "add", slug, "--no-barrel", "--components-out", "components", "--lib-out", "lib",
      "--registry", options.registry ?? snapshot.sourceRegistry ?? ondaRegistry,
    ], sourceRoot, snapshot.cliVersion);
    }
    const plan = await sourcePlan(sourceRoot, slug);
    const compatibility = await inspectSource(sourceRoot, projectRoot, peerDependenciesFrom(cliOutput));
    const result = {
      provider: "onda",
      id: item.id,
      slug: item.slug,
      name: item.name,
      category: item.category,
      kind: item.kind,
      description: item.description,
      dependencies: item.dependencies,
      registryDependencies: item.registryDependencies,
      installed: Boolean(installed),
      ...(installed ? {localId: installed.id, localSourcePath: installed.sourcePath} : {}),
      wouldInstall: plannedFiles(sourceRoot, plan),
      peerDependencies: peerDependenciesFrom(cliOutput),
      compatibility: compatibility.state,
      compatibilityReasons: compatibility.reasons,
    };
    if (options.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`${result.id} — ${result.name} (${result.category}/${result.kind})`);
      console.log(`Description: ${result.description}`);
      console.log(`Installed: ${result.installed ? "yes" : "no"}`);
      console.log(`Source files: ${result.wouldInstall.join(", ")}`);
      console.log(`Package dependencies: ${result.peerDependencies.join(", ") || "none reported"}`);
      console.log(`Compatibility: ${result.compatibility}${result.compatibilityReasons.length ? ` — ${result.compatibilityReasons.join("; ")}` : ""}`);
    }
  } catch (error) {
    console.error(`registry:onda:inspect failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (temporaryRoot) await rm(temporaryRoot, {recursive: true, force: true});
  }
}
