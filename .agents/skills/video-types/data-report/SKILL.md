---
name: data-report
description: Defines success and creative/self-review guidance for data reports. Use when viewers must accurately understand findings, comparisons, trends, uncertainty, limitations, and conclusions supported by data.
---

# Data Report

## Success Definition

The viewer should accurately understand the important findings, the comparison/context required to interpret them, material uncertainty or limitations, and the conclusion the data supports. When goals conflict, protect analytical truth and fair comparison before drama or advocacy. A polished report fails when denominator, time window, scale, uncertainty, or correlation/causation framing creates a false story.

### Use when

The video is organized around evidence, metrics, findings, or analytical relationships.

### Do not use as primary when

Data is merely supporting evidence for a proposal, the main job is teaching a general concept, or the requested outcome is campaign persuasion.

### Boundary with adjacent profiles

- `persuasive-pitch` selects truthful evidence toward a decision; this profile must faithfully report findings even when they weaken a preferred conclusion.
- `concept-explainer` organizes around transferable understanding rather than a particular dataset.
- A supporting pitch profile may improve relevance and conclusion clarity but cannot cherry-pick or distort findings.

## Creative Guidance

Start from the analytical question, not a pile of charts. Select the smallest set of findings that answers the brief.

For every material finding, establish what is needed from metric definition, unit, denominator/base, source, time window, comparison group, absolute versus relative change, uncertainty/coverage, subgroup aggregation, and observation versus interpretation. Never narrate correlation as causation without evidence for the causal claim.

Choose a narrative order based on the relationship the viewer must see: change over time, ranking, deviation, distribution, magnitude, correlation, part-to-whole, or spatial pattern. This vocabulary guides analytical choice; it does not mandate chart components.

Candidates may differ through top-finding-first synthesis, question-led comparison, anomaly-led investigation, or another analytical mechanism. Swapping chart styles while preserving the same reasoning is not distinctness. Under duration pressure, remove low-priority findings rather than compress every number beyond legibility.

## Self-review Guidance

Ask:

- Do the metrics answer the actual analytical question?
- Are metric definition, unit, denominator, source, period, and comparison group sufficient?
- Is relative change missing relevant absolute context?
- Does the chosen time window create a misleading trend?
- Is correlation stated as causation without support?
- Does aggregation hide a material subgroup effect?
- Could axes, baselines, scale, or area encoding exaggerate or conceal magnitude?
- Is the conclusion selected fairly, or cherry-picked around one dramatic point?
- Are caveats proportionate and legible rather than buried or overwhelming?
- Is the information density feasible for the audience and duration?

Disqualify fabricated data, unfair comparison, unsupported causality, or presentation that materially changes apparent magnitude. Accept a concise report and selective caveats when omitted detail is immaterial. Do not demand a persuasive ask, emotional arc, or marketing hook.

## Development Guidance

Preserve the winning analytical mechanism. Write complete narration/copy that distinguishes observed result from interpretation, keeps source/period/context where necessary, and sequences findings so each answers the next viewer question. Simplify without changing what the numbers mean.

Store viewer-facing finding/caveat copy in `screenText` and optional `audio.voiceoverText`, describe the truthful analytical relationship to show in `visualConcept`, and materialize source-grounded data/media after approval through `assets/manifest.json`. Do not add chart specs, metrics, or review scores as new top-level canonical objects.

## Renderer Guidance

Choose presentation based on the analytical relationship. Preserve truthful scales, units, baselines where relevant, stable labels/legends, and consistent comparison. Highlight without distorting and allow important values/conclusions to be inspected. Animation may reveal sequence or relationship but must not alter apparent magnitude. The selected renderer owns chart implementation and exact timing.
