# Plan: Reestructuración del Pipeline — "Una herramienta para cada tarea"

## Context

El pipeline actual usa wav2vec2 CTC como modelo principal para transcribir Y producir timestamps. Esto genera:
- Tokens fusionados, timestamps comprimidos 3-8x
- matcher.ts de 999 líneas compensando errores del modelo
- Cortes imprecisos: Allahu Akbar leaks, ayahs cortadas, Fatiha tails

El nuevo pipeline separa responsabilidades. **Reemplazamos v1 directamente** — no mantenemos código en paralelo.

**Regla fundamental**: No avanzamos al paso N+1 hasta que el paso N esté **demostrado** con outputs reales.

---

## Arquitectura nueva

```
Paso 1: Audio → tarteel-ai/whisper-base-ar-quran (RunPod) → Texto árabe
Paso 2: Texto → Fuzzy matching vs 6,236 ayat → "Surah X, ayahs Y-Z"  
Paso 3: Audio + texto canónico → Forced alignment → Word timestamps precisos
Paso 4: Timestamps precisos → Corte quirúrgico → Audio limpio
```

**Backend**: RunPod (misma infraestructura, nuevo modelo)
**Transición**: Reemplazo directo de v1

---

## FASE 1: TRANSCRIPCIÓN (implementar ahora)

### Objetivo
Conseguir que tarteel-ai/whisper-base-ar-quran transcriba audio largo (20min-1hr) y produzca texto árabe legible.

### Estrategia para audio largo
La librería `transformers` tiene chunking automático para Whisper:
- `chunk_length_s=30`: ventanas de 30s
- `stride_length_s=5`: overlap de 5s entre ventanas
- Fusión automática de resultados (sin duplicados)
- Devuelve texto completo + chunks opcionales con timestamps aproximados

### Cambios

#### 1. `serverless/handler.py` — REESCRIBIR
Eliminar wav2vec2 completamente. Nuevo handler con tarteel-ai:

```python
from transformers import pipeline
import torch, librosa, base64, io
import runpod

device = "cuda" if torch.cuda.is_available() else "cpu"

# Cargar modelo una vez al cold start
whisper_pipe = pipeline(
    "automatic-speech-recognition",
    model="tarteel-ai/whisper-base-ar-quran",
    device=device,
    chunk_length_s=30,
    stride_length_s=5,
)

def transcribe_handler(audio_array):
    # transformers pipeline acepta numpy array directamente
    result = whisper_pipe(
        {"raw": audio_array, "sampling_rate": 16000},
        return_timestamps=True,
    )
    return {
        "text": result["text"],
        "chunks": result.get("chunks", []),
    }

def handler(event):
    inp = event["input"]
    audio_b64 = inp["audio"]
    audio_bytes = base64.b64decode(audio_b64)
    audio_array, sr = librosa.load(io.BytesIO(audio_bytes), sr=16000)
    return transcribe_handler(audio_array)

runpod.serverless.start({"handler": handler})
```

#### 2. `serverless/Dockerfile` — SIMPLIFICAR
Eliminar wav2vec2, whisperx, ctranslate2. Solo:
- torch + torchaudio (CUDA)
- transformers
- librosa
- runpod
- Pre-download tarteel-ai/whisper-base-ar-quran

#### 3. `quran-app/src/app/api/recitations/[id]/transcribe/route.ts` — REESCRIBIR
Simplificar: envía audio a RunPod, recibe texto + chunks.
Ya no necesita manejar múltiples modos (json vs multipart).

```typescript
// Input: audioBase64 (audio completo o segmento grande)
// Output: { text: string, chunks: { text: string, timestamp: [number, number] }[] }
```

#### 4. `quran-app/src/hooks/use-audio-processor.ts` — SIMPLIFICAR (solo Paso 1)
Reducir a:
1. Decode audio
2. Convertir a WAV 16kHz mono base64
3. Enviar a RunPod (un solo request, o segmentos de ~3-5 min si el audio es muy largo)
4. Recibir texto transcrito
5. Guardar en debug-outputs/whisper-tarteel/ para verificación
6. Mostrar resultado en UI

**Eliminar**: steps 3-7 del pipeline actual (matcher, alignment, extraction, MP3 encode). Se reconstruirán en fases posteriores.

