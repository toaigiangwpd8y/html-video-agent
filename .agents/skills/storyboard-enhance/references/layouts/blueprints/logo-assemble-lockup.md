---
id: logo-assemble-lockup
name: Identity Assemble to Lockup
family: identity-assembly
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Identity Assemble to Lockup

## Intent
Prepare/clear → parts or prior material transform toward identity → lockup completes → hold or extend to cta.

## Choose when
- a mark/identity must come into existence or resolve from prior material.
- brand/product identity is the semantic payoff.
- parts-to-whole transformation is meaningful.

## Avoid when
- there is no meaningful identity object.
- the scene needs factual evidence more than branding.
- assembly would be decorative filler.

## Semantic requirements
- a target identity/lockup.
- a justified source state: parts, prior phrase, marks, or cleared field.


## Narrative roles
- **Upstream HyperFrames role coverage:** `product_intro`, `cta`, `branding`
- **Generalized story roles:** `identity-reveal`, `brand-lockup`, `closing`
- **Story job:** Make one identity/mark come into existence or resolve from prior material, then hold it as the semantic conclusion.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`identity_mark` — required.** The real logo, wordmark, title, or identity that must resolve.
- **`source_material` — conditional.** Parts, letters, previous phrase, or semantic material that can legitimately become the identity.
- **`lockup_support` — optional.** URL, CTA, tagline, or proof line only when approved.
- **`hold_state` — required.** A clean final identity state suitable for recognition.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `conditional`.
- **Required content/evidence:**
- A canonical logo/wordmark/identity source when the scene represents a real brand.
- **Preferred source material when useful:**
- Vector or transparent source asset when available.
- **Do not:**
- Recreating a real logo inaccurately when an official source exists.
- Using brand assembly for a scene with no identity payoff.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`prepare/clear → parts or prior material transform toward identity → lockup completes → hold or extend to CTA`

## Layout guidance
Use a strong focal anchor for the forming identity. Parts may orbit, converge, draw, morph, or arrive, but final lockup should be spatially stable and readable.

## Temporal progression
1. Prepare the stage or establish raw material.
2. Build or transform toward the identity in visible stages.
3. Complete the identity/lockup.
4. Hold long enough to register, optionally extending to one CTA or proof element.


## Implementation guidance
- Identify the semantic source material that legitimately forms or resolves into the identity.
- Keep part-to-whole correspondence traceable during assembly; pieces should not teleport arbitrarily into a mark.
- Make the final lockup spatially calmer and more stable than the assembly phase.
- Use only as much supporting copy as needed to explain the identity payoff.
- Preserve the completed identity if it anchors the following scene.

### Failure modes
- Decorative particles assemble into a logo with no relation to prior content.
- Final identity is introduced as a separate image after an unrelated animation.
- Assembly remains busy during the hold, reducing legibility.
- Branding treatment overwhelms factual/story evidence.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
Excellent for morphing from a prior glyph/phrase or handing a finished identity into a CTA.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Removed renderer-specific 3D, stroke, camera, blur, motion-rule mappings, and exact brand-animation recipes. Kept parts-to-whole identity grammar.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
