FROM pytorch/pytorch:2.4.1-cuda12.4-cudnn9-devel

WORKDIR /app

# Remove pre-installed torch 2.4.1 (too old for transformers >= 5.x CVE fix)
# so pip can resolve all versions together from scratch
RUN pip uninstall -y torch torchvision torchaudio

# Install ALL dependencies in one pip command for proper version resolution.
# Modern PyPI torch (>= 2.6) includes CUDA support natively.
RUN pip install --no-cache-dir \
    runpod \
    transformers \
    librosa \
    soundfile \
    whisperx

COPY handler.py .

# Pre-download Whisper model during build (faster cold starts)
RUN python -c "from transformers import WhisperProcessor, WhisperForConditionalGeneration; \
    WhisperProcessor.from_pretrained('tarteel-ai/whisper-base-ar-quran'); \
    WhisperForConditionalGeneration.from_pretrained('tarteel-ai/whisper-base-ar-quran')"

# Pre-download Wav2Vec2 CTC Quran model during build
RUN python -c "from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor; \
    Wav2Vec2Processor.from_pretrained('rabah2026/wav2vec2-large-xlsr-53-arabic-quran-v_final'); \
    Wav2Vec2ForCTC.from_pretrained('rabah2026/wav2vec2-large-xlsr-53-arabic-quran-v_final')"

# Pre-download wav2vec2 Arabic alignment model during build
RUN python -c "import whisperx; whisperx.load_align_model(language_code='ar', device='cpu')"

CMD ["python", "-u", "handler.py"]
