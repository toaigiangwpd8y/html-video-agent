# Web app capture

`video web-capture` opens a configured HTTP(S) app in local Chromium, drives a JSON recipe, and writes PNG screenshots plus an optional H.264 MP4. It does not use desktop automation, an internal natural-language planner, or an editor. The recipe is technical capture input; `video.json` remains the semantic source of truth.

## Prerequisites

Run the repository bootstrap first:

```powershell
npm.cmd run bootstrap
npm.cmd run video -- web-capture doctor
```

The doctor checks local Chromium/Chrome, `playwright-core`, FFmpeg, and ffprobe. It also reports shared-session connection readiness separately. Shared mode uses the external `agent-browser` CLI and the pinned `playwright-core` CDP adapter; set `AGENT_BROWSER_NATIVE` to a compatible native executable path when it is not on `PATH`. The researched native `agent-browser` 0.39.1 binary can run independently of Node, while the npm wrapper requires Node >=24. The doctor never downloads browsers. You can point to local binaries with `CHROME_PATH`, `FFMPEG_PATH`, and `FFPROBE_PATH`, or set `app.browserExecutablePath` in an owned-mode recipe.

To render the vector cursor and click ripples, first provide a separate Cutroom checkout under `cutroom/`; that checkout is not part of this repository or its commits. Then install its locked renderer dependencies once:

```powershell
npm.cmd ci --prefix cutroom/toolkit
npm.cmd run video -- web-capture doctor
```

Doctor reports whether the optional Cutroom cursor renderer is available.

## CLI

```powershell
npm.cmd run video -- web-capture doctor
npm.cmd run explore -- sessions register --app <registered-app-id> --context <authorized-context-id> --session <agent-browser-session-alias> --role <expected-role>
npm.cmd run video -- web-capture probe examples/web-capture/create-task.recipe.json
npm.cmd run video -- web-capture validate examples/web-capture/create-task.recipe.json
npm.cmd run video -- web-capture run examples/web-capture/create-task.recipe.json
npm.cmd run video -- web-capture inspect <run-id>
npm.cmd run video -- web-capture materialize <run-id> <artifact-id> <asset-id> <scene-id> <role> --rights-file examples/web-capture/fixture-rights.json
```

`probe` opens the app and lists visible headings and control labels without clicking, saving screenshots, or reading field values. `validate` checks the recipe without opening a browser. `run` returns JSON with a run ID, status, artifact IDs, hashes, dimensions, and postconditions. Each run is stored under `.video/web-capture/runs/<run-id>/` with a `result.json`, optional PNG frame sequence and MP4, checkpoint screenshots, and—when recording video—a `timeline.json`.

### Which skill runs this, and where files go

The task-specific procedure is `.agents/skills/web-app-capture/SKILL.md`, called optionally from `storyboard-enhance` Phase 2 asset resolution. `.agents/skills/agent-video/SKILL.md` still owns the complete video workflow and final renderer delivery. The capture runtime is this repository's `video web-capture` CLI; Cutroom supplies the optional cursor renderer and cursor movement guidance.

| File | Location | Purpose |
| --- | --- | --- |
| Capture run | `.video/web-capture/runs/<run-id>/` | Source screenshots, optional capture MP4, PNG frames, `timeline.json`, and `result.json` |
| Promoted asset | `assets/web-capture/<run-id>/` | Selected PNG/MP4 copied into the production asset registry and referenced by `assets/manifest.json` |
| Final video | `output/final.mp4` | Finished video rendered by the selected Remotion or HyperFrames workflow |

`probe`, `validate`, and `run` do not require HITL approval. `materialize` requires the current canonical project to match the host-approved Storyboard and refuses to write while `video hitl status` is `INPUT_REQUIRED` or `REVIEW_REQUIRED`. If the asset snapshot is incomplete, use Backlot's **Request changes** action first; it stores the human feedback and returns HITL to `WORKING` without approving the snapshot. Materialization never writes approval records. Materializing changes the asset manifest and makes prior production preflight approval stale; run a new production preflight and obtain host approval for the new snapshot. Capture data remains separate from `output/final.mp4`.

Runs are retained. Failed runs are marked `failed` and cannot be materialized. `video init` preserves capture runs; when a completed delivery is archived, its run artifacts are copied into that archive without copying local auth storage.

## Recipe outline

See [the local fixture recipe](../examples/web-capture/create-task.recipe.json) and [recipe contract](../.agents/skills/web-app-capture/references/recipe-contract.md). Recipes use version `1` and have an `app`, ordered `steps`, `outputs.video`, optional `outputs.cursorOverlay`, and optional `postconditions`.

