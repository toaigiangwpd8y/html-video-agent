---
id: agent-progress-theater
name: Agent Progress Theater
family: state-progression
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Agent Progress Theater

## Intent
Trigger → visible work-in-progress → result materializes → result resolves or remains partially active.

## Choose when
- machine/agent work must be visible over time.
- progress, scan, build, processing, checklist, message-thread receipt.
- state mutation is the proof.

## Avoid when
- the main action is typing a prompt.
- a user cursor must drive every UI state.
- a static list is enough.

## Semantic requirements
- at least one meaningful working state.
- a visible result or state change.


## Narrative roles
- **Upstream HyperFrames role coverage:** `feature_showcase`
- **Generalized story roles:** `process-state`, `machine-working`, `progression`, `multi-step-result`
- **Story job:** Make intermediate working states and their mutation into a receipt/result the evidence of a multi-step process.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`trigger` — required.** The event or initial state that starts the process.
- **`working_states` — required.** Distinct meaningful phases/statuses, not random loading copy.
- **`persistent_task_identity` — required.** The job/process that stays identifiable throughout.
- **`receipt_or_result` — required.** Checklist, findings, message, artifact, or resolved state showing completion.
- **`step_evidence` — optional.** Per-step proof when the story requires inspection.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `conditional`.
- **Required content/evidence:**
- Truthful process states and final result; use captured UI only when the story is about a real product.
- **Preferred source material when useful:**
- Real status/result captures, logs, documents, or artifacts when they are available evidence.
- **Do not:**
- Inventing plausible-sounding machine steps for a factual product demo.
- Animating loaders around an already-complete result.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`trigger → visible work-in-progress → result materializes → result resolves or remains partially active`

## Layout guidance
Keep one stable work surface or status region so the viewer can track state changes. The visual hierarchy should favor the current machine state, then the receipt/result. Cards, pills, loaders, chat bubbles, or checklists are optional representations, not required containers.

## Temporal progression
1. Establish the trigger with one concise cause.
2. Hand attention to the machine state; show 1–3 meaningful progress changes.
3. Materialize the result progressively rather than presenting it complete at once.
4. Resolve on a confirmation, partial completion, or focused result.


## Implementation guidance
- Keep a stable semantic work surface so each progress state reads as a mutation of the same process.
- Show only progress states that change the viewer’s understanding of what the system is doing.
- Materialize the result progressively from the working state rather than cutting from “working” to a finished receipt with no causal bridge.
- Let current state own hierarchy; supporting status labels should explain, not dominate.
- Preserve the result object if it becomes the next scene’s subject.

### Failure modes
- Progress is represented only by generic loaders, pills, or checklist boxes with no semantic change.
- Every status becomes a detached card or panel.
- Working states are cosmetic loops that do not advance the story.
- Result appears complete without a visible relationship to the preceding work.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
If a result becomes the subject of the next scene, preserve its identity and focal position where useful.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Original HyperFrames variants often use UI cards, status pills, loaders, cursor clicks, and runtime-specific motion-rule mappings. This version keeps the state-theater grammar but makes all container and motion choices optional.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
