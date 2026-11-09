# Storyboard Enhance to HyperFrames handoff

After production assets are materialized and `video project preflight production` passes, run `video renderer prepare`. The command creates an immutable, hash-bound project under `hyperframes/projects/` from canonical `video.json`, the frozen Production Profile, and the approved asset manifest. Do not regenerate that version.

Read in this order:

1. Complete canonical `video.json` and `assets/manifest.json`.
2. This handoff and the selected renderer-neutral layout blueprint.
3. `hyperframes/kit/README.md`, `tokens.css`, and `primitives.css`.
4. Active Production Profile `Renderer Guidance`.
5. Version-pinned HyperFrames CLI documentation at [0.8.50](https://hyperframes.heygen.com/packages/cli) for the exact `check`, `preview`, and local `render` commands. Do not install or load its downloadable skills.

## Semantic ownership

`video.json` has exactly `meta` and `scenes` at the top level. It owns meaning, approved narration and screen copy, constraints, and the total frame budget. Canonical `scene.durationInFrames` values are positive integer semantic allocations whose sum equals `meta.durationsInFrames`.

Production profile and renderer manifest are provenance/configuration, not secondary story sources. Do not add a claim, CTA, scene, caption, visible label, or narration because the visual design would benefit from it. Meaningful copy changes return to canonical review.

## Timing and media

Derive scene start frames with cumulative integer addition. Convert each integer frame boundary to seconds once as `frame / fps`; never accumulate floating-point durations. Keep composition/media clips on local project paths with explicit `data-start`, `data-duration`, and `data-track-index` values. HTML audio is only for local preview. Final timing comes from the CLI PNG frame sequence plus the repository FFmpeg mux script, which places approved audio at integer-frame sample offsets.

Each approved media file must originate in `assets/manifest.json` and retain its source, license or rights, permitted use, provenance, and scene binding. Do not use URLs, remote fonts/scripts, external catalogs, or implicit browser downloads. Mute every rendered `<video>`; final audio is mixed only from manifest-timed `<audio>` clips.

For approved narration, keep `audio.voiceSegmentId`, exact canonical text, registered WAV bytes, measured samples, scene, and clip schedule aligned. Every audio clip uses playback rate `1.0`, begins at its canonical integer-frame offset, and covers the complete measured voice. Do not add HTML/JavaScript playback-rate controls, time stretching, pitch/rate filters, or truncation to fit. Source scanning is a guard; executable renderer code still requires honest inspection and approved output evidence.

## HTML and motion

Author HTML/CSS only within the project reported by `prepare`. Use the three repository-owned layout primitives: Title/Text, Fullscreen Media, and Split Layout. Every user-visible text node must be inside its exact `data-canonical-text-id` binding. Keep narration in approved local audio assets.

Use seekable fixed CSS keyframes and project-local images/fonts. No inline JavaScript, wall-clock timers, runtime randomness, CSS-generated copy, remote resource requests, GSAP, or third-party runtimes. Preserve composition dimensions, semantic order, required visual progression, and the approved end frame.

## Review freeze and rendering

`video renderer check` runs the pinned CLI's lint/runtime/layout/motion/contrast gate, keeps its findings instead of reducing them to a pass/fail, and adds the harness layout rules for what the CLI does not cover (a connector drawn across a node). It writes `.video/layout-lint.json` and exits non-zero unless the status is `PASS`; fix every error finding and re-run before review. `--scene <scene-id>` limits the run while iterating and `--strict` treats warnings as errors. Mark intentional layering with the shared opt-out attributes on the narrowest owning element: `data-layout-allow-overlap`, `data-layout-allow-occlusion`, `data-layout-allow-connector-overlap`, `data-layout-allow-overflow`, `data-layout-ignore`. `video renderer review` samples transition frames, starts pinned HyperFrames Studio on loopback, opens the project deep link in the default browser, records the source hash, and enters `VISUAL_REVIEW`. This repository uses Studio only for local education and authored video output; do not build, host, or distribute a competing web animation tool. After review starts, visual-only HTML/CSS changes stay in place and invalidate evidence/approval. Re-run check/review and stop for human review of the new hash. A failed Studio launch is a blocking error, not a Player fallback.

After a rendered or finalized delivery, run `video renderer revise` before visual-only edits. It archives the prior delivery, copies the authored project into a new versioned folder, and clears approval/evidence state. Run check/review again and require human approval for the new source hash.

Opening Studio is a preview, not approval. The creative agent never writes human approval or runs `video:host`. Rendering requires host-recorded approval for the exact frozen source hash. `render` captures the complete PNG sequence, selects evidence by zero-based frame number, and mixes local audio; `finalize` checks evidence freshness and `ffprobe` metadata before writing `hyperframes/implementation-manifest.json`.

A text/narration/claim/meaning edit returns through the canonical Storyboard approval path and creates a new renderer version. Never merge HTML copy into `video.json`, rerun `prepare` over an existing version, or remove older project versions.
