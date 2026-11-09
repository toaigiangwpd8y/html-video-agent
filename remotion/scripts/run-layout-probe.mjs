import {readFile, mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {extname, join, resolve, sep} from "node:path";
import {tmpdir} from "node:os";
import {createServer} from "node:http";
import {bundle} from "@remotion/bundler";
import {chromium} from "playwright-core";

/**
 * Deterministic layout-lint probe.
 *
 * Reads one JSON job from stdin, bundles the harness-owned Player entry once, serves it over a
 * loopback static server, drives @remotion/player with playwright-core, and prints one JSON
 * object with the measured `LintFrame`s. Never renders pixels; geometry only.
 *
 * Job: {frames:number[], fps:number, entryPoint:string, publicDir:string, width:number, height:number}
 */

function browserExecutable() {
  const explicit = [process.env.REMOTION_BROWSER_EXECUTABLE, process.env.CHROME_PATH].find(
    (candidate) => Boolean(candidate) && existsSync(candidate),
  );
  if (explicit) return explicit;
  const candidates = [];
  if (process.platform === "win32") {
    for (const base of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(join(base, "Google", "Chrome", "Application", "chrome.exe"));
      candidates.push(join(base, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/opt/brave-bin/brave",
      "/usr/bin/brave",
      "/usr/bin/brave-browser",
    );
  }
  return candidates.find(existsSync);
}

function contentType(path) {
  switch (extname(path)) {
    case ".html":
      return "text/html";
    case ".js":
      return "text/javascript";
    case ".mjs":
      return "text/javascript";
    case ".css":
      return "text/css";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const job = JSON.parse(raw);
if (!Array.isArray(job.frames) || !job.frames.length) throw new Error("The layout probe requires at least one frame.");
const frames = [...new Set(job.frames.map((frame) => Number(frame)))].filter((frame) => Number.isInteger(frame) && frame >= 0).sort((a, b) => a - b);
if (!frames.length) throw new Error("The layout probe requires non-negative integer frames.");
const fps = Number(job.fps);
if (!Number.isFinite(fps) || fps <= 0) throw new Error("The layout probe requires a positive fps.");
const width = Number(job.width);
const height = Number(job.height);
if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) throw new Error("The layout probe requires positive width and height.");

const root = process.cwd();
const tmp = await mkdtemp(join(tmpdir(), "remotion-layout-probe-"));
let server;
let browser;
const started = Date.now();

try {
  const outDir = join(tmp, "bundle");
  await mkdir(outDir, {recursive: true});
  const bundleStarted = Date.now();
  await bundle({
    entryPoint: resolve(root, job.entryPoint ?? "qa/player-entry.tsx"),
    publicDir: resolve(root, job.publicDir ?? "public"),
    outDir,
    ignoreRegisterRootWarning: true,
    onProgress: () => {},
  });
  const bundleMs = Date.now() - bundleStarted;

  const index = await readFile(join(outDir, "index.html"), "utf8");
  const script = index.match(/<script[^>]+src=["']([^"']+\.js)["']/i)?.[1];
  if (!script) throw new Error("Could not locate the Player bundle script in the generated HTML.");
  await writeFile(
    join(outDir, "layout-probe.html"),
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script src="${script}"></script></body></html>`,
  );

  server = createServer(async (request, response) => {
    const relative = decodeURIComponent((request.url ?? "/").split("?")[0].slice(1) || "layout-probe.html");
    const path = resolve(outDir, relative);
    if (path !== outDir && !path.startsWith(outDir + sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      const data = await readFile(path);
      response.writeHead(200, {"Content-Type": contentType(path)});
      response.end(data);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  const {promise: listening, resolve: onListen, reject: onListenError} = Promise.withResolvers();
  server.once("error", onListenError);
  server.listen(0, "127.0.0.1", onListen);
  await listening;
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/layout-probe.html`;

  const executablePath = browserExecutable();
  if (!executablePath) throw new Error("No local Chromium/Chrome executable was found for the layout probe. Set REMOTION_BROWSER_EXECUTABLE or CHROME_PATH.");
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewportSize({width, height});
  await page.goto(url, {waitUntil: "load", timeout: 30_000});
  await page.waitForFunction(() => window.__LINT_READY__ === true, {timeout: 30_000});

  const measured = [];
  for (const frame of frames) {
    await page.evaluate((target) => window.__LINT_SEEK__(target), frame);
    measured.push(await page.evaluate(([target, timeSeconds]) => window.__LINT_EXTRACT__(target, timeSeconds), [frame, frame / fps]));
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      frames: measured,
      timings: {bundleMs, totalMs: Date.now() - started},
      browserExecutable: executablePath,
      measurement: "remotion-player-dom",
    })}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 2;
} finally {
  if (browser) await browser.close();
  if (server) {
    const {promise: closed, resolve: onClose} = Promise.withResolvers();
    server.close(onClose);
    await closed;
  }
  await rm(tmp, {recursive: true, force: true});
}
