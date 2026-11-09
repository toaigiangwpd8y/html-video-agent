---
name: general-narrative
description: Defines success and creative/self-review guidance for story-led videos. Use when story progression, changed state, stakes, discovery, supported causal relationships, emotion, or thematic payoff is the main communication mechanism.
---

# General Narrative

## Success Definition

The viewer should follow what changes, why the story progresses, and why that progression matters, with an intentional emotional or thematic development suited to the request. When goals conflict, protect coherent, earned progression before formula or spectacle. A polished narrative fails when beats can be reordered or removed without consequence, stakes are merely stated, or the ending is not earned by, explained by, or meaningfully connected to what preceded it.

### Use when

Story progression itself is the primary communication mechanism.

### Do not use as primary when

The viewer mainly needs an executable procedure, analytical findings, product workflow proof, or a causal technical model.

### Boundary with adjacent profiles

The narrative subject may be a person, team, place, object, system, event, relationship, historical process, or abstract phenomenon capable of meaningful progression. Supporting profiles may add factual or explanatory constraints without forcing the story into their default structure.

## Creative Guidance

Identify the initial world/state, subject or governing question, pressure for change, obstacle/constraint, stakes/consequence, meaningful beats, escalation/turn/reveal, and changed final state or intentionally unresolved meaning. Use only the dimensions the request needs.

Pixar concepts such as wants/needs, obstacles, stakes, beats, structure, and visual language are tools, not mandatory Hollywood form. Do not force three acts, a hero's journey, villain, redemption, happy ending, or human protagonist.

Generate candidates through different narrative engines: transformation, mystery/reveal, escalating obstacle, parallel contrast, countdown/process progression, or retrospective cause-and-effect. Aesthetic treatments of one beat chain are not distinct stories.

Maintain factual/world/subject consistency. Emotion should arise from events, choices, discovery, or changed meaning rather than unsupported music/copy. Setup only what the narrative can pay off or deliberately leave productively open.

## Self-review Guidance

Ask:

- What makes each major beat follow from the previous one: cause, consequence, discovery, chronology, evidence, contrast, reinterpretation, or a motivated question?
- What materially changes at this beat?
- Are stakes legible through consequence or merely asserted?
- Does the subject's behavior/state remain coherent when relevant?
- Is setup paid off or intentionally left open for a defensible reason?
- Is the emotional/thematic turn earned by events?
- Can any beat be removed without loss of progression, explanation, or meaning?
- Is the ending a consequence, synthesis, or purposeful unresolved state rather than an arbitrary stop?

Disqualify broken narrative/explanatory continuity, unsupported causal claims, contradictory world/subject facts, or an unearned payoff central to the requested experience. Accept quiet, non-human, open-ended, documentary, process, or structurally unconventional stories when the brief supports them. Do not demand a CTA, tutorial completeness, or three-act escalation.

## Development Guidance

Preserve the winning narrative engine. Write the complete beat-to-beat story, remove redundancy, strengthen setup/consequence, maintain facts and recurring identity, and ensure motif/theme supports rather than substitutes for events. Do not introduce a new protagonist or payoff after selection.

Map each meaningful narrative beat to a canonical scene: viewer-facing language in `screenText` and optional narration text in `audio.voiceoverText`, story action/change/meaning to show in `visualConcept`, and no production media paths. Acquire truthful media after approval through `assets/manifest.json`. Do not add story-arc or character-schema objects to canonical `video.json`.

## Renderer Guidance

Support continuity and the approved emotional rhythm; preserve recurring subject/motif identity when it carries meaning. Framing, motion, transition, and sound may reinforce story change only after semantic truth is clear. No specific transition style or film grammar is universal; the post-approval renderer author chooses implementation.
