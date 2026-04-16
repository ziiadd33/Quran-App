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

CMD ["python", "-u", "handler.py"]
