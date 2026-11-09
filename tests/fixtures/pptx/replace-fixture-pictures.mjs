import {readFile, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {createCanvas} from "@napi-rs/canvas";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const deckUrl = new URL("./two-slides.pptx", import.meta.url);
const provenanceUrl = new URL("./fixture-media-provenance.json", import.meta.url);
const zip = await JSZip.loadAsync(await readFile(deckUrl));
let provenance = {};
try { provenance = JSON.parse(await readFile(provenanceUrl, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const replacements = [];
for (const [path, entry] of Object.entries(zip.files)) {
  if (entry.dir || !path.startsWith("ppt/media/") || !/\.png$/i.test(path)) continue;
  const oldBytes = await entry.async("nodebuffer");
  if (provenance[path]?.generatedSha256 === sha256(oldBytes)) continue;
  const canvas = createCanvas(1, 1);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#52627a";
  ctx.fillRect(0, 0, 1, 1);
  const generated = canvas.toBuffer("image/png");
  zip.file(path, generated);
  provenance[path] = {
    originalSha256: provenance[path]?.originalSha256 ?? sha256(oldBytes),
    generatedSha256: sha256(generated),
    generated: "1x1 flat-color fixture pixel",
    format: "PNG",
  };
  replacements.push(path);
}
await writeFile(deckUrl, await zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"}));
await writeFile(provenanceUrl, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`Replaced ${replacements.length} embedded picture(s): ${JSON.stringify(replacements)}`);
