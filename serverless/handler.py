import runpod
import torch
import io
import base64
import numpy as np
from transformers import (
    WhisperProcessor,
    WhisperForConditionalGeneration,
    Wav2Vec2ForCTC,
    Wav2Vec2Processor,
)
import librosa
import whisperx

# ── Device ────────────────────────────────────────────────────────────
device = "cuda" if torch.cuda.is_available() else "cpu"

# ── Load Whisper model once at cold start ─────────────────────────────
WHISPER_MODEL_ID = "tarteel-ai/whisper-base-ar-quran"
whisper_processor = WhisperProcessor.from_pretrained(WHISPER_MODEL_ID)
whisper_model = WhisperForConditionalGeneration.from_pretrained(WHISPER_MODEL_ID)
whisper_model.to(device)

# ── Load Wav2Vec2 CTC model once at cold start ───────────────────────
WAV2VEC2_MODEL_ID = "rabah2026/wav2vec2-large-xlsr-53-arabic-quran-v_final"
wav2vec2_processor = Wav2Vec2Processor.from_pretrained(WAV2VEC2_MODEL_ID)
wav2vec2_model = Wav2Vec2ForCTC.from_pretrained(WAV2VEC2_MODEL_ID)
wav2vec2_model.to(device)

# ── Load alignment model once at cold start ───────────────────────────
align_model, align_metadata = whisperx.load_align_model(
    language_code="ar", device=device
)


# ── Silence-based segmentation for CTC output ────────────────────────

def segment_by_silence(audio_array, text, sr=16000,
                       min_silence_len=0.3, silence_thresh_db=-40,
                       max_segment_duration=30.0):
    """
    Split CTC transcription into segments using silence detection.

    CTC models output continuous text without timestamps. We detect silent
    regions in the audio and use them as natural segment boundaries, then
    distribute the transcribed words proportionally across segments.

    Args:
        audio_array: numpy array of audio samples at sr
        text: full transcription text from CTC model
        sr: sample rate
        min_silence_len: minimum silence duration (seconds) to split on
        silence_thresh_db: dB threshold below which audio is "silent"
        max_segment_duration: force-split segments longer than this

    Returns:
        list of { "start": float, "end": float, "text": str }
    """
    if not text or not text.strip():
        return []

    # Compute RMS energy in short frames
    frame_length = int(0.025 * sr)  # 25ms frames
    hop_length = int(0.010 * sr)    # 10ms hop

    # Calculate RMS energy per frame
    rms = librosa.feature.rms(y=audio_array, frame_length=frame_length,
                               hop_length=hop_length)[0]

    # Convert to dB
    rms_db = librosa.amplitude_to_db(rms, ref=np.max(rms) if np.max(rms) > 0 else 1.0)

    # Find silent frames
    is_silent = rms_db < silence_thresh_db
    frame_times = librosa.frames_to_time(np.arange(len(rms_db)),
                                          sr=sr, hop_length=hop_length)

    # Find silence regions (contiguous silent frames)
    silence_regions = []
    in_silence = False
    silence_start = 0.0

    for i, silent in enumerate(is_silent):
        t = frame_times[i]
        if silent and not in_silence:
            in_silence = True
            silence_start = t
        elif not silent and in_silence:
            in_silence = False
            duration = t - silence_start
            if duration >= min_silence_len:
                silence_regions.append((silence_start, t))

    # End of audio
    if in_silence:
        duration = frame_times[-1] - silence_start
        if duration >= min_silence_len:
            silence_regions.append((silence_start, frame_times[-1]))

    # Build speech segments from gaps between silences
    audio_duration = len(audio_array) / sr
    speech_boundaries = []

    # Find speech regions (inverse of silence regions)
    prev_end = 0.0
    for sil_start, sil_end in silence_regions:
        if sil_start > prev_end + 0.1:  # at least 100ms of speech
            speech_boundaries.append((prev_end, sil_start))
        prev_end = sil_end

    # Last segment
    if prev_end < audio_duration - 0.1:
        speech_boundaries.append((prev_end, audio_duration))

    # If no silence detected, treat entire audio as one segment
    if not speech_boundaries:
        speech_boundaries = [(0.0, audio_duration)]

    # Merge short segments and split long ones
    merged = []
    for start, end in speech_boundaries:
        if merged and (start - merged[-1][1]) < min_silence_len:
            # Merge with previous if gap is too short
            merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))

    # Force-split segments that are too long
    final_boundaries = []
    for start, end in merged:
        duration = end - start
        if duration <= max_segment_duration:
            final_boundaries.append((start, end))
        else:
            # Split into roughly equal parts
            n_parts = int(np.ceil(duration / max_segment_duration))
            part_dur = duration / n_parts
            for p in range(n_parts):
                ps = start + p * part_dur
                pe = start + (p + 1) * part_dur
                final_boundaries.append((ps, min(pe, end)))

    # Distribute words proportionally across segments based on duration
    words = text.split()
    total_speech_duration = sum(end - start for start, end in final_boundaries)

    segments = []
    word_idx = 0
    for start, end in final_boundaries:
        seg_duration = end - start
        # Proportion of words for this segment
        word_share = seg_duration / total_speech_duration if total_speech_duration > 0 else 1.0
        n_words = max(1, round(word_share * len(words)))

        seg_words = words[word_idx:word_idx + n_words]
        word_idx += n_words

        if seg_words:
            segments.append({
                "start": round(start, 2),
                "end": round(end, 2),
                "text": " ".join(seg_words),
            })

    # Assign remaining words to last segment
    if word_idx < len(words) and segments:
        segments[-1]["text"] += " " + " ".join(words[word_idx:])

    return segments


