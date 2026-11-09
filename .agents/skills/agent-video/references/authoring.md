# Authoring — internal creative reasoning under a frozen production profile

The external agent may explore alternatives internally. The exact approved request, Video Brief, and frozen Production Profile define success; the base process adds no universal creative taste. The harness persists only the request-bound artifacts required by the review checkpoints.

## Resolve and freeze human intent

Inspect the request, repository context, and only user-provided or already-authoritative pre-existing assets before asking. Do not search for, download, generate, or bind visual/source production media before Storyboard approval. Script-stage narration TTS is the sole exception: after the complete Script exists, create the structured stable-ID narration sidecar and synthesize the exact voice for delivery/timing review and later reuse. Do not heuristically extract speech from Markdown. Commit one clarification assessment for every request. Ask at most two high-information questions only when plausible answers materially change audience, objective, content selection, depth, duration, or presentation. For a clear request, commit a resolved assessment with zero questions and record the explicit/inferred decisions before continuing to the Video Brief.

After host approval of the Video Brief and human renderer choice, select and freeze one primary profile plus only non-conflicting supporting profiles. The renderer choice affects post-Storyboard implementation only; do not create renderer-specific story artifacts. Priority is:

```text
explicit user intent > inferred intent
primary profile > supporting profile
neutral = fallback only
```

## Internal creative lens

Before writing the Script, form a compact internal lens from:

1. the exact approved brief;
2. the primary profile's Success Definition;
3. only orthogonal criteria from supporting profiles;
4. factual, claim, user-provided/pre-existing evidence, and safety constraints;
5. viewer, platform, and context constraints actually present in the brief/profile.

Then self-review the chosen direction for hard constraints, hidden assumptions, factual/claim supportability, contradictions, profile-specific failure modes, and whether it serves the requested viewer outcome. This is reasoning, not a new artifact or shadow schema. Do not persist exploratory alternatives or evaluation notes.

## Script checkpoint

Read [scriptwriting.md](scriptwriting.md), then develop the direction into complete viewer-facing content, not another outline. Establish its one audience question/job, observable viewer outcome, essential proof, approximate duration reference, any explicit delivery constraint, and explicit exclusions before drafting.

- narrated work: full spoken narration coordinated with concise visible anchors; about 5-8 words is a useful default for `screenText`, not a hard cap when exact names, units, caveats, or tightly bound meaning require more;
- silent/text-led work: full visible copy sequence, without fabricated voice-over;
- demo/tutorial: complete spoken/visible instructions tied to truthful product or task states;
- data report: complete wording for findings, comparisons, caveats, and supported conclusion.

Apply only the active production profile's pre-production sections—Success Definition, Creative/Scriptwriting guidance, Self-review, and content-level Development Guidance—in addition to the universal `scriptwriting.md` contract. **Do not apply the profile's `Renderer Guidance` before Storyboard approval.** At the Script checkpoint, also defer any Development Guidance that maps content into canonical scenes/`visualConcept` or names a renderer manifestation; those instructions belong to Storyboard serialization or post-approval Storyboard Enhance. Renderer Guidance belongs to post-approval work in the selected renderer. Do not import proof, hook, delivery, or review constraints from another profile.

Preserve the chosen mechanism and viewer progression. Resolve its accepted tradeoff where possible without replacing the concept; support every material claim; add no renderer implementation details or materially new creative idea after review. Perform the one bounded pre-review self-check in `scriptwriting.md` in the same drafting pass, then use the existing production TTS path to materialize every narrated beat before Script review. Measure the actual audio files and report their duration for Script review. The Video Brief duration is approximate guidance, not a hard fit target. Use measured TTS duration as the minimum timing input for each narrated scene; no fixed breathing margin is required. Fix clear content or delivery blockers in this draft; do not generate alternatives or start a dedicated Critic/model-selection loop. If wording changes, regenerate only affected narration. Do not tempo-fit or speed up narration to force a duration.

```bash
npm run video -- script commit .video/candidates/script.md
```

