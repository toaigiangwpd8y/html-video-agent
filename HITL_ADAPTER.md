# Universal HITL adapter contract

The creative agent uses only:

```bash
npm run video -- hitl status
```

The machine-readable result is `video-hitl/1`:

- `INPUT_REQUIRED` -> ask the user and suspend the agent turn.
- `REVIEW_REQUIRED` -> show the artifact and require approval/revision.
- `WORKING` -> continue.
- `READY` -> pre-production HITL is complete.

The creative agent **must not** call `npm run video:host`.

A harness/host integration may map its native user-interaction system to the host surface:

```bash
npm run video:host -- clarify resolve path/to/answers.json
npm run video:host -- brief approve
npm run video:host -- script approve
npm run video:host -- storyboard approve
```

Recommended runtime behavior:

1. Agent reaches `INPUT_REQUIRED` / `REVIEW_REQUIRED`.
2. Harness displays the question/artifact.
3. Harness waits for a real user decision.
4. Harness invokes the corresponding host action.
5. Resume the same agent/session.

For OpenCode/Claude/Codex, permission-gate the host action or keep it outside the creative model tool surface. For a shell-only harness, the human may run the host command manually between turns.

This MVP intentionally does not implement cryptographic approval receipts. A coding agent and the human often share the same filesystem/OS user, so cryptographic-looking state inside the same writable repo would not create a real trust boundary. Stronger trust comes from the harness permission/host process boundary.
# Additional host actions

- `DURATION_FIT` is `INPUT_REQUIRED`. Show measured duration, hard ceiling, overrun, and the `shorten_script` / `revise_brief` choices. Only the host records the choice through Backlot or `npm run video:host -- duration choose ...`; the decision binds the exact Brief, Script, narration manifest, and timing plan.
- Approved `VIDEO_BRIEF`, `SCRIPT`, `STORYBOARD`, `ASSET_PREFLIGHT`, and `VISUAL_REVIEW` checkpoints may be reopened by the host with concrete feedback and the current edit generation. Use Backlot's protected reopen action or `npm run video:host -- reopen <checkpoint> --reason <feedback> --expected-revision <generation>`. Reopening is never an approval.
- Before downstream resubmission after reopening, the creative agent inspects `video revision status` and submits `video revision reconcile <report.json>`. Hash bindings are validated; unaffected audio/assets/renderer work can be reused but all stale approvals need new human decisions.
