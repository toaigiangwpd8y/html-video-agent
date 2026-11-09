# Validation report v1.5 — Scene Design + Asset Planning prototype

## Structural checks

- Blueprint files: **24**.
- Upstream HyperFrames adaptations: **22**.
- Local composed gap-fill blueprints: **2**.
- `catalog.json` version: **1.5.0**.
- 24/24 blueprint files contain: `Narrative roles`, `Semantic content roles`, `Asset implications`, `Semantic shot shape`, `Layout guidance`, `Temporal progression`, `Implementation guidance`, and `Continuity`.
- `SKILL.md` supports both `Scene-design / asset probe` and `Full Enhance`.
- Semantic-only `video.json` contains no production asset paths or playable voice-over paths; those are materialized after approval through `assets/manifest.json`.

## Context guard

Approximate mandatory reference words before the selected blueprint/video itself:

- Probe mode (`SKILL.md` + README + compact catalog): **5224 words**.
- Full production adds global blueprint index/materialization rules: **+1638 words**.

The skill explicitly forbids preloading all 24 full blueprint bodies. Normal routing is compact catalog → one selected full blueprint; one alternate is allowed only when real asset feasibility invalidates the first choice.

## Intended probe flow

```text
approved semantic video.json
  → scene signature
  → 3 materially different candidate families
  → selected visual-story blueprint
  → semantic content roles
  → required/preferred asset needs
  → optional asset acquisition + provenance
  → STOP (probe mode)
```

No Remotion guidance or rendering is required for the isolated probe.

## Intended integrated flow later

```text
approved semantic video.json
  → Scene Design
  → asset reasoning/acquisition
  → confirm same blueprint
  → layout/materialization
  → Remotion
```

## Migration boundary

The repository now integrates this tested Scene Design/Asset Planning logic after semantic Storyboard approval. No asset-approval or Scene Design approval checkpoint is inserted; Enhance owns production acquisition, validation, derivative creation, strategy re-check, layout, and Remotion implementation.

## Provenance

The 22 upstream blueprints are renderer-neutral adaptations of public HyperFrames blueprint/story-role guidance. Asset implications are conservative local derivations from semantic slots and role guidance, not a verbatim HyperFrames asset schema. HyperFrames-specific HTML/CSS/GSAP/runtime contracts remain excluded.
