# v1.3 Materialization hardening

This patch is based on the second end-to-end Remotion materialization experiment. It does not add a renderer, selector, planner, or production wiring.

## Global changes

Added six post-selection materialization rules to `blueprints-index.md`:

1. mutate the actual semantic evidence object;
2. make temporal invariants observable in time;
3. preserve visual identity through transformation;
4. preserve Storyboard-required cross-scene semantic continuity;
5. prevent shared visual style from becoming a universal composition shell;
6. perform a YES/PARTIAL/NO materialization test before accepting a scene.

## Blueprint-specific clarifications

- `kinetic-type-beats`: typography itself must carry meaningful temporal change.
- `fixed-anchor-cycle`: anchor can transform for a handoff after the stable cycle is established.
- `interruption-reentry`: distinct Storyboard interruptions must remain distinct temporal events.
- `panel-edit-live-sync`: each edit must visibly mutate the persistent target; controls alone are insufficient.
- `abstract-to-concrete-timeline`: visual inheritance must be perceptible; component reuse or a binary mode switch alone is insufficient.
- `spatial-pan-stations`: conceptual/cognitive stations are valid if traversal carries semantic order rather than decorative spacing.

## Unchanged

- all 24 blueprint families and selection semantics;
- renderer-neutral ownership boundary;
- no HyperFrames runtime, HTML/DOM, GSAP, or Remotion API mandate;
- no intermediate layout plan or composition artifact.
