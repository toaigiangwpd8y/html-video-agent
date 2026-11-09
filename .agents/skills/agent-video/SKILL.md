---
name: agent-video
description: Create, revise, inspect, implement, and render a structured video project end to end. Use for any request to make or change a video in this repository. Normal completion means output/final.mp4 exists.
---

# Agent Video

`video.json` is canonical semantic truth with exactly `meta` and `scenes` at the top level. The external harness owns intelligence; the runtime owns human checkpoints. Keep the workflow creative-taste neutral except for the selected video-type Success Definition.

## Human checkpoints

The creative agent may prepare artifacts but cannot approve them. `npm run video -- hitl status` returns `INPUT_REQUIRED`, `REVIEW_REQUIRED`, `WORKING`, or `READY`.

- For `INPUT_REQUIRED`, show the questions and stop.
- For `REVIEW_REQUIRED`, show the exact artifact and wait by default. If the user explicitly asks to revise it, treat that as revision authorization, not approval. Submit their feedback through Backlot's existing `Request Changes` control when the authorized interface is available; do not ask them to approve the rejected artifact. Do not mutate the pending snapshot. Resume after the host records the request and status becomes `WORKING` with phase `revision_requested`; revise the artifact, then present a fresh review. If no authorized Request Changes interface is available, ask the user to submit that request in Backlot, not to approve.
- Never run `npm run video:host` or record `HUMAN` approval yourself.
- Storyboard approval creates the next canonical revision; after the initial promotion, every approved semantic revision increments its revision number and preserves the previous project and delivery.
- Renderer visual review also requires human approval. Opening a preview, passing checks, or agent inspection is not approval.

## Create workflow

1. Run `npm run bootstrap` before starting a request. It installs both pinned renderer runtimes, builds the harness, and verifies both renderer options. Resolve missing browser/runtime prerequisites before continuing. Then run `video init`, capture the request with `video request set`, and start Backlot with `video backlot` so the operator can follow the workflow on loopback.
2. Inspect the request, repository guidance, and only user-provided or already-authoritative assets. For software product requests, follow the inspection guidance below. Do not acquire production media before Storyboard approval. Record a clarification assessment for every request. Clear requests commit `status:"resolved"` with zero questions; material ambiguity commits `status:"awaiting_user"` with one or two questions. For requests involving PPT/PPTX or PDF slides, inspect only current-turn attachments, explicit paths, and repository-root `video-input/`; import an explicit source with `video source import <path>` or `video source import-input`, and use `video sources extract` plus `video sources assess` when a slide-by-slide lecture assessment is needed. Treat extraction as analysis context, leave chosen media unregistered until Enhance, and load `.agents/skills/slide-to-video/SKILL.md` or `.agents/skills/lecture-slides/SKILL.md` as appropriate before reading the source. Do not scan other folders or the machine.
3. Run `video hitl status`. Surface `INPUT_REQUIRED` and stop; otherwise continue.
4. Create and commit one Video Brief. Preserve requested capabilities without assigning a renderer manifestation before Storyboard approval.
5. Include a brief-specific `rendererRecommendation` in the Video Brief with concrete fit rationale and the alternate renderer's tradeoff. Run `video renderer options --require-all` and `video hitl status`; surface `VIDEO_BRIEF` review with both available engine cards and stop. The human approves the brief and explicitly chooses Remotion or HyperFrames through the host/Backlot. Revise only on user feedback.
6. Select and freeze `.video/production-profile.json` before Script authoring. Apply only pre-production guidance until Storyboard approval.
7. Author one complete Script and perform one bounded correctness/fit self-check. Write a structured `.video/narration-input.json` with stable segment IDs, exact text, and explicit silent beats, then run `video tts synthesize` and `video tts status`. Review exact local voice and measured duration. Revise only blocking wording/fit issues in the same pass; do not create alternate candidates, a Critic round, an iterative review loop, or model-side selection. Commit the Script for review. See `docs/TTS.md`.
8. Run `video hitl status`. Surface `SCRIPT` review and stop. Revise only on user feedback.
9. Serialize the approved Script to the canonical `VideoProject` shape and commit the Storyboard. Map every narrated scene to its exact Script segment with `audio.voiceSegmentId`; the text must match that approved segment and its frame budget must cover the measured WAV at native speed.
10. Run `video hitl status`. Surface `STORYBOARD` review and stop. Approval promotes that exact Storyboard to `video.json`, creates project revision 1, and records semantic preflight.
11. Perform one complete Storyboard Enhance pass. Resolve production asset needs from approved semantic roles first, and materialize only relevant licensed local assets and approved narration. After inspecting actual assets, choose the final renderer-neutral blueprint and motion treatment; optional Onda retrieval is allowed only after that choice and never drives story meaning, asset needs, or blueprint choice. For an existing normalized source, materialize only the selected item a scene needs after Storyboard approval. Then run `video project preflight production` and `video hitl status`. If HITL returns `REVIEW_REQUIRED` at `ASSET_PREFLIGHT`, surface the report and registered asset list. If the user requests changes, submit that feedback through Backlot's `Request Changes` control when authorized; never ask them to approve the rejected asset snapshot. After the host records the request and status becomes `WORKING / revision_requested`, revise the asset set and rerun production preflight. Request approval only for the fresh snapshot. Run `video renderer prepare` only after that fresh approval is recorded and HITL advances. Read `.agents/skills/storyboard-enhance/SKILL.md` and the selected adapter handoff. Remotion authoring belongs under `remotion/generated/`; HyperFrames authoring belongs in its returned versioned project. Do not run a competing authoring workflow or generate root-level `SCRIPT.md`, `STORYBOARD.md`, `frame.md`, or `theme.json`. Keep visible and spoken copy canonical; use only manifest-approved local assets. This is a local educational graduation project for rendered video output; do not build or distribute a hosted animation editor.
12. Fix materially unresolved authoring findings in the same bounded pass. Run `video renderer check`, fix every reported layout finding, and re-run until it reports `PASS`; a `FAIL` or `NOT_EVALUATED` check must not advance to review. Then run `video renderer review`. The selected adapter opens its local preview and freezes the source hash. If preview startup fails, stop on the error; do not substitute another renderer or claim review. Run `video hitl status`; surface the preview link/source hash at `VISUAL_REVIEW` and stop.
13. After the human approves through the host checkpoint, run `video renderer render`, then `video renderer finalize`, then `video status`. Completion requires a fresh `output/final.mp4`, matching boundary evidence, and validated MP4 metadata.

