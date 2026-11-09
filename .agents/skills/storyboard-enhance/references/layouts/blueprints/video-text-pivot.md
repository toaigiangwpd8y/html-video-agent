---
id: video-text-pivot
name: Media to Text Handoff
family: media-handoff
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Media to Text Handoff

## Intent
Media establishes → media yields space while staying present → metric/result inherits weight → media clears → text/statement takes center → final stamp.

## Choose when
- a video/image/demo should yield to a metric or statement without disappearing immediately.
- show → impact → interpretation is the rhetorical arc.
- the same visual weight should transfer across media types.

## Avoid when
- the media and text have no causal relation.
- a clean cut is semantically stronger.
- screen space cannot support a readable overlap/handoff.

## Semantic requirements
- one primary media subject.
- one metric/text payoff related to that media.


## Narrative roles
- **Upstream HyperFrames role coverage:** `product_intro`, `feature_showcase`
- **Generalized story roles:** `evidence-to-interpretation`, `media-to-claim`, `demo-to-impact`
- **Story job:** Let primary media establish evidence, then transfer visual importance to the metric or statement that interprets that evidence.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`primary_media` — required.** Video/image/demo/artifact that is the initial evidence.
- **`interpretive_payoff` — required.** Metric, statement, or conclusion directly supported by the media.
- **`causal_bridge` — required.** The semantic reason the payoff follows from the media.
- **`final_statement` — optional.** A concise interpretation or stamp after media yields.
- **`source_context` — optional.** Caption/source label when evidence requires provenance.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `required`.
- **Required content/evidence:**
- A real primary media asset and an approved payoff that is actually supported by it.
- **Preferred source material when useful:**
- Media with enough duration/resolution to remain identifiable during the handoff.
- **Do not:**
- Pairing attractive media with an unrelated claim.
- Using a metric not supported by the source.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`media establishes → media yields space while staying present → metric/result inherits weight → media clears → text/statement takes center → final stamp`

## Layout guidance
Design a shared anchor or weight-transfer path so each new subject occupies space vacated by the previous one. Avoid treating media and text as independent panels.

## Temporal progression
1. Let the media demonstrate the feature/evidence.
2. Shift its weight to create space for the impact metric/result.
3. Clear or de-emphasize both into the interpretive statement.
4. Seal with one concise final emphasis.


## Implementation guidance
- Start with media as genuine evidence and let it occupy enough visual weight to establish what happened.
- Create a shared anchor, alignment, or weight-transfer path so the metric/text payoff inherits attention from the media.
- Keep both subjects briefly co-present during the handoff when that makes causality clearer.
- Let interpretation take over only after the media has delivered its proof.
- Resolve on the text/metric state with media reduced or cleared according to semantic need.

### Failure modes
- Media and text are presented as unrelated side-by-side panels.
- Text appears before the media evidence is understandable.
- Handoff is just a crossfade with no preserved visual relation.
- Decorative metric/statement is added without support from the media.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
Works well when the final text or metric should lead into the next explanatory scene.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Removed exact slide directions, gradient pill, type effects, and media-runtime details. Keep weight transfer across media → metric → text.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
