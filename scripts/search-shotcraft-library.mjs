import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {energyBandFromText} from "./shotcraft-energy.mjs";

const defaultIndex = ".agents/skills/storyboard-enhance/references/shotcraft/search-index.json";
const stopWords = new Set(["a", "an", "and", "for", "in", "is", "of", "on", "the", "to", "with"]);
export const tokenize = value => [...new Set(String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(token => token && !stopWords.has(token)))];

export function searchShotcraft(cards, query, {top = 8, category, energy} = {}) {
  const terms = tokenize(query);
  if (!terms.length) throw new Error("--query must be non-empty English text");
  return cards.filter(card => !card.retired && (!category || card.category === category) && (!energy || energyMatch(card.energyBand ?? card.energy, energy)))
    .map(card => {
      const fields = {
        name: tokenize(`${card.name} ${card.id}`),
        category: tokenize(card.category),
        retrieval: tokenize((card.retrieval ?? []).join(" ")),
        summary: tokenize(card.summary),
        use: tokenize(card.use),
      };
      const score = terms.reduce((sum, term) => sum +
        (fields.name.includes(term) ? 8 : 0) +
        (fields.retrieval.includes(term) ? 5 : 0) +
        (fields.category.includes(term) ? 3 : 0) +
        (fields.summary.includes(term) ? 2 : 0) +
        (fields.use.includes(term) ? 1 : 0), 0);
      return {card, score};
    }).filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id, "en"))
    .slice(0, top)
    .map(({card, score}) => ({
      id: card.id,
      category: card.category,
      fit: card.use,
      constraints: {duration: card.duration, energy: card.energy},
      variantCount: card.variants.length,
      compatibility: card.compatibility,
      score,
    }));
}

function energyMatch(value, requested) {
  if (requested !== "high") return false;
  return value === "high" || energyBandFromText(value) === "high";
}

function value(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const result = args[index + 1];
  if (!result || result.startsWith("--")) throw new Error(`${name} requires a value`);
  return result;
}

function numberOption(raw, fallback) {
  const number = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(number) || number < 1 || number > 20) throw new Error("--top must be an integer from 1 to 20");
  return number;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: npm run shotcraft:search -- --query TEXT --top 8 [--category NAME] [--energy high]");
    return;
  }
  const query = value(args, "--query");
  if (query === undefined) throw new Error("--query is required and must be non-empty");
  const top = numberOption(value(args, "--top"), 8);
  const category = value(args, "--category");
  const energy = value(args, "--energy");
  if (energy && energy !== "high") throw new Error("--energy supports only high");
  const indexPath = resolve(value(args, "--index") ?? defaultIndex);
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  const results = searchShotcraft(index.cards, query, {top, category, energy});
  console.log(JSON.stringify({query, count: results.length, results}, null, 2));
}

try { await main(); }
catch (error) {
  console.error(`shotcraft:search failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
