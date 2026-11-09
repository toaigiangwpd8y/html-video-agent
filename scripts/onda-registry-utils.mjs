import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {lstat, mkdir, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, relative, resolve, sep, win32} from "node:path";
import {fileURLToPath} from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const defaultSnapshotPath = resolve(repoRoot, ".agents/skills/storyboard-enhance/references/registry/upstream/onda.snapshot.json");
export const defaultCatalogPath = resolve(repoRoot, ".agents/skills/storyboard-enhance/references/registry/catalog.json");
export const ondaRepo = "https://github.com/degueba/onda";
export const ondaRegistry = "https://remotion.onda.video/r";

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function writeJsonAtomic(filePath, value) {
  await mkdir(dirname(filePath), {recursive: true});
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, {force: true});
    throw error;
  }
}

export function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const key = argument.slice(2);
    if (key === "help" || key === "json" || key === "skip-typecheck" || key === "timing") {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    index += 1;
  }
  return {options, positionals};
}

export function safeSlug(slug) {
  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`Unsafe Onda slug: ${slug}`);
  }
  return slug;
}

export function kindForCategory(category) {
  if (category === "scenes") return "scene";
  if (category === "transitions") return "transition";
  if (category === "atmosphere") return "effect";
  return "primitive";
}

export function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems)) throw new Error("Onda list output must be an array");
  const items = rawItems.map((raw) => {
    const slug = safeSlug(raw.name ?? raw.slug);
    const category = String(raw.category ?? "").trim();
    if (!category) throw new Error(`Onda item ${slug} is missing category`);
    return {
      id: `onda:${slug}`,
      slug,
      name: String(raw.title ?? raw.name ?? slug),
      category,
      kind: kindForCategory(category),
      description: String(raw.description ?? "").trim(),
      tags: Array.isArray(raw.tags) ? raw.tags.filter(tag => typeof tag === "string") : [],
      dependencies: Array.isArray(raw.dependencies) ? raw.dependencies : [],
      registryDependencies: Array.isArray(raw.registryDependencies) ? raw.registryDependencies : [],
    };
  });
  items.sort((left, right) => left.slug.localeCompare(right.slug));
  const slugs = new Set();
  for (const item of items) {
    if (slugs.has(item.slug)) throw new Error(`Duplicate Onda slug: ${item.slug}`);
    slugs.add(item.slug);
  }
  return items;
}

