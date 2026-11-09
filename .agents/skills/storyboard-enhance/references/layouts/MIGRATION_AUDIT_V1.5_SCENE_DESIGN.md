# Migration audit v1.5 — restore scene-design semantics

## Problem

The earlier renderer-neutral port successfully removed HyperFrames-specific HTML/CSS/GSAP and reduced card/UI treatment bias, but it also over-generalized the blueprints toward layout/shot-shape selection. The package retained strong `Intent`, `Semantic requirements`, `Semantic shot shape`, layout, temporal, and materialization guidance, while losing much of the upstream role→blueprint and content-slot information useful **before** asset search.

## v1.5 change

Every blueprint now adds:

- `Narrative roles`: upstream HyperFrames role coverage when applicable plus generalized story roles;
- `Semantic content roles`: the evidence/content slots that must exist for the shape to tell the intended story;
- `Asset implications`: whether external media is none/conditional/required, what evidence is needed, useful source material, and anti-overfetch constraints.

`catalog.json` carries compact versions of the same fields so the agent can shortlist without loading all full blueprint bodies.

## Boundary

The restored slots are semantic roles, not React components and not mandatory external assets. A role can be represented with text, verified data, generated graphics, sourced media, or product captures. Asset search happens only after strategy selection.

The package still excludes HyperFrames HTML/DOM/CSS/GSAP/runtime recipes, exact geometry, and literal card/pill/browser/device styling.

## Architecture effect

One selected blueprint can now bridge:

`approved semantic scene → visual strategy → content roles → asset requirements → asset acquisition → layout/materialization → Remotion`.

No new semantic source of truth or mandatory planning artifact is introduced.

## Context guard

Use the compact index/catalog for retrieval. Read one selected full blueprint per scene, plus at most one alternate when asset feasibility forces reconsideration. Do not preload all 24 definitions.
