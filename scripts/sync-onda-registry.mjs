import {resolve} from "node:path";
import {readFile} from "node:fs/promises";
import {
  defaultSnapshotPath,
  ondaRegistry,
  ondaRepo,
  ondaVersion,
  normalizeItems,
  parseArgs,
  repoRoot,
  runOnda,
  writeJsonAtomic,
} from "./onda-registry-utils.mjs";

const {options} = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log("Usage: npm run registry:onda:sync [-- --input FILE] [--output FILE] [--registry URL]");
  process.exit(0);
}

try {
  const outputPath = resolve(repoRoot, options.output ?? defaultSnapshotPath);
  const sourceRegistry = options.registry ?? ondaRegistry;
  let rawItems;
  let cliVersion = "fixture";
  if (options.input) {
    rawItems = JSON.parse(await readFile(resolve(options.input), "utf8"));
  } else {
    cliVersion = ondaVersion();
    rawItems = JSON.parse(runOnda(["list", "--json", "--registry", sourceRegistry], repoRoot, cliVersion));
  }
  const items = normalizeItems(rawItems);
  const snapshot = {
    provider: "onda",
    revision: `onda-cli@${cliVersion}`,
    cliVersion,
    sourceRegistry,
    sourceRepo: ondaRepo,
    itemCount: items.length,
    items,
  };
  await writeJsonAtomic(outputPath, snapshot);
  console.log(`synced ${items.length} Onda items to ${outputPath}`);
} catch (error) {
  console.error(`registry:onda:sync failed: ${error.message}`);
  process.exitCode = 1;
}