export function ondaPackage(version) {
  if (version === undefined) return "ondajs";
  if (typeof version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Unsafe Onda CLI version: ${version}`);
  }
  return `ondajs@${version}`;
}

export function runOnda(args, cwd = repoRoot, version) {
  const packageName = ondaPackage(version);
  const commandArgs = ["npx", "--yes", packageName, ...args];
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npx";
  const finalArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", commandArgs.map(value => /\s/.test(String(value)) ? `"${String(value).replaceAll('"', '\\"')}"` : String(value)).join(" ")]
    : ["--yes", packageName, ...args];
  return execFileSync(executable, finalArgs, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function ondaVersion(cwd = repoRoot) {
  return runOnda(["--version"], cwd).trim().split(/\r?\n/).pop();
}

export function isContained(rootPath, candidatePath) {
  const candidateRelative = relative(resolve(rootPath), resolve(candidatePath));
  return candidateRelative === "" ||
    (!isAbsolute(candidateRelative) && !win32.isAbsolute(candidateRelative) &&
      candidateRelative !== ".." && !candidateRelative.startsWith(`..${sep}`));
}

export async function walkFiles(directory) {
  const files = [];
  async function visit(current) {
    const entries = await readdir(current, {withFileTypes: true});
    for (const entry of entries) {
      const entryPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      } else {
        throw new Error(`Unsupported symlink or special file in Onda source: ${entryPath}`);
      }
    }
  }
  await visit(directory);
  return files.sort((left, right) => left.localeCompare(right));
}

export async function hashSourceClosure(directory) {
  const hash = createHash("sha256");
  for (const filePath of await walkFiles(directory)) {
    hash.update(relative(directory, filePath).split(sep).join("/"));
    hash.update("\0");
    hash.update(await readFile(filePath));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function findInstalledItem(slug, catalogPath = defaultCatalogPath) {
  let catalog;
  try {
    catalog = await readJson(catalogPath);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  return catalog.items?.find(item => item.provider === "onda" && (
    item.origin?.upstreamItem === slug ||
    item.id === `onda:${slug}` ||
    item.id === `onda-${slug}` ||
    item.sourcePath?.split(/[\\/]+/).includes(slug)
  ));
}

export async function loadSnapshot(snapshotPath = defaultSnapshotPath) {
  const snapshot = await readJson(snapshotPath);
  if (snapshot.provider !== "onda" || typeof snapshot.cliVersion !== "string" || !snapshot.cliVersion.trim() || !Array.isArray(snapshot.items)) {
    throw new Error(`Invalid Onda snapshot: ${snapshotPath}`);
  }
  return snapshot;
}

export async function projectDependencies(projectRoot = repoRoot) {
  const packageJson = await readJson(resolve(projectRoot, "remotion/package.json"));
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
}

function packageName(specifier) {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

export function externalImports(source) {
  const imports = new Set();
  const pattern = /(?:from\s*|import\s*\()\s*["']([^"']+)["']/g;
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  for (const match of code.matchAll(pattern)) {
    if (!match[1].startsWith(".")) imports.add(packageName(match[1]));
  }
  return imports;
}

export async function inspectSource(sourceRoot, projectRoot = repoRoot, peerDependencies = []) {
  const files = await walkFiles(sourceRoot);
  const sourceFiles = [];
  const imports = new Set();
  let unsafeRuntime = false;
  for (const filePath of files) {
    if (!/\.(?:ts|tsx|js|jsx)$/.test(filePath)) continue;
    const source = await readFile(filePath, "utf8");
    sourceFiles.push({filePath, source});
    for (const dependency of externalImports(source)) imports.add(dependency);
    if (/\b(?:Math\.random|Date\.now|performance\.now|setTimeout|setInterval|fetch\s*\(|WebSocket|window\.|document\.)/.test(source)) {
      unsafeRuntime = true;
    }
  }
  const installedDependencies = await projectDependencies(projectRoot);
  const declaredPeerDependencies = peerDependencies.map(packageName);
  const missingDependencies = [...new Set([...imports, ...declaredPeerDependencies])]
    .filter(dependency => !installedDependencies.has(dependency));
  let state = "ACCEPT";
  const reasons = [];
  if (unsafeRuntime) {
    state = "REJECT";
    reasons.push("source uses a wall-clock, runtime service, or non-deterministic API");
  } else if (missingDependencies.length > 0) {
    state = "NEEDS_REVIEW";
    reasons.push(`requires packages absent from remotion/package.json: ${missingDependencies.join(", ")}`);
  }
  return {
    state,
    reasons,
    files: sourceFiles.map(file => file.filePath),
    imports: [...imports].sort(),
    missingDependencies,
  };
}

export async function sourcePlan(sourceRoot, slug) {
  const componentsRoot = resolve(sourceRoot, "components");
  const componentFiles = (await walkFiles(componentsRoot)).filter(filePath =>
    filePath.includes(`${sep}${slug}${sep}`) && /\.(?:ts|tsx)$/.test(filePath));
  if (componentFiles.length === 0) throw new Error(`No component source found for Onda item ${slug}`);
  const primary = componentFiles.find(filePath => !filePath.endsWith("schema.ts")) ?? componentFiles[0];
  const libRoot = resolve(sourceRoot, "lib");
  const libFiles = await walkFiles(libRoot).catch(error => error?.code === "ENOENT" ? [] : Promise.reject(error));
  return {componentFiles, libFiles, primary};
}

export async function copySourcePlan(plan, sourceRoot, targetRoot, slug) {
  await mkdir(targetRoot, {recursive: true});
  const componentRoot = resolve(sourceRoot, "components", "entrances", slug);
  const actualComponentRoot = dirname(plan.primary);
  const copyOne = async (sourcePath, destinationPath) => {
    const sourceStat = await lstat(sourcePath);
    if (!sourceStat.isFile()) throw new Error(`Onda source is not a regular file: ${sourcePath}`);
    const destination = resolve(destinationPath);
    if (!isContained(targetRoot, destination)) throw new Error(`Onda vendor path escaped target: ${destination}`);
    await mkdir(dirname(destination), {recursive: true});
    let source = await readFile(sourcePath, "utf8");
    if (sourcePath.startsWith(actualComponentRoot)) {
      source = source.replaceAll(/(from\s*["'])(?:\.\.\/)+lib\//g, "$1./shared/");
    }
    await writeFile(destination, source, "utf8");
  };
  for (const filePath of plan.componentFiles) {
    await copyOne(filePath, resolve(targetRoot, relative(actualComponentRoot, filePath)));
  }
  for (const filePath of plan.libFiles) {
    await copyOne(filePath, resolve(targetRoot, "shared", relative(resolve(sourceRoot, "lib"), filePath)));
  }
  const primaryRelative = relative(actualComponentRoot, plan.primary);
  return resolve(targetRoot, primaryRelative);
}

export async function removeIfExists(path) {
  await rm(path, {recursive: true, force: true});
}
