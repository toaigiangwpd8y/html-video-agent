# Agent-native video harness v0.22.0

Renderer-neutral canonical workflow with a human-selected Remotion or HyperFrames renderer. The repository owns semantic state, validation, revisions, evidence, and delivery; the external harness owns creative reasoning.

## Production flow

```text
Request -> clarification assessment -> Video Brief + explicit renderer choice
  -> frozen Production Profile -> one Script + bounded self-check -> approval
  -> Storyboard approval -> canonical video.json
  -> one Storyboard Enhance author
       scene strategy -> licensed local assets -> production preflight
       -> selected renderer workspace -> one bounded self-check
  -> selected renderer check -> local preview/Backlot review -> HUMAN approval
  -> renderer-specific render/evidence -> shared final manifest -> MP4 finalize
```

No asset or Scene Design approval checkpoint is added. The human chooses an engine during Video Brief review; no renderer is selected automatically. Final visual review opens that renderer's local preview and provides a direct Backlot link. Preview is not approval. Renderer use is scoped to local educational video authoring; this repository does not provide or distribute a hosted animation tool.

## Ownership

`video.json` remains the only semantic source of truth with exactly `meta` and `scenes` at the top level. Its sequential integer scene budgets sum to `meta.durationsInFrames`. `assets/manifest.json` records local path, source/provenance, scene binding, license or rights, and permitted use.

The selected renderer workspace owns visual implementation and local timing. Remotion source lives under `remotion/generated/`; HyperFrames source lives in its versioned HTML project. Visible text must match canonical `video.json`; `video renderer check` verifies rendered copy against canonical text (HyperFrames by source binding, Remotion by the `copy_parity` lint rule) and reports geometry findings in `.video/layout-lint.json`. After a rendered or finalized delivery, start visual-only edits with `video renderer revise`; it preserves the prior delivery and opens a fresh renderer authoring version whose source needs new check, review, and approval. Copy/narration/meaning edits return through canonical Storyboard approval and create a new renderer version. HyperFrames versions stay under `hyperframes/projects/`; prior Remotion source is preserved under `remotion/projects/` when canonical state advances.

Generated renderer workspaces, copied media, and implementation manifests are git-ignored. Keep them local unless their specific assets and project files receive separate distribution review.

HyperFrames uses the first-party Title/Text, Fullscreen Media, and Split Layout kit. Remotion uses React/TypeScript compositions. Both renderers preserve canonical frame budgets and use local assets. The CLI's bundled HyperFrames Studio is only a local visual-review editor and is not copied or redistributed.

## Runtime and compliance controls

- Node.js 22.18.0 or later.
- HyperFrames CLI is pinned to `0.8.50`; Remotion packages are pinned by `remotion/package-lock.json`.
- `npm run bootstrap` installs root dependencies, prepares both pinned runtimes, builds the harness, and fails unless both renderer options are available. `npm run setup -- --renderer=hyperframes|remotion` repairs one engine.
- Setup installs pinned packages from `registry.npmjs.org` with package scripts, audit hooks, and funding output disabled. When Remotion is selected, it also installs the pinned official Remotion Agent Skills set for implementation guidance. Setup does not download a browser or FFmpeg.
- Rendering requires a locally installed Chrome/Chromium, FFmpeg, and ffprobe. No cloud rendering, publish, auth, telemetry, update check, or HyperFrames skill download is used.
- HyperFrames commands are invoked from the locked local package with telemetry, update checks, and skill downloads disabled. Backlot and both Studio previews are constrained to loopback.
- `video renderer review` opens the selected renderer's local preview. Runtime dependencies and applicable third-party terms are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- `video renderer finalize` writes a shared `.video/final-manifest.json` for Backlot/status and retains each renderer's detailed implementation manifest. Renderer availability indicates installed runtime readiness, not compliance approval.

## Setup

```bash
npm run bootstrap
npm test
```

Bootstrap installs root dependencies, prepares both pinned renderers, builds the harness, and fails unless both renderer options are available. If install scripts were disabled, run `npm run setup -- --renderer=all` manually.

## CLI workflow

