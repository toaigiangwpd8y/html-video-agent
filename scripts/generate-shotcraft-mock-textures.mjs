import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createCanvas, loadImage} from "@napi-rs/canvas";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "third-party/video-shotcraft/source");
const manifestPath = join(root, "third-party/video-shotcraft/SOURCE.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const pngs = manifest.files.filter(({path}) => path.toLowerCase().endsWith(".png"));

function color(seed, offset = 0) {
  const hue = (seed + offset * 61) % 360;
  return `hsl(${hue} 32% ${offset % 2 ? 89 : 95}%)`;
}

function drawTexture(ctx, width, height, name) {
  const seed = [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  ctx.fillStyle = "#f4f5f7";
  ctx.fillRect(0, 0, width, height);
  const scale = Math.max(1, width / 1920);
  const margin = Math.round(52 * scale);
  const navHeight = Math.max(18, Math.round(60 * scale));
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, navHeight);
  ctx.fillStyle = "#dfe3e8";
  ctx.fillRect(0, navHeight - 1, width, 1);
  ctx.fillStyle = "#52627a";
  ctx.fillRect(margin, Math.round(navHeight * .36), Math.max(18, Math.round(30 * scale)), Math.max(8, Math.round(12 * scale)));

  const cardGap = Math.round(18 * scale);
  const cardWidth = Math.max(12, Math.floor((width - margin * 2 - cardGap * 2) / 3));
  const cardHeight = Math.max(10, Math.round(150 * scale));
  const contentTop = navHeight + Math.round(38 * scale);
  const rows = Math.max(1, Math.ceil((height - contentTop - margin) / (cardHeight + cardGap)));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < 3; col++) {
      const x = margin + col * (cardWidth + cardGap);
      const y = contentTop + row * (cardHeight + cardGap);
      if (x + cardWidth > width || y + cardHeight > height) continue;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, cardWidth, cardHeight);
      ctx.strokeStyle = "#dfe3e8";
      ctx.strokeRect(x + .5, y + .5, cardWidth - 1, cardHeight - 1);
      const pad = Math.max(4, Math.round(15 * scale));
      ctx.fillStyle = color(seed, row * 3 + col);
      ctx.fillRect(x + pad, y + pad, Math.max(5, Math.round(cardWidth * .22)), Math.max(5, Math.round(cardHeight * .16)));
      ctx.fillStyle = "#c8ced6";
      ctx.fillRect(x + pad, y + pad * 2 + Math.round(cardHeight * .16), Math.round(cardWidth * .72), Math.max(2, Math.round(5 * scale)));
      ctx.fillStyle = "#e3e7ec";
      ctx.fillRect(x + pad, y + pad * 2 + Math.round(cardHeight * .16) + Math.round(10 * scale), Math.round(cardWidth * .52), Math.max(2, Math.round(4 * scale)));
      const bars = 5;
      const barWidth = Math.max(2, Math.floor((cardWidth - pad * 2) / (bars * 2 - 1)));
      const chartBottom = y + cardHeight - pad;
      for (let i = 0; i < bars; i++) {
        const barHeight = Math.max(3, Math.round((cardHeight * .18) + (((seed + row * 13 + col * 7 + i * 11) % 19) / 30) * cardHeight));
        ctx.fillStyle = i % 2 ? "#b9c8da" : "#8fa8c4";
        ctx.fillRect(x + pad + i * barWidth * 2, chartBottom - barHeight, barWidth, barHeight);
      }
    }
  }
}

for (const entry of pngs) {
  const file = join(sourceRoot, entry.path);
  const oldBytes = await readFile(file);
  const oldImage = await loadImage(oldBytes);
  const canvas = createCanvas(oldImage.width, oldImage.height);
  drawTexture(canvas.getContext("2d"), oldImage.width, oldImage.height, entry.path.split("/").at(-1));
  const bytes = canvas.toBuffer("image/png");
  await writeFile(file, bytes);
  entry.sha256 = createHash("sha256").update(bytes).digest("hex");
}

manifest.mediaReplacement = {
  generator: "scripts/generate-shotcraft-mock-textures.mjs",
  description: "Original PNG screenshot fixtures replaced with deterministic abstract dashboard textures; file paths and dimensions retained for demo compatibility.",
  sourcePaths: pngs.map(({path}) => path),
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${pngs.length} abstract PNG textures and refreshed ${relative(root, manifestPath)}.`);
