---
name: illustrated-explainer
description: Defines success and creative/self-review guidance for short narration-led illustrated explainers. Use when coordinated voice-over, simple illustrations, concise headline text, and spoken-word-following captions are the intended communication format.
---

# Illustrated Explainer — narration + illustration + active-word captions

## Success Definition

A first-time viewer should understand the main idea after one viewing, including on a phone. Narration is the pacing spine; each beat carries one dominant idea; illustration makes that idea concrete; headline text identifies the useful takeaway; captions keep speech followable without becoming a second competing script.

When goals conflict, protect comprehension and coordination between spoken point, headline, caption, and illustration before visual novelty. A polished result fails when those layers compete, the illustration decorates nouns instead of explaining meaning, or the ending does not resolve the opening explanatory promise.

### Use when

The approved format is a short narration-led explanation expressed through coordinated illustration and caption layers.

### Do not use as primary when

The primary outcome is campaign advertising, product workflow proof, task reproduction, or narrative progression and illustration/caption format is merely incidental.

### Boundary with adjacent profiles

- `concept-explainer` defines intuition/transfer without requiring this presentation format.
- Vertical aspect ratio, captions, narration, or simple graphics alone do not select this profile.
- Supporting guidance may add domain accuracy, but the primary profile still owns narration/illustration/caption coordination.

## Creative Guidance

Write for the ear first, then coordinate the screen around what is being understood. The opening should honestly create or state the explanatory question/promise; do not use bait unrelated to the eventual answer.

For each semantic beat, author three coordinated layers:

- **Spoken point:** the complete idea the narrator communicates.
- **Headline/key text:** the shortest useful phrase, number, or takeaway worth seeing large.
- **Illustration intent:** the semantic relationship, state, transformation, comparison, example, or reaction that must become observable to make the spoken point easier to understand. Author the job of the illustration, not its concrete production vocabulary.

One dominant idea per beat is more important than any fixed sequence. A possible progression is question/promise -> plain-language explanation -> concrete example/consequence -> synthesis, but use another structure when the topic requires it. Do not force a CTA.

Narration should be natural at spoken speed: prefer clear clauses, concrete verbs/examples, immediate explanation of necessary terminology, and manageable lists. Remove nested qualifications that the target viewer cannot hold while watching. Large headline text may summarize speech; it should not reproduce a full transcript.

At Author time, do not choose a concrete illustration vocabulary such as a recurring character, object family, diagram, screenshot, product image, icon system, card system, or metaphor merely as a production treatment. State the semantic illustration job and any identity that is genuinely required by truth or explicit user intent. Post-approval Storyboard Enhance selects the concrete visual strategy, assets, and coherent vocabulary that best materialize that job.

### Caption / spoken-text authoring

Captions normally reproduce the spoken wording for accessibility and followability. Segment at semantic or breath boundaries. A small phrase—often around 3–7 spoken words when language and delivery allow—can be a useful readability heuristic, never a rule that splits names, numbers with units, or tightly bound meaning.

Active-word or compact-phrase highlighting is appropriate only when the intended caption behavior calls for it. Plan exact canonical narration first so timed captions never invent or rewrite copy during rendering.

Make candidates distinct through different explanatory mechanisms, causal framings, or examples that change how the viewer understands—not through alternative illustration systems, color palettes, mascots, layouts, or caption skins.

## Self-review Guidance

Ask:

- Can a first-time viewer state the main point after one viewing?
- Does each beat contain one dominant idea?
- Is the narration processable at spoken speed?
- Does the illustration explain, demonstrate, transform, compare, or react to meaning?
- Do narration, headline, captions, and illustration compete for the same attention?
- Is large text a takeaway or a transcript dump?
- Can captions follow speech without unnatural segmentation?
- Are claims/numbers contextualized rather than merely flashed?
- Does the final synthesis resolve the opening question or promise?

Disqualify a misleading semantic illustration requirement, unresolved explanatory promise, narration that is not plausibly speakable within the approved timing, or information competition that prevents comprehension. Accept simple literal visuals and speech-matching captions; caption redundancy is not itself a defect when it serves accessibility. Do not demand a specific mascot, palette, exact chunk length, CTA, or cinematic transition style.

## Development Guidance

Preserve the winning explanatory mechanism and semantic illustration job. Write the complete narration and visible copy, split multi-concept beats, verify examples/claims, and keep illustration intent synchronized to meaning. Do not freeze the concrete illustration mechanism before post-approval Scene Design.

For each canonical scene:

- put only the exact approved spoken wording in optional `audio.voiceoverText`; no resolved audio file belongs in canonical Storyboard state;
- put the concise headline/key takeaway in `screenText`;
- put the semantic explanatory relationship/state/change/evidence job in `visualConcept`;
- leave concrete illustration vocabulary, visual/source production media, and asset binding to post-approval Storyboard Enhance through `assets/manifest.json`; approved Script-stage narration TTS is the pre-existing audio exception.

Do not fabricate `audio` for intentionally silent/text-led work. For narrated beats, materialize TTS before Script review and use measured audio duration as the minimum scene timing input, rounded up to a whole frame. Use that minimum by default; add time only for a purposeful illustrative pause, hold, or semantic beat, then keep the sum equal to `meta.durationsInFrames`. Storyboard Enhance reuses and registers that approved voice-over post-approval rather than generating it for the first time. Prefer splitting or tightening a dense semantic beat over making speech or captions unreadably fast; do not use tempo-fit/speed-up as the normal solution.

## Renderer Guidance

After Storyboard approval, a Remotion implementation with this frozen primary profile may use the optional deterministic helper library in `.agents/skills/remotion-editorial-motion/SKILL.md`. This link makes the library discoverable for this profile; it does not require a particular visual style, caption format, transition, or motion pattern. User and brief intent remain authoritative.

### Narration and captions

When the approved Script-stage narration is reused post-approval for canonical `audio.voiceoverText`, treat audible narration as the presentation clock. Caption timing should follow actual speech closely enough that active emphasis does not visibly lead or lag. Keep one readable phrase stable while spoken, distinguish the current word or compact phrase without making every word jump, and switch groups at natural boundaries.

### Screen hierarchy

Maintain a quickly parseable hierarchy among context, headline/key text, one dominant illustration, and caption region. Keep captions away from important illustration details and respect phone-safe margins when output is vertical. This is a hierarchy, not a pixel template.

### Illustration and motion

Reuse a coherent visual vocabulary. Let motion clarify entrance, state change, comparison, pointing, emphasis, or transformation, then hold long enough to understand. Avoid constant movement or transitions that cause the viewer to miss the next spoken idea.

### QA priorities

Inspect the opening promise, an ordinary explanatory beat, caption emphasis across time, a scene boundary, and the exact final frame. Verify actual narration audibility, speech/caption alignment, mobile legibility, and that all four information layers support one idea. The selected renderer owns implementation components, timestamp format, exact frames, motion easing, and transition topology.
