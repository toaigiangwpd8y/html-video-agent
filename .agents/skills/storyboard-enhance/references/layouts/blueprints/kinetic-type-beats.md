---
id: kinetic-type-beats
name: Kinetic Type Beats
family: typography
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Kinetic Type Beats

## Intent
Text premise → token/phrase change or escalating beats → emphasis/payoff → hold or handoff.

## Choose when
- words/phrases themselves carry the argument.
- a hook or payoff can be expressed through changing language.
- minimal imagery is intentional.

## Avoid when
- visual evidence is required.
- the scene would become a generic text slideshow.
- too much copy must be read at once.

## Semantic requirements
- short high-value text beats.
- clear phrase hierarchy.


## Narrative roles
- **Upstream HyperFrames role coverage:** `hook`, `pain_point`, `product_intro`, `benefit_highlight`, `cta`, `branding`
- **Generalized story roles:** `hook`, `problem`, `claim`, `explanation`, `benefit`, `payoff`, `closing`
- **Story job:** Let wording itself carry the scene through successive statement states; use when the semantic evidence is primarily language rather than external media.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`message_beats` — required.** 2+ short semantic phrases or one phrase with meaningful token/state changes.
- **`anchor_phrase` — conditional.** A persistent phrase, subject, or statement that gives changing words a stable reference.
- **`payoff` — required.** The final claim, answer, identity, or conclusion the preceding word changes resolve toward.
- **`supporting_mark` — optional.** A logo, icon, or non-text evidence object only when it materially strengthens the semantic payoff.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `none`.
- **Required content/evidence:**
- Approved short copy or narration-derived phrases that can be shown without changing meaning.
- **Preferred source material when useful:**
- A real logo/mark only when identity is part of the semantic claim.
- **Do not:**
- Searching for decorative photos merely to fill the frame.
- Inventing statistics, quotes, or labels not supported by the semantic source.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`text premise → token/phrase change or escalating beats → emphasis/payoff → hold or handoff`

## Layout guidance
Use a simple typographic field with one dominant reading path. Preserve text readability before movement novelty. Centered composition is common but not mandatory.

## Temporal progression
1. Establish the first phrase or sentence frame.
2. Change only the meaningful token/phrase or advance through distinct full-frame beats.
3. Escalate scale/weight/position only when the rhetoric escalates.
4. Land on the payoff with sufficient dwell.


## Implementation guidance
- Keep one dominant reading path and let typography changes follow rhetorical emphasis, not visual novelty.
- Change only the words, tokens, scale, weight, or placement that carry a new semantic beat.
- Give each phrase enough stable dwell before the next transformation.
- Use spatial continuity when one phrase evolves into another so the viewer reads the change rather than re-reading the frame.
- Let the final phrase settle cleanly or hand its key token into the next scene.

### Failure modes
- Every word moves independently or continuously.
- Typography competes with necessary visual evidence.
- Motion begins before the current phrase can be read.
- Generic title + underline treatment is repeated regardless of the selected typographic composition.

### Materialization clarification — typography carries the event
- The typography itself must carry meaningful temporal change: token/phrase replacement, reordering, semantic emphasis migration, hierarchy change, mask/reveal, split/merge, or position change when those changes carry meaning.
- Decorative lines, particles, shapes, or background motion may support the beat, but they must not carry nearly all of the temporal change while the text remains effectively static.
- If removing the decorative layer leaves almost the same typographic event from beginning to end, this blueprint is only weakly materialized.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
A keyword, glyph, or text position may morph into the next scene’s hero.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Removed named text effects, spring APIs, logo mechanics, and runtime mappings. The shot is still defined by language changing over time.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
