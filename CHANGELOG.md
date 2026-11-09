# Changelog

## Unreleased — deterministic layout lint

- `video renderer check` now runs a deterministic layout lint after typecheck/evidence, writes `.video/layout-lint.json`, and exits non-zero unless the status is `PASS`; `--scene <scene-id>` focuses one scene and scopes coverage to it, so a clean focused re-check can pass while unfixed scenes stay flagged on a full run; `--strict` treats warnings as errors. `video renderer review` refuses to open the human checkpoint while the lint is `FAIL` or `NOT_EVALUATED`.
- Hardcoded rules (one pure module each, in `src/lint/rules/`): `text_overlap`, `object_over_text`, `connector_over_node`, `out_of_frame`, `text_clipped`, `text_too_small`, `asset_not_ready`, `copy_parity`. Adding a check means adding a module plus one registry line.
- Remotion: a harness-owned `@remotion/player` page is driven by `playwright-core`; the shared in-page extractor (`remotion/core/lint-extract.ts`) infers roles from the rendered DOM at sampled scene frames, so authored code needs no lint annotations.
- HyperFrames: the pinned CLI's previously discarded `lint`/`runtime`/`layout`/`motion`/`contrast` findings are now normalized into the same issue contract, and a harness probe adds the rules the CLI is blind to (a connector drawn across a node).
- Opt-outs are shared across renderers: `data-layout-allow-overlap`, `data-layout-allow-occlusion`, `data-layout-allow-connector-overlap`, `data-layout-allow-overflow`/`data-layout-bleed`, `data-layout-ignore`. Remotion scene roots must carry `data-scene-id` for scene attribution; a composition with no markers reports `NOT_EVALUATED` instead of a clean verdict.
- Removed the model-side scene-by-scene mechanical self-audit from the Storyboard Enhance and slide-to-video skills; the lint report is the mechanical verdict and only semantic checks remain in the model's bounded self-check.

## Unreleased — derived design tokens and registered fonts

- Renderer sync now emits `remotion/generated/theme.ts`, `remotion/generated/fonts.ts`, and `remotion/generated/motion.ts`, so color and typography come from one harness-owned token module instead of being re-declared per scene.
- Canonical `meta.theme` gains optional `mode` (`dark` default, or `light`) and optional `roles` (`page`, `text`, `accent`, each a palette color). Pinned roles are used as given; unpinned roles are measured by luminance, contrast, and OKLab chroma, so light-canvas videos are expressible and palette order does not affect the result.
- The derived tokens publish neutral `--video-*` custom properties plus `--onda-*` aliases, letting the vendored Onda family theme itself without source edits. Prop-driven vendored components receive `theme.*` through their props.
- Motion rhythm (`DURATION_IN_FRAMES`, `STAGGER_IN_FRAMES`, `EASING`, `SPRING`, ...) moved to `generated/motion.ts` as optional defaults; Remotion keeps temporal freedom.
- Font tokens are CSS stacks with a generic fallback; generic families such as `sans-serif` no longer raise `THEME_FONT_UNBOUND`.
- Low-contrast, single-color, light-mode mismatch, and unbound-font situations are reported as `THEME_*` warnings by `video remotion prepare` and annotated in the generated module.
- `assets/manifest.json` supports project-level font assets (`role: "font"` with `family`/`weight`/`style`), validated by signature and registered through `@remotion/fonts` at import.
- Backlot shows the resolved theme (swatches, roles, contrast, warnings) on the Storyboard review and Canonical Project pages, and previews registered font assets.

## Unreleased — simplified pre-production flow

- Simplified pre-production to a mandatory clarification assessment (zero questions when clear), approved Video Brief, frozen Production Profile, one complete Script with one bounded self-check, Storyboard review, and automatic canonical promotion.
- Kept creative exploration and self-review internal to the external agent; the harness persists only request-bound checkpoint artifacts.
- Storyboard host approval now validates and promotes the exact reviewed project to `video.json`, creates revision 1/preflight state, and invalidates renderer-derived state.
- Request content remains replaceable before Production Profile and freezes with the profile's request/brief/clarification/skill bindings.

## 0.21.0 — canonical semantic contract

- Canonical `video.json` has exactly `meta` and `scenes` at the top level.
- Added discoverable production profiles with request-specific Success Definition, Creative Guidance, Self-review Guidance, Development Guidance, and Renderer Guidance.
- Added deterministic frame-budget, optional-audio, asset-resolution, schema-equivalence, and Remotion handoff coverage.
- Preserved Remotion implementation freedom and the host-owned HITL boundary.
