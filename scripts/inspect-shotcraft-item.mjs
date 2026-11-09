import {inspectShotcraftItem} from "./shotcraft-inspection.mjs";

const root = process.cwd();

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const result = args[index + 1];
  if (!result || result.startsWith("--")) throw new Error(`${name} requires a value`);
  return result;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const separator = rawArgs.indexOf("--");
  const args = separator >= 0 ? rawArgs.slice(separator + 1) : rawArgs;
  if (args.includes("--help")) {
    console.log("Usage: npm run shotcraft:inspect -- <card-id> [--variant <key>] [--fetch-preview]");
    return;
  }
  const id = args.find(value => !value.startsWith("--"));
  if (!id) throw new Error("Usage: npm run shotcraft:inspect -- <card-id> [--variant <key>] [--fetch-preview]");
  const result = await inspectShotcraftItem(root, id, {
    variantKey: option(args, "--variant"),
    fetchPreview: args.includes("--fetch-preview"),
  });
  console.log(JSON.stringify(result, null, 2));
}

try { await main(); }
catch (error) {
  console.error(`shotcraft:inspect failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
