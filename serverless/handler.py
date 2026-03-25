# Quran Worker v5 — Wav2Vec2 CTC with fixed 30s chunks (no silence detection)
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
        list of {"start": float, "end": float, "text": str, "words": list}
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
                "words": [
                    {"word": w["text"], "start": round(w["start"], 3), "end": round(w["end"], 3)}
                    for w in current_seg
                ],
            })
            current_seg = [word]
        else:
            current_seg.append(word)

    if current_seg:
        segments.append({
            "start": round(current_seg[0]["start"], 2),
            "end": round(current_seg[-1]["end"], 2),
            "text": " ".join(w["text"] for w in current_seg),
            "words": [
                {"word": w["text"], "start": round(w["start"], 3), "end": round(w["end"], 3)}
                for w in current_seg
            ],
        })

    return segments


def split_fixed_chunks(audio_array, sr=16000, chunk_duration=30.0, overlap=5.0):
    """
    Split audio into fixed-duration chunks with overlap.

    Previous silence-based splitting (top_db=30) classified quiet tajweed
    recitation as silence, creating huge sub-chunks that overwhelmed the CTC
    model. Fixed chunks ensure every piece of audio gets transcribed.

    Args:
        audio_array: numpy array of audio samples
        sr: sample rate
        chunk_duration: duration of each chunk in seconds
        overlap: overlap between consecutive chunks in seconds

    Returns:
        list of (start_time_seconds, audio_slice) tuples
    """
    total_samples = len(audio_array)
    chunk_samples = int(chunk_duration * sr)
    step_samples = int((chunk_duration - overlap) * sr)

    chunks = []
    pos = 0
    while pos < total_samples:
        end = min(pos + chunk_samples, total_samples)
        chunk_audio = audio_array[pos:end]
        chunk_start_time = pos / sr
        chunks.append((chunk_start_time, chunk_audio))
        pos += step_samples
        if end >= total_samples:
            break

    return chunks


def transcribe_ctc_handler(audio_array):
    """
    Transcription using Wav2Vec2 CTC model (no hallucinations).

    Splits audio into fixed 30s chunks with 5s overlap. Previous silence-based
    splitting only captured ~14% of the audio because quiet tajweed recitation
    was classified as silence (top_db=30 vs loud takbirat peaks).
    """
    audio_duration = len(audio_array) / 16000
    all_segments = []

    # Fixed 30s chunks with 5s overlap — ensures ALL audio reaches the CTC model
    sub_chunks = split_fixed_chunks(audio_array, sr=16000,
                                      chunk_duration=30.0, overlap=5.0)

    for chunk_start_time, chunk_audio in sub_chunks:
        if len(chunk_audio) < 1600:  # skip tiny chunks < 0.1s
            continue

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
            if seg.get("words"):
                for w in seg["words"]:
                    w["start"] = round(w["start"] + chunk_start_time, 3)
                    w["end"] = round(w["end"] + chunk_start_time, 3)

        all_segments.extend(segments)

    # Sort and deduplicate segments from overlap zones
    all_segments.sort(key=lambda s: s["start"])
    deduped = []
    for seg in all_segments:
        if deduped and abs(seg["start"] - deduped[-1]["start"]) < 0.5:
            # Duplicate from overlap zone — keep the longer (more complete) one
            if (seg["end"] - seg["start"]) > (deduped[-1]["end"] - deduped[-1]["start"]):
                deduped[-1] = seg
        else:
            deduped.append(seg)

    # Fallback
    if not deduped:
        deduped = [{"start": 0.0, "end": round(audio_duration, 2), "text": "", "words": []}]

    return {"segments": deduped}



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
