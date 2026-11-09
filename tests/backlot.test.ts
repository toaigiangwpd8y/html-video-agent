import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectBacklotState } from "../src/backlot/api.js";
import { startBacklotServer } from "../src/backlot/server.js";
import { BacklotWatcher } from "../src/backlot/watcher.js";

const root = process.cwd();

test("collectBacklotState gathers valid pipeline snapshot", async () => {
  const state = await collectBacklotState(root);
  assert.ok(state);
  assert.ok(Array.isArray(state.stages));
  assert.equal(state.stages.length, 10);
  assert.ok(state.hitl);
  assert.ok(typeof state.previewExists === "boolean");
  assert.ok(typeof state.finalVideoExists === "boolean");
  assert.ok(Array.isArray(state.evidenceFiles));
});

test("startBacklotServer serves state API and static assets", async () => {
  const instance = await startBacklotServer({
    root,
    port: 0,
    openBrowser: false,
  });

  try {
    assert.ok(instance.port > 0);
    assert.ok(instance.url.startsWith("http://127.0.0.1:"));

    // Test /api/state
    const stateRes = await fetch(`${instance.url}/api/state`);
    assert.equal(stateRes.status, 200);
    const stateData = await stateRes.json();
    assert.ok(stateData.stages);
    assert.equal(stateData.stages.length, 10);

    // Test static HTML serving
    const htmlRes = await fetch(`${instance.url}/`);
    assert.equal(htmlRes.status, 200);
    const htmlText = await htmlRes.text();
    assert.match(htmlText, /id="page-storyboard"/);

    // Test static CSS serving
    const cssRes = await fetch(`${instance.url}/style.css`);
    assert.equal(cssRes.status, 200);

    // Test static JS serving
    const jsRes = await fetch(`${instance.url}/app.js`);
    assert.equal(jsRes.status, 200);
    assert.match(await jsRes.text(), /\/api\/hitl\/request-changes/);

    // Test local Markdown runtime assets.
    const markedRes = await fetch(`${instance.url}/vendor/marked.js`);
    assert.equal(markedRes.status, 200);
    assert.match(await markedRes.text(), /marked v18\.0\.5/);

    const purifierRes = await fetch(`${instance.url}/vendor/purify.js`);
    assert.equal(purifierRes.status, 200);
    assert.match(await purifierRes.text(), /DOMPurify 3\.4\.17/);

    // Test HITL approve endpoint validation
    const invalidApprove = await fetch(`${instance.url}/api/hitl/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkpoint: "INVALID_CHECKPOINT" }),
    });
    assert.equal(invalidApprove.status, 400);
    const errJson = await invalidApprove.json();
    assert.equal(errJson.ok, false);

    const invalidChanges = await fetch(`${instance.url}/api/hitl/request-changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkpoint: "CLARIFICATION", feedback: "Revise it." }),
    });
    assert.equal(invalidChanges.status, 400);
    assert.equal((await invalidChanges.json()).ok, false);
  } finally {
    await instance.stop();
  }
});

test("BacklotWatcher can subscribe and stop cleanly", async () => {
  const watcher = new BacklotWatcher(root);
  let changeNotified = false;
  const unsubscribe = watcher.subscribe(() => {
    changeNotified = true;
  });

  await watcher.start();
  unsubscribe();
  watcher.stop();
  assert.equal(changeNotified, false);
});

test("collectBacklotState resolves the video theme and flags an unbound canonical font", async () => {
  const tmp = resolve(root, "tests/.tmp-backlot-theme");
  await rm(tmp, { recursive: true, force: true });
  try {
    await mkdir(resolve(tmp, "assets"), { recursive: true });
    const project = {
      meta: {
        title: "Theme review",
        width: 1920,
        height: 1080,
        durationsInFrames: 60,
        fps: 30,
        theme: { palette: ["#FFFFFF", "#111111", "#0066FF"], font: "Inter", mode: "light", roles: { accent: "#0066FF" } },
        constraints: { style: "documentary", disallowed: [], motionTone: "measured" },
      },
      scenes: [{ id: "scene-1", durationInFrames: 60, screenText: "Frame", visualConcept: "One approved claim." }],
    };
    await writeFile(resolve(tmp, "video.json"), JSON.stringify(project), "utf8");
    await writeFile(resolve(tmp, "assets/manifest.json"), JSON.stringify({ version: "1", assets: [] }), "utf8");

    const { theme } = await collectBacklotState(tmp);
    if (!theme) throw new Error("Backlot state did not resolve a theme.");
    assert.equal(theme.source, "canonical");
    assert.equal(theme.tokens.mode, "light");
    assert.equal(theme.tokens.page, "#FFFFFF");
    assert.equal(theme.tokens.text, "#111111");
    assert.deepEqual(theme.pinnedRoles, ["accent"]);
    assert.ok(theme.contrast.textOnPage > 4.5);
    assert.ok(theme.warnings.some((warning) => warning.code === "THEME_FONT_UNBOUND"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
