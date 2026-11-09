---
id: fixed-anchor-cycle
name: Fixed Anchor, Cycling World
family: fixed-anchor
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Fixed Anchor, Cycling World

## Intent
Anchor establishes → surrounding states cycle → cadence may change → final state joins/resolves with anchor.

## Choose when
- one identity/statement must stay constant while surrounding examples vary.
- breadth is the claim.
- repetition around a stable anchor communicates consistency.

## Avoid when
- the anchor itself must transform.
- items need simultaneous comparison.
- the cycle would become filler rather than evidence.

## Semantic requirements
- one persistent anchor.
- multiple meaningful surrounding states/examples.


## Narrative roles
- **Upstream HyperFrames role coverage:** `hook`, `benefit_highlight`, `branding`
- **Generalized story roles:** `breadth`, `variation-around-constant`, `compatibility`, `roll-call`, `theme-cycle`
- **Story job:** Keep one semantic anchor constant while a peer slot or surrounding state cycles, proving breadth or variation without losing identity.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`fixed_anchor` — required.** The wordmark, subject, surface, line, or object that must not change identity.
- **`cycle_items` — required.** Two or more peer labels/states/themes that vary around the anchor.
- **`shared_relation` — required.** Why every cycle item belongs to the same slot.
- **`resolution` — required.** The final state/statement that interprets the breadth.
- **`supporting_evidence` — optional.** Icons/logos/media for cycle items when exact identity matters.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `conditional`.
- **Required content/evidence:**
- A legitimate fixed identity and a truthful peer set of variants.
- **Preferred source material when useful:**
- Real logos/icons/screens where the variants are named products/integrations/themes.
- **Do not:**
- Moving/replacing the anchor.
- Cycling arbitrary items that do not share the same semantic role.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`anchor establishes → surrounding states cycle → cadence may change → final state joins/resolves with anchor`

## Layout guidance
Pin one dominant anchor. Let one adjacent region, background theme, label rail, or surrounding field change while the anchor remains stable. Avoid moving the anchor merely to add motion.

## Temporal progression
1. Establish the invariant anchor.
2. Cycle through distinct examples with readable cadence.
3. Optionally accelerate or compress only when semantic breadth is already clear.
4. Resolve by adding or emphasizing one final element while keeping the anchor.


## Implementation guidance
- Establish one anchor with unmistakable identity and keep its core geometry or focal role stable throughout the cycle.
- Change one surrounding dimension at a time so the viewer understands what varies and what stays invariant.
- Give each surrounding state enough dwell to register before advancing.
- Use cadence changes only after the pattern is understood; acceleration should summarize, not hide content.
- Resolve by integrating the final state with the anchor or by making the invariant claim explicit.

### Failure modes
- Anchor itself drifts, resizes, or restyles so much that invariance is lost.
- Surrounding states become unrelated examples with no shared dimension.
- Cycling is too fast to read or becomes decorative repetition.
- Each state is boxed independently, weakening the sense of one stable anchor.

### Materialization clarification — what “fixed” means
- “Fixed anchor” means semantic and visual identity remains stable during the main cycle; it does not require zero motion forever.
- The anchor may move, shrink, expand, or reposition for a handoff only after the cycle has been clearly established, when the transformation serves continuity into the next scene, and when the viewer can still recognize the same anchor.
- Do not continually change anchor geometry while surrounding states cycle; that weakens its role as the stable reference.
- Valid pattern: `stable anchor during cycle → deliberate end-of-scene handoff transform → same anchor continues`.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
The fixed anchor is ideal for continuity across several related scenes.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Removed specific wordmark/composer/theme implementations. The invariant-vs-changing-world relation is preserved.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
