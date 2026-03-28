# Quran Worker v5 — Wav2Vec2 CTC with fixed 30s chunks (no silence detection)
# Trigger redeploy
import re
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

# Fix: WhisperX alignment.py:232 accesses processor.sampling_rate but newer
# transformers moved it to processor.feature_extractor.sampling_rate.
# Without this patch, every alignment call throws AttributeError silently.
if not hasattr(Wav2Vec2Processor, 'sampling_rate'):
    Wav2Vec2Processor.sampling_rate = property(
        lambda self: getattr(self.feature_extractor, 'sampling_rate', 16000)
    )


def strip_tashkeel(text: str) -> str:
    """Remove Arabic diacritics (tashkeel) that WhisperX alignment model can't handle.
    CTC outputs full diacritics but MMS alignment model expects plain Arabic."""
    return re.sub(r'[\u064B-\u065F\u0670]', '', text)

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


def align_chunk_text(chunk_audio, ctc_text, chunk_duration):
    """
    Second pass: use WhisperX forced alignment to get real timestamps
    for text that CTC already transcribed accurately.

    CTC timestamps are compressed 3-8x because CTC frames don't map
    linearly to real audio time when silence/takbirat is present.
    WhisperX does phoneme-level audio-text alignment (not re-transcription).

    IMPORTANT: CTC outputs full Arabic diacritics (tashkeel) but the
    WhisperX MMS alignment model expects plain Arabic. We strip diacritics
    before alignment to prevent silent failures.
    """
    if not ctc_text.strip():
        return None
    try:
        # Strip tashkeel — CTC outputs diacritics that MMS alignment can't handle
        clean_text = strip_tashkeel(ctc_text)
        print(f"[align_chunk] Aligning {len(clean_text.split())} words over {chunk_duration:.1f}s")

        transcript_segments = [{"text": clean_text, "start": 0.0, "end": chunk_duration}]
        aligned = whisperx.align(
            transcript_segments, align_model, align_metadata,
            chunk_audio, device, return_char_alignments=False,
        )
        word_segments = aligned.get("word_segments", [])

        if word_segments:
            # Count how many words got valid timestamps
            valid = sum(1 for w in word_segments if w.get("start") is not None and w.get("end") is not None)
            print(f"[align_chunk] WhisperX returned {len(word_segments)} words, {valid} with valid timestamps")
        else:
            print(f"[align_chunk] WhisperX returned empty word_segments")

        return word_segments if word_segments else None
    except Exception as e:
        print(f"[align_chunk] WhisperX alignment failed: {e}")
        return None


def rebuild_segments_from_alignment(ctc_segments, whisperx_words):
    """
    Replace CTC word timestamps with WhisperX-aligned timestamps.
    Walks both lists in order, matching CTC words to WhisperX words 1:1.
    Adds alignment_quality field: "aligned" or "ctc_fallback".
    """
    if not whisperx_words:
        return ctc_segments
    wx_idx = 0
    rebuilt = []
    for seg in ctc_segments:
        ctc_words = seg.get("words", [])
        new_words = []
        seg_has_aligned = False
        for cw in ctc_words:
            matched = False
            if wx_idx < len(whisperx_words):
                wx = whisperx_words[wx_idx]
                w_start = wx.get("start")
                w_end = wx.get("end")
                if w_start is not None and w_end is not None:
                    new_words.append({"word": cw["word"], "start": round(w_start, 3), "end": round(w_end, 3)})
                    seg_has_aligned = True
                    matched = True
                wx_idx += 1
            if not matched:
                new_words.append(cw)
        if new_words and seg_has_aligned:
            rebuilt.append({
                "start": round(new_words[0].get("start", seg["start"]), 2),
                "end": round(new_words[-1].get("end", seg["end"]), 2),
                "text": seg["text"],
                "words": new_words,
                "alignment_quality": "aligned",
            })
        else:
            rebuilt.append({**seg, "alignment_quality": "ctc_fallback"})
    return rebuilt


def transcribe_ctc_handler(audio_array):
    """
    Two-pass transcription: CTC for text accuracy + WhisperX for real timestamps.

    Pass 1: Wav2Vec2 CTC — accurate Arabic Quranic text (no hallucinations)
    Pass 2: WhisperX forced alignment — real word-level timestamps

    CTC timestamps are compressed 3-8x; WhisperX corrects them by aligning
    the known text against the actual audio phonemes.
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

        # Second pass: WhisperX forced alignment for real timestamps
        ctc_text = " ".join(seg["text"] for seg in segments)
        whisperx_words = align_chunk_text(chunk_audio, ctc_text, chunk_duration)

        if whisperx_words:
            segments = rebuild_segments_from_alignment(segments, whisperx_words)
        else:
            for seg in segments:
                seg["alignment_quality"] = "ctc_fallback"

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
