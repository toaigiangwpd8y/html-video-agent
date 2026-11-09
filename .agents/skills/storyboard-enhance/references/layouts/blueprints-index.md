# Renderer-neutral blueprint index

This package adapts all 22 upstream HyperFrames scene blueprints plus 2 **local composed gap-fill** blueprints (`interruption-reentry`, `abstract-to-concrete-timeline`). HyperFrames defines blueprints as reusable product-agnostic, time-coded shot shapes with semantic slots; v1.5 restores that scene-design meaning while keeping renderer/runtime specifics removed.

## What this index is for

The approved scene decides what must be communicated; a blueprint supplies a proven way to organize that meaning visually. Never use a blueprint name to invent the story.

## Full Enhance order

Full Enhance reasoning order: scene design → asset resolution → candidate layout/blueprint → motion reasoning → bounded `KEEP`/`ADAPT`/`SWITCH` → final layout confirmation → runtime choice → implementation.

1. Derive a **scene signature** from story job, evidence, important relationships, temporal shape, and required continuity. This is semantic scene intent only; do not choose a final blueprint yet.
2. Convert semantic roles into asset requirements. A role may be fulfilled by approved text, verified data, generated graphics, sourced media, or existing captures. **Do not search media merely to fill a role.** Classify external media need as `none`, `conditional`, or `required`; search/reuse/generate only after that decision.
3. Acquire and validate only actual materialized files. If a source document is not directly renderable, create a truthful derivative and retain provenance. Register materialized assets through `assets/manifest.json` with provenance, scene binding, and concise semantic role.
4. After asset inspection, retrieve at least 3 candidates from materially different `family` values using this index or `catalog.json`. Retrieval is not selection. Choose by semantic fit, read the complete selected blueprint file, and instantiate its `Semantic content roles`.
5. Read the selected blueprint's `Implementation guidance`, `Failure modes`, and materialization test before coding. The selected renderer owns exact geometry and transition technique. For Remotion, follow official Remotion runtime guidance; for HyperFrames, use the repository-owned HTML/CSS kit.
6. Re-check blueprint and asset fit as `KEEP`, `ADAPT`, or `SWITCH`. If a truly required asset cannot be obtained and the selected strategy is no longer executable, load at most one alternate blueprint that preserves the same approved meaning. Do not silently rewrite the story around whatever asset happens to be available.

### Context rule

Do not preload all blueprint bodies. In Full Enhance, read the compact index/catalog after asset reasoning, then **one selected full blueprint per scene**. Read at most one alternate full blueprint when real asset feasibility invalidates the first choice.

### Asset-planning rule

Asset planning is internal production reasoning, not a new semantic artifact. Do not create `asset-plan.json`, `scene-strategy.json`, or another source of truth. When actual acquisition occurs, register only materialized final assets through `assets/manifest.json` with provenance, scene binding, and concise semantic role.

## Separate bounded Scene-design / asset probe

An explicitly requested probe may derive a scene signature and provisional layout/asset options before Full Enhance. For every non-trivial scene in this bounded probe mode, derive semantic intent and shortlist candidates only to answer the probe. It is bounded exploration only: do not load motion guidance, acquire production media, author a renderer project, or carry a provisional blueprint forward as the final choice. Full Enhance starts with semantic scene design and resolves assets before selecting its candidate blueprint.

## Materialize the selected blueprint

After asset resolution and blueprint selection, use that blueprint to decide spatial hierarchy, relationships, temporal development, and continuity. Asset availability may change crop, representation, or exact layout, but must not silently replace the blueprint's semantic content roles.

A blueprint is not considered used merely because its id appears in a source comment. Its defining composition and temporal invariants must be recognizable in the final composition. Shared branding/theme primitives may remain consistent, but they must not impose the same title/panel/shell hierarchy on every scene.

## Global materialization rules

These rules validate how a selected blueprint is realized. They do not create a separate planning artifact or renderer layer.

### 1. Materialize the semantic evidence object

