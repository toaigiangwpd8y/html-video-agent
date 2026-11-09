---
name: storyboard-enhance
description: Use after an approved semantic Storyboard to resolve production assets and author with the user-selected renderer; optional local Onda reuse may help Remotion scenes.
---

# Storyboard Enhance Author

Own the post-approval bridge from canonical semantic WHAT to the user-selected renderer's presentation HOW. `video.json` remains the only semantic source of truth. Perform one complete Enhance pass and one bounded correctness/fit self-check; do not create candidate loops, a Critic round, or additional HITL checkpoints.

## Required reading

1. Read the complete approved `video.json` first.
2. Read `.agents/skills/storyboard-enhance/references/layouts/README.md` and `catalog.json` for renderer-neutral scene-design guidance.
3. Read the active Production Profile `Renderer Guidance` and the handoff for `.video/renderer-selection.json`'s selected engine.
4. For Remotion, read `.agents/skills/remotion-best-practices/SKILL.md` as the official router and implementation authority. Choose the motion runtime by capability, then load only the official implementation guidance for that runtime. For HyperFrames, read `hyperframes/kit/README.md` and its selected adapter handoff.
5. After Phase 2 asset resolution, read `blueprints-index.md` for global materialization and continuity rules; read only the selected blueprint's complete file and, if needed, one alternate.

Onda retrieval is optional. Do not load the full discovery snapshot or vendor source as required reading. When reuse could help after real assets and the final blueprint are known, follow the optional Onda procedure below.

Shotcraft retrieval is also optional and Remotion-only. It cannot change the selected renderer, canonical scene meaning, required assets, blueprint, exact copy, or frame budget. When a shot could help after Phase 2 asset resolution and final blueprint confirmation, read `.agents/skills/storyboard-enhance/references/shotcraft/README.md` and follow its bounded lookup. For a user-named card or variant, inspect that exact ID and variant; preserve the request within the same asset, renderer, source-hash, and host-review gates. Do not apply Shotcraft examples, Ink Press styling, or its timing taste globally.

## Canonical preservation

Preserve scene meaning/order, required evidence and relationships, approved claims, narration meaning, exact `screenText`, continuity, frame budget, and user constraints. `visualConcept` describes what viewers must understand, not a required layout or asset list. Do not add meaningful visible/spoken text outside `video.json`.

When canonical `meta.theme` is present and Remotion is selected, use the harness-generated theme, font, and motion modules as presentation guidance. Keep the selected renderer's timing and composition flexible; do not add a separate theme source file.

## Full Enhance reasoning order

Full Enhance reasoning order: scene design → asset resolution → candidate layout/blueprint → motion reasoning → bounded KEEP/ADAPT/SWITCH → final layout confirmation → runtime choice → implementation.

For Full Enhance, Phase 1 records semantic scene intent only; candidate selection is deferred to Phase 3 after Phase 2 asset resolution. Scene-design / asset probe remains a separate bounded mode: it does not load motion or implementation guidance.

1. **Scene design:** For each scene, identify its story job, evidence objects, important relationships, temporal change, and required continuity. Record semantic intent only; do not lock a blueprint before asset inspection.
2. **Asset resolution:** Derive required/preferred assets from semantic roles. Acquire only assets that help communicate approved meaning. Keep source, provenance, scene binding, rights/license, and permitted use in `assets/manifest.json`. Use local manifest-approved files only. Create truthful derivatives with provenance when a source is not renderable.
   - For software product scenes, follow Software UI assets below to resolve missing captures and faithful UI derivatives.
   - If an existing normalized source contains slide or document material, inspect only the relevant source items. Materialize an explicitly selected item into the production asset registry only when a scene needs it: `video source materialize <source-id> <asset-id> <scene-id> <role>`. Do not bulk-promote a source deck or use its unselected media as production assets.
   - When an approved scene needs authentic web-interface evidence, use `.agents/skills/web-app-capture/SKILL.md` as an optional asset-resolution source here, after scene intent is clear and before Phase 3 blueprint choice. Probe read-only, capture only the authorized configured app, assert the resulting state, and materialize selected PNG/MP4 files into the existing manifest with explicit rights, scene, and role. This is a branch inside Phase 2, not a new workflow stage. Do not promote footage whose meaningful visible copy/state is absent from canonical `video.json`; route that change through Storyboard revision and its existing host approval. Preserve the current renderer and asset preflight/HITL gate.
   - Reuse each exact approved Script-stage narration asset, registered from the validated narration manifest without resynthesis. Bind each canonical `audio.voiceSegmentId` to `role: "voiceover"` on exactly one matching `sceneId`; Remotion code resolves it through `resolveSceneVoiceover` in `remotion/core/video-utils.ts`. Never infer scene, filename, or path conventions. Record measured frame-addressed audio timing, media offset, gain, and fades. Do not omit, trim, or rate-change narration to force fit.
