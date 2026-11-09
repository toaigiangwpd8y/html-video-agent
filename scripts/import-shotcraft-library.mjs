import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {
  buildCatalog,
  exclusions,
  selectSnapshotFiles,
  shotcraftRepo,
  shotcraftRevision,
  validateSourcePath,
} from "./shotcraft-library.mjs";

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--help" || key === "-h") options.help = true;
    else if (["--source", "--repo", "--revision", "--files", "--output"].includes(key)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
      options[key.slice(2)] = value;
    } else throw new Error(`Unknown option: ${key}`);
  }
  return options;
}

async function importSnapshot({source, repo, revision, filesPath, output}) {
  if (!repo || !/^https:\/\//.test(repo)) throw new Error("A pinned upstream HTTPS repository is required");
  if (!revision || !/^[a-f0-9]{40}$/i.test(revision)) throw new Error("A 40-character commit revision is required");
  if (!source || !output) throw new Error("--source and --output are required");
  const sourceRoot = resolve(source);
  const sourceStat = await lstat(sourceRoot);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) throw new Error("--source must be a real directory");
  let checkedOutRevision;
  try {
    checkedOutRevision = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {encoding: "utf8"}).trim();
  } catch {
    throw new Error("--source must be a Git checkout containing the requested commit");
  }
  if (checkedOutRevision.toLowerCase() !== revision.toLowerCase()) {
    throw new Error(`Source checkout revision ${checkedOutRevision} does not match requested pin ${revision}`);
  }

  let files;
  if (filesPath) {
    files = JSON.parse(await readFile(resolve(filesPath), "utf8"));
    if (!Array.isArray(files) || !files.every(path => typeof path === "string")) throw new Error("--files must contain a JSON array of source paths");
  } else {
    if (repo !== shotcraftRepo || revision.toLowerCase() !== shotcraftRevision) {
      throw new Error("Automatic catalog import only supports the documented Shotcraft repository revision");
    }
    files = await selectSnapshotFiles(sourceRoot);
  }
  files = files.map(validateSourcePath).sort();
  if (!files.length) throw new Error("At least one source file is required");
  if (new Set(files).size !== files.length) throw new Error("Duplicate source paths are not allowed");

  const gitTree = execFileSync("git", ["-C", sourceRoot, "ls-tree", "-r", "-z", revision], {maxBuffer: 32 * 1024 * 1024});
  const pinnedFiles = new Map();
  for (const record of gitTree.toString("utf8").split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    const [mode, type, objectId] = record.slice(0, tab).split(" ");
    if (type === "blob") pinnedFiles.set(record.slice(tab + 1), {mode, objectId});
  }

  const importedFiles = [];
  for (const path of files) {
    let workingFile = sourceRoot;
    for (const part of path.split("/")) {
      workingFile = join(workingFile, part);
      const stat = await lstat(workingFile);
      if (stat.isSymbolicLink()) throw new Error(`Symlink source path is not allowed: ${path}`);
    }
    const workingStat = await lstat(workingFile);
    if (!workingStat.isFile()) throw new Error(`Source path is not a regular file: ${path}`);
    const pinnedFile = pinnedFiles.get(path);
    if (!pinnedFile) throw new Error(`Source path is not present in pinned Git tree: ${path}`);
    if (pinnedFile.mode !== "100644" && pinnedFile.mode !== "100755") {
      throw new Error(`Pinned source path is not a regular file: ${path}`);
    }
    const bytes = execFileSync("git", ["-C", sourceRoot, "cat-file", "blob", pinnedFile.objectId], {maxBuffer: 64 * 1024 * 1024});
    const workingBytes = await readFile(workingFile);
    const workingObjectId = execFileSync("git", ["-C", sourceRoot, "hash-object", `--path=${path}`, "--stdin"], {
      input: workingBytes,
      encoding: "utf8",
    }).trim();
    if (workingObjectId !== pinnedFile.objectId) throw new Error(`Working tree file differs from pinned Git tree: ${path}`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    importedFiles.push({path, sha256, bytes});
  }

  const outputPath = resolve(output);
  try {
    await lstat(outputPath);
    throw new Error(`Output already exists; source snapshots are immutable: ${outputPath}`);
  } catch (error) {
    if (error.message.includes("already exists")) throw error;
    if (error.code !== "ENOENT") throw error;
  }
  const parent = dirname(outputPath);
  await mkdir(parent, {recursive: true});
  const stage = await mkdtemp(join(parent, ".shotcraft-import-"));
  try {
    for (const item of importedFiles) {
      const destination = join(stage, "source", ...item.path.split("/"));
      await mkdir(dirname(destination), {recursive: true});
      await writeFile(destination, item.bytes);
    }
    const license = importedFiles.find(item => item.path === "LICENSE");
    if (license) await writeFile(join(stage, "LICENSE"), license.bytes);
    const sourceManifest = {
      repo,
      revision: revision.toLowerCase(),
      importedAt: new Date().toISOString(),
      files: importedFiles.map(({path, sha256}) => ({path, sha256})),
      exclusions,
    };
    await writeFile(join(stage, "SOURCE.json"), `${JSON.stringify(sourceManifest, null, 2)}\n`);

    if (!filesPath) {
      const catalog = await buildCatalog(join(stage, "source"), revision.toLowerCase());
      await writeFile(join(stage, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
    }
    await rename(stage, outputPath);
    return {outputPath, fileCount: importedFiles.length};
  } catch (error) {
    await rm(stage, {recursive: true, force: true});
    throw error;
  }
}

const help = "Usage: node scripts/import-shotcraft-library.mjs --source CHECKOUT --revision FULL_SHA --output DIR [--repo HTTPS_URL] [--files JSON_FILE]";
try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(help);
    process.exit(0);
  }
  const result = await importSnapshot({
    source: options.source,
    repo: options.repo ?? shotcraftRepo,
    revision: options.revision,
    filesPath: options.files,
    output: options.output,
  });
  console.log(`imported ${result.fileCount} pinned Shotcraft source files into ${result.outputPath}`);
} catch (error) {
  console.error(`Shotcraft import failed: ${error.message}`);
  process.exitCode = 1;
}
