# PPTX source regression fixtures

`two-slides.pptx` is the small two-slide presentation fixture added in P7 commit `08cd549` (`tests/fixtures/pptx/two-slides.pptx`). Its embedded 1×1 PNG is replaced with a deterministic flat-color test pixel by `replace-fixture-pictures.mjs`; `fixture-media-provenance.json` records the previous and current hashes. This keeps embedded-image extraction coverage without redistributing the prior image bytes.

`smartart.pptx` is generated from that fixture by `smartart-openxml-fixture.mjs`. The generator adds a native DrawingML SmartArt `graphicFrame`, a `dgm:dataModel` with two node points and two parent-child connections, and the associated generated drawing part. The SmartArt is editable structure in the PowerPoint package, not a flattened diagram picture. The second slide and generated fixture pixel remain from the sanitized P7 fixture.
