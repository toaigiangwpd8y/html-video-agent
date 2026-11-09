import {createHash} from "node:crypto";
import {lstat, readFile, readdir} from "node:fs/promises";
import {dirname, extname, join, relative, resolve, sep} from "node:path";

export const shotcraftRepo = "https://github.com/Vincentwei1021/video-shotcraft";
export const shotcraftRevision = "43bd349a136651865ecfa6ea1cf012f6e957d304";
export const exclusions = [
  "demos/_legacy/**: retired demos excluded from the current selectable library",
  "workbench/**: authoring workbench excluded from the source snapshot",
  "publish/**: publishing and upload tooling excluded",
  "jianying-export/**: external editor export tooling excluded",
  "assets/audio/** and template/public/audio/**: audio binaries excluded until separate rights review",
  "gallery/media/** and videos/**: preview and showcase media binaries excluded",
  "demos/_textures/** and template/public/textures/live/**: retained only as reference/compatibility fixtures; never production assets",
  "node_modules/**, package caches, and platform build outputs: generated dependencies excluded",
];

const posix = path => path.split(sep).join("/");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

export function validateSourcePath(path) {
  if (typeof path !== "string" || !path || path.includes("\\") || path.includes(":") || path.startsWith("/") || /^[a-z]:/i.test(path)) {
    throw new Error(`Unsafe source path: ${String(path)}`);
  }
  const parts = path.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || /[\u0000-\u001f]/.test(part))) {
    throw new Error(`Unsafe source path: ${path}`);
  }
  return path;
}

