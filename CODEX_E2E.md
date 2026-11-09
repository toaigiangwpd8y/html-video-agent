# Codex end-to-end workflow

Use `.agents/skills/agent-video/SKILL.md` for every video creation/editing request. Codex is the external creative harness; the CLI/runtime owns checkpoint state and human approval.

## Flow

```text
clarification assessment -> Video Brief + explicit renderer choice
  -> one Script + bounded self-check -> Script HUMAN review
  -> semantic Storyboard -> Storyboard HUMAN review -> canonical video.json
  -> one Enhance author: layout strategy, rights-cleared assets, preflight
  -> selected adapter prepare/check/review -> HUMAN approval
  -> renderer-specific render/evidence -> finalize
```

## Local setup

Requirements: Node.js 22+, locally installed Chrome/Chromium, FFmpeg, and ffprobe.

```bash
npm ci
npm run setup -- --renderer=all
npm run build
npm run video -- init
npm run video -- backlot
```

`npm run setup` installs both renderer lockfiles with npm install scripts disabled. `--renderer=remotion|hyperframes` installs one nested runtime. Setup downloads no browser, skills, or FFmpeg. Runtime calls keep preview local; cloud commands are outside the workflow.

## Authoring and approvals

The Video Brief must include a brief-specific renderer recommendation and alternative tradeoff. The human explicitly selects an available renderer during brief review; `.video/renderer-selection.json` records the choice. After the exact Storyboard is approved, canonical `video.json` and Production Profile hashes are fixed. `video renderer prepare` prepares only the chosen adapter. Remotion authoring lives in `remotion/generated/`; HyperFrames authoring lives in its returned versioned project. Use only files approved through `assets/manifest.json`; preflight requires source/rights and permitted-use evidence.

HyperFrames uses the Title/Text, Fullscreen Media, and Split Layout kit. Remotion uses its repository-owned React/TypeScript contract. Both preserve canonical text, frame budgets, and approved local assets.

Run `video renderer check` then `video renderer review`. The selected adapter opens its local preview and freezes the exact source hash. The CLI status becomes `REVIEW_REQUIRED` at `VISUAL_REVIEW`. Show the user the Backlot link/hash, then stop. Never run `video:host` from Codex or assume preview/check implies approval.

After a human operator or permissioned harness adapter records approval, `video hitl status` is `READY`. Then run `video renderer render`, `video renderer finalize`, and `video status`. Finalize validates output metadata and evidence, retains the renderer-specific manifest, and writes `.video/final-manifest.json` for the shared delivery record.

Visual-only revisions update the selected renderer project and require fresh check/review/approval. Copy, narration, claims, or meaning changes go through canonical Storyboard revision/approval and create a new renderer project version. Never regenerate or merge frozen renderer source into canonical data.
