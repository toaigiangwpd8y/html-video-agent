# Cutroom source notice

This repository adapts selected capture mechanics and documentation ideas attributed to [Cutroom](https://github.com/ceasarhaddad/cutroom), snapshot commit `d7172c353e8e2f51c8b7f75b0370f6a9374e576f` (recorded 2026-10-03). The copied repository license text is in [LICENSE](LICENSE).

Reviewed source files: `capture/director.mjs`, `capture/config.example.mjs`, `capture/scenes/example-todo.mjs`, `capture/frames-to-mov.sh`, `capture/package-lock.json`, `toolkit/src/playback/types.ts`, `.claude/skills/capture/SKILL.md`, `knowledge/craft/capture.md`, `knowledge/craft/screen-record.md`, and `docs/connect-your-app.md`.

This source list and the local directories below are a recorded group-level attribution, not an independently verified file-by-file derivation map. The available records do not establish which exact upstream lines contributed to each local file. Do not treat this notice as proof that such a comparison has been completed.

The project-owned implementation is under `src/web-capture/`, `examples/web-capture/`, `tests/fixtures/web-capture/`, and `.agents/skills/web-app-capture/`. It replaces Cutroom's output/deletion behavior, choreography API, Remotion playback pipeline, MOV/CapCut handoff, auth handling, and workflow with a validated JSON recipe, isolated run directories, optional raw H.264 MP4 plus PNG screenshots, production-manifest materialization, and this repository's existing canonical-project/HITL/renderer contracts. Raw screenshots and MP4 capture do not require Cutroom. The optional cursor-overlay renderer looks for a separate local Cutroom toolkit at `cutroom/toolkit`; the Cutroom checkout itself is not included in this commit.

## License note

The MIT notice covers only the selected Cutroom code/documentation adapted into this repository. It does not grant rights to content shown by a captured website. Each promoted capture must carry factual rights/license and permitted-use metadata.

