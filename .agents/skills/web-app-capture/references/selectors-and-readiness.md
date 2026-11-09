# Selectors and app readiness

## Find stable selectors

1. Read the app source for accessible labels, roles, and `data-testid` values when the repository is available.
2. Run `video web-capture probe <recipe.json>` against the explicitly configured URL. Probe opens the page, waits for DOM readiness and fonts, lists visible headings/control labels, and reads no form values or user data. It never clicks.
3. Prefer role plus accessible name, then stable text or test ID. Use CSS only when there is no stable semantic hook. Confirm that each action locator matches one visible element.
4. After an action that should change the app, add a wait/assertion or a postcondition. Do not infer success from a click completing.

The runtime uses `domcontentloaded` and `document.fonts.ready`, with bounded navigation and locator timeouts. It does not depend solely on `networkidle`, since live apps may keep connections open. A configured server is health-checked first, started with argv only when needed, and stopped only if this run started it.

## Auth and seeded state

Use the user's authorized test/demo URL and seeded test account. Store Playwright `storageState` only under `.video/`, which is ignored by Git. Auth state is loaded before navigation and capture. Do not record a sign-in screen as a production asset; do not put credential values in recipes or results. For one-off form values, reference environment variable names in `fill` steps.

Never browse through links to discover app URLs. Navigation targets must be authored in the recipe and remain on its allowed host list. Do not point a fake loopback hostname at an external site.

## Clock and footage timing

With `clock: true`, the runtime verifies Playwright's page clock and advances it once per captured frame. A failed probe fails the run. Clock support does not make servers, animation libraries, network responses, or the whole page deterministic. Navigation/readiness waits happen outside captured time; add an explicit `hold` after the resulting state if it needs to remain on screen.

The clip records the real visible page at each PNG frame. It contains no app audio or synthetic cursor, zoom, pan, or click effects. Those effects require later authoring through the selected renderer.
