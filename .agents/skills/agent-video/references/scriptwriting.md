# Script authoring and review

Use this reference only at the Script checkpoint. A script is exact viewer-facing content, not a longer outline or storyboard. It must let another agent stage it without inventing the argument, lesson, procedure, claims, examples, or spoken copy.

## Establish the script contract

Before drafting, state privately and concisely:

- the one audience question, job, decision, or change the script must resolve;
- the core tension, friction, or observable failure mode that establishes why the topic matters;
- what the viewer already knows and should be able to explain, recognize, do, believe, or decide afterward;
- the essential evidence, example, product state, code, data, or event that makes the outcome credible;
- the approximate duration reference and delivery mode;
- what is explicitly out of scope.

If explicit content and delivery constraints cannot fit together, reduce scope before writing. Treat the approximate duration as guidance; do not hide a mismatch by making every beat denser just to hit the estimate.

## Draft exact content

Write complete spoken wording when narration is intended and complete visible wording when it is not. For each beat, make these relationships recoverable without prescribing renderer details:

1. the viewer question, tension, or state entering the beat;
2. the beat's single necessary function;
3. the exact audio and necessary visible copy;
4. the concrete evidence, example, or observable state that supports it;
5. why the next beat follows: causally, logically, temporally, evidentially, or because it answers a narrative question raised before it.

### Viewer-facing content channels

Every beat coordinates two viewer-facing content channels:

- **Spoken narration (`audio.voiceoverText`):** Drives the narrative/explanatory progression and the "why". State causal relationships only when the approved evidence supports causality. Written as spoken discourse from an authoritative subject-matter expert, never a regurgitation of bullet points. Narration must sound natural when spoken aloud.
- **Visible anchor copy (`screenText`):** Concise cognitive anchors, metrics, or short labels. About 5-8 words is a useful default when it preserves meaning, but it is not a hard cap: exact names, numbers with units, necessary caveats, and tightly bound phrases may be longer. Screen text must complement speech, never duplicate narration verbatim or force the viewer to read a second script while listening.

Script owns story logic, claims, evidence/source requirements, and the relationship needed for the argument, but it does **not** author canonical `visualConcept` or choose a scene manifestation. Do not decide timeline, diagram, balance, split, network topology, left/right placement, blueprint, production asset, transition, or motion treatment at the Script checkpoint. Storyboard derives the semantic visual requirement after Script approval; Storyboard Enhance chooses the manifestation after Storyboard approval.

### Evidence and anti-filler

Do not make a material claim without enough evidence for the viewer to understand or assess it:

- Every material claim must have concrete visual, spoken, or example-based support when the viewer needs that support to follow or trust it.
- Make the relevant state, example, comparison, or consequence observable; do not rely on a decorative metaphor to carry an important claim.
- Eliminate generic filler, empty intensifiers, and marketing buzzwords ("seamless", "cutting-edge", "powerful paradigm", "blazing fast", "game-changing"). Let the content demonstrate value.

### Opening hook and progression

The opening beat must establish an immediate question, tension, friction, or meaningful change before expanding the subject. Never open with an unearned definition, an abstract taxonomy, or an introductory thesis statement. The ending must resolve the opening promise, and every beat must make the next beat follow for a reason.

### Pacing and delivery fit

Write for listening: use stable terms, concrete verbs, pronounceable sentences, and explicit referents.

- Materialize TTS for every narrated beat from explicit stable-ID JSON after the draft is complete and before Script review (`video tts synthesize`, then `video tts status`). An intentionally silent video still records an empty narration manifest. Measure the resulting WAV; its sample count and sample rate are authoritative for downstream timing. The Script review binds exact narration text, configuration, and audio hashes.
- A Brief may have an approximate `targetSeconds`, a hard `maxSeconds` ceiling, or both. Legacy `durationSeconds` is only an approximate target. Do not require narration to fill a target. A hard-ceiling overrun pauses at host-owned `DURATION_FIT`, showing measured voice plus silent beats/gaps and the two decisions `shorten_script` / `revise_brief`.
- A narrated scene's default duration is the measured TTS duration rounded up to a whole frame. Add time only when a purposeful visual pause, hold, or semantic beat needs it; there is no mandatory one-second breathing margin.
- Do not overload a 10-second beat with multiple distinct ideas. One beat must develop exactly one primary concept with its tangible proof.
- Keep every approved take at native speed. Never add a voice speed setting, playback-rate change, time stretch, sample-rate reinterpretation, or speech trimming to fit a target or ceiling. Do not repeatedly synthesize takes to fish for shorter timing.

### Multilingual TTS delivery

