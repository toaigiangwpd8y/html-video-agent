import {mkdir} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = resolve(root, "tests/fixtures/registry-poc");
const entry = resolve(fixtureRoot, "remotion/entry.tsx");
const project = resolve(fixtureRoot, "remotion/project.json");
const output = resolve(root, "output/registry-poc-still.png");
const remotionBin = resolve(root, "remotion/node_modules/.bin", process.platform === "win32" ? "remotion.cmd" : "remotion");

await mkdir(resolve(root, "output"), {recursive: true});
const args = ["still", entry, "RegistryPoc", output, `--props=${project}`, `--public-dir=${fixtureRoot}`];
const result = process.platform === "win32"
  ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", remotionBin, ...args], {stdio: "inherit", cwd: root})
  : spawnSync(remotionBin, args, {stdio: "inherit", cwd: root});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
