# v1.4 materialization clarification audit

This patch does not add or remove blueprint families. It tightens two renderer-neutral materialization invariants found in the v1.3 E2E test.

## 1. Identity-preserving transform without ambiguous duplication

Problem observed: during abstract-to-concrete handoff, a moving/source landmark could remain visible while an independently rendered destination copy was already present, creating two visible instances of what should read as one semantic object.

Patch:
- Global transformation rule now forbids ambiguous source + destination duplication during identity-preserving handoff.
- `abstract-to-concrete-timeline` requires the destination to receive, replace, absorb, or visibly inherit the migrating landmark.

## 2. Actual object continuity, not semantic equivalence only

Problem observed: a landing scene could preserve the same meaning while redrawing a new symbolic block, even when the Storyboard required the inherited evidence object itself to remain visible.

Patch:
- Global cross-scene continuity rule now distinguishes same meaning from same evidence object/state.
- `titlecard-reveal` now requires preservation or visibly traceable transformation of inherited evidence when Storyboard continuity requires it.

## Scope

No new blueprint, selector, runtime, renderer API, coordinate recipe, or visual style preference was added.
