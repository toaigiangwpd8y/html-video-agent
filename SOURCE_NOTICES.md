# Source notices

## HyperFrames CLI runtime

- Dependency: `hyperframes@0.8.50`, pinned by `hyperframes/package-lock.json`.
- Upstream project: [HyperFrames](https://github.com/heygen-com/hyperframes), Apache-2.0. The license text is retained in [`docs/compliance/HYPERFRAMES-APACHE-2.0-LICENSE.txt`](docs/compliance/HYPERFRAMES-APACHE-2.0-LICENSE.txt).
- The renderer toolchain also includes GSAP and Mediabunny; see [third-party notices](THIRD_PARTY_NOTICES.md) for their licenses.

## HyperFrames-derived layout blueprint adaptations

- Directory: `.agents/skills/storyboard-enhance/references/layouts/`.
- The 22 renderer-neutral blueprint adaptations were prepared from the public HyperFrames blueprint corpus as documented in `MIGRATION_AUDIT.md` and `VALIDATION_REPORT_V1.5.md`; the source tree audited on 2026-09-09 corresponds to upstream commit [`0665249ca9551b8584681dd6f76433f2ff69deb3`](https://github.com/heygen-com/hyperframes/tree/0665249ca9551b8584681dd6f76433f2ff69deb3).
- These files contain renderer-neutral scene guidance adapted from the pinned HyperFrames source. Apache-2.0 license text is retained in [`docs/compliance/HYPERFRAMES-APACHE-2.0-LICENSE.txt`](docs/compliance/HYPERFRAMES-APACHE-2.0-LICENSE.txt).

## Shotcraft source and reference catalog

- `third-party/video-shotcraft/source/` is a selected source/reference snapshot based on [`Vincentwei1021/video-shotcraft`](https://github.com/Vincentwei1021/video-shotcraft) at commit [`43bd349a136651865ecfa6ea1cf012f6e957d304`](https://github.com/Vincentwei1021/video-shotcraft/tree/43bd349a136651865ecfa6ea1cf012f6e957d304). `third-party/video-shotcraft/SOURCE.json` records included paths and current SHA-256 hashes; `.agents/skills/storyboard-enhance/references/shotcraft/catalog.json` maps current cards and variants to cited demo sources.
- Source and adaptations are recorded in `third-party/video-shotcraft/SOURCE.json`; the snapshot retains Apache-2.0 attribution and license terms.

## HyperFrames authoring kit

`hyperframes/kit/` and the new handoff instructions are repository-authored. They do not contain copied HyperFrames Studio code, skills, catalog assets, GSAP code, or third-party motion runtime code.

## Existing Remotion-era materials

- Onda, RemotionUI, and RemotionBits component sources under `remotion/registry/` retain their upstream license references and source mappings in `.agents/skills/storyboard-enhance/references/registry/SOURCE-NOTICE.md`. Keep the corresponding source notice with copied portions.

## Cutroom-derived web capture

The web capture implementation and documentation in `src/web-capture/`, `examples/web-capture/`, `tests/fixtures/web-capture/`, and `.agents/skills/web-app-capture/` adapt selected mechanics and documentation ideas from [Cutroom](https://github.com/ceasarhaddad/cutroom), commit `d7172c353e8e2f51c8b7f75b0370f6a9374e576f`. Source mapping and the MIT license are in [`third-party/cutroom/NOTICE.md`](third-party/cutroom/NOTICE.md).
