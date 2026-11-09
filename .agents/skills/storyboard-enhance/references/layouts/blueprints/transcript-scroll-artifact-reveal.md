---
id: transcript-scroll-artifact-reveal
name: Long Surface to Artifact Reveal
family: long-surface
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Long Surface to Artifact Reveal

## Intent
Long surface establishes → traverse meaningful excerpts → focal item selected/highlighted → artifact/detail expands or replaces field → payoff hold.

## Choose when
- a long transcript/feed/document is evidence of work.
- traversal demonstrates quantity or process.
- one artifact/detail should emerge as payoff.

## Avoid when
- there is no meaningful long surface.
- scrolling would be unreadable filler.
- the artifact can be shown directly without losing the proof.

## Semantic requirements
- one coherent long content surface.
- one focal pivot into an artifact/detail.


## Narrative roles
- **Upstream HyperFrames role coverage:** `feature_showcase`
- **Generalized story roles:** `evidence-to-artifact`, `document-traversal`, `process-proof`, `research-result`
- **Story job:** Use a long evidence surface to prove work/quantity/process, then pivot from one selected part into the concrete artifact or detail it produced.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`long_surface` — required.** Transcript, feed, document, log, analysis, or other coherent long-form evidence.
- **`meaningful_excerpts` — required.** Readable portions worth traversing; not filler.
- **`pivot_item` — required.** One item/row/quote/file/detail chosen from the long surface.
- **`artifact` — required.** The deliverable/detail revealed from the selected evidence.
- **`artifact_focus` — optional.** Specific region proving why the artifact matters.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `conditional`.
- **Required content/evidence:**
- A real or approved long-form content source and a semantically linked artifact/detail.
- **Preferred source material when useful:**
- Actual transcript/document/log and the actual output artifact when available.
- **Do not:**
- Generating filler text just to create scroll length.
- Revealing an artifact unrelated to the selected evidence.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`long surface establishes → traverse meaningful excerpts → focal item selected/highlighted → artifact/detail expands or replaces field → payoff hold`

## Layout guidance
Treat the long surface as one continuous canvas, not many detached cards. Keep one reading column/track dominant during traversal. The artifact reveal may expand from a selected region or replace the field.

## Temporal progression
1. Establish the document/feed identity.
2. Traverse enough representative content to prove the work.
3. Pause or emphasize one meaningful focal item.
4. Pivot from that item into the resulting artifact/detail.
5. Hold on the deliverable.


## Implementation guidance
- Treat the source transcript/feed/document as one continuous evidence surface with stable reading orientation.
- Traverse only representative excerpts that prove the process or quantity; skip filler.
- Make the selected focal item visibly originate from the long surface before it becomes the artifact/detail.
- Transfer hierarchy from source surface to artifact rather than cutting to an unrelated finished object.
- Resolve with the artifact readable and source context reduced but still traceable when useful.

### Failure modes
- Long surface is broken into detached cards/chips.
- Scrolling is used as filler without meaningful excerpts.
- Artifact appears from nowhere instead of from a selected source region.
- Traversal speed prevents reading or recognizing evidence.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
The revealed artifact can persist as the next scene’s primary evidence.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Removed renderer-specific scrolling, file-chip mechanics, workspace APIs, and camera/element distinction rules. Retained evidence traversal → artifact payoff.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
