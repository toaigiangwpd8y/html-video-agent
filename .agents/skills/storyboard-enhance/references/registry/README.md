# Remotion registry

The blueprint answers visual-story strategy. The registry answers whether a reusable Remotion source helps implement that strategy.

Registry retrieval is optional and follows actual asset inspection and final renderer-neutral blueprint confirmation. Registry availability cannot influence story meaning, asset requirements, motion design, or blueprint choice. Inspect the actual assets before final candidate resolution or rejection. `NONE` is always a legal resolution.

The registry is not a planning artifact, runtime renderer, JSON DSL, or global registry. Asset roles remain semantic. When no natural registry fit exists, prefer custom direct Remotion authoring.

Catalog metadata is intentionally minimal. An item records only the compact
selection data needed to find a possible implementation source: id, provider,
kind, description, capabilities, semantic inputs, constraints, sourcePath, and
origin. The semantic inputs and constraints describe fit without mirroring
upstream name, schema, or other metadata fields.

## Onda discovery and lazy vendoring

`catalog.json` is the installed/approved local source catalog. The full Onda
metadata snapshot at `upstream/onda.snapshot.json` is a separate discovery
universe; it contains metadata only and is queried locally, never loaded into
Storyboard Enhance context wholesale.

```bash
npm run registry:onda:sync
npm run registry:search -- --provider onda --query "image reveal documentary" --top 8
npm run registry:onda:inspect -- image-reveal
npm run registry:onda:vendor -- image-reveal --metadata /tmp/image-reveal.registry.json
```

Search is deterministic lexical retrieval and reports `installed: true` when
the local catalog already contains the matching Onda source. The agent still
does semantic selection. An undiscovered source must pass `ACCEPT` before it
is copied into `remotion/registry/onda/<slug>/`; `REJECT` and `NEEDS_REVIEW`
remain uninstalled. Sync/search never install dependencies or mutate the
local catalog; vendor uses a temporary Onda install, `--no-barrel`, path
containment checks, reviewed semantic metadata, catalog validation, and
Remotion typecheck. Inspect/vendor resolve the exact `cliVersion` recorded in
the snapshot; the catalog also records a SHA-256 hash of the copied source
closure. Vendor never installs npm dependencies or touches production
composition registration.

Onda discovery queries must use compact English visual vocabulary. Non-ASCII
queries fail fast rather than returning misleading lexical matches.

The default confidence floor is conservative; pass `--min-score 2` explicitly
when a broader retrieval pass is useful.
