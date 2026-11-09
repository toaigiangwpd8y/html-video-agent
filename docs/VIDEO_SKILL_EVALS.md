> Superseded for the authoring flow as of v0.22: the G0/G1/G2 tournament was removed in favor of single-draft Script HITL. Historical details below describe v0.21.

# Video skill behavior evaluations

## Current evaluation contract

The repository has no internal model provider. Creative quality is evaluated by the external agent against the approved brief and frozen Production Profile, followed by self-review before each human review checkpoint.

The deterministic harness verifies that:

- clear requests reach the Video Brief without creating a clarification artifact;
- pending clarification blocks until the host resolves it;
- profile binding is optional for absent clarification and exact when clarification exists;
- Script review binds the request, approved brief, and frozen profile;
- changed request-bound inputs make Script or Storyboard review stale;
- Storyboard host approval promotes the exact reviewed semantic project after schema/semantic preflight; Enhance materializes the registry, runs production asset preflight, and must pass it before strategy re-check/layout;
- promotion creates canonical state/revision 1, invalidates derived renderer state, and exposes `ready_to_render`;
- canonical schema, timing, audio, asset, Remotion, evidence, and archive contracts remain valid.

## Verification command

```bash
npm run build
npm test
```

The current suite is the executable acceptance contract for the simplified pre-production flow and the unchanged canonical/Remotion invariants.