Supported actions are `goto`, `waitFor`, `assertVisible`, `assertText`, `click`, `fill`, `press`, `scroll`, `hold`, `marker`, and `screenshot`. Locators use exactly one of `role`, `text`, `testId`, or `css`; nested locators are supported. Runtime actions reject selectors that match more than one element. No recipe JavaScript is evaluated.

Screenshots use `mode: "viewport"`, `"element"`, or `"fullPage"`. A screenshot checkpoint does not add video frames. The optional video is encoded from the page's PNG viewport frames, with audio disabled. Set `outputs.cursorOverlay: true` (requires `outputs.video: true`) to use Cutroom's Remotion `ScreenPlayback` to draw its vector cursor and click ripples from the capture timeline. Without it, the MP4 stays a raw viewport recording. Cursor overlay does not add camera movement or zoom. The timeline remains separate technical metadata.

`app.clock` defaults to `false`. When enabled, the browser timer clock is probed and advanced by one video frame after each captured PNG. It does not make network responses or all page behavior deterministic, and a failed clock probe fails the run rather than silently disabling the clock.

### Shared App Explorer sessions

The optional `app.session.handle` selects a private owner binding registered with `explore sessions register`. The descriptor is stored in the user-private App Explorer session directory, outside the project and knowledge workspace; the CDP endpoint is queried fresh for each attach and exists only in memory. A recipe cannot supply a CDP endpoint directly. Registration records the selected target ID and semantic app/context/role aliases. Capture then resolves that exact target and checks configured observable identity assertions; for a required identity, both account and role assertions are required:

```json
{
  "app": {
    "session": { "handle": "registered-handle", "networkPolicy": "capture" },
    "identity": {
      "required": true,
      "account": { "target": { "testId": "current-account" }, "text": "Demo Account", "exact": true },
      "role": { "target": { "testId": "current-role" }, "text": "Presenter", "exact": true }
    }
  }
}
```

Shared capture requires an explicit `app.session.networkPolicy`. Select `"capture"` to accept the supported HTTP(S) request and navigation policy described below. Missing policy and `"strict"` fail with `SHARED_SESSION_POLICY_UNSUPPORTED`; this pinned browser API cannot provide strict containment for an already-loaded page. There is no automatic downgrade. Shared capture attaches to the exact existing page without an initial navigation or reload. It does not create a replacement context, recover page-memory auth, or silently log in as another account. An expired or missing session reports a reauthentication/rebind action and preserves App Explorer knowledge and checkpoints. Shared mode uses the real clock. It measures the page's live viewport and DPR; a configured viewport is applied for capture and restored on disconnect. Without one, the measured viewport is used, and MP4 capture fails if its dimensions are odd.

In `"capture"` mode the borrower installs HTTP(S) request and navigation checks because agent-browser launch filters do not carry across external CDP attachment. Loopback hosts (`localhost`, `127.0.0.1`, and `::1`) remain implicitly allowed by the existing capture policy; other hosts must be listed in `allowedHosts`. A new target's first navigation can arrive before Chromium exposes a frame or page for ownership checks. That request is therefore allowed only when its URL is in the configured policy; a disallowed first navigation is blocked. This can also block a manually opened unrelated popup to a disallowed host during capture. Once a request has an attributable frame, selected-page and opener-descendant requests use the capture policy while other existing pages fall back to their prior context handlers. The adapter does not claim that a separate Playwright/CDP owner client's route handler is preserved or removed.

The pinned Playwright WebSocket router only handles sockets created after its route is installed, and CDP URL blocking did not block a socket created by the already-loaded owner page in the synthetic regression. Therefore `"capture"` mode intentionally does not filter WebSocket hosts: existing or later app-created WebSocket connections, including disallowed hosts, may connect. It does not claim containment for other pre-existing channels either. Dedicated/shared worker script requests pass through the HTTP(S) request policy. Any existing HTTP(S) service worker in the borrowed context fails closed, even when its host is outside `allowedHosts`, because Playwright context routing cannot contain service-worker-intercepted requests. Browser-owned non-HTTP extension workers are distinct and ignored. Registration is disabled during capture and the guard is removed on release. The boundary is browser-side policy, not an OS firewall, and page content is untrusted. Doctor and CLI help report these pinned adapter limits. Popup selection follows the `Page.opener()` lineage from the action that opened it; unrelated owner tabs are not capture output.