Animation around an object does not count as materializing a blueprint if the semantic evidence object itself does not change as required.

If the blueprint describes editing, interruption, accumulation, transformation, comparison, expansion, recovery, or state change, that behavior must occur on the actual evidence object. Labels, cursors, controls, highlights, and decorative motion are secondary evidence.

Bad: `final target already visible → labels/controls animate around it`.

Good: `source state → meaningful event/action → target visibly mutates → new state becomes inspectable`.

### 2. Temporal invariants must happen in time

If a blueprint's semantic shape is `A → B → C`, the important states must be temporally distinguishable in the implementation. Do not collapse a temporal sequence into `[A] [B] [C]` shown simultaneously while only decoration changes.

A temporal blueprint is materialized only when the viewer can observe the meaningful state transitions in the rendered timeline.

### 3. Narrated temporal coverage

For narrated scenes, distribute meaningful visual state changes across the
spoken progression rather than completing the full semantic animation early.

When narration introduces multiple successive ideas, relationships, states,
or consequences, let the visual state evolve when those ideas become relevant.
Do not reach the final semantic visual state while materially related narration
is still continuing.

A final hold is useful for comprehension, but it should follow the last
meaningful visual/narrative development rather than replace a large remaining
portion of the scene.

This does not require constant motion. Static dwell is valid when the viewer
is inspecting the current evidence or no new visual meaning is being introduced.

### 4. Transformation must preserve identity

When a blueprint describes `A → transformed/recontextualized A`, the viewer must be able to recognize that the later state derives from the earlier one. Preserve enough identity through geometry, position, landmarks, ordering, color identity, a persistent object, a shared axis, or a visible transformation path.

Using the same React component or data source is not sufficient by itself. The visual inheritance must be perceptible.

During an identity-preserving transformation, do not simultaneously expose both a source/migrating object and an independently rendered destination copy in a way that makes the viewer see two instances of what should be one semantic object. The destination should emerge from, receive, replace, absorb, or visibly inherit the migrating object without ambiguous duplication. Temporary overlap is allowed only when it clearly communicates handoff rather than two co-existing identities.

### 5. Cross-scene semantic continuity outranks local blueprint validity

A scene can correctly realize its selected blueprint locally and still be wrong if it breaks a semantic object that the Storyboard requires to continue from an adjacent scene. When such continuity is required, preserve, transform, extend, or visibly derive the new state from the existing semantic object.

Preserving only the same meaning is not sufficient when the Storyboard requires the actual evidence object/state to continue. A newly redrawn symbolic substitute does not satisfy object continuity merely because it communicates the same idea. The implementation should preserve the actual visual object/state, or make its transformation into the next representation visibly traceable.

### 6. Shared style must not become a universal composition shell

Palette, typeface, brand tone, visual texture, and small reusable primitives may stay consistent. They must not automatically force every blueprint into the same eyebrow, headline location, accent line, content frame, card/panel structure, progress decoration, or composition margins.

Different blueprint families should remain materially distinguishable in hierarchy, spatial organization, focal structure, temporal organization, and object relationships.

### 7. Blueprint success requires a materialization test

Before accepting a scene, verify:

1. What is the selected blueprint's defining invariant?
2. What semantic object carries the evidence?
3. What state or relationship must visibly change?
4. Does that change happen on the evidence object itself?
5. Does the implementation hit any documented Failure Mode?
6. Does it preserve required continuity with adjacent scenes?

Use `YES`, `PARTIAL`, or `NO`. A `LAYOUT_BLUEPRINT` comment is trace evidence only. If the result is `NO`, revise before render. If it is `PARTIAL`, revise when the missing invariant materially affects the semantic or visual role of the blueprint.


## Compact catalog

The first 22 entries are renderer-neutral adaptations of upstream HyperFrames blueprints. The final two are local gap-fill compositions documented in `MIGRATION_AUDIT_ADDENDUM.md`. `External` means whether external media is normally necessary; it does **not** mean every semantic role is an image/video slot.

