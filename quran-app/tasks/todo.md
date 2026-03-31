# Quran App — Progress Tracker

## Fase 1 — UI con Mock Data ✅
- [x] Home page (Noches + Surahs views)
- [x] Upload page (drag & drop, reciter name)
- [x] Process page (stepper animation)
- [x] Result page (audio player, summary card)
- [x] Bottom navigation
- [x] Glassmorphism design system
- [x] Arabic font support (Amiri)

## Fase 2 — Infraestructura y Base de Datos (Supabase) ✅
- [x] Supabase client, schema SQL, TypeScript types
- [x] API CRUD recitations + chunks
- [x] Upload, Process, Result pages conectadas a DB real
- [x] Build pasa con cero errores

## Fase 3 — Audio Processing Pipeline (Client-side) ✅
- [x] lamejs MP3 encoder + Web Worker
- [x] Audio splitter, concatenator, storage helpers
- [x] Orchestration hook (`use-audio-processor.ts`)
- [x] Pipeline de 8 pasos con progreso real

## Fase 4 — Transcripción y Detección ✅
- [x] Normalize árabe (tashkeel), Quran index n-grams
- [x] Block-level matcher: detecta Fatiha / surah / takbirat
- [x] Forced alignment con WhisperX (RunPod)
- [x] section-builder: refineWithAlignment()

## ~~Fase 4.5 — Tarteel Whisper en RunPod~~ ❌ DESCARTADO
- ❌ whisper-base (74M params) — demasiado pequeño, alucinaciones masivas
- **Decisión**: descartado completamente

## ~~Fase 4.6 — OpenAI Whisper API~~ ❌ DESCARTADO
- ❌ Whisper genérico de OpenAI alucina con tajweed y pausas de recitación
- ❌ Salta secciones de 30-60s, baja precisión en árabe coránico
- **Decisión**: reemplazado por Wav2Vec2 CTC

## Fase 4.9 — Wav2Vec2 CTC (RunPod) ← FASE ACTUAL
- [x] Modelo: `rabah2026/wav2vec2-large-xlsr-53-arabic-quran-v_final`
- [x] Worker RunPod: handler.py con modo `transcribe_ctc` y modo `align`
- [x] GitHub Actions deploy automático al hacer push a `main` en `serverless/`
- [x] Frontend: usa base64 WAV 16kHz, polling async RunPod job
- [x] **BUG ENCONTRADO Y CORREGIDO**: `segment_by_silence` producía segmentos de 28-30s con timestamps falsos → reemplazado por `build_segments_from_ctc` con char offsets reales del CTC
- [ ] **PENDIENTE**: Verificar que el fix produce segmentos cortos (1-10s) reales
- [ ] **PENDIENTE**: Test E2E completo con audio de Tarawih real (An-Nisa o similar)
- [ ] **PENDIENTE**: Verificar que el matcher detecta Fatihas y takbirat correctamente

## Fase 5 — Cortes Precisos por Ayah (TODO — después de detección estructural estable)

### Concepto
Una vez que el matcher detecta correctamente los bloques (Fatiha / surah / takbirat),
el siguiente paso es usar esa información para hacer cortes quirúrgicos a nivel de ayah:

**Flujo completo:**
```
1. Detección estructural → bloques aislados (fatiha / surah / takbirat)
2. Identificación de surah + rango → "An-Nisa, ayahs 30–46"
3. Forced alignment → dado el texto conocido de la ayah 46,
   buscar el timestamp exacto en el audio (ya implementado en el worker: align_handler / WhisperX)
4. Corte preciso justo al final de la última ayah
```

**Por qué este orden es el correcto:**
- Identificar la surah SIN aislar el bloque primero es imposible: el texto de Fatiha
  y los takbirat contaminan la comparación con quran.json.
- La identificación SIEMPRE va después de la detección estructural.
- El forced alignment (paso 3) ya está implementado en el worker — solo hay que conectarlo.

**Tareas concretas:**
- [ ] Verificar que la detección estructural (Fase 4.9) funciona establemente
- [ ] En `section-builder.ts`: al identificar surah + last verse, llamar a `align_handler`
      pasando el texto de la última ayah y el audio del bloque
- [ ] Usar el timestamp de fin de la última ayah como punto de corte
- [ ] Reemplazar el corte actual (basado en fin de bloque) por el corte de aligned timestamp

## Fase 6 — Polish y Deploy (TODO)
- [ ] Error handling + retry
- [ ] PWA install prompt + service worker
- [ ] Tests E2E
- [ ] Deploy final + optimización

---

## Futuras Funcionalidades (después del pipeline)

### Mi Mushaf — Biblioteca Personal
- [ ] Grid de 114 surahs (completada / parcial / no grabada)
- [ ] Reproductor: tocar surah → escuchar tu recitación
- [ ] Progreso global: "llevas X/114 surahs"

### Grabación Nativa
- [ ] Botón "Grabar" junto a "Subir archivo"
- [ ] Usar MediaRecorder API del navegador
- [ ] Mostrar tiempo en vivo durante grabación

### Karaoke Coránico — Resaltado en Tiempo Real
- [ ] Mostrar texto del Quran mientras reproduces tu recitación
- [ ] Resaltar la ayah actual según timestamps del aligner
- [ ] Scroll automático sincronizado con el audio
