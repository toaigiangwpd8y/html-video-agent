---
id: ticker-takeover
name: Cycle then Takeover
family: takeover
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Cycle then Takeover

## Intent
Context establishes → options cycle → hero enters with force → prior content yields/exits → hero holds.

## Choose when
- several possibilities should be rejected/replaced by one decisive hero.
- the final reveal should feel physically dominant.
- a collision/takeover communicates the rhetorical turn.

## Avoid when
- the transition should be calm.
- the alternatives are evidence that must remain visible.
- the hero does not semantically replace the earlier options.

## Semantic requirements
- a cycling set of options/labels.
- one decisive final hero.


## Narrative roles
- **Upstream HyperFrames role coverage:** `hook`, `branding`
- **Generalized story roles:** `option-rejection`, `reframing`, `decisive-reveal`, `identity-payoff`
- **Story job:** Cycle through plausible alternatives, then replace them with one semantically decisive hero that resolves the uncertainty.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`options` — required.** Two or more plausible alternatives/labels.
- **`shared_question` — required.** The semantic slot those alternatives are competing to fill.
- **`hero` — required.** The final answer/identity/object that legitimately supersedes the options.
- **`payoff_context` — optional.** Short evidence or lockup supporting why the hero wins.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `conditional`.
- **Required content/evidence:**
- Approved alternatives and one final hero.
- **Preferred source material when useful:**
- Real logo/product/object asset when the hero is a real entity.
- **Do not:**
- Inventing straw-man alternatives.
- Using a dramatic takeover when the final hero does not actually replace the earlier options.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`context establishes → options cycle → hero enters with force → prior content yields/exits → hero holds`

## Layout guidance
Reserve a clear lane or focal zone for the cycling context, then allow the hero to claim that space. The exact entry direction and collision treatment are Enhance decisions.

## Temporal progression
1. Establish the context phrase/state.
2. Cycle through only enough alternatives to create the premise.
3. Introduce the hero as a decisive replacement, not a crossfade.
4. Settle on the hero alone or clearly dominant.


## Implementation guidance
- Establish enough alternatives/context to make the replacement meaningful before the hero arrives.
- Keep the cycling context in one coherent lane or focal field so the hero can visibly claim or overwrite that semantic territory.
- Make the hero’s entrance a decisive state change, not just another item in the cycle.
- Reduce prior content as the hero gains dominance; do not leave a cluttered compromise state unless comparison is intended.
- Hold the final hero long enough for the takeover to register.

### Failure modes
- Cycles too many alternatives and becomes filler.
- Hero simply fades in beside prior content with no takeover relationship.
- Entry force is decorative and unrelated to the rhetorical shift.
- Prior items remain equally prominent after the supposed takeover.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
The final hero is a strong anchor into the next scene.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Removed specific typewriter, slot-machine, spring-roll and off-screen physics implementations. Preserve cycle → decisive takeover rhetoric.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
