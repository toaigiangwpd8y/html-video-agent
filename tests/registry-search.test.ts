import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {resolve} from "node:path";
import test from "node:test";

const root = process.cwd();
const searchScript = resolve(root, "scripts/search-registry.mjs");

const search = (query: string, extra: string[] = []): Promise<any> => new Promise((resolveResult, reject) => {
  execFile(process.argv[0], [searchScript, "--provider", "onda", "--query", query, "--top", "8", ...extra],
    {cwd: root}, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr}`));
        return;
      }
      resolveResult(JSON.parse(stdout));
    });
});

test("local search retrieves an image reveal candidate and reports installed state", async () => {
  const response = await search("image reveal media");
  assert.equal(response.provider, "onda");
  assert.ok(response.results.some((item: any) => item.slug === "image-reveal"));
  const imageReveal = response.results.find((item: any) => item.slug === "image-reveal");
  assert.equal(imageReveal.installed, true);
  assert.equal(typeof imageReveal.score, "number");
  assert.equal("sourceCode" in imageReveal, false);
});

test("local search retrieves transition and numeric/data candidates", async () => {
  const transition = await search("wipe transition scene");
  assert.ok(transition.results.some((item: any) => item.category === "transitions" || /wipe|transition/i.test(item.slug)));

  const numeric = await search("animated numeric value count");
  assert.ok(numeric.results.some((item: any) => /count|bar|progress|stat|number/i.test(`${item.slug} ${item.name} ${item.description}`)));
});

test("local search returns no irrelevant nonsense results", async () => {
  const response = await search("zzzz-not-a-real-visual-job");
  assert.deepEqual(response.results, []);
});

test("default confidence floor suppresses weak documentary false positives", async () => {
  const response = await search("film digital photography value chain comparison");
  assert.deepEqual(response.results, []);
});

test("category hint remains soft and can fall back to the full snapshot", async () => {
  const response = await search("image reveal", ["--category", "transitions"]);
  assert.ok(response.results.some((item: any) => item.slug === "image-reveal"));
});

test("rejects non-ASCII discovery queries instead of returning lexical garbage", async () => {
  const result = await new Promise<{error: any; stderr: string}>((resolveResult) => {
    execFile(process.argv[0], [searchScript, "--provider", "onda", "--query", "so sánh hai hình ảnh cạnh nhau"],
      {cwd: root}, (error, _stdout, stderr) => resolveResult({error, stderr: stderr ?? ""}));
  });
  assert.ok(result.error);
  assert.match(result.stderr, /Onda discovery queries must use English visual search terms/i);
});