3. **Candidate layout/blueprint:** After inspecting actual assets, compare at least three materially different blueprint families and choose by semantic fit. Read the complete selected blueprint, including its failure modes and Materialization Test. Asset inconvenience does not change canonical story meaning.
4. **Motion reasoning:** Read the renderer-neutral motion index and only the matched pattern guides. Select the motion patterns required to express the intended visual behavior and choreography faithfully. Every selected pattern must have a semantic or temporal purpose. Do not reduce motion richness to minimize the number of patterns. Do not add motion that has no communicative purpose. Reuse an existing blueprint family where it fits; motion reasoning is part of the current Enhance pass, not a new workflow stage. Do not create a persisted motion plan or artifact.
5. **Bounded fit decision:** Confirm blueprint and motion fit as `KEEP`, `ADAPT`, or `SWITCH`. Switch only when the selected strategy is genuinely infeasible; inspect at most one alternate, and do not begin another candidate search.
6. **Final layout confirmation:** Check actual materialized assets against the chosen blueprint's roles and constraints. Preserve scene meaning, evidence relationships, continuity, and frame budget.
7. **Runtime choice:** Use capability-based runtime choice for Remotion. GSAP is optional and never the default; do not omit or reduce intended motion to use a simpler API—choose the Remotion-supported runtime that fits. After choosing, return to the installed official Remotion skills and router, then load only the selected runtime guidance. Do not load implementation guidance for unselected runtimes. Official Remotion guidance owns implementation technique and API choices. Remotion-native frame motion uses official `remotion-markup` guidance; GSAP uses the official `remotion-docs` and `@remotion/gsap` guidance, including `useGsapTimeline()`. HyperFrames uses the repository-owned HTML/CSS kit.
8. **Implementation:** Run `video project preflight production` and stop on failure. Surface `ASSET_PREFLIGHT` for host approval when required. Run `video renderer prepare` only after approval. For Remotion, author React/TypeScript under `remotion/generated/`; use `resolveSceneAsset` and `resolveSceneVoiceover` from `remotion/core/video-utils.ts` to resolve exact manifest-bound local assets. For HyperFrames, author HTML/CSS only inside its returned versioned project. Preserve canonical order, exact text, and integer frame budgets; record resolved renderer timing in the selected adapter's required format. Mute video elements and attach audio only through the approved frame-addressed audio registry.
9. Perform one bounded semantic self-check against canonical meaning, asset-role fit, selected blueprint invariants, and motion purpose. Fix material blockers in this same pass and report any remaining limitations plainly.
10. Run `video renderer check`; when it reports `PASS`, run `video renderer review`. `check` runs typecheck, boundary stills, and the deterministic layout lint (overlapping text, an object painted over text, a connector drawn across a node, content outside the canvas, clipped copy, copy under the legibility floor, unready fonts/images, and canonical copy parity), writes `.video/layout-lint.json`, and exits non-zero on any error or unevaluated check. Fix every reported finding in this same pass and re-run; never hand-inspect geometry the lint already measures. `review` then starts the selected local preview and freezes its source hash. Stop for human `VISUAL_REVIEW`. If preview startup fails, stop with the error; do not substitute another renderer or claim review. Never approve it yourself.

## Software UI assets

Apply during Phase 2 after Storyboard approval, before blueprint selection:

- This phase acquires production captures after Storyboard approval. Inspect available product captures against the approved workflow proof. Reuse them when adequate; obtain missing states from the authorized running product with available browser tools or Playwright when supported by the harness. These tools belong to the external harness, not a new repository capture command.
- A bound App Explorer research selection is provenance for approved video research, not a second semantic project. Use selected evidence only for its bound scenario/context; new or supplemental images go through the existing selection, rights, scene/role, hash, conflict, host approval, and asset-preflight gate. Research evidence remains distinct from production assets until selected and promoted through that gate.
- Reproduce the planned initial state and inputs in the permitted demo environment. Capture the relevant action, response, and result as local screenshots or recordings. Confirm that the result follows the demonstrated action rather than a stale/preloaded output. Use only the authorized seed/reset procedure; a video request does not authorize unrelated account or production-data changes.
- Register each production file in `assets/manifest.json` using the existing contract, with scene/role binding, source, provenance, and permitted use. Include known app/version and demo-data context in existing provenance fields where relevant. Keep captures clear of unrelated private data; screenshots do not prove motion, latency, or automation by themselves.
- When a code-authored UI representation is clearer than a capture, derive it from supported behavior and real UI evidence. Preserve meaningful labels, inputs, permissions, response states, and outputs. Identify the representation as a derivative in provenance rather than an actual capture; illustrative sample data must not become a claimed real result or benchmark. Register any materialized media through the asset registry; renderer implementation stays in the selected workspace.
- Motion should reveal the interaction and resulting value while preserving readable UI and spatial continuity. Show compressed waits honestly; do not fabricate instant processing, successful actions, or capabilities to improve pacing. Meaningful visible labels and claims must already be canonical; decorative UI detail cannot introduce new meaning.
- If access, repeatability, or evidence cannot support approved meaning, report the blocker and return through the existing host feedback/canonical revision path. Do not substitute an invented workflow, change claims in renderer code, or add an approval checkpoint.

## Optional Onda retrieval

Registry availability cannot influence scene meaning, asset requirements, blueprint choice, or motion design.

