# Quran Recitation Processor

## Qué es
Una Progressive Web App (PWA) para procesar audios de recitaciones del Corán. El usuario sube un audio largo (30min-2hrs) y la app:

1. **Recorta silencios** entre segmentos de recitación
2. **Elimina repeticiones de Al-Fatiha** (recitada entre prostaciones/rak'ahs)
3. **Produce un audio limpio** y continuo
4. **Identifica la porción del Corán** que cubre (desde surah:ayah hasta surah:ayah)

## Stack tecnológico
- **Frontend**: Next.js 14+ (App Router) + TypeScript + Tailwind CSS
- **Backend**: Next.js API Routes (serverless en Vercel)
- **Base de datos**: Vercel Postgres + Drizzle ORM
- **Almacenamiento de audio**: Vercel Blob
- **Transcripción**: OpenAI Whisper API (árabe)
- **Identificación**: Base de datos del Corán (JSON estático de alquran.cloud) + fuzzy matching
- **Codificación audio**: lamejs (MP3 en el navegador) + Web Workers
- **Deploy**: Vercel

## Arquitectura clave
El procesamiento pesado (decodificar audio, detectar silencios, dividir en chunks, concatenar) se hace **en el cliente** con Web Audio API para evitar timeouts de funciones serverless. El servidor solo se usa para:
- Enviar chunks a Whisper API (~2-3 min cada uno, bajo 25MB)
- Detectar si un chunk es Al-Fatiha
- Hacer fuzzy matching contra el texto del Corán
- CRUD de historial en la base de datos

## Plan de implementación por fases

### FASE 1: Frontend completo (UI/UX) ← FASE ACTUAL
Toda la interfaz con datos mock. Sin lógica de backend.
- Página de upload (drag & drop)
- Página de procesamiento (pipeline visual con progreso simulado)
- Página de resultado (surah:ayah + reproductor + descarga)
- Historial (lista + detalle)
- Navegación, responsive, PWA manifest

### FASE 2: Infraestructura y base de datos
- Vercel Postgres + Drizzle ORM (schema + migraciones)
- Vercel Blob configurado
- API routes CRUD para recitaciones
- Historial real conectado a DB

### FASE 3: Pipeline de audio (cliente)
- `silence-detector.ts` — detección de silencios con Web Audio API
- `audio-splitter.ts` — dividir AudioBuffer en chunks
- `mp3-encoder.ts` — codificación MP3 con lamejs + Web Worker
- `audio-concatenator.ts` — unir AudioBuffers limpios
- `use-audio-processor.ts` — hook de orquestación
- Subida de chunks a Vercel Blob

### FASE 4: Transcripción y detección
- `/api/process/transcribe` — integración con OpenAI Whisper
- `text-normalizer.ts` — quitar tashkeel (diacríticos árabes)
- `fatiha-detector.ts` — identificar chunks que son Al-Fatiha
- Progreso real en el pipeline UI

### FASE 5: Identificación del Corán
- Embeber `quran-uthmani.json` (texto completo del Corán)
- `quran-matcher.ts` — fuzzy matching (normalizar texto, sliding window, Levenshtein)
- `/api/process/identify` — endpoint de identificación surah:ayah
- Resultado real en la UI

### FASE 6: Polish y deploy
- Error handling + retry
- PWA install prompt + service worker con caching
- Tests E2E
- Deploy final + optimización

## Estructura del proyecto
```
quran-recitation-processor/
├── public/
│   ├── manifest.json
│   ├── icons/
│   └── quran-uthmani.json          # Fase 5
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout + PWA meta
│   │   ├── page.tsx                # Upload page
│   │   ├── globals.css
│   │   ├── process/page.tsx        # Pipeline de procesamiento
│   │   ├── result/page.tsx         # Resultado final
│   │   ├── history/page.tsx        # Lista de recitaciones
│   │   ├── history/[id]/page.tsx   # Detalle de recitación
│   │   └── api/
│   │       ├── upload/route.ts
│   │       ├── process/
│   │       │   ├── transcribe/route.ts
│   │       │   └── identify/route.ts
│   │       └── recitations/
│   │           ├── route.ts
│   │           └── [id]/route.ts
│   ├── lib/
│   │   ├── audio/
│   │   │   ├── silence-detector.ts
│   │   │   ├── audio-splitter.ts
│   │   │   ├── mp3-encoder.ts
│   │   │   └── audio-concatenator.ts
│   │   ├── quran/
│   │   │   ├── text-normalizer.ts
│   │   │   ├── fatiha-detector.ts
│   │   │   ├── quran-matcher.ts
│   │   │   └── quran-data.ts
│   │   ├── db/
│   │   │   └── schema.ts
│   │   ├── blob.ts
│   │   └── openai.ts
│   ├── components/
│   │   ├── upload-zone.tsx
│   │   ├── processing-pipeline.tsx
│   │   ├── result-card.tsx
│   │   ├── audio-player.tsx
│   │   ├── recitation-list.tsx
│   │   └── nav-bar.tsx
│   └── hooks/
│       ├── use-audio-processor.ts
│       └── use-pwa-install.ts
├── next.config.ts
├── tailwind.config.ts
├── vercel.json
├── PROYECTO.md                     # Este archivo
└── CLAUDE.md
```

## Schema de base de datos (Fase 2)

**recitations**: id, status, original_blob_url, processed_blob_url, original_filename, duration_seconds, processed_duration, start_surah, start_ayah, end_surah, end_ayah, full_text, total_chunks, fatiha_chunks, silences_removed, error_message, created_at, updated_at

**recitation_chunks**: id, recitation_id (FK), chunk_index, blob_url, transcription, is_fatiha, status, created_at

## Variables de entorno
- `OPENAI_API_KEY` — API key de OpenAI (Whisper)
- `BLOB_READ_WRITE_TOKEN` — Token de Vercel Blob
- `POSTGRES_URL` — Conexión a Vercel Postgres (auto-set)

## Notas para Claude
- Leer este archivo al inicio de cada conversación para entender el contexto
- Preguntar en qué fase estamos antes de empezar a trabajar
- Respetar la estructura de archivos definida
- El procesamiento pesado de audio va en el CLIENTE, no en el servidor
- Los audios son recitaciones en árabe del Corán
## La paleta de colores
:root {
  --color-background:    #111010;
  --color-surface:       #1C1B19;
  --color-glass:         rgba(255,255,255,0.05);
  --color-accent:        #4A6090;
  --color-accent-light:  #8BA3CC;
  --color-text-primary:  #E8E4DC;
  --color-text-secondary: rgba(232,228,220,0.4);
  --color-border:        rgba(255,255,255,0.07);
  --color-glass-border:  rgba(232,228,220,0.12);
} 