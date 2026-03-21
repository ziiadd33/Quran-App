"""
Local test for Tarteel Whisper — runs on CPU, no GPU needed.
Usage: python test_local.py <path_to_audio_file>
"""
import sys
import json
import torch
from transformers import pipeline, GenerationConfig
import librosa

if len(sys.argv) < 2:
    print("Usage: python test_local.py <audio_file>")
    print("Example: python test_local.py recording.wav")
    sys.exit(1)

audio_path = sys.argv[1]
print(f"Loading Tarteel Whisper model (first time downloads ~300MB)...")

pipe = pipeline(
    "automatic-speech-recognition",
    model="tarteel-ai/whisper-base-ar-quran",
    device="cpu",
    chunk_length_s=30,
    stride_length_s=5,
)

# Patch timestamp config from openai/whisper-base
base_gen_config = GenerationConfig.from_pretrained("openai/whisper-base")
pipe.model.generation_config.no_timestamps_token_id = base_gen_config.no_timestamps_token_id
pipe.model.generation_config.begin_timestamps = base_gen_config.begin_timestamps

print(f"Loading audio: {audio_path}")
audio_array, sr = librosa.load(audio_path, sr=16000)
duration = len(audio_array) / 16000
print(f"Audio duration: {duration:.1f}s ({duration/60:.1f} min)")

print("Transcribing (this may take a few minutes on CPU)...")
result = pipe(
    {"raw": audio_array, "sampling_rate": 16000},
    return_timestamps=True,
    generate_kwargs={"language": "ar", "task": "transcribe"},
)

segments = []
if result and "chunks" in result:
    for chunk in result["chunks"]:
        ts = chunk.get("timestamp", (0, 0))
        segments.append({
            "start": ts[0] if ts[0] is not None else 0,
            "end": ts[1] if ts[1] is not None else 0,
            "text": chunk["text"],
        })

print(f"\n=== {len(segments)} segments found ===\n")
for i, seg in enumerate(segments):
    print(f"[{seg['start']:.1f}s - {seg['end']:.1f}s] {seg['text']}")

# Save to file
output_path = "tarteel-local-output.json"
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(segments, f, ensure_ascii=False, indent=2)
print(f"\nSaved to {output_path}")