## Software product requests

- When observable workflow behavior is the main proof, use `product-demo` as primary. When campaign attention, recall, or action is primary, use `product-ad`; add a supporting profile only for a distinct requirement. Explicit user intent remains authoritative, and profile freezing stays at the existing pre-Script stage.
- App Explorer exploration requires an explicit user request. Product-video requests read existing selected workflows and report missing knowledge without starting discovery.
- Read the relevant product profile's pre-production guidance. For a software app, use existing authorized product evidence and read the registered App Explorer workflows relevant to the brief. Report missing knowledge in the clarification assessment; exploration requires an explicit user request and is never started by a video request. If the user requests exploration, load `.agents/skills/app-explorer/SKILL.md` and follow its scope, revision, and evidence rules. Label findings as observed, documented, inferred, or unverified. Existing screenshots may inform appearance; they do not establish functional transitions. Do not acquire production media before Storyboard approval.
- For demonstrated workflows, keep initial state, action, response, result, and supported value in the Script and semantic Storyboard. Existing research records support only their tested scenario and context. After Storyboard approval, use `storyboard-enhance`'s Software UI assets guidance and existing asset gate to select or supplement production captures or truthful derivatives. A capture does not promote an unverified behavior to verified.

## Visual revisions and canonical edits

- Renderer-only layout and motion edits stay in that adapter's durable project. Run `video renderer check` and `video renderer review` again; the new source hash invalidates prior approval.
- After a Remotion or HyperFrames delivery is rendered or finalized, run `video renderer revise` before renderer-only edits; this preserves the prior delivery and opens a fresh review without changing approved semantic inputs.
- Text, narration, claims, and semantic changes go through a revised, re-approved canonical `video.json`. Start a new renderer project version. Never sync Studio/HTML edits back to canonical JSON or merge DOM trees.
- For any already-approved Brief, Script, Storyboard, asset preflight, or visual review that must be revisited, use the protected host `reopen` action with concrete feedback and the current edit generation. The runtime snapshots prior authorization, preserves artifacts, invalidates the selected checkpoint and all descendants, and keeps old deliveries historical. Inspect `video revision status`, make a complete hash-bound `video revision reconcile` report, and reapprove each affected checkpoint; unchanged artifacts can be reused but never inherit old approval.
- Reopening an approved Brief requires a fresh renderer selection and Production Profile binding. Use `video profile rebind` only when all non-duration Brief intent is unchanged; reassess with `video profile revise` when it changed. A hard duration ceiling overrun is `DURATION_FIT` input; the host records `shorten_script` or `revise_brief`. Never speed, slow, stretch, reinterpret sample rate, or trim approved voice to fit.
- Do not run `video renderer prepare` to overwrite a frozen version. HyperFrames versions stay under `hyperframes/projects/`; prior Remotion sources are snapshotted under `remotion/projects/` when canonical state advances.
- Keep Studio, CLI renderer, and Backlot loopback-only. HyperFrames runs with telemetry, update checks, and skill downloads disabled. Do not publish, cloud-render, provide public or hosted editor access, use catalog/auth/feedback/remote-asset commands, or redistribute a renderer bundle. Preserve the education-only, video-output scope in `docs/compliance/EDUCATIONAL-USE-SCOPE.md`; this repository policy does not alter upstream license terms.
- When Remotion is selected, use `.agents/skills/remotion-best-practices/SKILL.md` as the official router and load only official Remotion guidance for the chosen runtime. GSAP is optional; use `remotion-docs` and the official `@remotion/gsap` guidance only when GSAP is selected. Official Remotion guidance owns implementation technique; repository handoffs add only project-specific constraints.

## Ownership

`video.json` owns meaning, approved copy, narration, constraints, and sequential integer frame budgets. The selected renderer workspace owns visual implementation and resolved timing. Each adapter captures frame evidence and produces the same `output/final.mp4` delivery path.

Preserve semantic truth and required continuity while choosing the clearest visual representation. Meaningful visible/spoken copy must exist in canonical `video.json`. Keep content, claims, and narration out of CSS-generated text or executable scripts.

## Production profile rules

- Profiles define viewer outcomes and priorities, not mandatory scene templates.
- Explicit user intent outranks inferred profiles; primary profile outranks supporting profiles.
- Choose supporting profiles only for distinct viewer-success, truth, evidence, or communication requirements.
- `neutral` is fallback only.
- Profile selection is frozen and request/skill/hash-bound before Script authoring.
