# Implementation Guidance Addendum

Version 1.2 adds renderer-neutral `Implementation guidance` and blueprint-specific `Failure modes` to all 24 blueprint files.

## Why

The prior package described when to choose a blueprint and its semantic shot shape, but an agent could still record the selected blueprint id and then implement every scene through the same generic visual shell. The new sections close that gap without turning blueprints into fixed templates.

## What was added

- Per-blueprint materialization invariants.
- Per-blueprint failure modes.
- A common materialization test: the blueprint should remain recognizable if its source annotation is removed.
- Package-level guidance that shared theme primitives must not flatten all scenes into one composition.

## What was intentionally not added

- Exact x/y coordinates.
- Mandatory component trees.
- CSS or DOM recipes.
- GSAP or HyperFrames runtime contracts.
- Remotion API prescriptions.
- Motion/transition registries.

The selected blueprint still guides layout/shot shape; Enhance remains authoritative for exact Remotion realization.
