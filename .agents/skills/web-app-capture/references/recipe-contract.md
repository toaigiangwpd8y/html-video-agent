# Recipe contract

Recipes are JSON files with `version: "1"`, a `name`, `app`, ordered `steps`, `outputs`, and optional `postconditions`. Use the repository example at `examples/web-capture/create-task.recipe.json` as the runnable baseline.

## App config

`app.url` is absolute HTTP(S). Loopback hosts are allowed by default; external hosts must be named in `allowedHosts`. Page navigation is constrained to those hosts. `browserExecutablePath` may select a local Chrome/Chromium executable. Other fields are `viewport`, `dpr` (1–2), `fps` (1–60), `clock`, `headless`, navigation/action timeouts, and capture limits.

Optional `server` fields are `command`, `args`, workspace-relative `cwd`, `healthUrl`, and `startTimeoutMs`. A healthy server is reused. Only a server process started by the current run is stopped. Commands are spawned with `shell: false`.

Optional `auth.storageStatePath` references an existing Playwright storage-state file under `.video/`. Store that state locally; never commit it or include it in a result.

Default limits: 1,800 frames, 60 seconds, 250 MiB per artifact, and 1 GiB total run output. Set limits explicitly for long scenes. `viewport × dpr` must yield even integer pixel dimensions for H.264. Choose a compatible viewport rather than allowing the encoder to crop or resize UI pixels.

## Locators

A locator has exactly one of `role`, `text`, `testId`, or `css`. Role locators may add `name`; any locator can set `exact`. `within` nests a locator scope. Runtime actions require one visible match; zero matches fail, and multiple matches are reported as ambiguous. Do not use CSS selector tricks to evaluate page code.

## Actions

- `goto`: navigate to an absolute or app-relative URL on an allowed host.
- `waitFor`: wait for a locator state (`visible`, `hidden`, `attached`, `detached`).
- `assertVisible`, `assertText`: require a unique visible locator and expected text.
- `click`: move the real browser pointer to a unique visible target, click it, and hold frames for readability. `travelFrames` controls movement time; default 8 frames at 30 fps, or 13 for a focal target.
- `fill`: move to the field, then fill it instantly. `travelFrames` controls pointer movement and `holdFrames` controls reading time. `value` is a demo string or `{ "env": "VARIABLE_NAME" }`; resolved values are not logged or stored in results.
- `press`: press a key, optionally after moving to and focusing a locator. A targeted press has `travelFrames`; `holdFrames` remains the pause after the action.
- `scroll`: scroll the page by explicit pixels over a finite number of frames.
- `hold`: capture the current state for an explicit number of frames.
- `marker`: write a named frame marker to the technical timeline.
- `screenshot`: save a checkpoint with `mode: "viewport"`, `"element"`, or `"fullPage"`. Element mode requires a locator.

Per-step `timeoutMs` is bounded. A screenshot does not add frames to the clip. `outputs.video: false` records no frame sequence; browser interactions and screenshot steps still run. Skill-authored interaction videos set `outputs.cursorOverlay: true` by default. This field must be paired with `outputs.video: true` and post-processes the recorded MP4 through Cutroom's `ScreenDemo` composition. It overlays a synthetic cursor and click ripples from the capture timeline; it does not add camera motion. Install the pinned Cutroom toolkit dependencies with `npm ci --prefix cutroom/toolkit` before enabling this option. If they are unavailable, the capture fails with `CUTROOM_UNAVAILABLE` instead of silently returning a video without the requested cursor. The CLI continues to treat an omitted `cursorOverlay` field as false, so write it explicitly in each recipe.

Postconditions support `assertVisible` and `assertText`. Runs with failed postconditions have `status: "failed"` and cannot be materialized.

## Result and production handoff

Every run gets a new UUID directory at `.video/web-capture/runs/<run-id>/`. `result.json` includes status, a recipe hash, redacted app config, screenshot/video artifact IDs, type, relative path, dimensions, byte count and SHA-256, video frame/FPS/duration metadata, postconditions, and a safe error code. The technical `timeline.json` is separate from canonical project data.

`materialize` takes one successful artifact ID, a unique asset ID, an approved canonical scene ID, a role, and a rights JSON file. Rights must state either `rights` or `license`, plus `permittedUse`. A duplicate ID only succeeds idempotently when bytes, provenance, rights, and binding all match; scene/role conflicts and overwrites fail. The file is copied under `assets/web-capture/<run-id>/` and the existing manifest is updated atomically. New media changes the asset fingerprint and may stale production preflight approval.
