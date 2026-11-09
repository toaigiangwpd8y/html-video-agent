---
id: interruption-reentry
name: Interruption and Re-entry
family: interruption-reentry
status: adapted-renderer-neutral-composed
source_project: heygen-com/hyperframes
---

# Interruption and Re-entry

## Intent
Keep one process or focal object identifiable while an external event breaks its flow, exposes an unfinished state, removes working context, and then reconstructs enough context for the same process to resume.

## Choose when
- the story depends on one continuous task/process being interrupted and later resumed.
- the unfinished state must remain visible or inferable across the interruption.
- the cost or meaning comes from re-entry, not from generic overload.
- the viewer must understand that "returning" and "being ready to continue" are different states.

## Avoid when
- many independent interruptions accumulate and overwhelm is the main claim.
- the scene is only a before/after comparison with no re-entry process.
- a generic progress sequence communicates the story without an interruption boundary.
- the interruption permanently replaces the original process rather than pausing it.

## Semantic requirements
- one persistent process, task, object, or state identity.
- at least one meaningful interruption event.
- a preserved unfinished state or resumable position.
- a re-entry phase that is semantically distinct from normal progress.

## Narrative roles
- **Upstream HyperFrames role coverage:** None directly; this is a local composed gap-fill blueprint.
- **Generalized story roles:** `interruption`, `context-loss`, `recovery`, `process-continuity`
- **Story job:** Keep one process identifiable across interruption, incomplete return, context reconstruction, and resumption so re-entry cost is visible.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`persistent_process` — required.** The task/process whose identity must survive the interruption.
- **`interruption_event` — required.** The event that breaks continuity.
- **`unfinished_state` — required.** Evidence of where the process was left.
- **`reentry_state` — required.** Return state showing that full context is not yet restored.
- **`reconstruction_steps` — required.** Semantic steps needed to restore enough context to continue.
- **`resumed_state` — required.** The same process visibly continuing after reconstruction.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `conditional`.
- **Required content/evidence:**
- A process representation and interruption/recovery states grounded in the approved scene.
- **Preferred source material when useful:**
- Calendar/task/document/UI assets when they are real evidence; generated diagrams are fine for conceptual explanation.
- **Do not:**
- Substituting generic clutter for a specific interruption.
- Showing a fresh task after interruption instead of the same task resuming.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`active process → external interruption → unfinished state preserved → return without full context → context reconstructed → same process resumes`

## Layout guidance
Give the persistent process a stable visual identity before the interruption. When the interruption arrives, disturb the active flow without erasing what was in progress. During re-entry, preserve enough of the prior state that the viewer can tell the process is being reconstructed rather than restarted as a new object.

The interruption may occupy the same field, cross through it, temporarily displace focus, or create a visible gap. Do not require cards, alerts, split panels, arrows, or checklist UI. The key layout property is continuity of identity across the break.

## Temporal progression
1. Establish the active process clearly enough that its current state is memorable.
2. Introduce one external interruption that breaks the active progression.
3. Hold or expose the unfinished state instead of resetting it.
4. Show return as an incomplete state: presence has returned, context has not.
5. Reconstruct the minimum context needed to continue.
6. Resume the original process from a recognizable prior identity or position.

## Implementation guidance
- Keep the same primary process/object continuously identifiable before, during, and after interruption.
- Represent interruption as a temporal break in an active state, not merely an annotation beside a finished layout.
- Preserve an unfinished marker, partial position, or other memory of the pre-interruption state.
- Make “returned but context not restored” visibly distinct from both active work and complete absence.
- Reconstruct only the context needed to resume, then continue from a recognizable prior state rather than restarting from zero.

### Failure modes
- Shows continuous and interrupted versions as two static comparison panels for the whole scene.
- Interruption is only a label, icon, or dashed box with no effect on process state.
- Returning process starts as a fresh object with no preserved unfinished state.
- Recovery is skipped, so interruption jumps directly to normal progress.

### Materialization clarification — distinct interruption events
- When the Storyboard requires multiple semantically distinct interruptions, represent them as distinct temporal events.
- Do not reuse one interruption marker and merely rename it from one interruption to another if the source requires separate causes/events.
- Preserve causal order: `active → interruption 1 → continuation/partial recovery → interruption 2 → unfinished/re-entry state → reconstruction → resume`, adapting the exact sequence only to the approved Storyboard.
- Exact spatial treatment remains free; the requirement is distinct temporal causality.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
The same focal identity should survive the interruption whenever the Storyboard implies continuation. If the re-entry sequence continues into the next scene, hand off the unfinished/reconstructed state rather than replacing it with a fresh layout.

## Enhance ownership
The approved Storyboard owns the fact of interruption, the interrupted subject, semantic order, evidence, and what must be restored before resumption. Presentation details in the Storyboard are suggestions unless changing them changes meaning. Enhance owns final geometry, interruption placement, state representation, motion technique, transition technique, and timing realization.

This blueprint is a candidate, not a command. Use it when interruption plus re-entry is the semantic shape; do not choose it for every state-change scene.

## Adaptation notes
This blueprint is composed from HyperFrames patterns rather than copied from one upstream blueprint. It keeps two renderer-neutral ideas: visible state mutation over time from Agent Progress Theater, and a persistent anchor whose identity survives surrounding changes from Fixed Anchor, Cycling World. Product-specific status UI, cards, loaders, cursor actions, fixed camera doctrine, and runtime rule mappings were removed. The result narrows the pattern to interruption, lost context, reconstruction, and resumption.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus, primarily `agent-progress-theater` and `fixed-anchor-cycle`, audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes renderer/runtime implementation contracts.
