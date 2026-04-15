# Quran Worker v6 — tarteel-ai/whisper-base-ar-quran
# One tool per task: Whisper for transcription only (no timestamps from CTC)
import runpod
import torch
import io
import base64
import librosa
from transformers import pipeline

# ── Device ────────────────────────────────────────────────────────────
device = "cuda" if torch.cuda.is_available() else "cpu"

# ── Load model once at cold start ─────────────────────────────────────
# chunk_length_s=30 + stride_length_s=5: transformers handles long audio
# automatically — overlapping windows, automatic deduplication, no manual splitting.
whisper_pipe = pipeline(
    "automatic-speech-recognition",
    model="tarteel-ai/whisper-base-ar-quran",
    device=device,
    chunk_length_s=30,
    stride_length_s=5,
)


def transcribe_handler(audio_array):
    """
    Transcribe Quranic Arabic audio using tarteel-ai/whisper-base-ar-quran.

    Returns full text + chunk-level timestamps (approximate, from Whisper).
    These chunks are for validation only — precise word timestamps come in Phase 3
    via forced alignment with the canonical Quran text.
    """
    result = whisper_pipe(
        {"raw": audio_array, "sampling_rate": 16000},
        return_timestamps=True,
    )

    # Normalize chunks: transformers returns [start, end] or None
    chunks = []
    for chunk in result.get("chunks", []):
        ts = chunk.get("timestamp")
        if ts and len(ts) == 2:
            chunks.append({
                "text": chunk["text"],
                "timestamp": [
                    round(ts[0], 2) if ts[0] is not None else None,
                    round(ts[1], 2) if ts[1] is not None else None,
                ],
            })
        else:
            chunks.append({"text": chunk["text"], "timestamp": [None, None]})

    return {
        "text": result["text"],
        "chunks": chunks,
    }


def handler(event):
    """RunPod serverless handler — receives base64 audio, returns transcription."""
    inp = event["input"]
    audio_b64 = inp["audio"]
    audio_bytes = base64.b64decode(audio_b64)
    audio_array, sr = librosa.load(io.BytesIO(audio_bytes), sr=16000)
    return transcribe_handler(audio_array)


runpod.serverless.start({"handler": handler})