Each run also writes a small `progress.json` beside `result.json`. It contains only run ID, `step-<n>` ID, state, timestamp, optional machine error code, and (when a valid private binding is available) registered app/context aliases. `readCaptureProgress(runDirectory, { appId, contextId? })` applies exact app/context filtering for Backlot. Invalid or missing private descriptors omit attribution, so unavailable bindings are never misattributed. The record never contains a session handle, owner alias, target ID, page text, account values, endpoint data, or auth bytes.

Recipes default to a 1,800 frame (60 second at 30 FPS), 250 MiB per artifact, and 1 GiB per run limit. Configure `maxFrames`, `maxDurationSeconds`, `maxArtifactBytes`, and `maxRunBytes` explicitly when a scene needs more. Oversized work fails; footage is never silently trimmed. For H.264, `viewport × dpr` must produce even integer pixel dimensions; choose a compatible viewport before running instead of cropping or silently resizing the UI.

## App, server, and auth

The app URL must be HTTP(S). Local loopback hosts are allowed by default. External hosts must appear in `app.allowedHosts`; navigation to another host is blocked. The app URL and allowed hosts are explicit recipe input, not discovered from page content.

An optional `app.server` starts an app only when its health URL is not already healthy. It takes an executable, an argument array, a project-relative working directory, and a bounded start timeout. It never evaluates a shell command string. Only the process started by that capture run is stopped; a server that was already running is reused.

For authenticated apps, prefer a seeded demo account. Put Playwright storage state under the ignored `.video/` directory and reference only its path in `app.auth.storageStatePath`. Secret fill values can use `{ "env": "DEMO_TASK_NAME" }`; literal values are visible on screen and must be non-sensitive demo data. Environment values, storage-state bytes, recipe contents, and server arguments are not written into the result or asset provenance. Auth runs before the capture begins, so a login screen is not automatically treated as a screenshot asset.

## Register a production asset

`materialize` promotes exactly one PNG or MP4 from a successful run. It verifies the run ID, current artifact bytes and hash, file type, canonical scene, and unique scene/role binding. The rights JSON must provide a factual `rights` or `license` statement and an explicit `permittedUse`; the capture library's license does not grant rights to a website or its content.

The command requires the current `video.json` to match its host-approved Storyboard and project revision. It refuses to write when `video hitl status` is `INPUT_REQUIRED` or `REVIEW_REQUIRED`, and returns the active payload. It does not write approval records. A new entry is copied to `assets/web-capture/<run-id>/` and appended atomically to `assets/manifest.json` with `source: "web-capture"`, sanitized source URL, capture/run hashes, dimensions, scene binding, role, rights, and timing notes. An existing asset is never overwritten. Adding an asset changes the manifest fingerprint, so an older production preflight approval becomes stale and must be rerun and approved by the host.

## Enhance routing

The capture path is an optional source inside `storyboard-enhance` Phase 2, **Asset resolution**. It runs after canonical scene intent is understood and before blueprint selection. Choose it only when authentic web UI evidence serves an approved semantic role. Otherwise continue Enhance's current asset resolution unchanged. Do not add a workflow stage or change the chosen renderer.

Before materializing, compare visible meaningful UI copy and state in each chosen capture with canonical `video.json`. If footage introduces meaningful copy or a state that is not canonical, do not register it for production; return to Storyboard revision and the host's existing approval checkpoint. Do not change semantic scene budgets to match captured video length. The selected renderer decides how a media asset fits within the approved scene budget.

## Limits and safety

When combining capture assets with reusable App Explorer evidence, keep capture runs and research promotion as separate provenance paths. The [research input reference](APP_EXPLORER_RESEARCH.md) defines exact binding and supplemental-image selection fields; promotion never creates a capture run or approval.

- This captures Chromium web pages, not desktop applications or native apps.
- Use an app and account the user authorized, preferably local fixtures or seeded demo data. Do not use production/customer data.
- Do not click irreversible actions (purchase, delete, publish, send, or similar) unless the task explicitly authorizes them.
- Do not put secrets in recipes, logs, screenshots, videos, or rights statements. Use environment references for fill values and `.video/` storage state for auth.
- The MP4 has no app audio. A cursor overlay is opt-in and adds the synthetic vector pointer and click ripples; it does not add camera movement or zoom.
- Capture does not revise `video.json`, select a renderer, create a new HITL checkpoint, or approve any checkpoint.

For selector patterns see [selectors and readiness](../.agents/skills/web-app-capture/references/selectors-and-readiness.md). For error recovery see [troubleshooting](../.agents/skills/web-app-capture/references/troubleshooting.md).
