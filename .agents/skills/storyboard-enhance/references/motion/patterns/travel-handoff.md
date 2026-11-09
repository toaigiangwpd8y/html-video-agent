# Travel and hand-off

**Trigger.** Match when a meaningful object travels through a continuous space, crosses a boundary, or transfers focus or identity between regions.

**Compositional purpose.** Establish the connected world, move the viewer or semantic object through the relevant region, then arrive where the consequence can be inspected. A multi-phase journey may establish, travel, and arrive; a viewport change may instead follow one focal object when that is the clearest spatial relation. Make the path clarify cause, continuity, or transfer. When identity must persist, let the receiving state visibly derive from, receive, or replace the traveling object. Reuse an existing layout strategy such as `camera-journey` when cause and consequence occupy regions of one continuous world.

**Failure checks.** Check that travel is legible at the chosen scale; endpoints matter to the story; the path does not obscure evidence; a hand-off does not look like two unrelated copies; and a camera move does not break required object or scene continuity.

**Source lineage.** Renderer-neutral adaptation of `camera-journey`, `viewport-change`, `multi-phase-camera`, and identity-preserving hand-off ideas from `skills/hyperframes-animation/blueprints/camera-journey.md`, `skills/hyperframes-animation/rules/viewport-change.md`, `skills/hyperframes-animation/rules/multi-phase-camera.md`, and `skills/hyperframes-keyframes/references/keyframe-patterns.md` in `heygen-com/hyperframes`; snapshot `main` at `bc1c60ae5b6e599a3caa482052547a5775a52261` (2026-09-23). Runtime-specific camera recipes are excluded.
