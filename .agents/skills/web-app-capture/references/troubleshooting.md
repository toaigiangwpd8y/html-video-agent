# Troubleshooting

- **Doctor reports no browser:** install/use a local Chrome or Chromium that matches the machine's policy, then set `CHROME_PATH` or `app.browserExecutablePath`. The capture tool does not download browsers.
- **Doctor reports missing FFmpeg/ffprobe:** install local binaries or point `FFMPEG_PATH` and `FFPROBE_PATH` to compatible local executables. No codec is downloaded.
- **Server does not start:** check the configured executable, argument array, workspace-relative `cwd`, port, and health URL. If the URL already serves an app, the configured health URL must identify that app before the run can reuse it.
- **App not ready:** make the test route stable, use a seeded local state, and choose a meaningful visible locator. Increase bounded navigation/action timeouts only when the app legitimately needs more time.
- **Target not found or ambiguous:** inspect the app source or rerun read-only `probe`; make the role/name, text, test ID, or CSS selector identify one visible element.
- **Postcondition failed:** the browser action did not establish the expected state. Correct the recipe or fixture; do not materialize the failed run.
- **Clock unavailable:** set `clock: false` only when the app relies on unsupported timing. The runtime never changes a requested true clock to false automatically.
- **Encode or media validation failed:** inspect the run result and local FFmpeg/ffprobe paths. Failed MP4 validation is not a successful run; keep the run for diagnostics.
- **Materialization says HITL is required:** surface the returned status and payload, then end the turn. A human operator advances the checkpoint. Never run `video:host` from the creative agent.
- **Materialization says canonical project is not approved:** finish the existing Storyboard host approval first. Do not write a synthetic approval record.
- **Materialization conflict or stale preflight:** choose a different asset ID/role only when semantically correct. If the manifest changed, rerun production preflight and obtain host approval if requested.
