/** Layout probe for HyperFrames preview pages.
 *
 * The pinned HyperFrames `check` audits the composition itself; this probe exists only for the rules
 * the vendor auditor is blind to (a connector drawn across a node). It drives the already-running
 * preview server, seeks the composition runtime, and extracts canvas geometry with the shared
 * extractor from `remotion/core/lint-extract.ts` (bundled to browser JavaScript with esbuild).
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "..", "..");

function browserExecutable() {
  const candidates = [process.env.REMOTION_BROWSER_EXECUTABLE, process.env.CHROME_PATH, process.env.CHROMIUM_PATH].filter(Boolean);
  if (process.platform === "darwin") candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/opt/brave-bin/brave");
  else if (process.platform === "win32") candidates.push("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
  else candidates.push("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/brave-bin/brave");
  return candidates.find((candidate) => existsSync(candidate));
}

/** Serialized into the page: seeks every runtime adapter the HyperFrames preview exposes. */
function seekExpression(timeSeconds) {
  return "(" + (async (time) => {
    const timelines = (window).__timelines ?? {};
    for (const timeline of Object.values(timelines)) {
      try {
        timeline.pause?.();
        if (typeof timeline.totalTime === "function") {
          timeline.totalTime(time + 0.001, true);
          timeline.totalTime(time, false);
        } else if (typeof timeline.seek === "function") timeline.seek(time);
      } catch {}
    }
    if (typeof document.getAnimations === "function") {
      for (const animation of document.getAnimations()) {
        try {
          animation.currentTime = Math.max(0, time * 1000);
          animation.pause();
        } catch {}
      }
    }
    try {
      window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time, waitUntil() {} } }));
    } catch {}
    (window).gsap?.ticker?.tick?.();
    const waitForSeek = (window).__hfWaitForSeekCompletion;
    if (typeof waitForSeek === "function") await waitForSeek();
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  }).toString() + `)(${JSON.stringify(timeSeconds)})`;
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
const job = JSON.parse(input);
if (!job.url) throw new Error("Layout probe requires a preview url.");
if (!Array.isArray(job.frames) || !job.frames.length) throw new Error("Layout probe requires a non-empty frames array.");
const width = Number(job.width) || 1920;
const height = Number(job.height) || 1080;

const executablePath = browserExecutable();
if (!executablePath) throw new Error("No local Chrome/Chromium found for the layout probe; set CHROME_PATH.");

const bundle = buildSync({
  entryPoints: [resolve(repositoryRoot, "remotion/core/lint-extract.ts")],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "OmpLayoutExtract",
  platform: "browser",
  target: "chrome120",
  logLevel: "silent",
});
const extractorSource = bundle.outputFiles[0].text;

const started = Date.now();
const browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox", "--disable-setuid-sandbox", "--hide-scrollbars"] });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(document.querySelector("[data-composition-id],[data-lint-canvas]")), { timeout: 20_000 });
  await page.waitForFunction(() => Boolean(window.__timelines) || document.fonts.status === "loaded", { timeout: 10_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: extractorSource });
  const frames = [];
  for (const target of job.frames) {
    await page.evaluate(seekExpression(target.timeSeconds));
    frames.push(
      await page.evaluate(
        ({ frame, timeSeconds, innerWidth, innerHeight }) =>
          window.OmpLayoutExtract.extractLintFrame({ frame, timeSeconds, innerWidth, innerHeight }),
        { frame: target.frame, timeSeconds: target.timeSeconds, innerWidth: width, innerHeight: height },
      ),
    );
  }
  process.stdout.write(
    JSON.stringify({
      ok: true,
      frames,
      browserExecutable: executablePath,
      measurement: "hyperframes-preview-dom",
      timings: { totalMs: Date.now() - started },
    }) + "\n",
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 2;
} finally {
  await browser.close();
}