When narration mixes languages, code identifiers, acronyms, product names, or specialist terms, do not assume a voice selected for the main language will pronounce them acceptably. Keep `audio.voiceoverText` as the exact approved wording. A TTS-only delivery input may use provider-supported pronunciation controls, SSML, language spans, or orthographic hints, but it must not change meaning or leak phonetic spellings into viewer-facing copy or canonical narration.

At the Script checkpoint, `audio.voiceoverText` remains the canonical narration wording, but the Author must also materialize TTS with the existing production voice path (the pinned local production voice) before review, measure actual PCM samples, and listen for obvious delivery defects such as bad mixed-language pronunciation, missing or repeated words, leading silence, clipping, or implausible pace. Stable segment IDs live in the structured narration sidecar. If wording changes during Script revision, only the changed segments need new audio; reorder and Brief-duration edits reuse identical WAV bytes. Storyboard serialization maps each narrated scene through `audio.voiceSegmentId`. Storyboard Enhance later reuses and registers the approved materialized voice-over without synthesis, and production preflight registers the same approved bytes.

The opening must promptly fulfill the promise implied by the approved concept. The ending must resolve it through synthesis, transfer, demonstrated result, supported conclusion, narrative payoff, or an earned ask. A hook or CTA is not universal.

## Select the genre-specific proof

Apply the active production profile rather than blending every structure below.

- **Concept explainer:** organize around one learnable question or misconception. Start with an observable failure or anomaly in the baseline case before presenting the concept. Move through a representative concrete case into the idea, refine its limits, then test transfer with a nearby case. A definition alone is not an explanation.
- **Procedural tutorial:** establish starting state and prerequisites, then preserve `required state -> exact action -> observable result`. Include only branches and recovery that materially affect completion, and end with a verifiable success state.
- **Product demo:** follow one realistic user job through initial state, meaningful action, truthful product response, result, and value. Observable behavior must carry important claims; adjectives cannot substitute for proof.
- **Product ad:** protect one campaign message. Attention must lead to the product/message, claims must be supported, and the direction or CTA must be proportional to the objective.
- **Persuasive pitch:** distinguish claim, evidence, inference, implication, material objection, and ask. The audience should not need to supply a hidden reasoning step.
- **Data report:** begin with the analytical question and prioritize findings that answer it. Preserve definitions, units, denominators, periods, comparison context, uncertainty, and the boundary between observation and interpretation where material.
- **General narrative:** every material beat must contribute a meaningful change, consequence, discovery, chronology, evidence, contrast, escalation, reinterpretation, or motivated question/answer. Assert causality only when supported; do not force three acts or a human protagonist.
- **Illustrated explainer:** write for the ear first. Each beat coordinates a complete spoken point, concise headline, and illustration that externalizes meaning. Do not make the channels compete.
- **Neutral:** derive structure and proof only from the brief; do not import another genre's hook, lesson, arc, or CTA.

## Bounded pre-review self-check

Perform one short correctness/fit self-check of the completed Script in the same drafting pass, without relying on unstated notes:

- **Core promise:** State its single promise and intended viewer outcome in one sentence. If two unrelated answers are required, the scope is unresolved.
- **Prerequisites and causality:** Mark the first hidden prerequisite, unexplained referent, causal leap, state jump, or unsupported claim.
- **Function and necessity:** Label each beat's function. Remove or merge a beat whose removal changes neither understanding nor outcome.
- **Domain-native evidence:** Check that evidence is native to the domain: code/output for code behavior, product state for product behavior, observable checkpoint for procedure, data/context for findings, and supported events/relationships for narrative.
- **The Information Competition Test:** Does the screen copy force the viewer to read dense sentences while listening to different spoken narration? If yes, condense it to the shortest anchor that preserves the required meaning; about 5-8 words is a useful default, not a hard cap.
- **The Ear Test (Spoken Quality):** Does the narration sound like a real person speaking to this audience rather than a printed textbook? Flag passive voice, bullet-style phrasing, and unpronounceable identifier chains.
- **Audio duration:** Use the materialized TTS file, not a word-count/read-aloud estimate, as the authoritative spoken-duration measurement. Confirm that Storyboard can give each narrated scene at least enough frames to play the complete audio. No extra margin is required by default; add time only for a purposeful visual pause, hold, or semantic beat. The final video may exceed the voice duration, but must not end before it. Do not force the total to equal the approximate Brief duration.
- **Motivated transitions:** Check whether every transition has a clear causal, logical, temporal, evidential, contrastive, or question-answer reason for the next beat to follow, rather than merely saying "next."
- **Resolution:** Confirm that the final beat resolves the opening promise and does not introduce a new thesis.

Fix clear blockers found in this bounded pass, then submit the single Script for user review. Do not generate alternate candidates, start a dedicated Critic round, iterate a model-review loop, or make a model-side final selection.
