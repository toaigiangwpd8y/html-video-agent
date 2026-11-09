---
id: grid-card-assemble
name: Collection Assemble
family: collection
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Collection Assemble

## Intent
Empty/partial field → items arrive progressively → collection structure becomes clear → assembled set holds or reframes.

## Choose when
- many peers must accumulate into one collection.
- breadth/coverage is the point.
- the viewer benefits from seeing the set co-resident at the end.

## Avoid when
- only two items need comparison.
- items have a strict causal sequence.
- collection density would exceed readability.

## Semantic requirements
- 3+ peer items or repeated units.
- a meaningful collection structure.


## Narrative roles
- **Upstream HyperFrames role coverage:** `feature_showcase`, `benefit_highlight`, `social_proof`
- **Generalized story roles:** `collection`, `breadth`, `enumeration`, `portfolio`, `evidence-set`
- **Story job:** Reveal a peer collection whose breadth or accumulation is the evidence, without requiring literal cards.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`peer_items` — required.** Three or more items with the same semantic status.
- **`collection_dimension` — required.** The common property that makes them a meaningful set.
- **`item_evidence` — required.** For each item: label, media, datum, state, or proof needed for recognition.
- **`collection_payoff` — optional.** A summary, proof point, or interpretation reached after the set becomes legible.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `conditional`.
- **Required content/evidence:**
- A trustworthy peer set; each item must be supported by the approved story or source material.
- **Preferred source material when useful:**
- Logos/screens/photos/icons only where item identity matters.
- **Do not:**
- Turning every item into a UI card by default.
- Padding the collection with invented items for visual density.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`empty/partial field → items arrive progressively → collection structure becomes clear → assembled set holds or reframes`

## Layout guidance
Choose a structure that matches the collection: grid, list, wall, cluster, rows, columns, or another repeated field. Do NOT default to cards. Containers are optional and need a visual reason. Keep spacing and item hierarchy coherent.

## Temporal progression
1. Establish the collection context.
2. Add items in a cadence that allows the viewer to perceive accumulation.
3. Complete or intentionally partially complete the set.
4. Hold or reframe to communicate breadth.


## Implementation guidance
- Choose a repeated-field structure that expresses the collection’s real relationship: rows, wall, cluster, stack, grid, or another coherent field.
- Preserve consistent item grammar while allowing hierarchy where evidence supports it.
- Make accumulation visible over time so the viewer perceives breadth or coverage growing.
- Containers are optional; use them only when they clarify item boundaries or metadata.
- Resolve on an assembled field whose overall pattern is legible at a glance.

### Failure modes
- Defaults to rounded cards simply because there are multiple items.
- Items arrive with no accumulation logic or final collection pattern.
- Dense collection exceeds readable scale.
- Uniform styling falsely implies equal importance when hierarchy exists.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
One item may be promoted from the collection into the next scene.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
This is the strongest anti-card adaptation. Original explicitly centers cards/tiles/pills and grid variants; this version generalizes to any repeated peer collection.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
