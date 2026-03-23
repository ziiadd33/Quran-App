# Plan: Fix Wav2Vec2 Worker Segmentation

## Context

El worker de RunPod usa Wav2Vec2 CTC para transcribir audio de Corán. El modelo sí produce texto correcto (sin alucinaciones), pero la función `segment_by_silence` que genera los timestamps está completamente rota para recitación de Corán:

- Usa umbral de silencio -40dB relativo: las pausas entre ayahs no llegan a ese umbral
- No encuentra silencios → todo el audio de 200s queda como un solo bloque
- Fallback: fuerza cortes cada 30s → segmentos de 28.4s exactos (arbitrarios)
- Los textos se distribuyen proporcionalmente al tiempo → timestamps completamente inventados
- El matcher recibe timestamps falsos → no puede detectar Fatiha, takbirat ni hacer cortes correctos

**La solución**: Wav2Vec2 CTC produce timestamps reales a nivel de carácter en sus logits. El worker los tiene disponibles vía `batch_decode(..., output_char_offsets=True)` pero los ignora completamente. Hay que usar esos timestamps reales en vez de la detección de silencios.

## Archivo a modificar

`serverless/handler.py` — única modificación necesaria.

## Cambio: reemplazar `segment_by_silence` con `build_segments_from_ctc`

### Eliminar
La función `segment_by_silence` completa (líneas 30-161).

### Añadir: función `build_segments_from_ctc`

```python
def build_segments_from_ctc(char_offsets, seconds_per_frame, audio_duration,
                              min_pause=0.3, max_seg_duration=15.0):
    """
    Build segments using REAL timestamps from CTC char offsets.
    Each char_offset = {"char": str, "start_offset": int (in CTC frames)}.
    seconds_per_frame = audio_duration / n_logit_frames
    """
    if not char_offsets:
        return []

    # Group characters into words
    words = []
    current_chars = []

    for item in char_offsets:
        char = item["char"]
        start_time = item["start_offset"] * seconds_per_frame

        if char == " ":
            if current_chars:
                words.append({
                    "text": "".join(c["char"] for c in current_chars),
                    "start": current_chars[0]["time"],
                    "end": start_time,
                })
                current_chars = []
        else:
            current_chars.append({"char": char, "time": start_time})

    # Last word (no trailing space)
    if current_chars:
        words.append({
            "text": "".join(c["char"] for c in current_chars),
            "start": current_chars[0]["time"],
            "end": audio_duration,
        })

    if not words:
        return []

    # Group words into segments: split on pause >= min_pause OR segment >= max_seg_duration
    segments = []
    current_seg = [words[0]]

    for word in words[1:]:
        gap = word["start"] - current_seg[-1]["end"]
        seg_duration = word["end"] - current_seg[0]["start"]

        if gap >= min_pause or seg_duration >= max_seg_duration:
            segments.append({
                "start": round(current_seg[0]["start"], 2),
                "end": round(current_seg[-1]["end"], 2),
                "text": " ".join(w["text"] for w in current_seg),
            })
            current_seg = [word]
        else:
            current_seg.append(word)

    if current_seg:
        segments.append({
            "start": round(current_seg[0]["start"], 2),
            "end": round(current_seg[-1]["end"], 2),
            "text": " ".join(w["text"] for w in current_seg),
        })

    return segments
```

### Modificar `transcribe_ctc_handler`

```python
def transcribe_ctc_handler(audio_array):
    inputs = wav2vec2_processor(
        audio_array, sampling_rate=16000, return_tensors="pt", padding=True
    )

    with torch.no_grad():
        logits = wav2vec2_model(inputs.input_values.to(device)).logits

    predicted_ids = torch.argmax(logits, dim=-1)

    # Decode with real character-level timestamps from CTC
    outputs = wav2vec2_processor.batch_decode(
        predicted_ids.cpu(),
        output_char_offsets=True,
        skip_special_tokens=True,
    )

    char_offsets = outputs.char_offsets[0]  # [{"char": str, "start_offset": int}, ...]

    # seconds per CTC frame = audio_duration / n_logit_frames
    audio_duration = len(audio_array) / 16000
    seconds_per_frame = audio_duration / logits.shape[1]

    segments = build_segments_from_ctc(char_offsets, seconds_per_frame, audio_duration)

    # Fallback: if no segments (rare), return full audio as one segment
    if not segments:
        transcription = outputs.text[0] if outputs.text else ""
        if transcription.strip():
            segments = [{"start": 0.0, "end": round(audio_duration, 2), "text": transcription}]

    return {"segments": segments}
```

## Resultado esperado

- Segmentos de ~1-10s (por ayah o frase) con timestamps reales del modelo
- Frases como "الله أكبر" o "الحمد لله رب العالمين" en sus propios segmentos cortos
- El matcher detecta Fatiha, takbirat y hace cortes correctamente
- Sin cambios en el matcher ni en el frontend

## Verificación

1. Redeploy del worker vía GitHub Actions (push a master con cambios en `serverless/`)
2. Procesar el mismo audio de An-Nisa
3. Verificar en `wav2vec2-output-{id}.json` que los segmentos son cortos (1-10s) con timestamps reales (no múltiplos de 28.4s)
4. Verificar que la UI detecta y elimina Fatihas y takbirat correctamente
