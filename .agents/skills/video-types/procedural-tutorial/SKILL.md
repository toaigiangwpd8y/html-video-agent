---
name: procedural-tutorial
description: Defines success and creative/self-review guidance for followable tutorials. Use when a target viewer must complete a task correctly, recognize successful state changes, and handle relevant prerequisites or branches.
---

# Procedural Tutorial

## Success Definition

A reasonable target viewer should be able to perform the task, recognize whether each important step worked, and follow necessary branches or recovery. When goals conflict, protect executability, state continuity, and risk clarity before narrative pace or brevity. A polished tutorial fails at the first hidden prerequisite, ambiguous action, or unobservable state jump that prevents continuation.

### Use when

The viewer's ability to complete a task is the primary outcome.

### Do not use as primary when

The viewer mainly needs product value proof, system understanding, or campaign persuasion rather than reproduction.

### Boundary with adjacent profiles

- `product-demo` may compress steps because observable value is primary; this profile must preserve task executability.
- `technical-explainer` explains how/why a mechanism works; this profile explains what to do and how to verify state.
- Supporting guidance cannot hide required steps for a cleaner story.

## Creative Guidance

Define the task's success state, target viewer, prerequisites, permissions, tools, inputs, and starting state. Determine dependency order before scripting.

Model each important step as:

```text
required state -> user action -> observable result / next state
```

Include real decision points and failure/recovery only when they materially affect completion. Clearly separate required steps, optional branches, and optimizations. Use exact action language and stable names for UI targets or physical objects. Avoid metaphor when precision is needed.

Pace for execution, not passive comprehension. Candidate mechanisms may differ through fastest-path walkthrough, goal-first branching, mistake-prevention-first guidance, or a task scenario that teaches operations in context. Different presenter tones are not distinct mechanisms.

For destructive, irreversible, permission-changing, or costly actions, make the action and expected consequence unambiguous rather than smoothing it over for pacing.

## Self-review Guidance

Simulate the target novice and ask:

- What does the viewer have before step one?
- At which first point could they not continue?
- Is every target visible or uniquely identifiable?
- Does each action produce a stated or visible result?
- Are prerequisites, permissions, branches, or platform differences hidden?
- Are required and optional actions clearly separated?
- Are high-risk actions and their consequences appropriately explicit?
- Is there enough semantic time for the action complexity?

Disqualify missing prerequisites, impossible state transitions, ambiguous high-risk actions, or steps that cannot produce the claimed result. Accept a conventional linear sequence when it is the clearest executable path. Do not demand an ad hook, product-value pitch, or internal mechanism explanation unless the request needs it.

## Development Guidance

Preserve the winning instructional mechanism. Write the complete action script with prerequisites, exact targets, observable checkpoints, and relevant branches. Resolve the first execution failure identified by self-review; do not introduce unverified shortcuts during compression.

Serialize each meaningful state/action/checkpoint as a canonical scene. Put viewer instructions in `screenText`, optional spoken instruction text in `audio.voiceoverText`, visible target/action/result in `visualConcept`, and resolve truthful UI/media after approval through `assets/manifest.json`. Keep branch logic in the approved semantic sequence rather than inventing a tutorial-specific top-level schema.

## Renderer Guidance

Keep action targets and resulting states readable; preserve before/after spatial continuity. Visual emphasis should disambiguate the action, not decorate it, and semantic dwell should allow the target viewer to locate and understand the change. Never fabricate states absent from canonical content or assets. The selected renderer owns exact zoom, cursor, timing, and layout implementation.
