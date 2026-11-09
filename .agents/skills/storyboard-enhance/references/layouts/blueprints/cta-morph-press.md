---
id: cta-morph-press
name: Identity to Action Morph
family: same-anchor-transform
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Identity to Action Morph

## Intent
Identity/focal object holds → transforms in place → action becomes clear → optional interaction confirms → hold.

## Choose when
- one identity/state should become one action at the same focal anchor.
- the scene needs a compact final action beat.
- a transformation is clearer than introducing a new layout.

## Avoid when
- multiple actions compete.
- the CTA requires a multi-step workflow.
- there is no meaningful shared identity between before and after.

## Semantic requirements
- one starting focal object.
- one final action/focal state.


## Narrative roles
- **Upstream HyperFrames role coverage:** `hook`, `cta`
- **Generalized story roles:** `action`, `single-widget-demo`, `focused-closing`, `micro-interaction`
- **Story job:** Concentrate attention on one identity/widget that changes into one actionable state and, when appropriate, receives a single confirming interaction.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`source_identity_or_widget` — required.** The starting mark/widget/state.
- **`target_action_state` — required.** The action/prompt/menu/CTA state it legitimately becomes.
- **`payload_or_action` — required.** The one semantic action performed.
- **`confirmation` — optional.** Feedback proving the action occurred.
- **`closing_message` — optional.** Short title/CTA after the action when approved.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `conditional`.
- **Required content/evidence:**
- Canonical mark/widget/product source when representing a real brand/product; otherwise approved text/state definitions.
- **Preferred source material when useful:**
- Real logo/UI asset if identity accuracy matters.
- **Do not:**
- Adding a fake click or CTA not present in the story.
- Using morph purely as decoration with no semantic state change.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`identity/focal object holds → transforms in place → action becomes clear → optional interaction confirms → hold`

## Layout guidance
Reserve one dominant anchor and keep the transformation localized around it. Do not introduce extra panels unless they are necessary to explain the action.

## Temporal progression
1. Establish the starting identity.
2. Transform or condense it into the action state without losing continuity.
3. Optionally show one confirming interaction or response.
4. Hold the final actionable state.


## Implementation guidance
- Use only when the final actionable state is semantically present in the Storyboard; do not invent a CTA.
- Keep the starting identity and final action state at one recognizable anchor so the transformation communicates continuity.
- Make the transformation explain why the object has become actionable, not just restyle it as a button/card.
- If interaction confirmation is shown, keep it brief and subordinate to the state change.
- Resolve on a stable action state without adding unrelated promotional chrome.

### Failure modes
- Used on a payoff scene that explicitly forbids or does not contain a CTA.
- A generic rounded button/card is introduced despite no semantic action transition.
- Starting object disappears and a new CTA appears elsewhere.
- Pulse/glow/press effects substitute for meaningful transformation.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
Strong for endings or hooks where the same focal anchor should persist across a seam.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Cursor, pill, click, and brand-mark specifics are optional. The transferable pattern is same-anchor identity-to-action transformation.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
