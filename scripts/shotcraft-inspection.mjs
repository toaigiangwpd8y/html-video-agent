import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {fetchPreviewAsset} from "./shotcraft-preview.mjs";

const libraryDirectory = ".agents/skills/storyboard-enhance/references/shotcraft";
const snapshotDirectory = "third-party/video-shotcraft/source";

export function resolvePreviewForSelection(card, indexed, variantKey) {
  const variant = variantKey
    ? card.variants.find(item => item.id === variantKey)
    : card.variants.length === 1 ? card.variants[0] : undefined;
  if (!variant) return null;
  return indexed.variants.find(item => item.id === variant.id)?.preview ?? null;
}

export async function inspectShotcraftItem(root, id, {
  variantKey,
  fetchPreview = false,
  previewDirectory = resolve(root, "output/shotcraft/previews"),
  fetchImpl,
} = {}) {
  const base = resolve(root, libraryDirectory);
  const [catalog, index] = await Promise.all([
    readFile(resolve(base, "catalog.json"), "utf8").then(JSON.parse),
    readFile(resolve(base, "search-index.json"), "utf8").then(JSON.parse),
  ]);
  const card = catalog.cards.find(item => item.id === id);
  if (!card) throw new Error(`Shotcraft card not found: ${id}`);
  const indexed = index.cards.find(item => item.id === id);
  if (!indexed) throw new Error(`Shotcraft search metadata missing for card: ${id}`);
  const candidates = variantKey ? card.variants.filter(item => item.id === variantKey) : card.variants;
  if (!candidates.length) throw new Error(`Shotcraft variant not found for ${id}: ${variantKey}`);
  const variantEvidence = variant => ({
    id: variant.id,
    label: variant.label,
    description: variant.description,
    source: variant.source,
    preview: indexed.variants.find(item => item.id === variant.id)?.preview ?? null,
  });
  const sourceText = await readFile(resolve(root, snapshotDirectory, card.source.card), "utf8");
  const selection = variantKey ? variantEvidence(candidates[0]) : card.variants.length === 1 ? variantEvidence(card.variants[0]) : null;
  const result = {
    card: {id: card.id, category: card.category, name: card.name, source: card.source},
    inputs: extractInputs(sourceText),
    compatibility: "source_only",
    selectionRequired: !variantKey && card.variants.length > 1,
    selection,
    variants: card.variants.map(variantEvidence),
    preview: resolvePreviewForSelection(card, indexed, variantKey),
  };
  if (fetchPreview) {
    if (!result.selection) throw new Error("Choose an exact --variant before fetching a preview");
    if (!result.preview) throw new Error("No release video is recorded for the selected variant");
    result.preview.record = await fetchPreviewAsset(result.preview, previewDirectory, fetchImpl);
    result.preview.status = "fetched";
    result.preview.ready = true;
  } else if (result.preview) {
    result.preview.status = "not_fetched";
    result.preview.ready = false;
  }
  return result;
}

export function extractInputs(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const front = normalized.match(/^---\n([\s\S]*?)\n---/m)?.[1] ?? "";
  const field = label => front.match(new RegExp(`^${label}:\\s*(.+)$`, "m"))?.[1]?.trim();
  const section = name => {
    const heading = new RegExp(`^##\\s*${name}\\s*$`, "m").exec(normalized);
    if (!heading || heading.index === undefined) return "";
    const bodyStart = heading.index + heading[0].length;
    const following = /^##\s/m.exec(normalized.slice(bodyStart));
    const bodyEnd = following?.index === undefined ? normalized.length : bodyStart + following.index;
    return normalized.slice(bodyStart, bodyEnd).trim();
  };
  const lines = value => value.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("|") && !/^[-|\s]+$/.test(line));
  const tableRows = value => {
    const rows = value.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith("|") && !/^\|[\s|:-]+\|?$/.test(line));
    return rows.slice(1).map(line => line.split("|").slice(1, -1).map(cell => cell.trim()).filter(Boolean).join(" — "));
  };
  return {
    suitability: field("适用") ?? null,
    duration: field("时长") ?? null,
    energy: field("能量") ?? null,
    parameters: tableRows(section("参数表")),
    constraints: lines(section("已知坑")),
  };
}
