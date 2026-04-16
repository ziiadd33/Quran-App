FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Core dependencies (torch 2.6 already in base image)
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
