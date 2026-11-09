# Vendored registry source notice

These are small, manually curated source closures. They are not a full mirror,
runtime registry, or vendor installation. Every item records its exact upstream
repository, pinned revision, upstream source path, license evidence, copied
support closure, and adaptations here.

## Onda

The Onda items come from `https://github.com/degueba/onda` at exact commit
`3c814051269597b31fee1603bef7ccfb93d091b6`.

License evidence at that revision is the root `LICENSE` (MIT) and root
`package.json` (`"license": "MIT"`). The required attribution and permission
notice for the copied MIT-covered source is preserved below and colocated at
`remotion/registry/onda/LICENSE`. `registry:onda:vendor` copies a matching
`LICENSE` and source notice into each newly materialized Onda component folder.

```text
MIT License

Copyright (c) 2026 Rodrigo Botelho

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Items and exact source paths:

- `onda-blur-reveal`: `registry/components/blur-reveal/BlurReveal.tsx` to
  `remotion/registry/onda/blur-reveal/BlurReveal.tsx`.
- `onda-callout`: `registry/components/callout/Callout.tsx` to
  `remotion/registry/onda/callout/Callout.tsx`.
- `onda-count-up`: `registry/components/count-up/CountUp.tsx` to
  `remotion/registry/onda/count-up/CountUp.tsx`.
- `onda-dynamic-grid`: `registry/components/dynamic-grid/DynamicGrid.tsx` to
  `remotion/registry/onda/dynamic-grid/DynamicGrid.tsx`.
- `onda-image-reveal`: `registry/components/image-reveal/ImageReveal.tsx` to
  `remotion/registry/onda/image-reveal/ImageReveal.tsx`.

The copied Onda support closure is `remotion/registry/onda/shared/`: motion,
canvas placement/size, choreography, grid/glow primitives, and the local
straight-line callout path helper. ImageReveal uses that existing closure for
SPRING_SMOOTH, entry motion, and placement. Its upstream zod schema and
`canvas-schemas` were not copied because zod is not an existing Remotion
dependency; typed props retain the component behavior. The upstream Picsum
default was made an explicit `src` input so rendering does not require a
network request. Imports point only to this local closure or existing
Remotion/React packages.

## RemotionUI

The RemotionUI items come from `https://github.com/riaz37/remotion-ui` at exact
commit `802a63708cc5c13936bcccb47f091a0b14325cb5`.

License evidence at that revision is the root `LICENSE` (MIT), identifying
`Copyright (c) 2026 RemotionUI`. The required notice for copied MIT-covered
source is preserved below and colocated at `remotion/registry/remotionui/LICENSE`.

```text
MIT License

Copyright (c) 2026 RemotionUI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Items and exact source paths:

- `remotionui-counter`: `apps/web/registry/bases/default/primitives/counter.tsx`
  to `remotion/registry/remotionui/counter/counter.tsx`.
- `remotionui-comparison-bars`:
  `apps/web/registry/bases/default/primitives/comparison-bars.tsx` to
  `remotion/registry/remotionui/comparison-bars/comparison-bars.tsx`.
- `remotionui-masked-slide-reveal`:
  `apps/web/registry/bases/default/primitives/masked-slide-reveal.tsx` to
  `remotion/registry/remotionui/masked-slide-reveal/masked-slide-reveal.tsx`.
- `remotionui-split-screen`:
  `apps/web/registry/bases/default/scenes/split-screen/index.tsx` to
  `remotion/registry/remotionui/split-screen/SplitScreen.tsx`.
- `remotionui-transition-wipe`:
  `apps/web/registry/bases/default/primitives/transition-wipe.tsx` to
  `remotion/registry/remotionui/transition-wipe/TransitionWipe.tsx`.

The copied shared closure under `remotion/registry/remotionui/shared/` retains
the scale, timing, motion, and chart helpers used by the three retained
primitives. SplitScreen adapts the upstream safe-area, media-fit, video-source,
and palette helpers locally in its source; it uses existing `@remotion/media`
and Remotion imports. TransitionWipe adapts the upstream timing selection
inline with existing `@remotion/transitions` and Remotion easing APIs. The
upstream font package, project aliases, code-theme module, and unrelated
runtime helpers were not copied; no new dependency was added. The earlier
RemotionUI typewriter candidate was removed from this compact set rather than
retaining another text primitive with unnecessary closure overlap.

## RemotionBits

The retained RemotionBits items come from `https://github.com/av/remotion-bits`
at exact commit `6c71169aa061f15313fadbdc6e29a3a3a87f2c03`.

License evidence at that revision is the upstream `package.json`
(`"license": "MIT"`) and the README `## License` section (`MIT`). There is no
root `LICENSE` file at that revision and no copyright holder is stated in the
inspected license evidence, so no attribution is invented here.

Items and exact source paths:

- `remotionbits-type-writer`: `src/components/TypeWriter.tsx` to
  `remotion/registry/remotionbits/type-writer/TypeWriter.tsx`.
- `remotionbits-staggered-motion`: `src/components/StaggeredMotion.tsx` to
  `remotion/registry/remotionbits/staggered-motion/StaggeredMotion.tsx`.

Their copied closure is `remotion/registry/remotionbits/shared/motion.ts` and
`random.ts`, adapted from the upstream motion/interpolation and random utility
paths. Three/Matrix4/3D, culori, Prism, runtime-package, network, clock, and
other unsupported variants remain rejected. The removed AnimatedText and
AnimatedCounter sources, plus no support file used solely by them, are not
part of this catalog. The retained sources use only existing dependencies and
seeded/frame-driven deterministic behavior.

No vendor CLI was run for any provider. Vendor tooling is isolated and may not
mutate `root.tsx`, `package.json`, or registration.

## Copying and notice retention

The provider-level `LICENSE` files sit beside the Onda and RemotionUI source
trees so the notice travels with a copied provider folder. A user who copies
only a source file must also copy the applicable provider `LICENSE` and retain
the provider source mapping above. RemotionBits has a provider-local
`SOURCE-NOTICE.md` because its inspected upstream revision provides MIT
metadata/README evidence but no root license text or copyright holder; retain
that provenance record with any copied RemotionBits files.
