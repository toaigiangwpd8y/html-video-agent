import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const {generatedHash} = await import(pathToFileURL(resolve(repositoryRoot, "dist/src/harness/remotion-evidence.js")).href);
const {remotionHitlStatus} = await import(pathToFileURL(resolve(repositoryRoot, "dist/src/harness/remotion.js")).href);

export async function proveStaleReviewInvalidation(root, {sourcePath = "remotion/generated/compatibility/Selected.tsx", sourceContent} = {}) {
  const generatedRoot = resolve(root, "remotion/generated");
  const source = resolve(root, sourcePath);
  const statePath = resolve(root, ".video/remotion-state.json");
  await mkdir(dirname(source), {recursive: true});
  await mkdir(dirname(statePath), {recursive: true});
  const original = sourceContent ?? "export const Selected = () => null;\n";
  await writeFile(source, original, "utf8");
  const sourceHash = await generatedHash(generatedRoot);
  const reviewState = {
    version: "1",
    renderer: "remotion",
    phase: "VISUAL_REVIEW",
    projectId: "disposable-compatibility-fixture",
    revision: 1,
    projectHash: "sha256:fixture-project",
    productionProfileHash: "sha256:fixture-profile",
    assetManifestHash: "sha256:fixture-assets",
    sourceHash,
    previewUrl: "http://127.0.0.1/disposable-review-fixture",
  };
  await writeFile(statePath, `${JSON.stringify(reviewState, null, 2)}\n`, "utf8");
  const before = await remotionHitlStatus(root);
  await writeFile(source, `${original}// disposable edit\n`, "utf8");
  const after = await remotionHitlStatus(root);
  const currentState = JSON.parse(await readFile(statePath, "utf8"));
  return {
    sourcePath,
    reviewedSourceHash: sourceHash,
    currentSourceHash: after?.payload?.sourceHash,
    before,
    after,
    humanApprovalRecorded: false,
    stateHasVisualApproval: Object.hasOwn(currentState, "visualApproval"),
  };
}
