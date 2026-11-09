# Architecture — v0.22.0 neutral core + production-profile skills

```text
Request
      ↓
Clarification assessment (resolved with zero questions when clear)
      ↓
Video Brief → HUMAN approval
      ↓
.video/production-profile.json
(primary + optional supporting profile skills, request/skill hash-bound)
      ↓
one complete Script draft + one bounded correctness/fit self-check
      ↓
Script → HUMAN approval
      ↓
Storyboard → HUMAN approval (semantic-only)
      ↓
canonical semantic `video.json` (`meta` + `scenes`)
      ↓
one Storyboard Enhance author subagent
  → Scene Design / blueprint strategy
  → asset requirement reasoning
  → asset acquisition and validation
  → KEEP / ADAPT / SWITCH re-check
  → layout and direct Remotion authoring
  → self-review materialization
      ↓
non-destructive validation → Remotion Studio review
      ↓
user visual feedback → same Enhance author revision
      ↺
validate → Remotion Studio review (repeat; no prepare)
      ↓
user visual approval → final QA/render → resolved timeline v3 → evidence → manifest
```

## Separation of concerns

Within the single Storyboard Enhance author, production asset preflight runs immediately after asset acquisition, validation, derivatives, and voice-over materialization. A failed `npm run video -- project preflight production` stops the author before strategy re-check, final geometry, or Remotion implementation.

### Neutral deterministic core
Owns request freezing at Production Profile, mandatory clarification-assessment binding, profile/skill binding, project schema, revisions/patches, assets/claims, timeline coverage, audio binding, evidence freshness and final readiness.

### Production profile skill
Defines request-specific success criteria and role guidance. It is not a shadow project document and cannot override explicit user instructions.

### VideoProject
Owns current semantic WHAT/WHY: approved project metadata/constraints plus ordered scene budgets, approved narration text, viewer-facing copy, and semantic visual concepts. Top-level keys are exactly `meta` and `scenes`; visual/audio files are not canonical fields.

`assets/manifest.json` is the compact registry for materialized production assets. Storyboard Enhance owns post-approval asset acquisition, validation, truthful derivatives, strategy re-check, layout, and Remotion implementation. Remotion source is disposable implementation derived from semantic truth plus the production registry.

### Remotion
Owns HOW/WHEN in frames: layout, local duration, overlap, easing, motion, transition topology and component architecture. Canonical scene budgets sum to the final frame budget but do not prescribe resolved layer occupancy.

### Derived design tokens

Every renderer sync emits `remotion/generated/theme.ts`, `remotion/generated/fonts.ts`, and `remotion/generated/motion.ts` from canonical input. `theme.ts` resolves named roles (canvas, surface, border, text, accent) from `meta.theme`: roles pinned in the optional `meta.theme.roles` are used as given, and the rest are measured from the palette by luminance, contrast, and OKLab chroma, honoring the optional `meta.theme.mode` (`dark` by default, or `light`). It publishes the neutral `--video-*` custom properties plus `--onda-*` aliases for the vendored Onda family. `fonts.ts` registers the project's manifest font faces through `@remotion/fonts`. `motion.ts` carries optional fps-scaled rhythm defaults; Remotion keeps temporal freedom.

This is renderer-derived state: `meta.theme` is never rewritten, and all three modules live in the gitignored `remotion/generated/` directory that `video remotion prepare` and each renderer sync regenerate. They participate in `generatedHash`, so boundary evidence cannot silently go stale against a changed token layer.

### Storyboard Enhance authoring

Storyboard Enhance is an internal authoring behavior after destructive Remotion preparation. One author subagent understands the complete canonical video, selects and reads layout blueprints, writes the generated Remotion source directly, and self-reviews materialization. It is not a persisted pipeline phase, planning artifact, or second source of semantic truth; `video.json` remains the semantic authority.

Remotion Studio is the visual review checkpoint. If the user requests changes, the same Enhance authoring behavior revises the existing source without running `video remotion prepare` again; the parent validates and reopens Studio until the user approves. Final evidence, rendering, and finalization happen only after that approval.

## Why one skill package per profile

Creative reasoning and self-review must optimize the same success definition. Therefore each production profile is one package with:

1. Success Definition
2. Creative Guidance
3. Self-review Guidance
4. Development Guidance
5. Renderer Guidance

They are not independently selectable creative/review skill sets, and they do not imply persisted search artifacts.

## Profile selection

Profiles are discoverable through `.agents/skills/video-types/catalog.json`; the core does not encode a TypeScript enum or branch the pipeline by video type. If the user explicitly names the production intent, that selection uses `USER_EXPLICIT`. Otherwise the external agent infers a primary profile and optional supporting profiles. `neutral` is the fallback and cannot be mixed with supporting profiles.

## Backlot Dashboard (Host Observation Interface)

Backlot provides a local live observer dashboard (`npm run backlot`) for human operators to observe the authoring pipeline in real time.
- Architecture pattern: clean-room implementation inspired by the OpenMontage Backlot living storyboard concept.
- Non-blocking observer: reads project state (`.video/`, `video.json`, `assets/`, `output/`) via filesystem watcher and Server-Sent Events (SSE).
- Universal HITL gateway: acts as the human host surface for `INPUT_REQUIRED` (clarification submission) and `REVIEW_REQUIRED` (one-click approval for Video Brief, Script, and Storyboard).
- Living Storyboard and Screenplay: renders formatted scene cards, script typography, asset previews, boundary evidence, and HTML5 video playback for `output/final.mp4`.

