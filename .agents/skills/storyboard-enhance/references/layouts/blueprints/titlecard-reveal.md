---
id: titlecard-reveal
name: Quiet Landing / Title Reveal
family: quiet-landing
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Quiet Landing / Title Reveal

## Intent
Clean field establishes → one restrained reveal/change → still readable hold.

## Choose when
- the video needs a breather or landing beat.
- one short title/proof/identity statement deserves stillness.
- low motion is intentionally contrasted with busy neighbors.

## Avoid when
- multiple ideas must develop.
- a static card would hide a required visual progression.
- low motion is being used only because implementation is easier.

## Semantic requirements
- one concise dominant message or proof.


## Narrative roles
- **Upstream HyperFrames role coverage:** `product_intro`, `benefit_highlight`, `social_proof`, `cta`
- **Generalized story roles:** `breather`, `section-title`, `single-claim`, `proof-hold`, `closing`
- **Story job:** Give one short semantic message enough visual stillness to land between denser scenes.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`dominant_message` — required.** One concise title, proof, identity, or conclusion.
- **`supporting_line` — optional.** One subordinate line only if necessary for interpretation.
- **`proof_or_mark` — optional.** A real logo/stat/evidence mark when the claim needs it.
- **`hold_state` — required.** Readable final state with no competing primary content.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `none`.
- **Required content/evidence:**
- Approved concise copy.
- **Preferred source material when useful:**
- Real proof mark/logo only when semantically required.
- **Do not:**
- Fetching background imagery merely to avoid empty space.
- Turning a complex multi-step scene into a static title card for convenience.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`clean field establishes → one restrained reveal/change → still readable hold`

## Layout guidance
Use one dominant message or proof element with generous negative space. A literal card is not required. Prefer a clean field, photographic field, simple lockup, or restrained single-region composition appropriate to the content.

## Temporal progression
1. Enter with one restrained change or reveal.
2. Let any qualifier/supporting line appear only if necessary.
3. Hold still long enough for the message to land.


## Implementation guidance
- Use one dominant message, proof element, or resolved state with generous negative space.
- Remove nonessential decoration; the selected focal element should own the hierarchy.
- Enter with one restrained semantic reveal or change, then become substantially still.
- A literal card/container is optional and should exist only if the content itself has a bounded-object reason.
- If the scene closes a prior sequence, preserve a concrete proof/anchor from that sequence rather than replacing it with a generic title.
- When Storyboard continuity requires an existing evidence object to remain visible, preserve that actual object/state or visibly transform it into the landing. Keeping only the same message or meaning in a newly drawn substitute is not enough.

### Failure modes
- Defaults to a rounded title card with border, shadow, accent rule, and generic pulse.
- Adds CTA language or action treatment not present in the Storyboard.
- Repeats the same global title composition used in every other scene.
- Removes the concrete evidence that makes the landing meaningful.
- Replaces a required inherited evidence object with a fresh symbolic block/title that communicates the same idea but breaks object continuity.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
Useful between high-motion scenes or as a final held state. If the Storyboard requires an existing evidence object to carry into the landing, the quiet composition should hold, emphasize, crop, simplify, or visibly transform that same object rather than redraw a semantically equivalent replacement.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Original title explicitly says single-card and includes card chains. This adaptation generalizes to any quiet single-focus landing; card is optional.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
