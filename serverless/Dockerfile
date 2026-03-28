FROM pytorch/pytorch:2.4.1-cuda12.4-cudnn9-devel

WORKDIR /app

# ffmpeg is required by whisperx for audio processing
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Remove pre-installed torch 2.4.1 so we can install a version
# matched to the CUDA toolkit in this image (12.4)
RUN pip uninstall -y torch torchvision torchaudio

# Install torch+torchaudio from the official CUDA 12.4 wheel index
RUN pip install --no-cache-dir \
    torch torchaudio --index-url https://download.pytorch.org/whl/cu124

# ctranslate2 must be installed before whisperx (build dependency)
RUN pip install --no-cache-dir ctranslate2

# Pin whisperx version for reproducible builds
RUN pip install --no-cache-dir "whisperx==3.1.1"

# Remaining dependencies (matplotlib required by pyannote.audio)
RUN pip install --no-cache-dir \
    runpod \
    transformers \
    librosa \
    soundfile \
    matplotlib

# numpy<2 MUST be installed LAST — pyannote.audio uses np.NaN which was
# removed in numpy 2.0. Earlier pip layers may upgrade numpy past 2.0.
RUN pip install --no-cache-dir "numpy<2"

# Fix: whisperx 3.1.1 (yanked unofficial release) has processor.sampling_rate
# which broke in newer transformers. See: https://github.com/m-bain/whisperX/issues/722
# Must run AFTER numpy<2 so `import whisperx` works to find the file path.
RUN sed -i 's/processor\.sampling_rate/processor.feature_extractor.sampling_rate/g' \
    $(python -c "import whisperx, os; print(os.path.join(os.path.dirname(whisperx.__file__), 'alignment.py'))")

COPY handler.py .

# Pre-download Wav2Vec2 CTC Quran model during build
RUN python -c "from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor; \
    Wav2Vec2Processor.from_pretrained('rabah2026/wav2vec2-large-xlsr-53-arabic-quran-v_final'); \
    Wav2Vec2ForCTC.from_pretrained('rabah2026/wav2vec2-large-xlsr-53-arabic-quran-v_final')"

# Pre-download wav2vec2 Arabic alignment model during build
RUN python -c "import whisperx; whisperx.load_align_model(language_code='ar', device='cpu')"

CMD ["python", "-u", "handler.py"]
