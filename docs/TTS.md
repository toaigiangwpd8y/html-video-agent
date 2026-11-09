# Local narration synthesis

GRA-17 uses the open-source VieNeu-TTS v3 Turbo CPU/ONNX path, the highest-quality self-hostable VieNeu release documented by upstream as of 2026-10-11. VieNeu v4 is proprietary, and upstream describes v3 Nano as a lower-quality edge option. The project pins SDK 3.8.3, the Turbo model snapshot, and the MOSS codec snapshot in `src/tts/config.ts`. No API or fallback model is used.

Use Python 3.11 or 3.12 in an environment of your choice. Follow the [official VieNeu installation guidance](https://github.com/pnnbao97/VieNeu-TTS) for platform prerequisites, then install this repository's pinned dependencies with that environment's Python:

```sh
python -m pip install -r scripts/tts/requirements.txt
npm run video -- tts doctor
```

Model files are cached outside tracked project files. Doctor checks the installed SDK version, ONNX runtime, and fixed model graph cache without downloading weights. First synthesis downloads the pinned snapshots through Hugging Face Hub. Bootstrap never installs TTS dependencies or downloads model weights.

The runtime uses `python` by default. If your environment uses another executable, set `VIDEO_TTS_PYTHON` to that executable using your shell's environment-variable syntax. Hugging Face manages model caching; optionally configure its cache location with `HF_HOME`.

## Narration input

Write a structured JSON sidecar; the runtime never guesses narration from arbitrary Markdown. `scriptFile` is the Script file whose exact UTF-8 bytes are bound into review. `language` is required (`vi`, `en`, or explicit `vi-en` code-switching); unsupported languages fail without fallback. Segment IDs are stable across reorder and revision. Spoken text is exact. Silent beats require explicit positive duration; optional `gapAfterSeconds` records intentional silence after either kind of segment.

```json
{
  "version": "1",
  "scriptFile": ".video/script-draft.md",
  "language": "vi-en",
  "segments": [
    {"id": "opening", "text": "Xin chào. Hôm nay ta xem cách API xử lý tiếng Việt và HTTP."},
    {"id": "pause", "silent": true, "durationSeconds": 1.2, "gapAfterSeconds": 0.5},
    {"id": "close", "text": "Kết luận: dữ liệu vẫn nguyên vẹn."}
  ]
}
```

Save the Script at `scriptFile`, synthesize, then submit that same Script to Script review:

```sh
npm run video -- tts options
npm run video -- tts synthesize .video/narration-input.json
npm run video -- tts status
npm run video -- script commit .video/script-draft.md
```

Synthesis uses one fixed preset voice (`Minh Đức` by default), CPU fp32, 48 kHz PCM WAV, and native model prosody. There is no speed argument, playback-rate adjustment, time stretching, duration truncation, cloud fallback, or Nano substitution. Correct sample-rate conversion can be applied downstream only if it preserves duration.

The generated `.video/narration-manifest.json` binds exact Script, config, segment IDs, text, audio bytes, PCM sample count, sample rate, and measured duration. It also reports a synthesis batch's elapsed time and peak worker RSS. Cache identity depends on exact segment text and synthesis configuration, so reorder and duration-only Brief edits reuse audio. A complete validated manifest is written only after each segment WAV has been verified.

## Duration decisions

`durationPolicy` supports an approximate `targetSeconds`, a hard `maxSeconds` ceiling, or both. Legacy `durationSeconds` is interpreted only as an approximate target. A target alone never blocks review. The measured timeline includes explicit silent beats and gaps. An overrun of a hard ceiling requires a host decision (`shorten_script` or `revise_brief`); the runtime does not auto-edit the Script or speed up speech.

## Measurement status

A Vietnamese CPU/ONNX sample run with Python 3.12.3, VieNeu 3.8.3, and ONNX Runtime 1.31.0 produced a 9.44-second, 48 kHz WAV in 31.6 seconds including model load. Peak worker RSS was 1,987,506,176 bytes (about 1.85 GiB). This sample fits the approximate 3 GB worker-memory target; memory and latency depend on the machine and workload. A listening quality check was not performed; review the generated narration before production delivery.

## Upstream references

- [VieNeu-TTS upstream repository](https://github.com/pnnbao97/VieNeu-TTS)
- [VieNeu v3 Turbo model](https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo)
- [MOSS Audio Tokenizer Nano ONNX model](https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX)
