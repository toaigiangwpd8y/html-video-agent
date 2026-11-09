---
id: dataviz-countup
name: Data Hero / Metric Journey
family: data-focus
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Data Hero / Metric Journey

## Intent
Data instrument establishes → values/trend develop → supporting metrics recede → hero metric lands.

## Choose when
- numbers/charts are the evidence.
- one metric or trend should dominate.
- the argument depends on quantitative change.

## Avoid when
- data is decorative or unsupported.
- multiple unrelated metrics compete.
- a narrative asset is more important than the numbers.

## Semantic requirements
- source-grounded quantitative evidence.
- a clear metric hierarchy.


## Narrative roles
- **Upstream HyperFrames role coverage:** `hook`, `pain_point`, `product_intro`, `feature_showcase`, `social_proof`
- **Generalized story roles:** `quantitative-evidence`, `trend`, `comparison`, `metric-proof`, `data-story`
- **Story job:** Let verified quantitative evidence carry the argument through one or more data states, then land on the metric or relationship that matters.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`data_source` — required.** Verified values/series/categories supporting the claim.
- **`visual_encoding` — required.** A chart/number/gauge/table relationship appropriate to those values.
- **`hero_metric_or_relation` — required.** The datum or pattern the viewer must understand.
- **`context_label` — required.** Units, time range, category, or comparison basis needed to interpret the data.
- **`supporting_marks` — optional.** Annotations/highlights that clarify rather than manufacture significance.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `conditional`.
- **Required content/evidence:**
- Verified numbers/data from approved source material.
- **Preferred source material when useful:**
- Source chart/table or citation when available; otherwise generate visualization from verified data.
- **Do not:**
- Inventing values for visual drama.
- Using chart-like decoration without a real quantitative claim.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`data instrument establishes → values/trend develop → supporting metrics recede → hero metric lands`

## Layout guidance
Treat the primary metric as a visual subject, not a dashboard widget by default. Supporting charts may share a field, sequence, or spatial path. Maintain scales/labels necessary for truthful reading.

## Temporal progression
1. Establish the measurement context.
2. Reveal change, count, or trend over time.
3. Guide attention through only the supporting evidence needed.
4. Land on one metric or conclusion with enough dwell to read.


## Implementation guidance
- Establish the measurement context, scale, unit, and baseline needed to interpret the data truthfully.
- Let one quantitative relationship drive hierarchy; supporting metrics should reinforce it rather than form a dashboard by default.
- Animate values or marks only in ways that preserve the data relationship and make change legible.
- Use a stable axis, shared baseline, or persistent metric anchor when comparison over time matters.
- Land on the quantitative conclusion with enough context still visible to verify it.

### Failure modes
- Numbers animate without scale, unit, source context, or comparison basis.
- Several metric cards compete with equal visual weight.
- Count-up animation implies growth/change that the data does not support.
- Decorative charts are added where the Storyboard contains no quantitative evidence.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
A hero metric can hand off into text, comparison, or evidence scenes.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Original includes tilted stat-card grids and camera push-through patterns. Card grids and camera moves are optional; data hierarchy and progression are retained.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
