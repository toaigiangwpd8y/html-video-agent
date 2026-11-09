# Shotcraft source catalog

This index is based on upstream `43bd349a136651865ecfa6ea1cf012f6e957d304`. It contains 124 current cards and 150 nested variants from that snapshot. The inventory and current per-file SHA-256 values are recorded in [`SOURCE.json`](../../../../../third-party/video-shotcraft/SOURCE.json). Fifty-one upstream PNG screenshot textures were replaced by deterministic project-generated abstract textures; for those entries, `SOURCE.json` preserves both the generated-file hash and the upstream hash. The root `LICENSE` is a convenience duplicate of the inventoried `source/LICENSE`.

`catalog.json` preserves upstream card descriptions and categories, maps every card to its exact reference paths, and records demo entry paths explicitly named by the card reference. Variants are marked `card_reference` because upstream references do not consistently assign a separate TSX component to each preview variant; each carries the card's cited demo set and its recursively resolved relative-import closure. Paths are checked against the imported snapshot; they are not derived from card IDs or slugs.

The snapshot retains project-generated abstract textures at the demo and Ink Press template fixture paths for compatibility. It excludes audio binaries, preview/showcase video, retired demos, workbench, publish tooling, and Jianying export tooling. Fixture textures are not target-product evidence and are not registered in the production asset manifest. They contain no copied upstream screenshot pixels and do not imply target-product styling.

The optional Ink Press example is in [`template/`](../../../../../third-party/video-shotcraft/source/template/). It is a complete source example, not a default treatment or a set of nine separate films; `template/src/themes/` contains its theme variants.

## Use in Storyboard Enhance

Shotcraft is an optional Remotion source reference. Use it after semantic scene intent, asset resolution, and final blueprint confirmation:

1. **Start from the approved scene.** Identify the visual job, evidence, temporal change, selected renderer, and canonical frame budget. Inspect actual production assets before selecting a shot.
2. **Search or honor an explicit choice.** Search the compact index for a visual job, or inspect the exact card ID/variant the user named. An explicit choice remains the request when it fits the approved scene and current gates; catalog rank does not replace it.
3. **Inspect the exact source.** Read the card/reference and selected demo source, check its variant mapping, inputs, constraints, duration, original suitability, and full dependency closure. Do not guess a demo from a slug or variant order. When a card maps several demos, explicitly choose one from its documented set.
4. **Record the bounded decision:** `USE <id>`, `ADAPT <id>`, or `NONE`. Keep the upstream motion and timing arc. ADAPT only for necessary imports, local media, canonical input bindings, and selected-scene integration. If the exact canonical wording or scene budget cannot fit without rewriting copy or changing motion, document the mismatch and choose another source or NONE.
5. **Bind the target inputs.** Use canonical text keys and palette tokens, plus approved local assets by manifest ID, scene, and role. Materialize the selected source/dependency closure only under `remotion/generated/`; this keeps it under existing source-hash and host-review checks. Shotcraft supports Remotion only and never selects or switches the renderer. HyperFrames scenes stay in their selected HTML/CSS workspace.
6. **Run existing checks and review.** Continue the existing renderer check, human review, and render path. Shotcraft adds no checkpoint, does not edit semantic `video.json`, and cannot approve its own output.

Ink Press is a complete optional film example, not a default treatment for high-energy SaaS. Its palette, holds, sound cues, taste, and pacing describe that example only. Do not globally apply slow holds, alter a high-energy brief to match it, or adopt upstream autonomous approval/reviewer workflows.

## UI evidence and derivatives

If the approved scene needs authentic product UI evidence, use the existing [web-app-capture skill](../../../web-app-capture/SKILL.md) in Storyboard Enhance Phase 2. Follow its authorization, configured-app, probe, recipe, postcondition, local-file, provenance, manifest binding, and existing HITL/preflight requirements. Do not launch a Puppeteer capture-template from the upstream repository, write directly around the asset gate, or add automatic browser discovery.

A screenshot can establish visible UI state, but not motion, latency, or automation. An element cutout or crop is a derivative of a source screenshot: keep the source identity/hash and derivative operation in provenance, preserve meaningful labels and context, and register the final local file under the existing asset contract. Layout metadata can guide a code-authored illustration; label it as a derivative, keep labels/states grounded in approved UI evidence, and bind any materialized media through the same asset gate. New meaningful copy/state must already be in canonical `video.json` or return through Storyboard revision.

## Sound design and audio rights

Shotcraft source notes about sound design, SFX placement, music beats, or sync are technical timing references. This snapshot deliberately excludes audio binaries. Selecting or acquiring a separate audio file requires item-specific source and rights provenance plus whatever approval applies to that production asset. A file marked `unknown-source` remains blocked until its source and permitted use are verified. The Shotcraft code's Apache-2.0 license does not extend to music or sound recordings; do not inherit the code license or use an unknown file because it appears in an upstream note. Use the existing narration/audio asset registry and production gates.

## Bounded agent lookup

`search-index.json` is compact retrieval metadata generated from the pinned catalog and its upstream gallery metadata. It preserves the upstream Chinese copy and card IDs, adds English search vocabulary, and does not include demo source. Search reads this index only:

```powershell
npm run shotcraft:search -- --query "split screen UI" --top 8
npm run shotcraft:search -- --query "kinetic typography" --category typography --energy high
```

Inspect one card and, where needed, name the exact upstream variant key:

```powershell
npm run shotcraft:inspect -- -- wall-reveal-moves
npm run shotcraft:inspect -- -- wall-reveal-moves --variant wireframe-draw-on
```

If the card has several variants, inspection returns the card-level cited demo set and leaves `selection` empty until a variant is named. Upstream does not always map each preview variant to a separate component, so do not infer a variant-specific component from array order. `source.mapping: card_reference` marks that evidence boundary. Inspect reports compatibility as `source_only` until later compatibility work adds evidence.

Inspection includes original suitability, energy, duration, parameter notes, constraints, exact card/reference/demo paths, dependency closure, and a release video reference. Preview files are fetched only on explicit request and saved under ignored `output/shotcraft/previews/`, with a sidecar recording source URL, byte size, and SHA-256. A fetch failure is an error and leaves no preview file; an unfetched release reference is never reported as ready. These clips are examples only and are not production assets or target-product evidence.

Regenerate the retrieval index after an intentional catalog update:

```powershell
npm run shotcraft:index
```

Re-import with an exact upstream checkout and commit pin:

```powershell
node scripts/import-shotcraft-library.mjs --source <checkout> --revision 43bd349a136651865ecfa6ea1cf012f6e957d304 --output third-party/video-shotcraft
```

The importer refuses to overwrite an existing snapshot. Its file-list override exists for isolated importer tests; normal imports use the pinned catalog and curated source selection.
