---
id: typewriter-reveal
name: Typewriter Reveal
family: typed-text
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Typewriter Reveal

## Intent
Caret/typing begins → line completes or edits → line collapses/yields or remains as anchor → payoff appears → hold.

## Choose when
- the act of typing is itself relatable or meaningful.
- one line should feel authored live.
- typed text should transform into or support a payoff.

## Avoid when
- typing only slows down information.
- the scene needs a real product input and machine response.
- copy is too long for readable live typing.

## Semantic requirements
- short text suitable for live reveal.


## Narrative roles
- **Upstream HyperFrames role coverage:** `hook`, `branding`
- **Generalized story roles:** `hook`, `authored-thought`, `prompt-like-idea`, `closing`
- **Story job:** Make the act of authoring one short line the evidence, then let that line resolve into a semantic payoff or identity.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`typed_line` — required.** One short line whose live authorship matters.
- **`authoring_anchor` — optional.** Caret, input affordance, or persistent mark establishing that the line is being authored.
- **`payoff` — required.** The state, statement, identity, or next semantic object reached after the line completes.
- **`brand_or_context` — optional.** Logo/product context only if the scene truly concerns that identity.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `none`.
- **Required content/evidence:**
- Short approved text suitable for a live reveal.
- **Preferred source material when useful:**
- Logo or real product surface only when explicitly relevant.
- **Do not:**
- Fetching unrelated imagery for a text-led scene.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`caret/typing begins → line completes or edits → line collapses/yields or remains as anchor → payoff appears → hold`

## Layout guidance
Use one clear typing rail or text region. Keep the typed line dominant until the handoff. A persistent mark may coexist if it has semantic purpose.

## Temporal progression
1. Begin with a clear typing start state.
2. Reveal the line at a believable/readable cadence.
3. Optionally edit or replace only when it adds meaning.
4. Transform, collapse, or subordinate the line to reveal the payoff.


## Implementation guidance
- Keep the typed line or phrase as the dominant semantic object during authoring.
- Reveal text at a cadence compatible with reading, emphasizing meaningful edits rather than mechanical keystrokes.
- If the typed phrase becomes a payoff object, preserve token/position/shape identity through the handoff where possible.
- Reduce supporting decoration while typing so attention stays on authorship.
- Stop typing once the semantic line is complete; hold before transforming.

### Failure modes
- Types text purely as a visual gimmick when authorship is irrelevant.
- Uses a blinking caret or keyboard-like effects as the main motion.
- Typed line disappears and an unrelated payoff appears elsewhere.
- Copy length forces unreadably fast typing.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
The typed phrase can morph into a logo, keyword, UI, or CTA if identity is preserved.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Removed blinking-loop doctrine, specific input/caret implementations, and spring mappings. Preserve human-authored typing as the narrative engine.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
