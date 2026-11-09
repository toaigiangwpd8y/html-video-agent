# Repository agent instructions

## Workspace and renderer readiness

- At the start of each new work session or fresh checkout, run `npm run bootstrap`. It installs both pinned renderer runtimes, builds the harness, and verifies Remotion and HyperFrames are available. It does not reset `.video` project state.
- Do not start Video Brief review until `npm run video -- renderer options --require-all` exits successfully. Resolve any missing browser or runtime prerequisite first; do not present an unavailable renderer as selectable.

For any video creation/editing request, use `$agent-video` from `.agents/skills/agent-video/SKILL.md`.

Important v0.22 invariants:

- No internal model provider exists; the external harness is the intelligence.
- Every request records a clarification assessment; clear requests resolve it with zero questions, while only material ambiguity enters `INPUT_REQUIRED`.
- Resolve and freeze `.video/production-profile.json` before Script authoring.
- Author one complete Script and perform one bounded correctness/fit self-check; do not create alternate candidates, a dedicated Critic round, an iterative model-review loop, or model-side final selection.
- The base workflow is creative-taste neutral. Selected video-type skill(s) define request-specific success criteria.
- User-explicit production intent outranks inferred profiles. Primary profile outranks supporting profiles. `neutral` is fallback only.
- Creative reasoning and self-review share one profile Success Definition; do not import unrelated taste.
- `video.json` is canonical semantic truth with exactly `meta` and `scenes` at top level.
- Canonical scene `durationInFrames` values are sequential semantic budgets whose sum equals `meta.durationsInFrames`; the selected renderer resolves authored layer/media overlap after handoff.
- Production profile is authoring provenance/configuration, not a shadow VideoProject.
- The user selects Remotion or HyperFrames at the Video Brief checkpoint; the runtime records that choice and never silently falls back.
- Remotion React and HyperFrames HTML/CSS workspaces hold renderer implementation only. The MVP-owned Script, Storyboard, `video.json`, Production Profile, and asset registry remain canonical.
- Each pinned renderer CLI and repository-owned handoff contract define renderer technique; profile Renderer Guidance only adds request-specific presentation priorities.
- Meaningful new visible/spoken copy must be canonical before final delivery.

## App Explorer and product research

- App Explorer exploration begins only when the user explicitly requests it. A video request reads previously explored workflows for the selected app and reports missing knowledge; do not start discovery automatically.
- Keep two dashboards: Backlot/Explorer for knowledge and `agent-browser` for the live browser. User steering remains in existing chat. Exploration and production capture are sequential; do not add browser locks or input-lock controls.
- User instructions to proceed with available evidence let video authoring continue while unresolved Explorer questions, blocked tasks, and unknown behavior remain labeled and open. A pause or selected-claim evidence is not scoped completion.
- Product-video images and recordings remain behind Storyboard approval and the existing asset manifest, rights, scene/role binding, hash, conflict, host approval, and preflight checks. Research image selection/supplementation does not create browser evidence or verify a feature.


## Universal HITL runtime boundary

For every video creation/editing request, load `.agents/skills/agent-video/SKILL.md` using the harness-native skill mechanism. If the harness has no skill primitive, read the file directly before taking video actions.

HITL is owned by the runtime/host, not by the creative model:
- the agent-facing `video` CLI may propose clarification, Video Brief, Script, and Storyboard artifacts, but it cannot resolve or approve them;
- when `npm run video -- hitl status` returns `INPUT_REQUIRED`, surface the payload and end the turn;
- when it returns `REVIEW_REQUIRED`, surface the exact artifact and wait by default. If the user explicitly asks for revisions, treat that as revision authorization, not approval: submit their feedback through Backlot's existing `Request Changes` control when the authorized interface is available. Do not ask them to approve the rejected artifact. Do not edit or materialize against the still-pending snapshot. Resume after the host records the request and status becomes `WORKING` with phase `revision_requested`; then revise the artifact and create a fresh review. If no authorized Request Changes interface is available, ask the user to submit that request in Backlot, not to approve. For `ASSET_PREFLIGHT`, fix the asset set and regenerate preflight before asking approval of the new snapshot;
- never invoke `npm run video:host` from the creative agent. That command is reserved for a human operator or a harness adapter protected by the harness permission/approval system;
- OpenCode/Claude/Codex/other harnesses should map `INPUT_REQUIRED` to their native ask-user mechanism when available. Map `REVIEW_REQUIRED` to an approval gate by default, with the existing `Request Changes` path for explicit revision feedback;
- if a harness has no native HITL primitive, plain chat + a separate human `video:host` command is the portable fallback.

Do not fake `HUMAN` approval or treat `Request Changes` as approval. Downstream work must remain blocked until the host has recorded the corresponding decision and advanced the checkpoint.
