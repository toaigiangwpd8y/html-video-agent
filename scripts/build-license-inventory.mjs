import {readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";

const root = process.cwd();
const projects = [".", "remotion", "hyperframes"];
const inventory = {
  format: 1,
  generatedAt: "2026-11-03",
  evidenceLimit: "Package license fields and lockfile URLs are registry metadata pointers only. They are not a substitute for inspecting the exact package license text, notices, or vendor terms before redistribution.",
  lockfiles: [],
};

for (const directory of projects) {
  const manifest = JSON.parse(await readFile(resolve(root, directory, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(resolve(root, directory, "package-lock.json"), "utf8"));
  const direct = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
  const packages = Object.entries(lock.packages ?? {}).filter(([path]) => path && path.startsWith("node_modules/")).map(([path, item]) => {
    const name = item.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    return {
    installPath: path,
    name,
    version: item.version ?? null,
    licenseMetadata: item.license ?? null,
    resolved: item.resolved ?? null,
    integrity: item.integrity ?? null,
    direct: path === `node_modules/${name}` && direct.has(name),
  };});
  inventory.lockfiles.push({
    path: `${directory === "." ? "" : `${directory}/`}package-lock.json`,
    packageCount: packages.length,
    directDependencyCount: packages.filter(item => item.direct).length,
    packages,
  });
}

await writeFile(resolve(root, "docs/compliance/npm-license-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
console.log(inventory.lockfiles.map(({path, packageCount, directDependencyCount}) => `${path}: ${packageCount} packages, ${directDependencyCount} direct`).join("\n"));
