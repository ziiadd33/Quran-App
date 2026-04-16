FROM pytorch/pytorch:2.4.1-cuda12.4-cudnn9-runtime

WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Upgrade torch to 2.6+ (transformers requires it to load .bin models, CVE-2025-32434)
RUN pip install --no-cache-dir "torch>=2.6.0" torchaudio \
    --index-url https://download.pytorch.org/whl/cu124

# Core dependencies
RUN pip install --no-cache-dir \
    runpod \
    transformers \
    librosa \
    soundfile

COPY handler.py .

# Pre-download tarteel-ai/whisper-base-ar-quran during build
RUN python -c "from transformers import pipeline; \
    pipeline('automatic-speech-recognition', model='tarteel-ai/whisper-base-ar-quran')"

CMD ["python", "-u", "handler.py"]
