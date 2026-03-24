# Quran Worker v4 — Wav2Vec2 CTC with 30s sub-chunk splitting
import runpod
import torch
import io
import base64
import numpy as np
from transformers import (
    Wav2Vec2ForCTC,
    Wav2Vec2Processor,
)
import librosa
import whisperx

# ── Device ────────────────────────────────────────────────────────────
device = "cuda" if torch.cuda.is_available() else "cpu"

# ── Load Wav2Vec2 CTC model once at cold start ───────────────────────
WAV2VEC2_MODEL_ID = "rabah2026/wav2vec2-large-xlsr-53-arabic-quran-v_final"
wav2vec2_processor = Wav2Vec2Processor.from_pretrained(WAV2VEC2_MODEL_ID)
wav2vec2_model = Wav2Vec2ForCTC.from_pretrained(WAV2VEC2_MODEL_ID)
wav2vec2_model.to(device)

# ── Load alignment model once at cold start ───────────────────────────
align_model, align_metadata = whisperx.load_align_model(
    language_code="ar", device=device
)


# ── CTC-based segmentation using real character timestamps ────────────

def build_segments_from_ctc(char_offsets, seconds_per_frame, audio_duration,
                              min_pause=0.3, max_seg_duration=15.0):
    """
    Build segments using REAL timestamps from CTC character offsets.

    Wav2Vec2 CTC logits have one frame per ~20ms of audio. Each character
    in the decoded output maps to a logit frame, giving us actual timestamps
    instead of silence-based proportional estimates.

    Args:
        char_offsets: list of {"char": str, "start_offset": int (CTC frame index)}
        seconds_per_frame: audio_duration / n_logit_frames
        audio_duration: total duration of the audio in seconds
        min_pause: minimum gap (seconds) between words to start a new segment
        max_seg_duration: force a new segment if current exceeds this duration

    Returns:
        list of {"start": float, "end": float, "text": str}
    """
    if not char_offsets:
        return []

    # Group characters into words using spaces as delimiters
    words = []
    current_chars = []

    for item in char_offsets:
        char = item["char"]
        start_time = item["start_offset"] * seconds_per_frame

        if char == " ":
            if current_chars:
                words.append({
                    "text": "".join(c["char"] for c in current_chars),
                    "start": current_chars[0]["time"],
                    "end": start_time,
                })
                current_chars = []
        else:
            current_chars.append({"char": char, "time": start_time})

    # Last word (no trailing space) — estimate end from char count
    if current_chars:
        estimated_duration = max(0.5, len(current_chars) * 0.08)
        word_end = min(current_chars[0]["time"] + estimated_duration, audio_duration)
        words.append({
            "text": "".join(c["char"] for c in current_chars),
            "start": current_chars[0]["time"],
            "end": word_end,
        })

    if not words:
        return []

    # Group words into segments: split on pause >= min_pause OR segment >= max_seg_duration
    segments = []
    current_seg = [words[0]]

    for word in words[1:]:
        gap = word["start"] - current_seg[-1]["end"]
        seg_duration = word["end"] - current_seg[0]["start"]

        if gap >= min_pause or seg_duration >= max_seg_duration:
            segments.append({
                "start": round(current_seg[0]["start"], 2),
                "end": round(current_seg[-1]["end"], 2),
                "text": " ".join(w["text"] for w in current_seg),
            })
            current_seg = [word]
        else:
            current_seg.append(word)

    if current_seg:
        segments.append({
            "start": round(current_seg[0]["start"], 2),
            "end": round(current_seg[-1]["end"], 2),
            "text": " ".join(w["text"] for w in current_seg),
        })

    return segments


def split_audio(audio_array, sr=16000, chunk_duration=30.0, overlap=0.5):
    """Split audio into overlapping chunks of chunk_duration seconds."""
    chunk_samples = int(chunk_duration * sr)
    overlap_samples = int(overlap * sr)
    step = chunk_samples - overlap_samples
    chunks = []
    start = 0
    while start < len(audio_array):
        end = min(start + chunk_samples, len(audio_array))
        chunks.append((start / sr, audio_array[start:end]))
        if end == len(audio_array):
            break
        start += step
    return chunks  # list of (start_time_seconds, audio_slice)


