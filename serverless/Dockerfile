FROM pytorch/pytorch:2.4.1-cuda12.4-cudnn9-devel

WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Remove pre-installed torch so we install one matched to CUDA 12.4
RUN pip uninstall -y torch torchvision torchaudio

# Install torch + torchaudio from official CUDA 12.4 wheel index
RUN pip install --no-cache-dir \
    torch torchaudio --index-url https://download.pytorch.org/whl/cu124

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
