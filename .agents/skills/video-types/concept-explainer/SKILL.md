---
name: concept-explainer
description: Defines success and creative/self-review guidance for educational concept explainers. Use when viewers should grasp a core intuition and recognize or apply it in a nearby example, without requiring a specific illustration/caption format.
---

# Concept Explainer

## Success Definition

After one viewing, the target viewer should be able to explain the core intuition in their own words and recognize or apply it in a nearby example. When goals conflict, protect the learning objective, representative examples, and transferable mental model before breadth or decorative interest. A polished explainer fails when it ends at a definition, substitutes metaphor for the concept, or overloads verbal and visual channels.

### Use when

The primary outcome is beginner-accessible intuition or transfer about an idea, principle, or phenomenon.

### Do not use as primary when

The viewer mainly needs system internals, an executable procedure, data findings, or a prescribed narration-plus-illustration caption format.

### Boundary with adjacent profiles

- `technical-explainer` prioritizes a causal system/mechanism model; this profile prioritizes intuition and transfer.
- `illustrated-explainer` additionally defines a narration-led illustration/caption communication format; this profile is presentation-neutral.
- Supporting profiles may add relevance or format criteria without replacing the learning objective.

## Creative Guidance

Define one learning objective or transferable intuition. Estimate prior knowledge and identify the natural question or likely misconception when relevant.

Choose an explanatory path suited to that obstacle, such as question -> intuition -> example -> refinement, surprising case -> pattern -> name/formalization, misconception -> counterexample -> new model, or analogy -> mapping -> break point -> real concept. Treat these as candidate mechanisms, not templates.

Introduce terminology after or alongside meaning when the audience needs intuition first. Use representative examples and show what changes across a nearby case. Coordinate words and visuals so each channel contributes; signal important relationships, segment the reasoning, and remove extraneous ideas when load rises.

Build the single Script around a coherent way to establish intuition and enable transfer. Different metaphors for the same untouched explanation do not add value by themselves. End with synthesis or application appropriate to the brief, not an automatic sales CTA.

## Self-review Guidance

Ask:

- Does each beat answer a natural viewer question?
- Can the viewer follow the reasoning without hidden notes?
- Is the example representative, and what nearby example tests transfer?
- Does the analogy map explicitly and state where it stops?
- Is a memorable metaphor being mistaken for the actual concept?
- Are visuals externalizing a relationship, transformation, comparison, or example?
- Are narration, visible text, and visuals complementary or competing?
- Is extraneous information displacing the learning objective?

Disqualify a materially misleading example/analogy or an explanation that cannot support its promised intuition. Accept simplicity, literal visuals, or omission of formalism when appropriate for the audience. Do not penalize lack of system internals, product proof, CTA, or a specific caption style unless requested.

## Development Guidance

Preserve the winning teaching mechanism. Write a complete question/answer progression, stabilize terminology, resolve example and analogy accuracy, and include a synthesis/transfer beat that genuinely tests the promised intuition. Avoid unrelated interesting facts and do not force voice-over for text-led requests.

Serialize approved semantic beats into `video.json`: viewer copy in `screenText`; optional complete narration in `audio.voiceoverText`; and the reasoning the visual must externalize in `visualConcept`. Resolve source-grounded media only after Storyboard approval through `assets/manifest.json`; do not add concept maps or learning-objective fields outside the canonical contract.

## Renderer Guidance

Make relationships, transformations, examples, contrasts, and annotations perceptible when they carry the reasoning. Align visual reveals with conceptual progression and avoid simultaneous elements that compete with the learning objective. Narration may be the pacing spine when present, but exact implementation belongs to post-approval renderer authoring.
