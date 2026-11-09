---
id: constellation-hub
name: Hub and Satellites
family: hub-spoke
status: adapted-renderer-neutral
source_project: heygen-com/hyperframes
---

# Hub and Satellites

## Intent
Satellites establish around hub → relation becomes obvious → converge, orbit, or focus toward hub → hold on core.

## Choose when
- one core connects many peers.
- ecosystem/integration/central-platform relationships.
- the center must become the final focus.

## Avoid when
- relationships are sequential rather than radial.
- there is no meaningful central entity.
- many nodes would become unreadable.

## Semantic requirements
- one central semantic anchor.
- multiple related satellites.


## Narrative roles
- **Upstream HyperFrames role coverage:** `hook`, `social_proof`, `cta`
- **Generalized story roles:** `ecosystem`, `hub-and-spoke`, `relationship-map`, `integration`, `central-idea`
- **Story job:** Show one anchor as the organizing center of multiple related peers or dependencies.

These roles are retrieval hints, not a story generator. Story truth decides whether the scene exists; the blueprint only supplies a proven visual storytelling shape for that already-approved semantic job.

## Semantic content roles
- **`hub` — required.** The central concept/entity that owns the relationship.
- **`satellites` — required.** Multiple peer entities related to the hub.
- **`relationship_meaning` — required.** Why the satellites belong around this hub.
- **`labels_or_evidence` — optional.** Evidence clarifying a satellite when identity alone is insufficient.
- **`payoff` — optional.** A resolved central claim or CTA when appropriate.

Content roles are semantic slots, not components. A role may be realized by text, data, a generated graphic, a sourced image/video, an existing product capture, or another truthful representation. Do not turn roles into cards/panels by default.

## Asset implications
- **External media:** `conditional`.
- **Required content/evidence:**
- A real central entity plus multiple legitimate related entities.
- **Preferred source material when useful:**
- Logos, icons, portraits, product marks, or evidence thumbnails when exact identity matters.
- **Do not:**
- Inventing integrations/relationships.
- Using arbitrary decorative icons as satellites.

These asset implications are a renderer-neutral local derivation from the blueprint semantics and upstream role/slot guidance, not a verbatim HyperFrames asset schema.

Asset planning happens after semantic strategy selection. First decide what evidence each role needs; only then search/reuse/generate media. Do not fetch an asset merely because a slot could contain media. If text/data/generated geometry communicates the role better, external media is not required.

## Semantic shot shape
`satellites establish around hub → relation becomes obvious → converge, orbit, or focus toward hub → hold on core`

## Layout guidance
Keep the hub visually stable and give satellites enough separation to read as independent peers. A ring is common but not mandatory; clustered arcs or radial groups are valid if the center remains unmistakable.

## Temporal progression
1. Establish the surrounding entities.
2. Reveal their relation to one core.
3. Increase focus on the center through convergence, de-emphasis, or spatial emphasis.
4. Resolve with the core owning the frame.


## Implementation guidance
- Keep the hub continuously identifiable while satellites establish their independent identities.
- Place satellites so their relation to the hub is readable without requiring connector lines by default.
- Use convergence, de-emphasis, grouping, or shared motion to make the central relationship increasingly obvious.
- Preserve peer status among satellites unless evidence establishes hierarchy.
- Resolve with the hub as the semantic owner of the frame, not merely the geometric center.

### Failure modes
- A radial diagram is drawn automatically even when relationships are not radial.
- Connector lines become clutter or imply unsupported one-to-one relationships.
- Satellites collapse into identical badges/icons with no meaningful identity.
- The hub is centered visually but has no stronger semantic role.

**Materialization test:** after implementation, the selected blueprint must be recognizable from the composition and temporal behavior even if the `LAYOUT_BLUEPRINT` annotation is removed. Recording the blueprint id without materially realizing its invariants does not count as using it.

## Continuity
The hub is a strong persistent object for scene-to-scene handoff.

## Enhance ownership
The approved Storyboard owns meaning, evidence, semantic relationships, and semantic order. Any presentation wording in the Storyboard is a non-binding suggestion unless changing it changes meaning. Enhance owns the final geometry, placement, crop/mask treatment, object arrangement, motion technique, transition technique, and within-scene timing realization.

This blueprint is a candidate, not a command. Retrieval must not equal selection. Compare it with materially different layout families before choosing it for a non-trivial scene.

## Adaptation notes
Removed required camera push, cursor collapse, depth-of-field, orbit implementation, and named motion rules. Radial semantics remain.

## Source attribution
Adapted from the public HyperFrames scene-blueprint corpus (heygen-com/hyperframes, skills/hyperframes-animation/blueprints), audited 2026-09-10. This adaptation preserves renderer-neutral scene-shape ideas and intentionally removes HyperFrames runtime/implementation contracts.
