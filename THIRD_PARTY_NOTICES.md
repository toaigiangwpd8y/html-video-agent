# Third-party notices

## License scope

The MIT License in [LICENSE](LICENSE) applies to original project-authored code and documentation, except where a path or file identifies a separate license. Third-party components retain their own terms.

Third-party source and packages remain under their own licenses and terms. Keep the notices and license texts identified below and in [SOURCE_NOTICES.md](SOURCE_NOTICES.md) and the registry's [source notice](.agents/skills/storyboard-enhance/references/registry/SOURCE-NOTICE.md) when copying or redistributing those portions.

## Copied and adapted source

- **Onda and RemotionUI:** selected component and helper source under `remotion/registry/` retains inspected upstream MIT notices. The registry source notice records exact repositories, revisions, paths and modifications; provider-local license files retain the MIT text.
- **RemotionBits:** selected source under `remotion/registry/remotionbits/` follows the upstream MIT license declaration. Retain its [source notice](remotion/registry/remotionbits/SOURCE-NOTICE.md) and registry source mapping.
- **App Explorer package:** `packages/app-explorer/` has its own MIT license and copyright notice in `packages/app-explorer/LICENSE`; retain it as-is.
- **Video Shotcraft:** selected source code under `third-party/video-shotcraft/source/` is from the Apache-2.0 upstream snapshot. Source mapping and license information are in `third-party/video-shotcraft/SOURCE.json` and the source directory.
- **HyperFrames layout references:** adapted renderer-neutral blueprint guidance under `.agents/skills/storyboard-enhance/references/layouts/` is documented in `SOURCE_NOTICES.md`, with the upstream revision and Apache-2.0 provenance.
- **Cutroom:** selected capture mechanics and documentation ideas were adapted into `src/web-capture/`, `examples/web-capture/`, `tests/fixtures/web-capture/`, and `.agents/skills/web-app-capture/`. Source mapping and MIT license text are in [`third-party/cutroom/NOTICE.md`](third-party/cutroom/NOTICE.md).

## Remotion

This repository uses the following Remotion packages from npm:

- `remotion`
- `@remotion/cli`
- `@remotion/bundler`
- `@remotion/fonts`
- `@remotion/gsap`
- `@remotion/media`
- `@remotion/player`
- `@remotion/transitions`
- `gsap` (Remotion project direct dependency)

Remotion source and license information:

- Repository: <https://github.com/remotion-dev/remotion>
- License: <https://github.com/remotion-dev/remotion/blob/main/LICENSE.md>

Use of Remotion is subject to its [license terms](https://raw.githubusercontent.com/remotion-dev/remotion/v4.0.538/LICENSE.md), including eligibility and derivative-work terms. This repository's MIT License does not relicense Remotion.

GSAP is governed by its [Standard License](https://gsap.com/community/standard-license/).

## Other dependencies

Direct and transitive npm dependencies retain their own licenses and notices. The direct dependency manifests and lockfiles are:

- [package.json](package.json) / [package-lock.json](package-lock.json)
- [remotion/package.json](remotion/package.json) / [remotion/package-lock.json](remotion/package-lock.json)
- [hyperframes/package.json](hyperframes/package.json) / [hyperframes/package-lock.json](hyperframes/package-lock.json)

Backlot's Markdown preview bundles these direct dependencies and their license texts under `dist/src/backlot/web/vendor/`:

- `marked` 18.0.5 — MIT
- `dompurify` 3.4.17 — MPL-2.0 or Apache-2.0

Before redistributing a build or product, review the applicable dependency notices and the license terms of the exact versions installed from these lockfiles.

## HyperFrames Studio bundle

The repository uses HyperFrames under its upstream Apache-2.0 license. GSAP and Mediabunny retain their separate licenses.
 
## OpenMontage architectural reference

The Backlot live observer dashboard (`src/backlot/`) draws on the living storyboard and HITL observation concept in [OpenMontage](https://github.com/calesthio/OpenMontage).
