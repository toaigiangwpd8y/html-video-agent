---
id: comparison-split
name: Balanced Comparison
family: comparison
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Balanced Comparison

## Intent
Comparison premise → paired subjects establish → differences/similarities become legible → balanced hold or decisive emphasis.

## Choose when
- exactly two concepts/assets/states have equal weight.
- the viewer must compare them at the same time.
- symmetry clarifies the claim.

## Avoid when
- more than two primary items.
- one side is clearly subordinate.
- the comparison is mainly temporal and should be shown sequentially.

## Semantic requirements
- two comparable subjects.
- a meaningful comparison dimension.


## Narrative roles
- **Upstream HyperFrames role coverage:** `feature_showcase`
- **Generalized story roles:** `comparison`, `before-after`, `paired-concepts`, `tradeoff`
- **Story job:** Put exactly two semantically comparable subjects into one common frame of reference so their difference or complementarity can be inspected.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`subject_a` — required.** First comparison peer.
- **`subject_b` — required.** Second comparison peer of equal semantic status.
- **`comparison_dimension` — required.** The shared dimension that makes the comparison valid.
- **`peer_evidence` — required.** Media/state/label/data needed for each side to be inspectable.
- **`conclusion` — optional.** A balanced or decisive interpretation supported by the comparison.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `conditional`.
- **Required content/evidence:**
- Two genuinely comparable subjects and enough evidence for the same comparison dimension on both.
- **Preferred source material when useful:**
- Matched media types or comparable views when using photos/screenshots/illustrations.
- **Do not:**
- Using unrelated images just because they fit two columns.
- Styling one side as “better” before evidence supports it.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`comparison premise → paired subjects establish → differences/similarities become legible → balanced hold or decisive emphasis`

## Layout guidance
Use two coordinated regions with comparable visual weight. They may be side-by-side, top/bottom, mirrored, overlapped, or share one axis. Equal cards are not required. Preserve a common scale or visual baseline when that helps comparison.

## Temporal progression
1. Introduce the comparison question or frame.
2. Reveal the two subjects in a coordinated way.
3. Expose the comparison dimension through state, annotation, or synchronized change.
4. Hold or resolve toward the intended conclusion without distorting evidence.


## Implementation guidance
- Establish one common comparison dimension before emphasizing differences.
- Keep both subjects visually commensurate through shared scale, baseline, framing logic, or synchronized state changes.
- Reveal the compared difference inside the common frame of reference instead of styling each subject independently.
- Simultaneous split is optional; sequential replacement, overlay, shared-axis transformation, or aligned rows are valid when comparison remains immediate.
- If one side becomes decisive, preserve enough of the counterpart to make the conclusion auditable.

### Failure modes
- Two subjects are merely placed in separate boxes without a shared comparison dimension.
- Styling differences create a conclusion not supported by content.
- One subject is visually privileged before the evidence justifies it.
- “Comparison” becomes a generic left/right layout even when temporal comparison would be clearer.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
If one subject wins focus, allow it to inherit the next scene’s dominant position.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Original blueprint is explicitly split-card and pill-badge oriented. Those are demoted to optional treatments; the reusable idea is balanced two-item comparison.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
