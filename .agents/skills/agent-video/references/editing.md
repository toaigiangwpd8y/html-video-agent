# Editing an existing project

Read `npm run video -- status`, `video.json`, and the user's requested change. Preserve the exact request boundary unless the user explicitly starts a new request.

Keep unrelated scenes untouched. First distinguish an implementation/production-only revision from a change to canonical meaning, viewer-facing copy, factual truth, semantic evidence requirement, or cross-scene continuity. A concrete production asset binding is not canonical by itself.

## Visual-only scene revisions

For a visual-only revision of a scene, preserve its semantic contract but reconsider the manifestation from scratch unless the user explicitly asks to preserve the existing treatment or it is required by truth, assets, continuity, or approved intent. Preserve canonical narration, `screenText`, factual truth, semantic purpose and end-state, required evidence, and meaningful cross-scene continuity.

Do not treat incidental cards, badges, chips, icons, metaphors, layout, animation, or transitions in an existing implementation as sacred. A scene whose contract compares alternatives and converges on a direction may use branching paths, an evaluation filter, or another clear visual structure without a semantic rewrite. The goal is not limited to polishing previous components.

When canonical meaning remains unchanged, update the selected renderer's frozen project and derived evidence only; replacing a non-binding manifestation does not itself require a canonical patch. If scene meaning, viewer-facing copy, truthful state, semantic evidence, or continuity changes, patch canonical `video.json` first. If only a production asset is replaced and it still satisfies the approved semantic evidence requirement, update `assets/manifest.json`, the selected renderer project, and derived evidence without patching `video.json`.

## Canonical edits

Use an absolute-JSON-Pointer patch with `baseRevision` from `video status`. The core stores revision/request binding in `.video/project-state.json`, outside canonical semantic content, then reruns hard validation/preflight.

Patch only existing canonical `meta` or `scenes` paths; root replacement is not allowed. The exact request cannot be patched because it remains separately frozen in `.video/request.txt`.

After canonical edits, create a new renderer version. During visual review, edits stay in the frozen project, invalidate its approval, and require fresh checks and human review. Never regenerate that project or merge renderer source with canonical JSON. Final rendering remains blocked until the host records human approval for the exact source hash.