#### 5. `quran-app/src/lib/audio/types.ts` — ACTUALIZAR
Nuevos tipos para el pipeline v2:

```typescript
/** Result from Step 1: Whisper transcription */
export interface TranscriptionV2Result {
  text: string;
  chunks: { text: string; timestamp: [number, number] }[];
}
```

#### 6. Archivos a ELIMINAR
- `quran-app/src/lib/audio/whisper.ts` (OpenAI Whisper API, ya no se usa)
- `quran-app/src/lib/audio/llm-analyzer.ts` (orchestrador v1)
- `quran-app/src/lib/audio/speech-filter.ts` (filtrado v1)
- `quran-app/src/lib/quran/matcher.ts` (999 líneas, reemplazado en Fase 2)
- `quran-app/src/lib/quran/llm-corrector.ts` (corrector v1)
- `quran-app/src/lib/quran/llm-cut-refiner.ts` (refinador v1)
- `quran-app/src/lib/quran/segment-deduplicator.ts` (dedup v1)
- `quran-app/src/lib/quran/section-builder.ts` (builder v1)
- `quran-app/src/app/api/recitations/[id]/analyze/route.ts` (endpoint v1)

#### 7. Archivos que se CONSERVAN (se reutilizarán en fases posteriores)
- `quran-app/src/lib/quran/quran-index.ts` — índice n-gram (core de Fase 2)
- `quran-app/src/lib/quran/normalize.ts` — normalización árabe
- `quran-app/src/lib/quran/quran.json` — datos del Quran
- `quran-app/src/lib/audio/speech-extractor.ts` — extracción de chunks (Fase 4)
- `quran-app/src/lib/audio/mp3-encoder.ts` — encoding (Fase 4)
- `quran-app/src/lib/audio/audio-concatenator.ts` — concatenación (Fase 4)
- `quran-app/src/lib/audio/time-splitter.ts` — split por tiempo (puede necesitarse)

### Validación del Paso 1
**Criterio**: "Leo el texto transcrito y reconozco qué surah es sin ayuda del matching"

1. Transcribir el mismo audio que produjo los debug outputs wav2vec2-raw
2. Guardar output en `debug-outputs/whisper-tarteel/`
3. Comparar lado a lado: wav2vec2-raw vs whisper-tarteel
4. Si el texto es claramente mejor → Paso 1 validado

### UI temporal para Fase 1
La página de resultado (`result/page.tsx`) mostrará:
- Texto transcrito completo
- Chunks con timestamps aproximados
- Estado: "Transcripción completada. Identificación de surah pendiente (Fase 2)"

---

## Fases futuras (solo referencia)

### Fase 2: IDENTIFICACIÓN
- Reutilizar `quran-index.ts` (findCandidates, n-gram matching)
- Nuevo `identifier.ts`: recibe texto plano → devuelve surah + rango de ayahs
- Mucho más simple que matcher.ts porque NO maneja timestamps

### Fase 3: ALINEACIÓN  
- WhisperX (o quran-align) con texto canónico del Paso 2
- Resultado: word-level timestamps precisos

### Fase 4: CORTE
- Timestamps precisos → extraer regiones → MP3

---

## Orden de ejecución Fase 1

1. Reescribir `serverless/handler.py` (nuevo handler tarteel-ai)
2. Reescribir `serverless/Dockerfile` (dependencias simplificadas)
3. Eliminar archivos del pipeline v1 que ya no se usan
4. Actualizar tipos en `types.ts`
5. Reescribir `transcribe/route.ts` (endpoint simplificado)
6. Simplificar `use-audio-processor.ts` (solo transcripción)
7. Actualizar UI de resultado para mostrar texto transcrito
8. Test: deploy a RunPod + transcribir audio de test
9. Guardar debug output + comparar con wav2vec2

---

## Verificación end-to-end

1. `docker build` del nuevo Dockerfile (sin errores)
2. Deploy a RunPod
3. Subir audio de test desde la UI
4. Verificar que el texto transcrito aparece en la pantalla de resultado
5. Verificar que el debug output se guarda en `debug-outputs/whisper-tarteel/`
6. Comparar calidad del texto con los wav2vec2-raw existentes
7. Si el texto es legible y reconocible → **Fase 1 completada**