When the Script checkpoint is pending, surface it and stop. Host approval unlocks Storyboard development.

## Storyboard and canonical `video.json`

Turn the approved Script into semantic visual beats, then serialize the exact candidate with top-level keys `meta` and `scenes` only. `video storyboard commit` creates the review artifact. Host approval automatically promotes that exact approved storyboard to canonical `video.json`, creates project state/revision 1 and the preflight report, and invalidates renderer-derived state.

For each approved Script beat, derive canonical `visualConcept` at the Storyboard boundary from the beat's story job, approved claim, evidence/source, narration/screen text, and explicit user constraints:

```text
story job + approved claim + evidence/source + approved copy + explicit constraints
→ derive semantic visual requirement
→ discard any upstream implementation manifestation
→ write semantic-only visualConcept
```

Do not preserve a presentation choice merely because it appears in the Script, Brief, Production Profile reason, or other upstream notes. If upstream material mentions a timeline, diagram, balance, split, network, card, left/right placement, transformation, blueprint, component, transition, or motion treatment, recover the underlying semantic requirement first. Preserve an exact manifestation only when the user explicitly requires that exact manifestation, factual/evidentiary identity depends on it, or meaningful cross-scene continuity depends on the identity itself.

For each scene, ask before submission: **Could a different valid layout, blueprint, or rendering technique still satisfy this visualConcept?** If the answer is no because the field prescribes implementation, rewrite it at the semantic level. This is an author/reviewer judgment, not a keyword blacklist.

Map decisions as follows:

- title, dimensions, FPS, final frame budget, palette/font, and cross-video constraints -> `meta`;
- one semantic beat -> one `scenes[]` item;
- measured Script-stage TTS duration, rounded up to a whole frame -> minimum narrated-scene `durationInFrames`; use that minimum by default and add time only for a purposeful visual pause, hold, or semantic beat. Use semantic pacing for intentionally silent scenes, and set `meta.durationsInFrames` to the sum of the complete sequential allocation. The approximate Video Brief duration does not determine or cap that sum;
- approved narration text -> optional `audio.voiceoverText`; its already-materialized Script-stage TTS is reused after Storyboard approval and registered as the scene voice-over asset;
- meaningful visible copy -> `screenText`;
- the scene's semantic visual intent/job—what the viewer must perceive, which relationship/change/evidence must become observable, and why -> `visualConcept`; visual/source production media is acquired and registered after approval in `assets/manifest.json`.

`meta.theme` carries approved color and typography intent only: `palette` is an unordered set of approved colors and `font` is the approved family name. Set optional `mode` to `light` when the video should sit on a light canvas (the default is `dark`). Use optional `roles` (`page`, `text`, `accent`, each a palette color) only when the user or brand fixes which color plays which role; otherwise roles, contrast handling, and renderer tokens are derived deterministically after approval. Do not encode surface shades or motion values here. A local font file becomes real typography only after Storyboard approval, when it is registered in `assets/manifest.json` with `role: "font"` and a `family` matching `meta.theme.font`.

`visualConcept` describes the semantic visual job, not a renderer recipe. State what the viewer must perceive, which supported relationship, state change, comparison, evidence, action, or semantic structure must become observable, what must be visually true by the end, and any adjacent-scene continuity that carries meaning. Leave manifestation open by default. Preserve an exact layout/component/metaphor/motion identity only when the user explicitly requires that exact manifestation, factual/evidentiary truth depends on that identity, or meaningful cross-scene continuity depends on the identity itself. "Communicates the approved meaning well" is never sufficient reason to make a manifestation canonical.

Every scene must earn its place. `screenText` is viewer copy, not renderer notes. `visualConcept` must say what the viewer must understand visually, including relationships, change, evidence, and semantic constraints; it must not prescribe asset paths, coordinates, layouts, components, colors, or animation recipes. Do not create `audio` for silent/text-led scenes or invent placeholder narration. Storyboard approval does not require visual files.

When Storyboard review is pending, surface it and stop. After host approval, run `video hitl status`; the next state is `ready_to_render`.
