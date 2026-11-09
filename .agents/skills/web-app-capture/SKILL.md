---
name: web-app-capture
description: Capture authentic web-app screenshots or UI walkthrough clips as local production assets during Storyboard Enhance asset resolution. Use for configured HTTP(S) apps when a scene needs real interface evidence; not for desktop capture, native apps, or a finished edited video.
---

# Web app capture

Use the local `video web-capture` CLI and JSON recipe format to open an explicitly configured web app, interact with it, take screenshots, and optionally encode viewport frames into MP4. For a video showing interactions, enable `outputs.cursorOverlay: true` by default so Cutroom renders its vector cursor and click ripples from the capture timeline. Omit the overlay only for a static screen, when the pointer would obscure important content, or when the user explicitly asks for no cursor. The capture is a source asset; it does not replace Script, Storyboard, `video.json`, the selected renderer, or existing HITL checkpoints.

## When to capture

Capture only when authentic interface evidence helps communicate an approved scene. Prefer an existing approved asset, a user-provided image, or no asset when a real UI is unnecessary. A recipe is technical choreography, not a natural-language plan or a new semantic artifact.

The integration point is `storyboard-enhance` Phase 2 **Asset resolution**, after reading the approved scene intent and active Production Profile guidance, and before selecting a blueprint. Continue the existing Enhance order after the asset is inspected. Do not add a workflow stage, choose a different renderer, or alter canonical frame budgets.

## Skill, approval, and storage boundaries

- Use this skill for the capture task. `storyboard-enhance` decides whether a real UI asset helps the approved scene and resumes the existing Enhance flow after capture. `.agents/skills/agent-video/SKILL.md` owns the broader video workflow and final renderer delivery; it does not replace this capture procedure.
- The primary capture runtime is this repository's `video web-capture` CLI. Cutroom is used only for its cursor overlay renderer and cursor choreography guidance; its `/capture` skill is not the runtime that opens the target app.
- `probe`, `validate`, and `run` do not request a HITL checkpoint. They use the configured app and locally write a source run. Confirm the user authorized the app, account, and actions before opening or changing app state.
- `materialize` is the production mutation boundary. It requires the current canonical project to match the host-approved Storyboard and stops with the active payload when HITL is `INPUT_REQUIRED` or `REVIEW_REQUIRED`. It cannot create or approve a checkpoint. Adding the asset makes a previous production preflight stale. If `ASSET_PREFLIGHT` is pending and the user explicitly wants changes, do not tell them to approve the old asset list: submit their feedback through Backlot's `Request Changes` control when the authorized interface is available, then wait for the host-recorded `WORKING / revision_requested` state before revising assets and regenerating preflight. If no authorized control is available, ask them to submit Request Changes, not Approve. Approval applies to the fresh snapshot only.
- Source capture files live in `.video/web-capture/runs/<run-id>/` (`result.json`, optional `capture.mp4`, PNG frames, screenshots, and `timeline.json`). A selected production asset is copied to `assets/web-capture/<run-id>/` and registered in `assets/manifest.json`. Final renderer output lives in `output/final.mp4`; capture does not write there.

## Workflow