def transcribe_ctc_handler(audio_array):
    """
    Transcription using Wav2Vec2 CTC model (no hallucinations).

    Returns segments in the same format as Whisper for compatibility
    with the downstream matcher pipeline.
    """
    # Process audio with Wav2Vec2
    inputs = wav2vec2_processor(
        audio_array, sampling_rate=16000, return_tensors="pt", padding=True
    )

    with torch.no_grad():
        logits = wav2vec2_model(
            inputs.input_values.to(device)
        ).logits

    # Decode CTC output
    predicted_ids = torch.argmax(logits, dim=-1)
    transcription = wav2vec2_processor.batch_decode(
        predicted_ids, skip_special_tokens=True
    )[0]

    # Segment by silence detection
    segments = segment_by_silence(audio_array, transcription)

    # If segmentation failed, return as single segment
    if not segments:
        duration = len(audio_array) / 16000
        if transcription.strip():
            segments = [{"start": 0.0, "end": round(duration, 2), "text": transcription}]

    return {"segments": segments}


def transcribe_handler(audio_array):
    """Original Whisper transcription mode."""
    input_features = whisper_processor(
        audio_array, sampling_rate=16000, return_tensors="pt"
    ).input_features.to(device)

    predicted_ids = whisper_model.generate(
        input_features,
        return_timestamps=True,
        language="ar",
        task="transcribe",
    )

    result = whisper_processor.batch_decode(
        predicted_ids, skip_special_tokens=True, output_offsets=True
    )

    segments = []
    if result and len(result) > 0:
        for chunk in result[0].get("offsets", []):
            segments.append({
                "start": chunk["timestamp"][0],
                "end": chunk["timestamp"][1],
                "text": chunk["text"],
            })

    if not segments and result:
        text = result[0] if isinstance(result[0], str) else result[0].get("text", "")
        if text:
            duration = len(audio_array) / 16000
            segments.append({"start": 0.0, "end": duration, "text": text})

    return {"segments": segments}


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
    elif mode == "transcribe_ctc":
        return transcribe_ctc_handler(audio_array)
    else:
        return transcribe_handler(audio_array)


runpod.serverless.start({"handler": handler})
