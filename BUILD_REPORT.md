# HyperFrames renderer integration

## Shared project contract

- `video.json` remains the canonical source for scene meaning, visible copy, narration, dimensions, frame rate, and sequential frame budgets.
- The HyperFrames adapter creates a versioned renderer workspace from the canonical project and approved asset manifest. Scene timing, narration captions, audio placement, gains, and fades derive from those inputs.
- HyperFrames renders the approved composition directly to MP4. Sparse snapshots provide boundary evidence; they are review evidence, not an intermediate video sequence.
- Finalization binds evidence to the approved renderer source and MP4 hashes, then validates output metadata against that project's renderer manifest.
- Renderer workspaces and final deliveries are project-specific. Each render requires host-recorded approval for its current source hash.

## Workflow

`prepare -> check -> review -> human approval -> render -> finalize`

Renderer-only visual edits stay in the versioned renderer workspace and require a new check, review, and approval. Changes to meaning, narration, or canonical copy go through `video.json` review and create a new renderer project version.

## Repository scope

The repository pins `hyperframes@0.8.50`. Setup installs the pinned CLI with npm install scripts disabled and does not download browser or FFmpeg binaries. Backlot and Studio use loopback. The repository supports local educational video output; it does not provide a hosted animation editor or distribute the renderer bundle. The recorded scope assessment is internal and does not amend upstream license terms.

The first-party kit provides Title/Text, Fullscreen Media, and Split Layout primitives. Projects may combine or extend these through their own renderer workspace.

## Verification procedure

1. Run `npm run build` after repository changes.
2. Run `npm run video -- renderer check` for the prepared project; review warnings against its own timeline and copy.
3. Run `npm run video -- renderer review`, then obtain host approval for the displayed source hash.
4. Render and finalize only after approval. Confirm `video status` reports `FINALIZED` / `READY`.
5. Confirm the final MP4 metadata matches the active project manifest and its evidence index binds boundary snapshots to the final MP4 hash.

Run-specific dimensions, frame count, codec, warnings, evidence hashes, and editorial findings belong with that project's `.video` state and output evidence. They are derived from the project being rendered.