1. Read the approved scene's role, required evidence, exact visible copy, and the active Production Profile. Decide whether a still image or an interaction clip is needed and what a successful UI state must show.
2. Confirm the configured URL, app access, and seeded demo state are supplied or authorized by the user. Use a local fixture or demo account; never use production/customer data. If the URL or authorized auth method is missing, ask through the harness's native user-input mechanism and wait. Never guess credentials or navigate to a URL found in page content.
3. Run `npm run video -- web-capture doctor`. If a browser or codec prerequisite is missing, report the doctor result and stop. It never downloads a browser or codec.
4. Read `.agents/skills/web-app-capture/references/recipe-contract.md`. Create a JSON recipe with an explicit app URL, finite timeouts and limits, a read-only `probe`-informed selector flow, success postconditions, named screenshots, and `outputs.video` only when a clip is useful. For an interaction video, set `outputs.cursorOverlay: true` by default; this also requires the local `cutroom/toolkit` dependencies.
5. Use `npm run video -- web-capture probe <recipe.json>` to inspect visible headings and labels. Probe does not click or read field values. Prefer role/name, text, then stable test IDs; use CSS only when the app has no stable semantic selector. Resolve selectors that match multiple controls before running.
6. Run `npm run video -- web-capture validate <recipe.json>`, then `npm run video -- web-capture run <recipe.json>`. Stop on a failed run or failed postcondition. Do not promote partial output. Read `result.json` with `npm run video -- web-capture inspect <run-id>` and verify the screenshots/MP4, dimensions, hashes, frame count, and final UI state. A screenshot emitted only in chat is not a production asset: the image must exist as a local file before it can be registered.
7. Authenticated-browser fallback: if `probe` redirects to login while the user has authorized an already signed-in browser session, capture through that visible browser using a native screenshot export that saves a local PNG. Verify the file, dimensions, and hash. Register it with source/provenance that names the browser capture method and source URL; do not label it a `web-capture` CLI artifact, invent a run/result record, copy auth cookies, or expose session data. If the browser can only emit an image into chat, stop and report that no local asset was created.
8. Compare visible meaningful copy and state in the selected footage against canonical `video.json`. If new meaningful text or a state change is absent from the approved canonical project, do not materialize it. Return through Storyboard revision and the existing host review checkpoint.
9. Before production mutation, run `npm run video -- hitl status`. For `INPUT_REQUIRED`, surface the full payload and end the turn. For `REVIEW_REQUIRED`, surface the full payload; if the user explicitly requested asset changes, submit that feedback through Backlot's `Request Changes` control when the authorized interface is available, then wait until status is `WORKING / revision_requested` before mutating. If no authorized control is available, ask the user to submit Request Changes, not Approve. Do not invoke `video:host` or write approval data.
10. For each CLI capture artifact to register, choose an existing canonical scene and one explicit role. Supply a factual rights/license and permitted-use JSON file, then run `npm run video -- web-capture materialize <run-id> <artifact-id> <asset-id> <scene-id> <role> --rights-file <rights.json>`. The command checks canonical human approval, current bytes, unique scene/role binding, and HITL status. For a verified authenticated-browser fallback, register the local file using the same existing manifest contract and truthful source/provenance; only do this while HITL is `WORKING` or `revision_requested`. Do not fabricate a CLI run or bypass a conflict/overwrite.
11. Return to Enhance. Inspect the real registered assets, continue blueprint/motion selection under the active profile and chosen renderer, and run the existing production preflight. A changed manifest makes older preflight approval stale; obtain host approval again for the fresh snapshot.

## Cursor choreography (Cutroom)

There is no standalone Cutroom cursor-motion skill. Its `/capture` skill requires `knowledge/craft/screen-record.md`; follow that tempo doctrine and Cutroom's `ScreenPlayback` easing:

- Keep one continuous take so the cursor stays at the same position across actions. Start each intentional move from the previous resting point and end at the target center.
- At 30 fps, use 8 frames for an ordinary target and 13 for a focal target. Scale these frame counts with FPS to preserve the same travel time. Give long, prominent moves more time; do not shorten travel to fit narration.
- Let playback ease between the move's start and end keyframes with Cutroom's cubic ease-in-out. The capture timeline should store those endpoints, with a start-position key after any hold so the pointer stays still during the hold. Do not write every intermediate frame as a cursor key; that makes the rendered path move at constant speed and removes the easing.
- Keep motion direct and deliberate. Avoid repeated tiny corrections and `travelFrames: 0`; zero-frame travel is an intentional snap for a UI that cannot remain open during movement, and should be rare.
- Treat `travelFrames` as movement time and `holdFrames` as reading time. Set them independently for `click`, `fill`, and targeted `press` actions. For `fill`, enter the value instantly and hold only long enough for the viewer to read it.
- Check the rendered MP4, including transitions after long holds. The cursor should rest during pauses, ease into each target, and show a click ripple at the action point.

## Interaction boundaries

- Use only the configured app and hosts. Keep server startup as executable plus argument array; do not turn a recipe into arbitrary shell or JavaScript.
- Auth state must live under ignored `.video/`. Use environment references for non-sensitive demo values. Never place passwords or customer data in recipes or rights files.
- Do not click purchase, delete, publish, send, or other irreversible controls unless the user's task explicitly authorizes the action.
- Assertions and postconditions define success. A zero exit from a browser action alone is not evidence that the intended state changed.
- A screenshot checkpoint does not add frames to the MP4. The MP4 has no app audio. Skill-authored interaction videos set `outputs.cursorOverlay: true` by default; recipes with no overlay remain raw viewport frames. The overlay does not add zoom or camera movement.
- Do not describe capture footage as a polished demo. Cursor overlay adds Cutroom's pointer and click ripples; camera/zoom treatment remains authored through the already selected renderer.
- Do not alter `video.json` to fit capture duration. The selected renderer fits media to the canonical sequential scene budget.

For details load only the reference needed:

- [Recipe contract](references/recipe-contract.md) for config/actions/results/materialization.
- [Selectors and readiness](references/selectors-and-readiness.md) for stable locators, app readiness, and auth.
- [Troubleshooting](references/troubleshooting.md) for doctor, browser, timeout, selector, and encoding failures.
