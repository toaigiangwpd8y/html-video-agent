import {performance} from "node:perf_hooks";
import {defaultCatalogPath, findInstalledItem, loadSnapshot, parseArgs} from "./onda-registry-utils.mjs";

const STOP_WORDS = new Set(["a", "an", "and", "for", "in", "is", "not", "of", "on", "the", "to", "with"]);

export function tokenize(value) {
  return [...new Set(String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(token => token && !STOP_WORDS.has(token)))];
}

export function assertEnglishQuery(value) {
  if ([...String(value ?? "")].some(character => character.codePointAt(0) > 0x7f)) {
    throw new Error("Onda discovery queries must use English visual search terms");
  }
}

function fieldTokens(value) {
  return new Set(tokenize(value));
}

export function scoreItem(item, queryTokens, queryPhrase, preferredCategories = []) {
  const fields = {
    name: fieldTokens(item.name),
    slug: fieldTokens(item.slug),
    category: fieldTokens(item.category),
    tags: fieldTokens(item.tags?.join(" ")),
    description: fieldTokens(item.description),
  };
  const exactPhrase = [item.name, item.slug].some(value =>
    tokenize(value).join(" ") === queryPhrase || tokenize(value).join(" ").includes(queryPhrase));
  let score = exactPhrase ? 12 : 0;
  for (const token of queryTokens) {
    if (fields.name.has(token)) score += 8;
    if (fields.slug.has(token)) score += 7;
    if (fields.category.has(token)) score += 5;
    if (fields.tags.has(token)) score += 4;
    if (fields.description.has(token)) score += 2;
    if ([item.name, item.slug, item.category, ...(item.tags ?? []), item.description]
      .some(value => String(value).toLowerCase().includes(token))) score += 1;
  }
  if (preferredCategories.includes(item.category)) score += 1;
  return score;
}

export function searchCatalog(items, query, {top = 8, minScore = 4, categories = []} = {}) {
  const queryTokens = tokenize(query);
  const queryPhrase = queryTokens.join(" ");
  if (queryTokens.length === 0) return [];
  return items.map(item => ({item, score: scoreItem(item, queryTokens, queryPhrase, categories)}))
    .filter(result => result.score >= minScore)
    .sort((left, right) => right.score - left.score || left.item.slug.localeCompare(right.item.slug))
    .slice(0, top);
}

function numberOption(value, name, min, max, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  }
  return number;
}

const started = performance.now();
let timing = false;
try {
  const {options} = parseArgs(process.argv.slice(2));
  timing = Boolean(options.timing);
  if (options.help) {
    console.log("Usage: npm run registry:search -- --provider onda --query TEXT [--top 8] [--min-score 4] [--category media,scenes]");
    process.exit(0);
  }
  if (options.provider !== "onda") throw new Error("Only --provider onda is supported in Registry V2.1");
  if (!options.query) throw new Error("--query is required");
  assertEnglishQuery(options.query);
  const top = numberOption(options.top, "top", 1, 20, 8);
  const minScore = numberOption(options["min-score"], "min-score", 0, Number.MAX_SAFE_INTEGER, 4);
  const categories = options.category ? String(options.category).split(",").map(value => value.trim()).filter(Boolean) : [];
  const snapshot = await loadSnapshot();
  const matches = searchCatalog(snapshot.items, options.query, {top, minScore, categories});
  const results = [];
  for (const match of matches) {
    const installed = await findInstalledItem(match.item.slug, defaultCatalogPath);
    results.push({
      id: match.item.id,
      slug: match.item.slug,
      name: match.item.name,
      category: match.item.category,
      description: match.item.description,
      score: match.score,
      installed: Boolean(installed),
      ...(installed ? {localId: installed.id, sourcePath: installed.sourcePath} : {}),
    });
  }
  console.log(JSON.stringify({query: options.query, provider: "onda", results}));
} catch (error) {
  console.error(`registry:search failed: ${error.message}`);
  process.exitCode = 1;
}

if (timing) console.error(`registry search: ${(performance.now() - started).toFixed(2)}ms`);
