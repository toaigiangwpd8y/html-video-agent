---
name: persuasive-pitch
description: Defines success and creative/self-review guidance for persuasive proposals and pitches. Use when an audience must understand a decision, find the argument credible, and know the intended takeaway or ask.
---

# Persuasive Pitch

## Success Definition

The audience should understand the decision/problem, find the reasoning and evidence credible enough for context, and know the intended takeaway or ask. When goals conflict, protect argument validity, audience relevance, and proportionality between evidence and conclusion before rhetoric or memorability. A polished pitch fails when it skips an inference, ignores a material objection, or asks for more than the evidence earns.

### Use when

The main outcome is support for an idea, proposal, project, strategy, or decision.

### Do not use as primary when

The first duty is neutral reporting of findings, campaign advertising, or step-by-step instruction.

### Boundary with adjacent profiles

- `product-ad` communicates a product/brand campaign; a pitch builds an argument toward a decision and may be more evidentiary.
- `data-report` must faithfully represent findings even when they undermine persuasion.
- Supporting data-report guidance can strengthen truthfulness; it cannot be cherry-picked around the desired ask.

## Creative Guidance

Identify who must decide, believe, or act; their current belief; what matters to them; and likely objections or alternatives. Establish why the issue matters before presenting a solution, then make the proposal relevant to explicit decision criteria.

Build one coherent argument. Distinguish claim, evidence, inference, and implication. Use proof, comparison, example, or counterargument appropriate to the claim, and make the ask proportional to what has actually been established. Prioritize decision-relevant information over comprehensive background.

`why -> what -> how` can be a useful storyline heuristic: why the issue matters, what must change or be true, and how the proposal addresses it. It is not a mandatory template.

Create candidate diversity through different argument mechanisms: consequence-led case, criteria/comparison, objection-first reframing, proof-led proposal, or another defensible reasoning path. Different slogans or emotional tones over the same logic are not distinct candidates.

## Self-review Guidance

Ask:

- Is the problem/decision relevant to this audience's actual stakes?
- What does the audience currently believe, and which material objection remains unanswered?
- Does each conclusion follow from the evidence, or is there a hidden inferential leap?
- Are rhetoric and evidence distinguishable?
- Is uncertainty acknowledged in proportion to its effect on the decision?
- Are relevant alternatives ignored in a way that weakens credibility?
- Is the ask clear, actionable where appropriate, and earned?
- Which facts change the decision, and which merely create volume?

Disqualify fabricated proof, materially invalid reasoning, manipulative omission, or unsupported certainty central to the ask. Accept selective background and unresolved minor objections when they do not affect the decision. Do not penalize lack of brand recall, exhaustive reporting, or cinematic emotion unless requested.

## Development Guidance

Preserve the Script's chosen argument mechanism. Write the complete audience journey, strengthen the chain from problem/criteria through evidence and implication to conclusion, answer material objections, and remove impressive details that do not affect the decision. Do not replace weak proof with stronger-sounding rhetoric.

Serialize approved claim/evidence/conclusion copy into `screenText` and optional `audio.voiceoverText`; describe the visible comparison, proof, or reasoning support in `visualConcept`; bind materialized evidence/media after approval in `assets/manifest.json`. Do not create pitch-specific argument or CTA objects outside canonical `video.json`.

## Renderer Guidance

Use information hierarchy and commensurate comparisons to support reasoning. Give material proof enough semantic dwell to be inspected and visually distinguish claim, evidence, and conclusion when useful. Presentation must not imply confidence or causality beyond canonical content. The selected renderer owns exact layout, motion, transitions, and timing.