Only after real asset inspection and final blueprint confirmation, an optional Remotion registry lookup may help identify reusable source. The compact installed catalog is `.agents/skills/storyboard-enhance/references/registry/catalog.json`; retrieval uses its search command, while the registry README owns discovery and vendor procedure. Custom direct Remotion authoring is preferred whenever reuse weakens semantic fit, asset fit, temporal behavior, or technical reliability; `NONE` is a valid outcome.

- Search only the compact local catalog: `npm run registry:search -- --provider onda --query "<compact English visual query>" --top 8`. Inspect only returned top candidates. Do not read `upstream/onda.snapshot.json` for every scene.
- Treat search as retrieval, not semantic selection. Review candidates as `ACCEPT`, `REJECT`, or `NEEDS_REVIEW`; drop rejected or unresolved candidates and choose `NONE` when no suitable candidate remains.
- For a `DISCOVERED` Onda item, read `.agents/skills/storyboard-enhance/references/registry/README.md`, inspect its source with `npm run registry:onda:inspect -- <slug>`, and review its capabilities, inputs, constraints, source closure, and provenance before accepting it.
- Vendor only an accepted item with `npm run registry:onda:vendor -- <slug> --metadata <temporary-file>`. Delete temporary metadata after use; it is not a canonical artifact. Do not install dependencies, create a registry manifest, add a runtime loader, provider adapter, global barrel, or component-ID renderer, or introduce a new user checkpoint.
- Resolve the final authoring choice as `USE <catalog-id>`, `ADAPT <catalog-id>`, or `NONE`. Use the selected catalog `sourcePath` as a direct authored import only for `USE` or `ADAPT`; write custom code for `NONE`. Add a concise `REGISTRY_SOURCE` trace comment only when vendored source materially contributes.

## Optional Shotcraft retrieval

Shotcraft is a pinned source/reference library, not a workflow or approval system. It is available only when the Video Brief selected Remotion, and only after semantic scene intent, real asset inspection, and final blueprint confirmation. A user-explicit shot remains the requested choice when it fits; do not replace it with another shot because of catalog ranking. If it conflicts with approved meaning, evidence, required assets, renderer constraints, or the canonical frame budget, report the specific mismatch and use the existing canonical revision or authoring path.

- Read the compact Shotcraft README, search for the semantic job (or inspect the explicit user-named ID), then inspect the exact card, demo source, and dependency closure. Name a variant when the card is ambiguous. Do not infer a demo from ID, slug, or variant order.
- Choose and record `USE <id>`, `ADAPT <id>`, or `NONE`. `USE` keeps the original demo behavior; `ADAPT` makes only the required input, import, or asset glue changes. Preserve upstream motion internals and the original frame arc. If canonical copy cannot fit the shot's input constraints, choose a different compatible source or `NONE`; do not rewrite meaningful copy or speed up the motion.
- For `USE` or `ADAPT`, bind only existing canonical text keys, theme palette tokens, and approved local assets from `assets/manifest.json`. Prepare the selected dependency closure under `remotion/generated/` so its source is covered by the existing hash and review contract. Do not create a semantic sidecar project or a global import barrel. For HyperFrames, use the selected HyperFrames workspace and do not import Shotcraft TSX.
- Ink Press is an optional complete example, not the default for high-energy SaaS or any other product. Upstream pacing, long holds, music cues, and creative taste are local reference only. Never activate its autonomous workflow, approval logic, reviewer loops, or global taste rules.
- When a scene needs authentic UI evidence, use the existing Software UI assets procedure and `.agents/skills/web-app-capture/SKILL.md` in Phase 2. A screenshot, element cutout, or layout metadata is a source/derivative asset: verify its source and meaning, give it truthful provenance, bind it through the existing manifest, and pass existing host approval/preflight before authoring. Do not use an upstream capture-template Puppeteer path, bypass asset registration, or start automatic browser discovery.
- Treat Shotcraft sound-design and beat-sync notes as technical references only. Audio binaries are excluded from this snapshot. Select or acquire audio only with specific rights provenance and applicable production approval; an `unknown-source` audio file stays blocked. The Apache-2.0 notice for code does not license separately sourced audio.
- Run the existing `video renderer check`, then `video renderer review`; the host owns review decisions. Never treat a preview, catalog status, or shot choice as approval, change canonical `video.json`, or add a HITL checkpoint.

## One-way visual freeze

The selected local preview is the required visual-review surface. `video renderer review` opens it in the default browser and Backlot exposes a loopback link. Source changes invalidate the hash and approval; rerun `check` and `review` for fresh human approval. Keep use local and video-only; do not build, host, or distribute a competing web animation editor or renderer bundle.

Renderer projects do not write back to `video.json`. If visible copy, narration, claims, or meaning need changes, return through canonical Storyboard review. Do not prepare over a frozen project or attempt a renderer-to-canonical merge. HyperFrames projects remain under `hyperframes/projects/`; prior Remotion source is preserved under `remotion/projects/` when canonical state advances.

## Return format

Return the project directory, selected blueprint IDs, materialized asset bindings, optional registry outcome, check result, and a concise self-check with any unresolved material findings. Do not report user approval; the host owns that record.
