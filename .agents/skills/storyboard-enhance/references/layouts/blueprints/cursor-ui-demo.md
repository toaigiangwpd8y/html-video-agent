---
id: cursor-ui-demo
name: Interaction-Driven Surface Demo
family: interaction-demo
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Interaction-Driven Surface Demo

## Intent
Surface establish → interaction → state response → next interaction/state → payoff.

## Choose when
- a visible user interaction is the causal actor.
- a real interface/workflow is the evidence.
- 2–4 discrete interaction states tell the story.

## Avoid when
- the machine acts after one trigger without continued user input.
- the scene is only a static product showcase.
- the interface can be summarized more clearly without simulated interaction.

## Semantic requirements
- a surface with meaningful states.
- an interaction sequence with causal changes.


## Narrative roles
- **Upstream HyperFrames role coverage:** `hook`, `product_intro`, `feature_showcase`, `benefit_highlight`
- **Generalized story roles:** `workflow-demo`, `interaction`, `before-after-state`, `software-mechanism`
- **Story job:** Explain a real interactive workflow by making user actions visibly cause state changes on the same product surface.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`product_surface` — required.** The real or faithfully reconstructed interface where the action happens.
- **`interaction_targets` — required.** Controls/objects that the user actually acts on.
- **`state_sequence` — required.** Observable before/action/after states.
- **`result` — required.** The product state or outcome proving the workflow.
- **`cursor_or_actor` — conditional.** Interaction proxy only when needed to make causality legible.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `required`.
- **Required content/evidence:**
- Real screenshots, captured UI, product assets, or sufficient source material to faithfully reconstruct the relevant surface and states.
- **Preferred source material when useful:**
- Multiple truthful states from the same workflow rather than unrelated screenshots.
- **Do not:**
- Inventing product UI behavior.
- Using a generic cursor over a static screenshot with no real state mutation.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`surface establish → interaction → state response → next interaction/state → payoff`

## Layout guidance
Keep the active target and resulting state co-visible when possible. The pointer/caret is an actor, not decoration. Reconstruct only the UI necessary to prove the interaction.

## Temporal progression
1. Introduce the surface and first actionable target.
2. Perform one interaction and show the immediate result.
3. Continue only with steps necessary to make the workflow legible.
4. Land on the result or primary action.


## Implementation guidance
- Keep the surface state and the active interaction target readable in the same causal beat.
- Move the pointer/caret only to targets that produce story-relevant state changes.
- Show the immediate consequence of each interaction before proceeding.
- Reuse the same surface geometry across steps so the viewer tracks workflow state rather than re-parsing the interface.
- Stop after the minimum interactions needed to prove the workflow.

### Failure modes
- Cursor wanders or clicks decorative controls.
- Every interaction is accompanied by a new detached callout/card.
- Surface is redrawn or repositioned between steps so causality becomes hard to follow.
- The pointer becomes the visual hero instead of the resulting state.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
The final UI/result state may persist into a product-proof scene.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Removed renderer-specific state, cursor, and camera-chase implementation requirements. Keep only causal interaction grammar.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
