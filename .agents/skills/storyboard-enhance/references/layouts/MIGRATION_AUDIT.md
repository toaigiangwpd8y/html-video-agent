# Migration audit

## Scope

Audited the complete 22-file blueprint directory exposed by the official HyperFrames repository on 2026-09-09.

## Rewrite policy

### Removed as incompatible with this Remotion-targeted Enhance layer

- HTML/DOM structure requirements.
- HyperFrames `data-*` timing and clip contracts.
- CSS-specific layout/animation recipes.
- GSAP, Anime.js, WAAPI, Three.js, or other HyperFrames runtime adapter instructions.
- HyperFrames CLI commands and build lifecycle.
- Named HyperFrames atomic motion-rule mappings.
- Exact camera API or browser-scroll implementation details.
- Requirements that a visual must be a card, pill, browser frame, device frame, or dashboard container when the semantic pattern does not require it.

### Rewritten because partly compatible

- Camera instructions → semantic spatial-travel or scale-change intent.
- Cursor/UI instructions → causal interaction semantics.
- Scroll instructions → long-surface traversal semantics.
- 3D/card/grid recipes → spatial hierarchy and collection semantics.
- Transition mechanics → continuity or handoff intent only.
- Timing recipes → ordered temporal progression, without engine-specific durations/eases.
- Original product-launch role labels → retained only as descriptive triggers through `best`/`avoid` semantics, not required enums.

### Preserved

- Why a blueprint exists.
- What kind of semantic scene it serves.
- The scene's temporal shape.
- Required relationships between objects/regions.
- What makes it different from neighboring blueprint families.
- Continuity potential.

## High-risk anti-bias adaptations

- `comparison-split`: split cards are no longer mandatory; it is a two-subject balanced comparison family.
- `grid-card-assemble`: renamed conceptually to Collection Assemble inside its content; cards are optional and repeated peers can use grids, lists, walls, clusters, or other fields.
- `titlecard-reveal`: single-card is generalized to a quiet single-focus landing.
- `agent-progress-theater`: cards/pills/checklists are optional representations of state mutation.
- `dataviz-countup`: dashboard/stat-card treatment is optional; metric hierarchy is the semantic invariant.
- `device-surface-showcase`: device/browser frame is optional when the actual surface can be shown more directly.

## Validation performed

- 22 adapted blueprint files generated.
- Every source blueprint id is represented once.
- Catalog families are explicit to support diverse candidate retrieval.
- Forbidden runtime vocabulary is checked separately for blueprint bodies.
