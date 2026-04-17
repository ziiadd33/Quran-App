FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Core dependencies (torch 2.6 already in base image)
# transformers pinned to 4.44.2 — newer versions have masking_utils changes
# incompatible with tarteel-ai/whisper-base-ar-quran (CUDA assert in find_packed_sequence_indices)
RUN pip install --no-cache-dir \
    runpod \
    "transformers==4.44.2" \
    librosa \
    soundfile

COPY handler.py .

CMD ["python", "-u", "handler.py"]
