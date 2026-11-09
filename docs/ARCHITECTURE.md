# Architecture — v0.22.0 dual renderer

```text
Request -> clarification -> Video Brief + explicit renderer choice
  -> frozen Production Profile -> Script HUMAN review
  -> Storyboard HUMAN review -> canonical video.json
  -> one Enhance pass: strategy -> licensed assets -> preflight
  -> selected renderer prepare/check/review -> source hash freeze
  -> HUMAN visual approval -> render/evidence -> MP4 finalize
```

## Semantic contract

`video.json` contains exactly `meta` and `scenes`. It owns approved meaning, copy, narration, constraints, and sequential integer scene budgets. Their sum equals `meta.durationsInFrames`. The user-selected engine is stored in `.video/renderer-selection.json`, outside canonical content and bound to the approved request/brief.

`assets/manifest.json` owns materialized production asset identity and license/rights, permitted use, provenance, type, and scene binding. Production preflight rejects entries without rights evidence and permitted-use records.

The MVP owns `.video/script.md`, `.video/storyboard.json`, `video.json`, and the Production Profile. A renderer translates those inputs into its own workspace; it does not generate competing root `SCRIPT.md`, `STORYBOARD.md`, `frame.md`, or `theme.json` sources.

## Renderer selection and shared lifecycle

- `src/harness/renderer-selection.ts` reports locally installed runtimes and persists explicit human choice, rationale, availability snapshot, and choice history.
- `src/harness/renderer.ts` routes `prepare`, `check`, `review`, approval status, `render`, and `finalize` to the selected adapter. No silent fallback is permitted.
- Run `npm run video -- renderer options --require-all` successfully before Video Brief review; renderer availability must be checked before presenting either choice.
- `src/harness/final-manifest.ts` normalizes both completed outputs into `.video/final-manifest.json`; detailed implementation manifests remain renderer-specific.
- Canonical revisions invalidate renderer state, approval, evidence, and output. HyperFrames source remains versioned under `hyperframes/projects/`; prior Remotion source and copied assets are snapshotted under `remotion/projects/`.
- `src/hitl-host-cli.ts` is the host approval writer. Rendering requires approval bound to the current source hash.

## HyperFrames adapter

- `src/harness/hyperframes-project.ts` creates a versioned local project from canonical data and approved local assets, pins source-byte hashes, and maps scene budgets using integer frames.
- `hyperframes/kit/` provides first-party Title/Text, Fullscreen Media, Split Layout, theme tokens, and seekable CSS motion.
- `src/harness/hyperframes.ts` invokes the locked `hyperframes@0.8.50` CLI. Checks validate the pinned JSON contract and canonical copy. Review starts the bundled Studio on loopback, opens the project deep link, hashes the durable project, and exposes `VISUAL_REVIEW`.
- Render sends the approved HTML composition directly to the pinned CLI's MP4 renderer. Native frame-addressed audio automation carries approved fades; sparse `snapshot --at` captures provide opening, transition, and ending evidence. Finalize validates evidence-to-MP4 hashes, dimensions, FPS, frame count, duration, and audio stream coverage. No full PNG sequence or repository-owned FFmpeg mux is used.

## Remotion adapter

- `src/harness/remotion.ts` prepares canonical project/manifest snapshots and copies only approved local assets into `remotion/public/assets/`. Authored React source and renderer timing evidence live under `remotion/generated/`.
- `remotion/AUTHORING.md` and `.agents/skills/agent-video/references/remotion-handoff.md` define project-specific constraints. The pinned official Remotion skills provide runtime implementation guidance when Remotion is selected.
- The local Studio launch uses the pinned CLI plus `remotion/scripts/loopback-only.mjs`, which constrains Node TCP listeners to `127.0.0.1`. Review hashes generated inputs; render requires host approval for that hash.
- Finalize checks the manifest candidate, timeline and boundary evidence, local approved asset bytes, MP4 streams/dimensions/FPS/duration, and output hash. Automated Remotion copy-parity validation remains open; canonical text is currently enforced by authoring instructions and human visual review.
- When canonical `meta.theme` is present, the harness emits `theme.ts`, `fonts.ts`, and `motion.ts` under `remotion/generated/` from theme tokens and registered local font assets. These are derived renderer inputs; `video.json` remains semantic truth.

## Slide-source intake

- The normalized `video source import|inspect|materialize` path supplies PPTX/PDF evidence for the general workflow. The lecture-specific `video sources extract|script|crop|assess` path adds per-slide previews, narration binding, and assessment. Both keep extracted inputs under `.video/sources/`, which workspace reset preserves.

## Review freeze

The selected local preview is not human approval. Renderer source, canonical project, Production Profile, and approved asset changes invalidate the review binding. Renderer-only edits require fresh check, review, and host approval. After a rendered or finalized delivery, `video renderer revise` preserves that delivery and opens a fresh authoring version. Semantic edits return through Storyboard approval and create a new renderer version.