def transcribe_ctc_handler(audio_array):
    """
    Transcription using Wav2Vec2 CTC model (no hallucinations).

    Splits audio into 30s sub-chunks to keep the CTC model within its
    effective range (~15-20s of meaningful output per chunk). Each sub-chunk
    is transcribed independently and timestamps are offset to absolute position.
    """
    audio_duration = len(audio_array) / 16000
    all_segments = []

    # Split into 30s sub-chunks to keep CTC model within its effective range
    sub_chunks = split_audio(audio_array, sr=16000, chunk_duration=30.0, overlap=0.5)

    for chunk_start_time, chunk_audio in sub_chunks:
        inputs = wav2vec2_processor(
            chunk_audio, sampling_rate=16000, return_tensors="pt", padding=True
        )
        with torch.no_grad():
            logits = wav2vec2_model(inputs.input_values.to(device)).logits

        predicted_ids = torch.argmax(logits, dim=-1)

        outputs = wav2vec2_processor.batch_decode(
            predicted_ids.cpu(),
            output_char_offsets=True,
            skip_special_tokens=True,
        )

        char_offsets = outputs.char_offsets[0]
        chunk_duration = len(chunk_audio) / 16000
        seconds_per_frame = chunk_duration / logits.shape[1]

        segments = build_segments_from_ctc(char_offsets, seconds_per_frame, chunk_duration)

        # Offset timestamps to absolute position in the full audio
        for seg in segments:
            seg["start"] = round(seg["start"] + chunk_start_time, 2)
            seg["end"] = round(seg["end"] + chunk_start_time, 2)

        all_segments.extend(segments)

    # Merge overlapping segments from adjacent sub-chunks
    all_segments.sort(key=lambda s: s["start"])
    merged = []
    for seg in all_segments:
        if merged and seg["start"] < merged[-1]["end"] - 0.1:
            # Overlapping: keep the one with more text
            if len(seg["text"]) > len(merged[-1]["text"]):
                merged[-1] = seg
        else:
            merged.append(seg)

    # Fallback
    if not merged:
        merged = [{"start": 0.0, "end": round(audio_duration, 2), "text": ""}]

    return {"segments": merged}



def align_handler(audio_array, text, language="ar"):
    """
    Forced alignment mode.
    Given audio + known text, return per-word timestamps.
    """
    duration = len(audio_array) / 16000

    # WhisperX expects a "transcript" with segments to align
    transcript_segments = [{
        "text": text,
        "start": 0.0,
        "end": duration,
    }]

    aligned = whisperx.align(
        transcript_segments,
        align_model,
        align_metadata,
        audio_array,
        device,
        return_char_alignments=False,
    )

    # Extract word-level timestamps
    word_segments = []
    for ws in aligned.get("word_segments", []):
        word_segments.append({
            "word": ws.get("word", ""),
            "start": ws.get("start", 0.0),
            "end": ws.get("end", 0.0),
            "score": ws.get("score", 0.0),
        })

    # Extract segment-level timestamps
    segments = []
    for seg in aligned.get("segments", []):
        segments.append({
            "text": seg.get("text", ""),
            "start": seg.get("start", 0.0),
            "end": seg.get("end", 0.0),
        })

    return {
        "word_segments": word_segments,
        "segments": segments,
    }


def handler(event):
    """RunPod serverless handler — routes to transcribe, transcribe_ctc, or align mode."""
    inp = event["input"]
    mode = inp.get("mode", "transcribe")

    audio_b64 = inp["audio"]
    audio_bytes = base64.b64decode(audio_b64)
    audio_array, sr = librosa.load(io.BytesIO(audio_bytes), sr=16000)

    if mode == "align":
        text = inp["text"]
        language = inp.get("language", "ar")
        return align_handler(audio_array, text, language)
    else:
        return transcribe_ctc_handler(audio_array)


runpod.serverless.start({"handler": handler})
