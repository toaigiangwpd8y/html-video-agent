---
id: spatial-pan-stations
name: Spatial Stations
family: station-traversal
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Spatial Stations

## Intent
Wide spatial map implied → station 1 focus → travel → station 2 focus → … → final station hold.

## Choose when
- milestones/steps/concepts can live at distinct spatial stations.
- sequence and location should reinforce each other.
- one canvas can hold the whole path.

## Avoid when
- the sequence has no spatial meaning.
- camera travel would be longer than the content warrants.
- the items need simultaneous comparison.

## Semantic requirements
- 2+ ordered stations.
- one coherent world/path.


## Narrative roles
- **Upstream HyperFrames role coverage:** `hook`, `pain_point`, `product_intro`
- **Generalized story roles:** `timeline`, `journey`, `process`, `multi-step-explanation`, `connected-problems`
- **Story job:** Turn an ordered set of milestones, concepts, or evidence points into distinct stations in one coherent conceptual world.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`stations` — required.** At least two ordered semantic stops.
- **`path_or_world` — required.** A coherent relationship that makes the stops belong to one space or sequence.
- **`station_evidence` — required.** The label, media, data, or state that makes each stop meaningful.
- **`final_station` — required.** The destination or conclusion that gives the traversal direction.
- **`connectors` — optional.** Only when a relationship truly needs explicit visual connection.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `conditional`.
- **Required content/evidence:**
- Enough evidence/content to distinguish each ordered station.
- **Preferred source material when useful:**
- Photos, screenshots, icons, documents, or diagrams for stations only when they are real evidence rather than decoration.
- **Do not:**
- Forcing external media for stations that are better represented by text/data.
- Using meaningless connector lines just because stations are spatially separated.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`wide spatial map implied → station 1 focus → travel → station 2 focus → … → final station hold`

## Layout guidance
Place stations on an oversized coherent canvas with enough separation for camera travel. Use a clear path, alignment, or connective logic; lines/arrows are optional and should exist only when they clarify relation.

## Temporal progression
1. Establish the first station and path direction.
2. Travel to each next station, revealing only what matters there.
3. Keep enough environmental continuity to preserve orientation.
4. Land on the final station with a deliberate hold.


## Implementation guidance
- Place stations in one coherent spatial model with a clear ordering or path relation.
- Keep enough prior-world context visible or inferable so each move feels like traversal, not a cut to a new slide.
- Give each station a distinct semantic role and a readable dwell.
- Connectors are optional; use path geometry, alignment, shared baseline, or environmental continuity when lines/arrows are unnecessary.
- End at a station whose position and content can naturally become the next scene’s anchor.

### Failure modes
- Represents every station as an identical card connected by a line.
- Movement between stations is decorative and the spatial model has no semantic meaning.
- Stations are so far apart or differently styled that they feel unrelated.
- Connectors imply causality/order not supported by the Storyboard.

### Materialization clarification — conceptual stations are valid
- A station may be a physical location, process stage, decision point, cognitive checkpoint, or causal prerequisite.
- Conceptual stations are valid when they have meaningful order, movement through them represents semantic progression, and they belong to one coherent visual world/path.
- Traversal must add meaning beyond simply arranging labels on a line.
- Failure case: unrelated labels are spaced along a path only to imitate a journey.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
Final station can be the next scene’s starting object or location.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Removed required callout styles, hand-drawn connectors, camera APIs, and cursor-demo coupling. The station/path composition remains.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