## Compliance records

Renderer versions are pinned in their package manifests and lockfiles. Applicable third-party terms are listed in `THIRD_PARTY_NOTICES.md`; follow each upstream license when using or distributing a runtime.

## Human-in-the-loop

The agent proposes clarification, Brief, Script, Storyboard, and renderer artifacts. The runtime/host owns all human approvals. `npm run video:host` is reserved for a human operator or permissioned harness adapter. When `video hitl status` reports `INPUT_REQUIRED` or `REVIEW_REQUIRED`, the creative agent shows the payload and ends its turn.

Every active review checkpoint also exposes a host-owned **Request changes** action. It stores feedback bound to the exact reviewed subject and returns HITL to `WORKING` without approving or editing that artifact. The creative agent can then revise it and submit a fresh review; a changed hash makes the prior feedback inapplicable. This applies to Video Brief, Script, Storyboard, Asset Preflight, and Visual Review. Clarification and renderer selection remain input checkpoints.

## Production profiles

Profiles define request-specific viewer outcomes and priorities. Explicit intent outranks inference; primary profiles outrank supporting profiles; `neutral` is fallback only. Profile selection is frozen and request/skill/hash-bound before Script authoring. Renderer Guidance adds profile-specific presentation priorities but does not select or prescribe the renderer.

## App Explorer research provenance

`video app-research bind <selection.json>` stores an immutable reference to one registered App Explorer application's exact V2 knowledge revision, selected contexts/scenarios/executions, and hashes of only the selected evidence. A binding requires either authoritative `exhausted_in_scope` plus clear coverage, or an explicit user instruction reference and a paused checkpoint that records unresolved unknowns. Paused/error/blocked runs do not imply completed scope. Binding is reference-only: video requests never start exploration, App Explorer knowledge remains outside `.video`, and no host approval record is written.

`video app-research inspect` checks the captured request and the immutable revision/evidence hashes. Later App Explorer revisions do not replace a selected revision. `rebind` explicitly replaces the current video binding; its fingerprint participates in Video Brief and Script review provenance so the existing HITL revision/review path applies. `video.json` keeps exactly `meta` and `scenes`. Completed archives include the binding and selected evidence only under `app-research/`; they exclude the App Explorer workspace and browser/session descriptors. `video init` clears the current video binding while preserving reusable App Explorer knowledge.

See [App Explorer research input examples and field definitions](APP_EXPLORER_RESEARCH.md) for the exact `BindResearchInput` and `PromoteExplorerEvidenceInput` JSON contracts, including supplemental evidence hashes.

An agent may promote an image linked to a context, feature, scenario, and execution in an exact immutable V2 revision with `explore evidence materialize <selection.json> --app <id>`. The operation copies signature-checked PNG, JPEG, or WebP bytes into `assets/app-explorer/<promotion-id>/`, stores a validated `researchEvidence` origin in the asset registry, and uses the existing canonical Storyboard, HITL, rights, scene/role, path, conflict, and preflight boundaries. If the frozen binding does not provide a hash for the selected reference, including evidence added in a later revision, the selection must carry `expectedSourceSha256` and promotion checks it against the current confined workspace bytes before copying. That supplied digest identifies the selected current bytes; core revision manifests do not snapshot evidence image bytes and the digest is not proof of a historical revision image. Explorer and capture asset manifest writes share a storage lock. A later image from a newer revision adds a separate immutable asset and does not change research-binding, Brief, or Script provenance by itself. Meaningful visible or spoken copy changes still require a Storyboard revision. Archives retain promoted Explorer bytes and their manifest origins.
# Script-stage TTS and revision reopening

The Script workflow records explicit narration segments in `.video/narration-input.json`. The local Python worker runs pinned VieNeu-TTS v3 Turbo CPU fp32. TypeScript measures real WAV sample counts and hashes, caches by exact segment text plus effective model/voice configuration, and commits a manifest only after every active segment validates. The approved Script review binds that manifest hash. Production preflight registers the exact WAV bytes as scene-bound assets; renderers verify the canonical `voiceSegmentId`, text, asset bytes, and measured frame schedule. Neither renderer may change narration rate or remove speech.

Brief duration policy distinguishes an approximate target from an optional hard ceiling. `DURATION_FIT` binds a host decision to the current Brief, Script, narration manifest, and timing plan. A target alone never blocks review.

The host-owned reopen ledger records an edit generation, snapshots authorization/artifact metadata, and marks the selected checkpoint and descendants stale. `video revision reconcile` records semantic reuse/edit/remove/add choices with prior/current hashes; runtime validation fails closed on stale reuse claims. A Storyboard approval after canonical promotion writes revision N+1 and preserves the prior project, renderer workspace, audio, and delivery. Old output is historical until fresh approvals and finalization.
