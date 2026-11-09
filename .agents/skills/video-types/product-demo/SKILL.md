---
name: product-demo
description: Defines success and creative/self-review guidance for product demonstrations. Use when viewers must see how a product behaves in a concrete job and understand value from observable workflow evidence.
---

# Product Demo

## Success Definition

The viewer should understand what the product does in a concrete task and see credible evidence of resulting value through actual or accurately represented behavior. When goals conflict, protect workflow truth and action-response-result continuity before promotional compression. A polished demo fails when value is merely asserted, states are skipped, or unsupported functionality makes the product appear magical.

### Use when

The product's visible behavior in a real user job is the main proof.

### Do not use as primary when

The primary goal is campaign persuasion/recall, novice task reproduction, or explanation of internal architecture.

### Boundary with adjacent profiles

- `product-ad` persuades through campaign communication; a demo proves through use.
- `procedural-tutorial` must make viewers able to perform every necessary step; a demo may omit routine steps that do not affect proof.
- `technical-explainer` may explain internals without a user-facing workflow.

## Creative Guidance

Choose a realistic audience-specific job or use case. Establish enough initial state to understand the need, then identify the meaningful user trigger/action, product response, resulting state, and concrete value. Omit irrelevant feature-tour branches.

Tie every important benefit claim to something the viewer can observe. Keep UI labels, inputs, outputs, latency, automation, permissions, and data states faithful to supplied product evidence. Never invent a capability, result, or frictionless transition to make the demo smoother.

Choose one job and proof mechanism that fit the audience, available evidence, and duration. Author one complete Script and perform one bounded correctness/fit self-check against this Success Definition. Fix blocking issues in that pass; subsequent revisions follow user feedback.

Preserve necessary state transitions while compressing routine action only when the viewer can still understand what caused the result. If the brief lacks proof for a desired claim, name the gap rather than scripting around it.

### Software workflow evidence

Read the known, selected workflows from the registered App Explorer revision. A video request does not start live discovery. If knowledge is missing, report that gap through the existing clarification or review path; continue exploration only after an explicit user request. Keep claims limited to the workflow's tested scenario and context. Read the repo-local `.agents/skills/app-explorer/SKILL.md` when exploration is explicitly requested.

When authoritative knowledge is unavailable, consult official product Help for intended behavior. Inspect a repository only when it is explicitly supplied and is the product's own source; use it to identify implementation paths and constraints, not as proof of deployed behavior. Existing screenshots may inform appearance but do not establish functional transitions. Label documented, inferred, and unverified facts accurately.

Plan a repeatable demonstration from known workflows with the appropriate account, inputs, and permitted seed/reset procedure when those are documented. Product knowledge informs the Brief and Script; it is separate from production capture. Acquire production screenshots or recordings only after Storyboard approval through the existing asset gate. State what must be captured or faithfully reconstructed without choosing renderer implementation during Author.

## Self-review Guidance

Ask:

- What did the viewer actually observe that supports each important claim?
- Does narration/copy describe the state currently visible?
- Where is the first skipped state that makes behavior look magical?
- Is the sequence one coherent user job or a feature list?
- Is the result meaningful to the stated user and context?
- Are UI labels, example data, permissions, and product capabilities supported?
- Can the planned demonstration reproduce the stated result, and are omitted setup or wait states represented honestly?
- Would removing the product leave the same generic before/after story?

Disqualify fabricated UI/capability, causal value claims unsupported by behavior, or a workflow whose states contradict supplied evidence. Accept omission of routine reproducible detail when it does not weaken the proof. Do not penalize the demo for lacking an ad hook, hard CTA, internal architecture, or novice-complete instructions unless explicitly requested.

## Development Guidance

Preserve the chosen job and proof mechanism. Write complete copy/narration aligned to supported states, make initial state -> action -> response -> result -> value causal, remove unsupported claims, and ensure the payoff is visible or directly inferable rather than merely declared.

Represent the required product states and transitions through canonical `video.json` scenes; do not require one scene per click. Put exact meaningful viewer-visible copy, including UI labels needed to understand the proof, in `screenText`, optional narration text in `audio.voiceoverText`, and the truthful state/proof to show in `visualConcept`. Acquire screenshots/video/UI assets after Storyboard approval into `assets/manifest.json`. Do not create feature, workflow, or proof objects outside the canonical contract.

## Renderer Guidance

Prioritize product/UI readability and continuity between action, response, and result. Maintain enough spatial/state persistence to prevent confusion; use emphasis only to disambiguate real behavior. Visual polish remains subordinate to fidelity. The selected renderer retains freedom over framing, overlap, exact timing, and implementation.

For software UI, keep the relevant control, response, and resulting state readable long enough to follow causality. Cursor emphasis, crop/zoom, highlights, or transitions should direct attention to that evidence. Preserve context when moving between views; communicate compressed waits honestly and do not imply measured speed from presentation timing. Match motion and styling to the approved brief rather than requiring a dark UI, rapid montage, or fixed hook/CTA structure.
