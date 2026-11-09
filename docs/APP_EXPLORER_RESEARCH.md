# App Explorer research inputs

This reference documents the JSON files accepted by `video app-research bind` and `explore evidence materialize`. Both operations read registered App Explorer knowledge. A video request does not launch exploration. Keep authentication, session descriptors, private evidence, and unredacted observations outside shared documentation.

## BindResearchInput

Create a JSON file and pass it to `video app-research bind <file>`. The example uses synthetic fixture identifiers; replace them with IDs read from the exact registered app revision and selected task packet.

```json
{
  "appId": "crm",
  "knowledgeRevision": "r000003",
  "selection": {
    "contextIds": ["member.fixture"],
    "scenarioIds": ["items.view.member"],
    "executionIds": ["execution.member.1"],
    "evidenceRefs": ["run.fixture/member.png"]
  },
  "readiness": {
    "basis": "user_enough",
    "runId": "run.integration",
    "userInstructionRef": "chat:synthetic-fixture"
  }
}
```

Field meanings and checks:

- `appId` is a registered app ID. It selects the host-managed `workspaces/<appId>` dataset; it is never a client filesystem path.
- `knowledgeRevision` is the immutable V2 revision shown by `summary --json`. The binder rejects V1 data, a stale revision, unknown IDs, or mismatched roles.
- `selection.contextIds` is a nonempty list of authorized context IDs. Each selected scenario must belong to one of these contexts, and its tested role must match that context.
- `selection.scenarioIds` and `selection.executionIds` identify the exact linked scenario history to use. Every selected scenario needs a selected, verified execution.
- `selection.evidenceRefs` contains workspace-relative paths linked to the selected executions. The binder hashes selected evidence bytes into the immutable binding. References must stay inside the workspace evidence directory.
- `readiness.basis` is `scope_complete` or `user_enough`. For `scope_complete`, `runId` must identify a run whose authorized scope is exhausted and whose current inventory and coverage reconcile. For `user_enough`, `runId` must identify a stopped run with a meaningful checkpoint and `userInstructionRef` must point to the explicit user instruction to proceed with available evidence. This choice preserves unknowns; it does not mark the whole app complete.

`scope_complete` example:

```json
"readiness": { "basis": "scope_complete", "runId": "run.exhausted" }
```

## PromoteExplorerEvidenceInput

Create a JSON file and pass it to `explore evidence materialize <file> --app <appId>`. Promotion reads the approved canonical scene and existing host asset/HITL gates. Rights text must state factual rights and permitted use; synthetic fixture text is suitable only for synthetic test bytes.

```json
{
  "revision": "r000003",
  "contextId": "member.fixture",
  "featureId": "items.view",
  "scenarioId": "items.view.member",
  "executionId": "execution.member.1",
  "evidenceRef": "run.fixture/member.png",
  "assetId": "member-still",
  "sceneId": "scene-1",
  "role": "product-ui-still",
  "rights": {
    "rights": "Synthetic local fixture rights",
    "permittedUse": "Synthetic integration test only"
  }
}
```

For evidence added in a later knowledge revision, add the SHA-256 digest of the exact bytes selected from the current workspace:

```json
{
  "revision": "r000004",
  "contextId": "member.fixture",
  "featureId": "items.view",
  "scenarioId": "items.view.member",
  "executionId": "execution.member.2",
  "evidenceRef": "run.later/member.png",
  "expectedSourceSha256": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "assetId": "member-still-later",
  "sceneId": "scene-1",
  "role": "product-ui-later",
  "rights": {
    "rights": "Describe the actual source rights",
    "permittedUse": "State the allowed production use"
  }
}
```

Field meanings and checks:

- `revision`, `contextId`, `featureId`, `scenarioId`, `executionId`, and `evidenceRef` identify evidence linked in one immutable V2 revision. The context, scenario, execution, and tested role must agree.
- `expectedSourceSha256` is required when the selected reference has no byte hash in the frozen binding, including evidence added in a later revision. It must match the current confined bytes before copying. App Explorer revision manifests do not historically hash evidence image bytes, so this digest does not prove which bytes existed in an older revision.
- `assetId` is a stable production asset ID; `sceneId` must exist in approved `video.json`; `role` is the scene's semantic asset role.
- `rights.rights` and `rights.permittedUse` are factual statements supplied for the selected media. Promotion does not infer or grant rights.

The binding remains a provenance reference. Promotion creates a separate asset-registry entry and does not revise `video.json`, create browser-run evidence, or write a host approval. Adding an asset makes production preflight stale. Continue through the existing Backlot Request Changes, preflight, and host approval path.

The deterministic fixture that exercises both inputs and later-revision promotion is [the Task 9 integration test](../tests/app-explorer-integration.test.ts). It validates synthetic data only; it is not a real app approval or live acceptance result.