| Blueprint | Family | General story roles | External | Strongest trigger |
|---|---|---|---|---|
| `agent-progress-theater` | state-progression | process-state, machine-working, progression, multi-step-result | `conditional` | machine/agent work must be visible over time |
| `camera-journey` | spatial-traversal | cause-effect, mechanism, spatial-explanation, cinematic-reveal | `conditional` | cause and consequence live in different regions of one continuous world |
| `comparison-split` | comparison | comparison, before-after, paired-concepts, tradeoff | `conditional` | exactly two concepts/assets/states have equal weight |
| `constellation-hub` | hub-spoke | ecosystem, hub-and-spoke, relationship-map, integration, … | `conditional` | one core connects many peers |
| `cta-morph-press` | same-anchor-transform | action, single-widget-demo, focused-closing, micro-interaction | `conditional` | one identity/state should become one action at the same focal anchor |
| `cursor-ui-demo` | interaction-demo | workflow-demo, interaction, before-after-state, software-mechanism | `required` | a visible user interaction is the causal actor |
| `dataviz-countup` | data-focus | quantitative-evidence, trend, comparison, metric-proof, … | `conditional` | numbers/charts are the evidence |
| `device-surface-showcase` | surface-hero | product-tour, surface-showcase, workflow-overview, artifact-tour | `required` | a product/page/device surface itself is the evidence |
| `fixed-anchor-cycle` | fixed-anchor | breadth, variation-around-constant, compatibility, roll-call, … | `conditional` | one identity/statement must stay constant while surrounding examples vary |
| `grid-card-assemble` | collection | collection, breadth, enumeration, portfolio, … | `conditional` | many peers must accumulate into one collection |
| `kinetic-type-beats` | typography | hook, problem, claim, explanation, … | `none` | words/phrases themselves carry the argument |
| `logo-assemble-lockup` | identity-assembly | identity-reveal, brand-lockup, closing | `conditional` | a mark/identity must come into existence or resolve from prior material |
| `overwhelm-surround` | accumulation | problem, overload, pressure, fragmentation | `conditional` | the problem is too many tools/windows/alerts/items |
| `panel-edit-live-sync` | coupled-regions | cause-effect, live-edit, control-result, parameter-explanation | `conditional` | one control change must visibly cause another surface to update |
| `prompt-type-submit-generate` | prompt-response | input-output, AI-mechanism, query-result, command-response | `conditional` | a typed ask is causally important |
| `spatial-pan-stations` | station-traversal | timeline, journey, process, multi-step-explanation, … | `conditional` | milestones/steps/concepts can live at distinct spatial stations |
| `ticker-takeover` | takeover | option-rejection, reframing, decisive-reveal, identity-payoff | `conditional` | several possibilities should be rejected/replaced by one decisive hero |
| `titlecard-reveal` | quiet-landing | breather, section-title, single-claim, proof-hold, … | `none` | the video needs a breather or landing beat |
| `transcript-scroll-artifact-reveal` | long-surface | evidence-to-artifact, document-traversal, process-proof, research-result | `conditional` | a long transcript/feed/document is evidence of work |
| `typewriter-reveal` | typed-text | hook, authored-thought, prompt-like-idea, closing | `none` | the act of typing is itself relatable or meaningful |
| `video-text-pivot` | media-handoff | evidence-to-interpretation, media-to-claim, demo-to-impact | `required` | a video/image/demo should yield to a metric or statement without disappearing immediately |
| `zoom-out-workspace-reveal` | nested-reveal | recontextualization, scale-reveal, detail-to-system, mystery-to-context | `conditional` | a close-up detail gains new meaning when revealed inside a larger whole |
| `interruption-reentry` | interruption-reentry | interruption, context-loss, recovery, process-continuity | `conditional` | one continuous process is interrupted and later resumed |
| `abstract-to-concrete-timeline` | representation-handoff | abstract-to-concrete, timeline, example, representation-handoff, … | `none` | an abstract duration/timeline becomes a concrete schedule or calendar |
