# Renderer-neutral motion design

Use this reference during Full Enhance after scene design and asset resolution, once a candidate layout or blueprint is being considered. Motion reasoning helps express the approved visual behavior; it does not select a renderer or prescribe implementation APIs.

## Routing

Read `rules-index.md` first. Load only the matched rule bodies for the scene's intended visual behavior. A scene may match more than one pattern when each contributes a distinct semantic or temporal purpose. Skip unmatched pattern documents.

The five pattern guides cover arrival/stagger, travel/hand-off, reveal/progressive disclosure, causal response/anticipation-impact, and reposition/settle/hold. They describe triggers, compositional purpose, and failure checks in renderer-neutral terms.

## Ownership and runtime

Storyboard Enhance remains the single scene-design and Remotion implementation owner. Keep `video.json` as the only canonical semantic truth and use the existing layout library and selected blueprint as the composition foundation. Motion references add no scene blueprint, workflow stage, director, persisted plan, artifact, agent, or checkpoint.

Select a runtime by the capabilities the chosen choreography needs. GSAP is optional and is never universal or the default. The installed official Remotion skills and documentation own Remotion implementation technique and API choices; motion references do not override them.

### Capability comparison

| Option | Useful when | Constraint |
| --- | --- | --- |
| Remotion-native frame-derived motion | Motion can be expressed directly from the current frame and composition timing, including clear local state changes or simple coordinated arrivals. | Keep outputs deterministic and frame-derived; consult installed official Remotion guidance for APIs and timing details. |
| `@remotion/gsap` | A choreography benefits from a coordinated timeline with several overlapping or staggered elements, and a timeline model makes their relationships easier to author. | Its official integration drives a paused GSAP timeline from the Remotion frame; use only when that capability helps. Before selecting it, inspect the active Remotion project's package manifest (`remotion/package.json` in this repository) and confirm compatibility. Installed official guidance decides supported APIs and implementation details. |

This table lists capabilities currently enabled in this repository; it is not an exhaustive runtime taxonomy. It supports capability selection only. Do not open runtime-specific implementation guidance until after runtime choice. This is not a default rule: do not omit/reduce intended motion to use a simpler API; choose the Remotion-supported runtime that fits. Do not add a dependency automatically.

Source lineage: locally authored renderer-neutral guidance. Discovery structure adapts the distinction between atomic rules and scene-level blueprints, plus trigger/tag-based load-on-demand, from upstream `skills/hyperframes-animation/SKILL.md` and `skills/hyperframes-animation/rules-index.md`. Other references are the paths named by each pattern guide. Upstream snapshot: `heygen-com/hyperframes` `main` at `bc1c60ae5b6e599a3caa482052547a5775a52261` (resolved 2026-09-23).

The `skills/faceless-explainer/references/motion-language.md` source is consulted only for content-aware motion pacing. Its parent `skills/faceless-explainer/SKILL.md` is not an adopted workflow or router: exclude its workflow, artifacts, CLI, frame workers, checkpoints, and approval concepts. GSAP adapter references (`adapters/gsap.md`, `adapters/gsap-timeline-and-labels.md`, `adapters/gsap-easing-and-stagger.md`, `adapters/gsap-transforms-and-perf.md`) were considered only to identify runtime-specific implementation boundaries. No adapter APIs, paused-timeline/registration contracts, or GSAP runtime preference are carried over.
