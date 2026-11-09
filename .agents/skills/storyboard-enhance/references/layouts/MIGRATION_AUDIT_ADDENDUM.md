# Migration audit addendum — 2 composed gap-fill blueprints

## Why these two exist

A dry-run on the current 8-scene Storyboard exposed two semantic gaps in the 22 upstream HyperFrames blueprint families: interruption/re-entry and abstract-time-to-concrete-schedule handoff. HyperFrames has useful source grammars for both gaps, but no one upstream blueprint exactly matches either need.

## `interruption-reentry`

**HyperFrames sources used:**
- `agent-progress-theater`: retained the renderer-neutral idea that visible state mutation over time is itself the evidence.
- `fixed-anchor-cycle`: retained the renderer-neutral idea that one semantic anchor can persist while surrounding states change.

**Removed:** product-agent framing, checklist/chat/status-card assumptions, cursor-trigger details, camera prescriptions, named runtime/motion-rule mappings, card/pill/container defaults.

**Adapted result:** one interrupted process remains identifiable across interruption, incomplete return, context reconstruction, and resumption.

## `abstract-to-concrete-timeline`

**HyperFrames sources used:**
- `spatial-pan-stations`: retained ordered landmarks/stations that belong to one coherent world.
- `zoom-out-workspace-reveal`: retained semantic re-contextualization — an existing detail is not replaced; it gains meaning inside a containing whole.

**Removed:** mandatory camera pan/zoom, one-world wrapper assumptions, workspace/product UI framing, callout-box/card variants, device chrome, named runtime/motion-rule mappings.

**Adapted result:** an abstract temporal model becomes a concrete schedule/calendar while preserving shared duration, order, landmarks, or state identity.

## Compatibility rule

Both files are renderer-neutral layout/shot-shape references. They do not prescribe a renderer, component, camera API, animation API, or intermediate planning artifact. Storyboard semantic truth remains binding; Enhance owns final HOW.
