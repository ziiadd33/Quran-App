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


def split_audio_on_silence(audio_array, sr=16000, target_duration=20.0, top_db=30):
    """
    Split audio at silence gaps, targeting ~target_duration seconds per chunk.

    Uses librosa.effects.split() to find non-silent intervals, then groups them
    into chunks using silence midpoints as natural cut boundaries. This avoids
    cutting mid-word (unlike fixed-time chunking).

    Args:
        audio_array: numpy array of audio samples
        sr: sample rate
        target_duration: target chunk length in seconds (~20s)
        top_db: silence threshold in dB below peak (higher = more aggressive)

    Returns:
        list of (start_time_seconds, audio_slice) tuples
    """
    intervals = librosa.effects.split(audio_array, top_db=top_db,
                                       frame_length=2048, hop_length=512)
    if len(intervals) == 0:
        return [(0.0, audio_array)]

    # Build potential cut points at midpoint of each silence gap
    cut_samples = [0]
    for i in range(1, len(intervals)):
        gap_start = int(intervals[i - 1][1])
        gap_end = int(intervals[i][0])
        if gap_end > gap_start:
            cut_samples.append((gap_start + gap_end) // 2)
    cut_samples.append(len(audio_array))

    # Greedily group cut points into chunks of ~target_duration
    target_samples = int(target_duration * sr)
    max_samples = int(target_duration * 2 * sr)  # absolute max: 2x target
    chunks = []
    chunk_start_idx = 0

    for i in range(1, len(cut_samples)):
        chunk_len = cut_samples[i] - cut_samples[chunk_start_idx]
        if chunk_len >= target_samples and i > chunk_start_idx + 1:
            # Use previous cut point as boundary (i-1 is the last good silence)
            boundary = cut_samples[i - 1]
            chunks.append((
                cut_samples[chunk_start_idx] / sr,
                audio_array[cut_samples[chunk_start_idx]:boundary]
            ))
            chunk_start_idx = i - 1
        elif chunk_len >= max_samples:
            # Force split at this cut point even if not ideal
            boundary = cut_samples[i]
            chunks.append((
                cut_samples[chunk_start_idx] / sr,
                audio_array[cut_samples[chunk_start_idx]:boundary]
            ))
            chunk_start_idx = i

    # Last chunk
    if cut_samples[chunk_start_idx] < len(audio_array):
        chunks.append((
            cut_samples[chunk_start_idx] / sr,
            audio_array[cut_samples[chunk_start_idx]:]
        ))

    return chunks  # list of (start_time_seconds, audio_slice)


def transcribe_ctc_handler(audio_array):
    """
    Transcription using Wav2Vec2 CTC model (no hallucinations).

    Splits audio at silence boundaries (~20s target) to keep the CTC model
    within its effective range. Each sub-chunk is transcribed independently
    and timestamps are offset to absolute position. No overlap needed since
    cuts happen at silence gaps (not mid-word).
    """
    audio_duration = len(audio_array) / 16000
    all_segments = []

    # Split at silence gaps, targeting ~20s chunks
    sub_chunks = split_audio_on_silence(audio_array, sr=16000, target_duration=20.0)

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

    # Sort by start time (chunks are already non-overlapping)
    all_segments.sort(key=lambda s: s["start"])

    # Fallback
    if not all_segments:
        all_segments = [{"start": 0.0, "end": round(audio_duration, 2), "text": "", "words": []}]

    return {"segments": all_segments}



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
