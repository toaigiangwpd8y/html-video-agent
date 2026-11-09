---
name: neutral
description: Provides a taste-neutral fallback success and creative/self-review guidance profile. Use when no specialized production outcome is justified and the exact brief itself must supply all creative priorities.
---

# Neutral Production Profile

## Success Definition

The video succeeds when it satisfies the exact approved brief, explicit constraints, and semantic truth without importing a specialized doctrine. When goals conflict, follow the priorities stated or necessarily implied by the request. A polished result fails when it invents assumptions about novelty, memorability, advertising, didacticism, emotionality, cinematicity, density, literalness, pacing, or CTA.

### Use when

No specialized viewer outcome clearly applies, or the user explicitly wants a general/literal response governed only by their brief.

### Do not use as primary when

The approved brief clearly centers advertising, demonstration, instruction, technical/concept explanation, illustrated explanation, persuasion, narrative, or data reporting.

### Boundary with adjacent profiles

Neutral adds no taste and cannot have supporting profiles. Aspect ratio, captions, narration, UI footage, or charts alone do not justify another profile; classify by the viewer outcome.

## Creative Guidance

Derive structure, content selection, level of creativity, tone, and pacing from the brief itself. Create three materially different responses only where the brief permits meaningful mechanism variation. Do not manufacture a dramatic arc, metaphor, hook, CTA, lesson, or visual throughline to make slots look different.

Neutral does not mean vague. Each candidate must still expose its viewer outcome, mechanism, progression, structural spine, relevant evidence strategy, tradeoff, and distinctness. When the brief tightly determines one mechanism, vary only along genuine remaining choices and state the constraint rather than inventing incompatible goals.

## Self-review Guidance

Ask:

- Does the candidate fulfill every explicit hard constraint and requested outcome?
- Which assumption is not supported by the brief or authoritative context?
- Is the internal progression coherent?
- Are material claims supportable?
- Did taste from an ad, explainer, narrative, tutorial, or another profile leak in?
- Is candidate distinctness mechanistic where the brief allows it?

Disqualify contradiction with explicit intent, unsupported semantic invention, or incoherence. Accept plainness, slowness, literalness, unconventionality, silence, lack of CTA, or lack of emotional arc when requested. Do not reward or punish genericness, spectacle, novelty, safety, memorability, or cinematicity by default.

## Development Guidance

Complete the selected response faithfully with the fewest additional assumptions necessary. Produce full viewer-facing copy, maintain claims and semantic progression, and do not upgrade the result into an ad, explainer, tutorial, or story without request support.

Serialize only approved content into canonical `video.json`: project-wide approved direction in `meta`; semantic beats, copy, approved narration text, and semantic visual concepts in `scenes`. Visual/source production assets are materialized after Storyboard approval. Script-stage narration TTS is the sole pre-Storyboard production exception. Do not invent narration for intentionally silent work.

## Renderer Guidance

Honor explicit style, platform, layout, legibility, and motion constraints. Otherwise add no aesthetic preference and leave implementation, exact timing, overlap, transition, and component choices to post-approval renderer authoring.
