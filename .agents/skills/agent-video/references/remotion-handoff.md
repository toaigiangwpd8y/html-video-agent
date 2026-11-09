# Storyboard Enhance to Remotion handoff

Run this adapter only when `.video/renderer-selection.json` selects `remotion`. After production assets pass `video project preflight production` and the host approves `ASSET_PREFLIGHT`, run `video renderer prepare` and author inside `remotion/generated/`.

Full Enhance reasoning order: scene design → asset resolution → candidate layout/blueprint → motion reasoning → bounded `KEEP`/`ADAPT`/`SWITCH` → final layout confirmation → runtime choice → implementation. The Remotion handoff does not change that order.

## Read order

1. The complete canonical `video.json`, then the approved `assets/manifest.json`.
2. This handoff, `.agents/skills/storyboard-enhance/SKILL.md`, `.agents/skills/storyboard-enhance/references/layouts/README.md`, and the compact layout catalog.
3. The active Production Profile `Renderer Guidance` and `.video/renderer-selection.json` establish presentation priorities and selected-runtime authority.
4. `.agents/skills/remotion-best-practices/SKILL.md` is the official Remotion router. After runtime selection, load only that runtime's official implementation guidance. For Remotion Studio structure, read `.agents/skills/remotion-interactivity/SKILL.md` and its `timeline-structure.md`; `remotion/AUTHORING.md` and `remotion/core/video-utils.ts` add project-specific constraints.
5. After asset resolution, read `blueprints-index.md` and the complete selected renderer-neutral blueprint.
6. Generated snapshots `remotion/generated/project.json` and `remotion/generated/asset-manifest.json`.

Do not run HyperFrames authoring commands or generate root `SCRIPT.md`, `STORYBOARD.md`, `frame.md`, or `theme.json`. Those would duplicate MVP-owned source artifacts.

## Generated implementation

- The harness derives `generated/theme.ts`, `generated/fonts.ts`, and `generated/motion.ts` from canonical `meta.theme` and the approved asset registry. Use these tokens and frame-based motion defaults as authoring inputs; do not create a competing root `theme.json`. Renderer timing remains free to resolve overlap while preserving canonical meaning and total duration.

- Create `remotion/generated/Video.tsx` and export `GeneratedVideo` for `remotion/root.tsx`. The prepared `remotion/root.tsx` also imports `GeneratedCompositions` from `remotion/generated/Compositions.tsx`; preparing a new project creates the empty `React.FC` scaffold when needed and preserves an authored extension.
- Keep connected preview registrations in `remotion/generated/Compositions.tsx`. Export `GeneratedCompositions: React.FC`, register unique non-`MainVideo` composition IDs with standalone dimensions, fps, duration, and default props, and point each registration at the same scene component used inside `GeneratedVideo`. Keep the extension and referenced scene source under `generated/` so source hashing and candidate manifests include every edit. Preserve authored extension contents during check/review and use `renderer revise` before authoring a new revision of a rendered or finalized workspace.
- Preserve scene order, exact `screenText`, narration meaning, dimensions, fps, and total frame budget from canonical inputs. Put every meaningful text string in canonical `video.json`.
- Create `remotion/generated/timeline.json` with `version: "3"`, canonical `fps`, `durationInFrames`, and one ordered `{sceneId,startFrame,endFrame}` interval per scene. Start at frame 0, cover the full output with no gaps, and keep ends within the canonical total. Overlap is permitted; non-monotonic scene order is not.
- Use only local files in `remotion/public/assets/` whose exact registry entries bind them to the scene. Resolve paths through `remotion/core/video-utils.ts`; do not construct filenames or URLs.
- For canonical voiceover, import `Audio` from `@remotion/media`, resolve the scene-bound `voiceover` through `resolveSceneVoiceover` in `remotion/core/video-utils.ts`, and render it as an audible frame-addressed track. Resolve media by manifest entry with `role: "voiceover"` and the exact matching `sceneId`. Do not infer scene, filename, or path conventions; do not synthesize, omit, or replace approved narration.
- Bind the exact `audio.voiceSegmentId` in the canonical scene to its approved WAV and manifest sample count/rate. The scheduled interval must cover the full measured voice duration. Keep playback rate at exactly `1.0`; do not set `playbackRate`, `trimBefore`, `trimAfter`, `endAt`, pitch/rate filters, or other fitting controls. The runtime verifies the approved asset bytes, mapping, natural-rate contract, and final audio stream duration; arbitrary renderer code cannot be proven safe through static scanning alone.
- Use deterministic Remotion frame APIs. No wall-clock timers, runtime randomness, CDN resources, remote media, cloud render, Lambda, or user-visible text generated outside canonical data.
- GSAP is optional, never universal or the default. When selected, follow the current official `@remotion/gsap` guidance, including `useGsapTimeline()`; for Remotion-native frame motion, use the official `remotion-markup` guidance. Do not load implementation guidance for an unselected runtime.

## Candidate manifest

Write `.video/implementation-manifest.candidate.json` with this structure:

```json
{
  "version": "1",
  "projectHash": "<videoProjectHash from the prepared canonical project>",
  "skillId": "mvp-remotion-contract",
  "generatedFiles": ["generated/Video.tsx", "generated/Compositions.tsx", "generated/timeline.json"],
  "sceneBindings": [
    {"sceneId": "<canonical scene id>", "sourceFile": "generated/Video.tsx", "assets": ["/assets/<approved path>"]}
  ]
}
```

List every implementation source file under `generated/`, include `generated/timeline.json`, bind each canonical scene exactly once, and list only assets present in the approved manifest. Do not author validation results; the harness adds those after checks.

## Check, review, render, finalize

Run `video renderer check`, read the reported layout findings, then `video renderer review`. `check` runs typecheck, generated boundary stills, and the deterministic layout lint over sampled frames; it writes `.video/layout-lint.json` and exits non-zero unless the status is `PASS`. Fix every error finding and re-run before review; `--scene <scene-id>` limits the run while iterating and `--strict` treats warnings as errors. The local Studio is opened on loopback by `review` and the harness freezes the generated-source hash. Stop for human visual review; preview and agent inspection are not approval. A source or approved-input hash change requires fresh check, review, and host approval.

After the host approves that exact source hash, run `video renderer render`. Then run `video renderer finalize`; it validates the already-rendered MP4, candidate manifest, canonical project/asset bindings, timeline evidence, boundary stills, stream metadata, and output hash before writing `remotion/implementation-manifest.json`. Finalize does not start another video render.
