---
name: technical-explainer
description: Defines success and creative/self-review guidance for technical system and mechanism explainers. Use when viewers need a causally accurate mental model of components, interfaces, states, transformations, or engineering processes.
---

# Technical Explainer

## Success Definition

The viewer should be able to explain the relevant problem/state, important components or interfaces, how the mechanism changes state, and why the consequence follows. When goals conflict, protect causal accuracy and the target mental model before completeness or spectacle. A polished explainer fails when names replace explanation, prerequisites are hidden, or a causal leap forces the viewer to infer the mechanism.

### Use when

The main outcome is accurate understanding of a system, architecture, mechanism, interface, or engineering process.

### Do not use as primary when

The viewer mainly needs transferable intuition without system detail, visible product behavior, or steps to reproduce a task.

### Boundary with adjacent profiles

- `concept-explainer` prioritizes intuition and transfer; this profile prioritizes mechanism and causal structure.
- `product-demo` proves user-facing behavior without necessarily explaining internals.
- `procedural-tutorial` protects task execution rather than a causal model.
- Supporting persuasion may sharpen relevance but cannot hide mechanisms or weaken accuracy.

## Creative Guidance

Calibrate prior knowledge from the brief and expose required prerequisites. Choose one main explanatory thread and keep names stable for entities, components, inputs, outputs, states, and interfaces. Distinguish what exists, what changes, what causes the change, and what consequence follows.

Possible mechanisms include tracing one concrete input through the system, correcting a misconception then revealing the mechanism, explaining outside-in architecture, following input -> transformation -> output, or comparing old and new mechanisms. These are options, not a fixed sequence.

Move from concrete to relational to abstract when it reduces load for the stated audience. Use analogy only when the mapping is explicit and the break point is named before it can create a false model. Omit implementation detail that does not improve the requested mental model; do not omit a causal dependency merely to move faster.

Make candidates different by explanatory mechanism or causal vantage point, not by diagram style. Plan evidence/examples to instantiate the mechanism rather than substitute for it.

## Scriptwriting

At the Script checkpoint, apply [`references/scriptwriting.md`](references/scriptwriting.md) in addition to the universal contract at `.agents/skills/agent-video/references/scriptwriting.md`. This profile reference owns technical tension, technical artifact grounding, technical spoken quality, and the technical Swap Test; other profiles must not inherit those requirements.

## Self-review Guidance

Ask:

- Can the viewer state `problem/state -> mechanism -> consequence`?
- Where is the first hidden prerequisite or causal leap?
- Are components introduced before use and named consistently afterward?
- Are state, transformation, interface, cause, and consequence distinguishable?
- Is jargon doing explanatory work or merely labeling a box?
- Does an analogy map explicitly, and where does it stop being accurate?
- Does any simplification become materially false for the target decision/use?
- Is conceptual load manageable for the stated prior knowledge and duration?

Disqualify material falsehood, broken causal order, or an unexplained dependency central to the requested model. Do not penalize a later literal diagram or conventional sequence when it best serves clarity; Author still specifies the semantic mechanism, not the renderer topology. Do not demand product persuasion, task executability, brand recall, or an emotional arc unless active guidance requires them.

## Development Guidance

Preserve the winning explanatory mechanism and build a complete progressive mental model. Stabilize terminology, close self-review-identified causal gaps, make examples representative, and remove branches that do not support the target model. Do not introduce new architecture after Script approval.

Map semantic reasoning beats into canonical scenes: explanation copy in `screenText` and optional narration text in `audio.voiceoverText`, the state/relationship/evidence the viewer must see in `visualConcept`, and no production media paths. Acquire source-grounded supporting media after approval through `assets/manifest.json`. Store cross-video visual/motion direction in `meta`, not technical nodes or diagram schemas.

## Renderer Guidance

Use stable spatial identity when it helps viewers track components. Reveal relationships as reasoning needs them; let visual change correspond to state change, flow, comparison, or causality. Preserve labels long enough to learn and make comparisons visually commensurate. Keep renderer mechanics out of the content plan; the selected renderer owns exact topology and timing.
