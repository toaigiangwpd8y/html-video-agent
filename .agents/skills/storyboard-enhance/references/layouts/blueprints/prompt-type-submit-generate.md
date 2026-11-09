---
id: prompt-type-submit-generate
name: Prompt to Generated Result
family: prompt-response
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Prompt to Generated Result

## Intent
Input surface establishes → prompt types → submit/commit → machine works/responds → result lands or loop restarts.

## Choose when
- a typed ask is causally important.
- the machine response is the payoff.
- AI/search/command behavior must be demonstrated.

## Avoid when
- typing is just decorative text.
- the user must keep clicking through a workflow.
- the output has no credible surface or artifact.

## Semantic requirements
- one meaningful input/prompt.
- one observable response/result.


## Narrative roles
- **Upstream HyperFrames role coverage:** `hook`, `product_intro`, `feature_showcase`, `cta`
- **Generalized story roles:** `input-output`, `AI-mechanism`, `query-result`, `command-response`
- **Story job:** Make a meaningful input causally produce an observable machine response, so the ask→answer relationship is the scene.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`input_surface` — required.** The place where the query/prompt/command is entered.
- **`input_content` — required.** A semantically meaningful ask.
- **`commit_event` — required.** Submission/commit that separates input from response.
- **`response_surface` — required.** Observable result, artifact, answer, chart, diff, or status output.
- **`result_evidence` — required.** The part of the response that proves the scene claim.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `conditional`.
- **Required content/evidence:**
- A truthful product/input surface when demonstrating a real product; otherwise enough semantic content to construct a generic conceptual input-output scene.
- **Preferred source material when useful:**
- Real generated result/artifact when it is evidence.
- **Do not:**
- Fabricating a real product response.
- Using typing as decoration when no causal response matters.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`input surface establishes → prompt types → submit/commit → machine works/responds → result lands or loop restarts`

## Layout guidance
Keep the input and response relation spatially understandable. The input may be hero first and then yield to the result. Avoid surrounding the prompt with unrelated UI chrome.

## Temporal progression
1. Establish the input context.
2. Type the meaningful ask at a readable rate.
3. Commit the ask.
4. Show response state or direct result progression.
5. Land on the output or deliberately cut at submission if the ask itself is the hook.


## Implementation guidance
- Make the prompt/ask legible enough to understand the causal request, but do not over-display irrelevant UI chrome.
- Preserve a clear spatial or temporal relation between the submitted ask and the resulting response/artifact.
- Distinguish typing, commit, processing, and result as separate semantic states.
- Let the result inherit attention from the input rather than appearing as an unrelated panel.
- Stop once the response proves the intended behavior.

### Failure modes
- Types long prompt text faster than it can be read.
- Submission is decorative and the result has no visible causal link.
- Generic chat bubbles/cards dominate when the actual output is the evidence.
- Adds fake AI processing states unsupported by the Storyboard.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
The generated artifact/result can become the next scene’s hero.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Removed renderer-specific input, terminal, cursor, streaming, and status-animation requirements. Keep keyboard-driven cause → machine-response structure.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