async function assertRegularSourceFile(sourceRoot, relativePath) {
  const safePath = validateSourcePath(relativePath);
  let current = resolve(sourceRoot);
  const rootStat = await lstat(current);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("Source root must be a real directory, not a symlink");
  for (const part of safePath.split("/")) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Symlink source path is not allowed: ${safePath}`);
  }
  const final = await lstat(current);
  if (!final.isFile()) throw new Error(`Source path is not a regular file: ${safePath}`);
  return current;
}

async function walkFiles(root, subdir) {
  const result = [];
  const visit = async directory => {
    for (const entry of (await readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = join(directory, entry.name);
      const relPath = posix(relative(root, fullPath));
      if (entry.isSymbolicLink()) throw new Error(`Symlink source path is not allowed: ${relPath}`);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) result.push(relPath);
    }
  };
  const target = join(root, subdir);
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error(`Symlink source path is not allowed: ${subdir}`);
    if (info.isDirectory()) await visit(target);
    else if (info.isFile()) result.push(posix(relative(root, target)));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return result;
}

function parseDemoPaths(referenceMarkdown) {
  const section = referenceMarkdown.split(/^##\s*参考实现\s*$/m).at(-1);
  if (section === referenceMarkdown) return [];
  const paths = [...section.matchAll(/\b(demos\/[a-zA-Z0-9_./-]+\.tsx)\b/g)].map(match => match[1]);
  const pattern = /((?:demos\/)[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/)\s*[\r\n\s]*[（(]([^）)\r\n]*)[）)]/g;
  for (const match of section.matchAll(pattern)) {
    const directory = match[1].replace(/\/$/, "");
    const files = [...match[2].matchAll(/([\w.-]+\.tsx)/g)].map(file => file[1]);
    for (const file of files) paths.push(`${directory}/${file}`);
  }
  return [...new Set(paths)].sort();
}

async function resolveRelativeImport(sourceRoot, importer, specifier) {
  const base = resolve(sourceRoot, dirname(importer), specifier);
  const candidates = extname(base) ? [base] : [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, join(base, "index.tsx"), join(base, "index.ts")];
  for (const candidate of candidates) {
    try {
      const stat = await lstat(candidate);
      if (stat.isSymbolicLink()) throw new Error(`Symlink source path is not allowed: ${posix(relative(sourceRoot, candidate))}`);
      if (stat.isFile()) return posix(relative(sourceRoot, candidate));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

export async function resolveDemoClosure(sourceRoot, demoPaths) {
  const found = new Set();
  const visit = async path => {
    if (found.has(path)) return;
    const absolute = await assertRegularSourceFile(sourceRoot, path);
    found.add(path);
    const text = await readFile(absolute, "utf8");
    const imports = [...text.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(match => match[1]).filter(value => value.startsWith("."));
    for (const specifier of imports) {
      const importedPath = await resolveRelativeImport(sourceRoot, path, specifier);
      if (importedPath) await visit(importedPath);
    }
  };
  for (const path of demoPaths) await visit(validateSourcePath(path));
  return [...found].sort();
}

export async function buildCatalog(sourceRoot, revision = shotcraftRevision) {
  const libraryPath = "gallery/api/library.json";
  const library = JSON.parse(await readFile(await assertRegularSourceFile(sourceRoot, libraryPath), "utf8"));
  const cards = [];
  for (const upstreamCard of library.cards) {
    const referencePath = validateSourcePath(upstreamCard.source);
    const publicSourcePath = validateSourcePath(upstreamCard.sourceUrl.startsWith("./")
      ? `gallery/${upstreamCard.sourceUrl.slice(2)}`
      : upstreamCard.sourceUrl);
    const referenceText = await readFile(await assertRegularSourceFile(sourceRoot, referencePath), "utf8");
    const demos = parseDemoPaths(referenceText);
    if (!demos.length) throw new Error(`No exact demo mapping in reference source: ${referencePath}`);
    const closure = await resolveDemoClosure(sourceRoot, demos);
    const card = {
      id: upstreamCard.name,
      category: upstreamCard.category,
      name: upstreamCard.name,
      summary: upstreamCard.summary,
      use: upstreamCard.use,
      duration: upstreamCard.duration,
      energy: upstreamCard.energy,
      intention: upstreamCard.intention,
      tags: upstreamCard.tags,
      source: {card: referencePath, reference: publicSourcePath},
      variants: upstreamCard.styles.map(variant => ({
        id: variant.key,
        label: variant.label,
        description: variant.description,
        ...(variant.use ? {use: variant.use} : {}),
        source: {mapping: "card_reference", demo: demos, closure},
      })),
    };
    cards.push(card);
  }
  const ids = cards.map(card => card.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate Shotcraft card IDs");
  const variantIds = cards.flatMap(card => card.variants.map(variant => variant.id));
  if (new Set(variantIds).size !== variantIds.length) throw new Error("Duplicate Shotcraft variant IDs");
  const categoryCounts = {};
  for (const card of cards) {
    categoryCounts[card.category] ??= {cards: 0, variants: 0};
    categoryCounts[card.category].cards++;
    categoryCounts[card.category].variants += card.variants.length;
  }
  return {
    version: 1,
    sourceRepo: shotcraftRepo,
    sourceRevision: revision,
    cardCount: cards.length,
    variantCount: variantIds.length,
    categoryCounts: Object.fromEntries(Object.entries(categoryCounts).sort(([a], [b]) => a.localeCompare(b))),
    cards: cards.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export async function selectSnapshotFiles(sourceRoot) {
  const library = JSON.parse(await readFile(await assertRegularSourceFile(sourceRoot, "gallery/api/library.json"), "utf8"));
  const selected = new Set(["LICENSE", "gallery/api/library.json", "references/sound-design.md", "references/music-beat-sync.md"]);
  const demos = [];
  for (const card of library.cards) {
    selected.add(validateSourcePath(card.source));
    selected.add(validateSourcePath(card.sourceUrl.startsWith("./") ? `gallery/${card.sourceUrl.slice(2)}` : card.sourceUrl));
    const reference = await readFile(await assertRegularSourceFile(sourceRoot, card.source), "utf8");
    demos.push(...parseDemoPaths(reference));
  }
  for (const path of await resolveDemoClosure(sourceRoot, demos)) selected.add(path);
  for (const subdir of ["demos/_fixtures", "demos/_textures", "assets/lib", "template/src", "template/public/textures/live"]) {
    for (const path of await walkFiles(sourceRoot, subdir)) {
      if (path.includes("/__tests__/") || path.endsWith("/__tests__")) continue;
      selected.add(path);
    }
  }
  for (const path of ["template/package.json", "template/TEMPLATE.md", "template/THEMES.md", "template/tsconfig.json", "template/remotion.config.ts"]) {
    try {
      await assertRegularSourceFile(sourceRoot, path);
      selected.add(path);
    } catch (error) {
      if (!String(error.message).includes("ENOENT")) throw error;
    }
  }
  const paths = [...selected].sort();
  for (const path of paths) await assertRegularSourceFile(sourceRoot, path);
  return paths;
}

export async function hashFile(sourceRoot, path) {
  return digest(await readFile(await assertRegularSourceFile(sourceRoot, path)));
}
