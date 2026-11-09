import {realpath, readFile, stat} from "node:fs/promises";
import {isAbsolute, relative, resolve, sep, win32} from "node:path";
import {fileURLToPath} from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const catalogPath = resolve(repoRoot, ".agents/skills/storyboard-enhance/references/registry/catalog.json");
const expectedTopLevelKeys = ["version", "purpose", "selection_contract", "items"];
const expectedSelectionKeys = [
  "blueprint_precedes_registry",
  "registry_is_optional",
  "none_is_valid",
  "registry_does_not_override_story_truth",
  "registry_does_not_override_asset_fit",
  "direct_remotion_remains_final_authoring_model"
];
const allowedProviders = new Set(["remotionui", "onda", "remotionbits"]);
const allowedKinds = new Set(["primitive", "scene", "transition", "effect"]);

function fail(message, sourceCatalogPath = catalogPath) {
  throw new Error(`${sourceCatalogPath}: ${message}`);
}

function requireNonEmptyString(value, label, sourceCatalogPath = catalogPath) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`, sourceCatalogPath);
  }
}

function isContained(rootPath, candidatePath) {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "" ||
    (!isAbsolute(relativePath) && !win32.isAbsolute(relativePath) &&
      relativePath !== ".." && !relativePath.startsWith(`..${sep}`));
}

function hasParentTraversal(sourcePath) {
  return sourcePath.split(/[\\/]+/).includes("..");
}

async function validateSourcePath(sourcePath, label, projectRoot, sourceCatalogPath) {
  requireNonEmptyString(sourcePath, `${label}.sourcePath`, sourceCatalogPath);
  if (isAbsolute(sourcePath) || win32.isAbsolute(sourcePath) || hasParentTraversal(sourcePath)) {
    fail(`${label}.sourcePath must be relative and contained under repo root: ${sourcePath}`, sourceCatalogPath);
  }

  const resolvedRoot = resolve(projectRoot);
  const resolvedSource = resolve(resolvedRoot, sourcePath);
  if (!isContained(resolvedRoot, resolvedSource)) {
    fail(`${label}.sourcePath must be relative and contained under repo root: ${sourcePath}`, sourceCatalogPath);
  }

  try {
    const [realRoot, realSource] = await Promise.all([realpath(resolvedRoot), realpath(resolvedSource)]);
    if (!isContained(realRoot, realSource)) {
      fail(`${label}.sourcePath must remain contained under repo root: ${sourcePath}`, sourceCatalogPath);
    }
    if (!(await stat(realSource)).isFile()) {
      fail(`${label}.sourcePath must resolve to a regular file: ${sourcePath}`, sourceCatalogPath);
    }
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      fail(`${label}.sourcePath must resolve to a regular file: ${sourcePath}`, sourceCatalogPath);
    }
    throw error;
  }
}

async function validateItem(item, index, ids, projectRoot, sourceCatalogPath) {
  const label = `items[${index}]`;
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    fail(`${label} must be an object`, sourceCatalogPath);
  }

  requireNonEmptyString(item.id, `${label}.id`, sourceCatalogPath);
  if (ids.has(item.id)) {
    fail(`${label}.id is duplicated: ${item.id}`, sourceCatalogPath);
  }
  ids.add(item.id);

  if (!allowedProviders.has(item.provider)) {
    fail(`${label}.provider must be one of remotionui, onda, remotionbits`, sourceCatalogPath);
  }
  if (!allowedKinds.has(item.kind)) {
    fail(`${label}.kind must be one of primitive, scene, transition, effect`, sourceCatalogPath);
  }
  requireNonEmptyString(item.description, `${label}.description`, sourceCatalogPath);

  if (!Array.isArray(item.capabilities) || item.capabilities.length === 0 ||
      item.capabilities.some(capability => typeof capability !== "string" || capability.trim().length === 0)) {
    fail(`${label}.capabilities must be a non-empty array of strings`, sourceCatalogPath);
  }

  if (!Array.isArray(item.inputs) || item.inputs.length === 0) {
    fail(`${label}.inputs must be a non-empty array`, sourceCatalogPath);
  }
  if (!Array.isArray(item.constraints)) {
    fail(`${label}.constraints must be an array`, sourceCatalogPath);
  }

  await validateSourcePath(item.sourcePath, label, projectRoot, sourceCatalogPath);

  if (item.origin === null || typeof item.origin !== "object" || Array.isArray(item.origin)) {
    fail(`${label}.origin must be an object`, sourceCatalogPath);
  }
  requireNonEmptyString(item.origin.repo, `${label}.origin.repo`, sourceCatalogPath);
  requireNonEmptyString(item.origin.revision, `${label}.origin.revision`, sourceCatalogPath);
}

export async function validateCatalog(catalog, projectRoot = repoRoot, sourceCatalogPath = catalogPath) {
  if (catalog === null || typeof catalog !== "object" || Array.isArray(catalog)) {
    fail("catalog must be an object", sourceCatalogPath);
  }

  const actualTopLevelKeys = Object.keys(catalog).sort();
  const sortedTopLevelKeys = [...expectedTopLevelKeys].sort();
  if (actualTopLevelKeys.length !== sortedTopLevelKeys.length ||
      actualTopLevelKeys.some((key, index) => key !== sortedTopLevelKeys[index])) {
    fail(`catalog must have exactly these top-level keys: ${expectedTopLevelKeys.join(", ")}`, sourceCatalogPath);
  }

  requireNonEmptyString(catalog.version, "version", sourceCatalogPath);
  requireNonEmptyString(catalog.purpose, "purpose", sourceCatalogPath);
  if (!Array.isArray(catalog.items)) {
    fail("items must be an array", sourceCatalogPath);
  }

  const selectionContract = catalog.selection_contract;
  if (selectionContract === null || typeof selectionContract !== "object" || Array.isArray(selectionContract)) {
    fail("selection_contract must be an object", sourceCatalogPath);
  }
  const actualSelectionKeys = Object.keys(selectionContract).sort();
  const expectedKeys = [...expectedSelectionKeys].sort();
  if (actualSelectionKeys.length !== expectedKeys.length ||
      actualSelectionKeys.some((key, index) => key !== expectedKeys[index])) {
    fail(`selection_contract must have exactly these keys: ${expectedSelectionKeys.join(", ")}`, sourceCatalogPath);
  }
  for (const key of expectedSelectionKeys) {
    if (selectionContract[key] !== true) {
      fail(`selection_contract.${key} must be true`, sourceCatalogPath);
    }
  }

  const ids = new Set();
  for (let index = 0; index < catalog.items.length; index += 1) {
    await validateItem(catalog.items[index], index, ids, projectRoot, sourceCatalogPath);
  }
  return catalog.items.length;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    let catalog;
    try {
      catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    } catch (error) {
      fail(`could not parse JSON: ${error.message}`);
    }
    const itemCount = await validateCatalog(catalog);
    console.log(`registry:check passed (${itemCount} item${itemCount === 1 ? "" : "s"})`);
  } catch (error) {
    console.error(`registry:check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
