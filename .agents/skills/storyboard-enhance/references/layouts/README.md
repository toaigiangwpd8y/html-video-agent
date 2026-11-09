# HyperFrames Blueprints — Renderer-neutral scene-design adaptation

Purpose: a compact reference layer for Storyboard Enhance that bridges an approved semantic scene to **asset requirements → visual strategy → layout/shot shape**. The selected renderer implements the approved visual strategy after asset validation.

## What is included

- 22 upstream HyperFrames blueprints, adapted renderer-neutral.
- 2 local composed gap-fill blueprints: `interruption-reentry` and `abstract-to-concrete-timeline`.
- Per-blueprint narrative roles, semantic content roles, asset implications, shot shape, layout guidance, temporal progression, implementation guidance, continuity, and failure modes.
- `blueprints-index.md` as the compact routing layer.
- `catalog.json` for low-context retrieval.

## Full Enhance use

Full Enhance reasoning order: scene design → asset resolution → candidate layout/blueprint → motion reasoning → bounded `KEEP`/`ADAPT`/`SWITCH` → final layout confirmation → runtime choice → implementation.

1. Read the approved semantic scene and derive its story job, evidence, relationships, temporal shape, and continuity. Do not select a final blueprint yet.
2. Derive asset requirements from semantic roles. Search, reuse, or generate only what those roles actually need. Register only materialized, approved files in `assets/manifest.json` with source/provenance and scene binding.
3. After inspecting actual assets, use `catalog.json` / `blueprints-index.md` to shortlist materially different candidates, select by semantic fit, and read the selected blueprint's full file and failure modes.
4. Use the selected blueprint to guide layout, temporal materialization, continuity, and implementation. Re-check against actual files as `KEEP`, `ADAPT`, or `SWITCH`; only `SWITCH` may load one alternate blueprint, and asset inconvenience never changes the approved story.

An optional Scene-design / asset probe is a separate bounded mode. This is a bounded strategy-and-asset probe, separate from Full Enhance. It may derive semantic roles and provisional visual or asset options, but it does not run Full Enhance, load motion implementation guidance, acquire production assets, or select a final renderer implementation. Its provisional layout ideas do not bind later Full Enhance.

## Asset principle

A semantic content role is not automatically an external asset slot. It may be satisfied by:

- approved text;
- verified data;
- generated diagram/shape/typography;
- sourced photo/video/document;
- existing product capture; or
- another truthful representation.

Do not search for media just to fill space. Do not create a separate `asset-plan.json`. If acquisition is performed, register only materialized files in `assets/manifest.json` with a compact role, source/provenance, and scene binding. HTML, PDF, and long-document evidence must receive a truthful renderable derivative before layout, with provenance retained.

## What remains intentionally removed

No blueprint in this package requires HyperFrames HTML/DOM, CSS recipes, `data-*` timing, GSAP/runtime adapters, CLI commands, exact coordinates, literal card/pill treatment, or HyperFrames renderer contracts.

## Storyboard boundary

Canonical Storyboard/video JSON owns semantic WHAT: meaning, narration text, approved visible text, evidence, constraints, and semantic continuity. It contains no production asset paths or playable voice-over paths.

Storyboard Enhance owns production HOW after approval: visual strategy instantiation, asset requirements/acquisition, final blueprint confirmation, layout, motion technique, and implementation through the selected renderer. Remotion uses its official runtime guidance; HyperFrames uses the repository-owned HTML/CSS kit.

For Remotion Full Enhance, resolve assets before selecting the candidate blueprint, then use the renderer-neutral motion router under `../motion/`. Read its index and only matched pattern guides. Choose patterns for their communicative purpose; do not reduce motion richness to minimize pattern count. Make one bounded `KEEP`, `ADAPT`, or `SWITCH` decision if choreography requires it; inspect at most one alternate on `SWITCH`. GSAP is optional and never the default. Official Remotion documentation owns implementation technique.

## Context discipline

Do **not** read all 24 full blueprint files. During Full Enhance, use the compact `catalog.json` after asset reasoning, then read only the selected blueprint. Defer `blueprints-index.md` until full production/materialization, where its global continuity rules are needed. Read one alternate blueprint only if the selected shape becomes infeasible after asset inspection.

## Source

Adapted from the public HyperFrames project (`heygen-com/hyperframes`), especially `skills/hyperframes-animation/blueprints-index.md` and the blueprint corpus. The upstream repository is Apache-2.0 licensed. The 2 gap-fill blueprints are local renderer-neutral compositions documented in `MIGRATION_AUDIT_ADDENDUM.md`.
