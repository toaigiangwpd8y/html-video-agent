#!/usr/bin/env python3
"""Isolated line-oriented VieNeu-TTS worker. Protocol JSON is stdout-only."""
import json
import os
import sys
import time
import traceback
from pathlib import Path
try:
    import resource
except ImportError:
    resource = None

SDK_VERSION = "3.8.3"
MODEL_ID = "pnnbao-ump/VieNeu-TTS-v3-Turbo"
MODEL_REVISION = "61b85e3d937fbbacb387714180e8182823512523"
CODEC_ID = "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX"
CODEC_REVISION = "ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae"
SAMPLE_RATE = 48000


def diagnostic(message):
    print(message, file=sys.stderr, flush=True)


def validate_config(config):
    if config.get("provider") != "vieneu-v3-turbo":
        raise ValueError("Only the pinned local VieNeu v3 Turbo provider is supported.")
    if config.get("sdkVersion") != SDK_VERSION or config.get("modelRevision") != MODEL_REVISION or config.get("codecRevision") != CODEC_REVISION:
        raise ValueError("Configured SDK/model/codec revision is not the pinned version.")
    if config.get("modelId") != MODEL_ID or config.get("codecId") != CODEC_ID:
        raise ValueError("Configured model or codec repository is not supported.")
    if config.get("device") != "cpu" or config.get("precision") != "fp32":
        raise ValueError("Only CPU fp32 is supported; no implicit precision fallback is allowed.")
    if not config.get("voice"):
        raise ValueError("A preset voice is required.")
    if config.get("language") not in ("vi", "en", "vi-en"):
        raise ValueError("Supported languages are Vietnamese, English, and explicit Vietnamese/English code-switching.")


def load_tts(config):
    from huggingface_hub import snapshot_download
    from vieneu import Vieneu

    model = snapshot_download(repo_id=MODEL_ID, revision=MODEL_REVISION, allow_patterns=["config.json", "onnx_update/*", "speaker_encoder.onnx", "denoiser.onnx", "voices_v3_turbo.json"])
    codec = snapshot_download(repo_id=CODEC_ID, revision=CODEC_REVISION, allow_patterns=["moss_audio_tokenizer_*", "codec_browser_onnx_meta.json"])
    # SDK 3.8.3 exposes model graph paths but leaves codec_dir at the moving
    # Hub default. Redirect that one internal fetch to the immutable snapshot.
    from vieneu._v3_turbo_engine.onnx_runtime_lite import OnnxV3LiteEngine
    original_fetch = OnnxV3LiteEngine._fetch
    def pinned_fetch(engine, repo, files, subfolder=None):
        if repo == "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX":
            return Path(codec)
        return original_fetch(engine, repo, files, subfolder)
    OnnxV3LiteEngine._fetch = pinned_fetch
    try:
        return Vieneu(mode="v3turbo", backbone_repo=model, backend="onnx", device="cpu", precision="fp32", onnx_dir=str(Path(model) / "onnx_update"))
    finally:
        OnnxV3LiteEngine._fetch = original_fetch


def sample_metadata(path):
    import soundfile as sf
    info = sf.info(str(path))
    if info.format != "WAV" or info.subtype not in ("PCM_16", "PCM_24", "PCM_32", "FLOAT"):
        raise ValueError("VieNeu output is not a supported WAV encoding.")
    if info.frames <= 0 or info.samplerate <= 0:
        raise ValueError("VieNeu produced an empty/invalid WAV.")
    return {"sampleRate": int(info.samplerate), "sampleCount": int(info.frames), "durationSeconds": float(info.frames / info.samplerate)}


def main():
    started = time.monotonic()
    try:
        request = json.load(sys.stdin)
        config = request.get("config") or {}
        validate_config(config)
        if request.get("action") == "probe":
            try:
                import vieneu
                from importlib.metadata import version
                from huggingface_hub import try_to_load_from_cache
                import onnxruntime
                import soundfile
                installed_sdk = version("vieneu")
                if installed_sdk != SDK_VERSION:
                    json.dump({"ready": False, "python": sys.version.split()[0], "sdkVersion": installed_sdk, "message": f"Expected vieneu {SDK_VERSION}, found {installed_sdk}."}, sys.stdout)
                    return 0
                from vieneu._v3_turbo_engine.onnx_runtime_lite import _GRAPH_FILES, _CODEC_FILES
                model_graphs = {name: try_to_load_from_cache(MODEL_ID, f"onnx_update/{name}", revision=MODEL_REVISION) for name in _GRAPH_FILES}
                codec_graphs = {name: try_to_load_from_cache(CODEC_ID, name, revision=CODEC_REVISION) for name in _CODEC_FILES}
                missing = [f"{MODEL_ID}/onnx_update/{name}" for name, path in model_graphs.items() if path is None]
                missing += [f"{CODEC_ID}/{name}" for name, path in codec_graphs.items() if path is None]
                available = not missing
                json.dump({"ready": available, "python": sys.version.split()[0], "message": "Pinned SDK, ONNX runtime, model graphs, and codec are ready." if available else "Pinned model, required ONNX graphs, or codec are not fully cached.", "missingFiles": missing, "sdkVersion": installed_sdk, "onnxruntimeVersion": onnxruntime.__version__, "soundfileVersion": soundfile.__version__}, sys.stdout)
                return 0
            except Exception as exc:
                json.dump({"ready": False, "python": sys.version.split()[0], "message": f"VieNeu readiness probe failed: {exc}"}, sys.stdout)
                return 0
        if request.get("action") != "synthesize":
            raise ValueError("Worker action must be probe or synthesize.")
        segments = request.get("segments")
        if not isinstance(segments, list) or not segments:
            raise ValueError("At least one narration segment is required.")
        tts = load_tts(config)  # Reuse the loaded SDK/model for this entire run.
        import soundfile as sf
        results = []
        seen = set()
        for segment in segments:
            sid, text, output = segment.get("id"), segment.get("text"), Path(segment.get("outputPath", "")).resolve()
            if not isinstance(sid, str) or not sid.replace("_", "").replace("-", "").isalnum() or sid in seen:
                raise ValueError("Segment ids must be unique safe identifiers.")
            seen.add(sid)
            if not isinstance(text, str) or not text.strip() or len(text) > 3000:
                raise ValueError(f"Segment {sid} text must contain 1–3000 characters.")
            cache_root = (Path(__file__).resolve().parents[2] / ".video" / "tts-cache").resolve()
            try:
                output.relative_to(cache_root)
            except ValueError:
                raise ValueError("Worker output must remain inside the local narration cache.")
            if output.suffix.lower() != ".wav":
                raise ValueError("Worker output path must end in .wav.")
            output.parent.mkdir(parents=True, exist_ok=True)
            wav = tts.infer(text, voice=config["voice"])
            sf.write(str(output), wav, SAMPLE_RATE, subtype="PCM_16", format="WAV")
            results.append({"id": sid, "outputPath": str(output), **sample_metadata(output)})
        usage = resource.getrusage(resource.RUSAGE_SELF) if resource else None
        peak_rss_bytes = int(usage.ru_maxrss * (1024 if sys.platform != "darwin" else 1)) if usage else 0
        json.dump({"ok": True, "segments": results, "sdkVersion": SDK_VERSION, "modelRevision": MODEL_REVISION, "elapsedMs": round((time.monotonic() - started) * 1000), "peakRssBytes": peak_rss_bytes}, sys.stdout)
        return 0
    except Exception as exc:
        diagnostic(f"VieNeu worker error: {exc}\n{traceback.format_exc()}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
