# Remotion Authoring Contract

This repository-owned contract describes the selected Remotion adapter. It does not copy or install an upstream agent skill.

## Inputs and ownership

- Read the approved root `video.json` and `assets/manifest.json` first. The harness snapshots both under `remotion/generated/` and copies approved local assets into `remotion/public/assets/`.
- `video.json` owns scene meaning, exact visible/spoken copy, constraints, and sequential integer frame budgets. The active Production Profile supplies viewer priorities.
- Do not create or edit root `SCRIPT.md`, `STORYBOARD.md`, `frame.md`, `theme.json`, or another semantic source. Write the React composition in `remotion/generated/Video.tsx` and renderer timing evidence in `remotion/generated/timeline.json`.

## Composition rules

- Bind every canonical scene exactly once and preserve its order and frame budget. Resolved overlaps belong in the renderer timeline and must retain canonical scene identities.
- Use only assets present in the prepared local asset manifest. Resolve paths through the project asset manifest; do not use remote URLs, CDN resources, or unapproved files.
- Preserve canonical copy verbatim. Meaningful text, narration, or claim changes return to the approved Storyboard and create a new canonical revision.
- Keep Remotion source and generated assets inside `remotion/`. Do not write HyperFrames HTML or Studio project files from this adapter.
- Mark the root element of every scene with `data-scene-id="<canonical scene id>"`. The layout lint attributes findings and coverage to scenes through that marker; a composition with no markers reports `NOT_EVALUATED` instead of a clean verdict.
- Mark intentional layout exceptions with the shared opt-out attributes: `data-layout-allow-overlap` (deliberate text layering), `data-layout-allow-occlusion` (an element is meant to cover text), `data-layout-allow-connector-overlap` (a connector is meant to cross a node), `data-layout-allow-overflow` (intentional travel outside a box), `data-layout-ignore` (decorative, never audited). Mark the narrowest owning element, never a scene or root wrapper.
- Produce the candidate implementation manifest required by the Remotion harness. Bind it to `videoProjectHash`, list all generated files, and map each scene to its source file and approved assets.

## Studio editing structure

- For new authored compositions, structure JSX around the logical items a person should select, move, trim, style, duplicate, or delete independently. Give each independently editable instance a literal, descriptive `name`; put its timing and appearance inline at that instance. Reuse a component implementation while keeping independently controlled instances as separate JSX nodes.
- Keep layout containers, shared backgrounds, and decorative internals as plain elements inside the owning editable unit. Use an `Interactive` element when the container itself needs independent controls. Use `Interactive.create()` for reusable components that need editable props at their call sites; declare each exposed schema field with a default and description.
- Keep editable style and timing values at the instance call site. Only the timing and appearance fields intentionally exposed by the component contract are user-editable; computed internals, derived layout, and helper animation values remain implementation details. Do not imply that Studio can edit a value that is not exposed by the component/schema.
- Write separate JSX instances when items need independent edits. A `.map()` is appropriate for output intentionally controlled as one generated group, such as particles or repeated chart marks; write each instance explicitly when each card, caption, or other item needs its own name, timing, or appearance controls. Do not flatten every animation/helper into its own item or create a track for each decorative detail.
- Keep connected composition registration in `generated/Compositions.tsx` as `GeneratedCompositions: React.FC`. Use unique IDs other than `MainVideo`, standalone metadata, and the same scene component reference used in the parent composition. Keep this extension and all referenced sources under `generated/`; the source hash and manifest must include them. Preparing a new Remotion project creates a blank extension when needed and preserves authored registrations. Use `renderer revise` before authoring a new revision of a rendered or finalized workspace.
- Keep canonical copy verbatim and treat it as read-only renderer input. Text displayed by a fixture must come from canonical production data; a screenshot is a single bitmap layer, not independently editable source text.
- Preserve approved voice-over at natural playback rate `1.0` and schedule its full measured interval. Keep the scene interval large enough to cover the complete approved voice segment; do not trim, time-stretch, or fit narration to a visual edit.
- Imported templates that preserve their original source can remain intact without a deep rewrite into independently editable JSX. Describe their real editing limits accurately: opening a template in Studio does not by itself make its internals independently editable.

The repository's implementation guidance is paired with the installed official `remotion-interactivity` skill and its `timeline-structure.md`. Follow both when authoring new Studio-editable structures; this contract does not replace upstream API guidance.

## Review and delivery

- Run `video renderer check`. It runs typecheck, refreshes boundary still evidence, and measures the rendered composition at scene boundary and midpoint frames with the deterministic layout rules (overlapping text, an object painted over text, a connector drawn across a node, content outside the canvas, clipped copy, copy under the legibility floor, unready fonts/images, canonical copy parity). Findings are written to `.video/layout-lint.json` and the command exits non-zero unless the status is `PASS`.
- Fix every reported finding and re-run until `PASS`; do not advance to review with `FAIL` or `NOT_EVALUATED`. Use `video renderer check --scene <scene-id>` while iterating on one scene, and `--strict` to treat warnings as errors.
- Inspect the local Remotion Studio preview before asking for human approval. Do not re-derive geometry by eye that the lint already measured.
- Visual approval binds to the generated-source hash. Any source change requires a fresh check, preview, and host approval.
- Final rendering is blocked until the host records approval for the current hash. Finalization validates boundary evidence, the implementation manifest, and MP4 metadata.
- Keep Studio local. Do not use Remotion cloud or Lambda rendering in this repository workflow.
