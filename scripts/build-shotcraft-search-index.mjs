import {readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {shotcraftRevision} from "./shotcraft-library.mjs";
import {energyBandFromText} from "./shotcraft-energy.mjs";

const root = process.cwd();
const base = resolve(root, ".agents/skills/storyboard-enhance/references/shotcraft");
const catalog = JSON.parse(await readFile(resolve(base, "catalog.json"), "utf8"));
const upstream = JSON.parse(await readFile(resolve(root, "third-party/video-shotcraft/source/gallery/api/library.json"), "utf8"));
const aliases = {
  "beat-step-list-theme-cycle": ["beat", "rhythm", "timed list", "step sequence", "theme cycle"],
  "crash-zoom-punch": ["zoom", "crash zoom", "punch in", "camera impact"],
  "quad-split-parallel-scenes": ["split", "split screen", "quad split", "parallel scenes", "multi panel", "ui"],
  "wall-reveal-moves": ["ui", "interface", "dashboard", "feature wall", "reveal"],
  "wipe-transitions": ["transition", "wipe", "scene change", "page change"],
  "word-relay-geometry": ["typography", "kinetic type", "animated words", "title", "word sequence"],
};
const mediaFile = value => {
  try { return new URL(value, "https://shotcraft.invalid/").pathname.split("/").at(-1); }
  catch { return undefined; }
};
const cards = catalog.cards.map(card => {
  const source = upstream.cards.find(item => item.name === card.id);
  const variants = card.variants.map(variant => {
    const upstreamVariant = source?.styles?.find(item => item.key === variant.id);
    const file = mediaFile(upstreamVariant?.media?.url ?? "");
    return {
      id: variant.id,
      label: variant.label,
      ...(file ? {preview: {
        kind: "motion_video",
        source: `https://github.com/Vincentwei1021/video-shotcraft/releases/download/gallery-media/${file}`,
        upstreamPath: `gallery/media/${file}`,
      }} : {}),
    };
  });
  const idTerms = card.id.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ");
  const energyBand = energyBandFromText(card.energy);
  const energyTerms = energyBand === "high" ? ["high", "energy"]
    : energyBand === "medium" ? ["medium", "energy"]
      : energyBand === "low_medium" ? ["low", "medium", "energy"]
        : energyBand === "low" ? ["low", "energy"] : [];
  const vocabulary = [card.category, ...card.tags, idTerms, ...energyTerms, ...(aliases[card.id] ?? [])];
  return {
    id: card.id,
    category: card.category,
    name: card.name,
    summary: card.summary,
    use: card.use,
    duration: card.duration,
    energy: card.energy,
    energyBand,
    intention: card.intention,
    constraints: [card.energy, card.intention].filter(Boolean),
    retrieval: [...new Set(vocabulary.flatMap(value => String(value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)))].sort(),
    variants,
    compatibility: "source_only",
    retired: false,
  };
});
const output = {version: 1, sourceRevision: shotcraftRevision, cardCount: cards.length, cards};
await writeFile(resolve(base, "search-index.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(`generated compact Shotcraft search index (${cards.length} cards)`);
