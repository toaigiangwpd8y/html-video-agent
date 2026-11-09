---
id: device-surface-showcase
name: Surface Hero Showcase
family: surface-hero
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Surface Hero Showcase

## Intent
Surface establishes as hero → internal state/flow advances → focal feature is emphasized → surface settles.

## Choose when
- a product/page/device surface itself is the evidence.
- the viewer should experience a feature within one persistent surface.
- screen state changes are more important than pointer choreography.

## Avoid when
- the camera must traverse many unrelated regions.
- a cursor-driven workflow is the primary story.
- the scene has no real surface to showcase.

## Semantic requirements
- one dominant surface.
- at least one meaningful state change or internal flow.


## Narrative roles
- **Upstream HyperFrames role coverage:** `product_intro`, `feature_showcase`
- **Generalized story roles:** `product-tour`, `surface-showcase`, `workflow-overview`, `artifact-tour`
- **Story job:** Hold one product/device/surface as the hero while its real states or views demonstrate the core experience.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`hero_surface` — required.** The main device/window/artifact that stays identifiable.
- **`screen_states` — required.** Two or more meaningful states/views belonging to the same experience.
- **`flow_order` — required.** The semantic order in which those states should be understood.
- **`success_or_payoff` — optional.** A completion/result state proving the loop.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `required`.
- **Required content/evidence:**
- Credible visual source for the hero surface and its relevant states.
- **Preferred source material when useful:**
- Consistent screenshots/captures from the same product/session/aspect.
- **Do not:**
- Mixing unrelated UI screenshots into one fake product flow.
- Using device chrome as decoration when the interface itself is not evidence.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`surface establishes as hero → internal state/flow advances → focal feature is emphasized → surface settles`

## Layout guidance
Keep one device/window/page as the dominant visual anchor. Preserve enough surrounding context to understand where the state change occurs. Full-bleed, floating, tilted, or framed treatments are optional.

## Temporal progression
1. Introduce the surface with clear hierarchy.
2. Advance through the minimum number of states needed to demonstrate the feature.
3. Emphasize the key result or control.
4. Settle on a readable final surface state.


## Implementation guidance
- Treat the surface itself as the persistent evidence field; preserve enough surrounding context to orient the viewer.
- Prioritize one internal state change or feature at a time while keeping the surface identity stable.
- Use framing, crop, scale, or focus changes to guide attention without fragmenting the surface into unrelated panels.
- Let the final surface state carry the proof; labels and callouts should be secondary.
- Preserve the same surface into adjacent scenes when the workflow continues.

### Failure modes
- Surface is reduced to a decorative mockup while generic cards carry the real information.
- Excessive chrome/frame treatment competes with the feature being demonstrated.
- Every state is shown as a separate screenshot with no continuity.
- Callouts obscure or replace the actual evidence.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
The surface can persist across scenes if the next beat is another feature or result on the same product.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Removed renderer-specific scrolling, 3D, camera, and runtime mechanics; one-surface hero semantics remain.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
