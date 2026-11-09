---
id: zoom-out-workspace-reveal
name: Nested Zoom-Out Reveal
family: nested-reveal
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Nested Zoom-Out Reveal

## Intent
Tight detail → local action → continuous outward reveal through context layers → wide containing whole → wide-frame payoff.

## Choose when
- a close-up detail gains new meaning when revealed inside a larger whole.
- scale/context reversal is the payoff.
- one continuous outward reveal is stronger than cuts.

## Avoid when
- there is no genuine containing whole.
- the scene needs several unrelated camera legs.
- zoom-out is being used only for spectacle.

## Semantic requirements
- a meaningful nested detail.
- a credible containing context/world.


## Narrative roles
- **Upstream HyperFrames role coverage:** `hook`, `benefit_highlight`
- **Generalized story roles:** `recontextualization`, `scale-reveal`, `detail-to-system`, `mystery-to-context`
- **Story job:** Start from one meaningful detail and reveal that it belongs to a larger containing system without breaking identity.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`nested_detail` — required.** A close detail whose identity must survive the reveal.
- **`containing_context` — required.** The larger whole that changes how the detail is understood.
- **`identity_bridge` — required.** Landmarks or structure proving the detail belongs to the revealed whole.
- **`wide_payoff` — required.** The larger-system insight delivered after context expands.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `conditional`.
- **Required content/evidence:**
- Nested detail and containing context that are genuinely the same semantic object/world.
- **Preferred source material when useful:**
- A single high-resolution source, coherent illustration, UI surface, map, or document that supports both detail and whole.
- **Do not:**
- Using two unrelated images as fake zoom states.
- Searching for a “wide” asset that cannot inherit the detail identity.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`tight detail → local action → continuous outward reveal through context layers → wide containing whole → wide-frame payoff`

## Layout guidance
Author the close-up and wide state as parts of one nested spatial hierarchy. Important elements must survive scale changes without losing identity. Do not fake nesting with unrelated replacements.

## Temporal progression
1. Open on the detail with enough information to create curiosity.
2. Allow a small local action or state change.
3. Execute one continuous outward reveal through meaningful context layers.
4. Lock on the wide whole and let a final element-level payoff occur.


## Implementation guidance
- Construct detail and containing whole as one nested hierarchy so shared elements remain identifiable through the reveal.
- Preserve scale relationships and focal landmarks that prove the detail belongs inside the larger context.
- Use the outward reveal to change meaning or scope; each newly revealed layer should add relevant context.
- Avoid replacing the detail with a precomposed wide view that merely resembles it.
- Resolve on the containing whole with the original detail still locatable.

### Failure modes
- Close-up and wide state are unrelated compositions joined by a zoom effect.
- Added context layers are decorative and do not change understanding.
- Scale change is so fast that identity is lost.
- Reveal is used merely for spectacle when a cut would communicate more clearly.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
The wide containing world is a natural starting context for the next scene.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Removed zoom-curve equations, design-tool implementation assumptions, and camera runtime specifics. Preserve true nested detail → whole reveal.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
