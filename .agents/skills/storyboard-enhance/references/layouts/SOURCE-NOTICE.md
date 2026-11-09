# Source and license notice

This adaptation is based on the public HyperFrames project by HeyGen (`heygen-com/hyperframes`), especially the scene-blueprint corpus and `skills/hyperframes-animation/blueprints-index.md`, reviewed again on 2026-09-10.

Upstream license: Apache License 2.0. See the upstream repository's `LICENSE` file for the authoritative license text.

Changes in this package: HyperFrames blueprint/story-role information has been condensed and rewritten into renderer-neutral visual-strategy guidance. v1.5 restores semantic story-role and content-slot information that earlier adaptation passes had over-generalized into layout-only guidance, and adds conservative asset implications for post-approval asset planning. HyperFrames-specific runtime, HTML/CSS, GSAP, CLI, exact geometry, and literal UI treatment remain intentionally removed.

`interruption-reentry` and `abstract-to-concrete-timeline` are local composed gap-fill blueprints derived from multiple renderer-neutral HyperFrames ideas; they are not represented as one-to-one upstream blueprint copies. See `MIGRATION_AUDIT_ADDENDUM.md`.
