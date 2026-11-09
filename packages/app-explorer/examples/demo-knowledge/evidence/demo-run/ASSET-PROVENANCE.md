# Demo evidence asset provenance

The PNGs in this folder are demonstration evidence for the synthetic TaskFlow app fixture included under `packages/app-explorer/tests/fixtures/explorer-app.mjs`. They are captured from the local fixture during acceptance/demo runs and contain mock project/task data, not screenshots or data from a real customer or third-party service.

`create-dialog.png` visibly includes the label “SIMULATED SCREENSHOT.” The other images in this folder are likewise synthetic fixture UI captures. They illustrate the App Explorer workflow only; they are not product research evidence and are not cleared as production video assets.

The paired `.txt` snapshots are generated from the same synthetic fixture page state. Recreate the live acceptance images with `packages/app-explorer/tools/acceptance-fixture.mjs`; generated evidence remains local to the demo fixture and must not be treated as verified observations of an external app.