```bash
npm run video -- init
npm run video -- request set request.md
npm run video -- clarify template
npm run video -- clarify commit .video/candidates/clarification.json
npm run video -- brief template
npm run video -- brief commit .video/candidates/brief.json
npm run video -- renderer options --require-all
# Human approval and explicit choice: npm run video:host -- brief approve <remotion|hyperframes>
npm run video -- profile catalog
npm run video -- profile template
npm run video -- profile commit .video/candidates/profile.json
npm run video -- script commit .video/candidates/script.md
# Human approval: npm run video:host -- script approve
npm run video -- storyboard commit .video/candidates/project.json
# Human approval: npm run video:host -- storyboard approve
npm run video -- project preflight production
npm run video -- renderer prepare
npm run video -- renderer check
npm run video -- renderer review
# Stop for VISUAL_REVIEW; host records approval.
npm run video:host -- renderer approve
npm run video -- renderer render
npm run video -- renderer finalize
npm run video -- status
```

## App Explorer

Reusable App Explorer knowledge is stored outside `.video` in one dataset per registered app. Registration creates the fixed `workspaces/<app-id>` directory without initializing or overwriting knowledge.

```bash
npm run explore -- apps add --id crm --name "CRM" --url https://crm.example
npm run explore -- apps list
npm run explore -- --app crm summary --json
npm run explore -- next --data ./existing-knowledge --json
npm run explore -- apps source add --app crm --alias source --path ../crm-source
npm run explore -- evidence materialize selection.json --app crm
```

The host `--app` option resolves only registered app IDs. Use either `--app` or the existing explicit `--data` option. App Explorer commands and flags are forwarded to the package CLI; its direct `--data` interface remains available through `runKnowledgeCli` and `packages/app-explorer/cli.mjs`.

Research binding and evidence-promotion JSON contracts are documented in [App Explorer research inputs](docs/APP_EXPLORER_RESEARCH.md). Run `npm run verify:host` for the compiled host suite plus the retained App Explorer package suite; `npm run test:explorer` runs the focused host registration/CLI checks.

`explore evidence materialize` promotes one PNG, JPEG, or WebP linked to a context, feature, scenario, and execution in the named immutable V2 revision. Its selection JSON supplies `revision`, `contextId`, `featureId`, `scenarioId`, `executionId`, `evidenceRef`, `assetId`, `sceneId`, `role`, and a factual `rights` or `license` statement with `permittedUse`. When the reference has no hash in the frozen research binding (including later-revision evidence), selection JSON must also supply `expectedSourceSha256` as `sha256:<64 lowercase hex digits>`. This digest matches the selected current workspace bytes before copying; Explorer revision manifests do not snapshot evidence image bytes, so it does not prove the bytes historically present at that revision. Each copied file stays under `assets/app-explorer/` with a machine-readable `researchEvidence` origin and content hash. Later evidence can be added from a newer revision without replacing the frozen research binding; changing canonical copy or meaning still goes through Storyboard revision and review.

The creative agent must never run the host approval command. For workflow details, see `CODEX_E2E.md`, `docs/ARCHITECTURE.md`, and `.agents/skills/agent-video/SKILL.md`.

For slide-based requests, place source decks in `video-input/` or pass a local PPTX/PDF to `npm run video -- source import <path>`. For lecture decks that need per-slide review, use `npm run video -- sources extract <deck.pdf|deck.pptx>`, bind a slide-labeled script with `sources script`, and create/check its assessment with `sources assess template|check`. `video init` preserves `.video/sources/`. Extraction supplies analysis context; `video.json` remains the approved source of meaning and visible copy. Remotion projects derive theme, font, and frame-motion modules from canonical theme tokens and registered fonts.
# Local TTS and checkpoint reopening

Narration uses pinned self-hosted VieNeu v3 Turbo CPU/ONNX; see [docs/TTS.md](docs/TTS.md) for general installation guidance, commands, measured WAV manifests, and sample memory measurements. Script approval binds exact voice bytes. Hard duration ceilings produce a host-owned `DURATION_FIT` decision; approved narration is never sped up or trimmed.

Approved checkpoints can be reopened from Backlot or `npm run video:host -- reopen ...`. Reopening snapshots old approvals and invalidates downstream authorization. Before resubmitting, inspect `video revision status` and submit a hash-bound report with `video revision reconcile <report.json>`. Previously approved artifacts may be reused but require fresh review.

## License

Original project-authored code and documentation are licensed under the MIT License in [LICENSE](LICENSE). Third-party components and runtimes retain their own terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [SOURCE_NOTICES.md](SOURCE_NOTICES.md) for source and license information. This project is not affiliated with or endorsed by the referenced upstream projects.
