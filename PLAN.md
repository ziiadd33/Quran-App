# Plan: Simplificar el Matcher (Post-WhisperX)

## Contexto

### Qué pasó
1. **WhisperX arreglado** ✅ — sed patch desplegado, 66/66 segmentos "aligned"
2. **Audio procesado** — primera transición perfecta, el resto sigue mal
3. **Descubrimiento clave**: el CTC (Wav2Vec2, entrenado SOLO en Corán) **NUNCA produce "Allahu Akbar"** ni ningún texto de takbirat. Produce basura árabe. Toda la detección por texto de takbirat es inútil (0/66 segmentos detectados como takbirat).

### Por qué fallan los cortes
El matcher tiene 9 pasos complejos. Los que dependen de texto takbirat (la mayoría) fallan todos. El ÚNICO mecanismo que funciona es `splitBlocksOnGaps()` (gaps temporales >8s). Pero:
- **Gap de 6.44s** en una transición está por debajo del umbral de 8s → sin corte
- Segmentos garbled (2-10s) quedan pegados a bloques de surah (texto basura coincide accidentalmente con n-gramas del Corán)
- Bloques garbled de 5-9 palabras se clasifican como "surah sin identificar" en vez de eliminarse

### Qué sobra en el pipeline actual
- **LLM (GPT-4o-mini)**: Corrige texto para matching. Ya funciona sin él. Coste + latencia innecesarios.
- **2ª pasada de WhisperX (forced alignment)**: Repite el mismo trabajo. WhisperX ya da word-level timestamps en la 1ª pasada.
- **9 pasos en analyzeBlocks()**: La mayoría buscan texto takbirat que nunca existe.
- **6 métodos de detectar Fatiha**: Con buenos timestamps, basta gap-split + fuzzy match.

## Plan: Reescribir `analyzeBlocks()` con 3 pasos simples

### Nuevo flujo

```
Segmentos con timestamps reales (CTC + WhisperX)
  ↓
Paso 1: Separar por gaps ≥5s → bloques independientes
  ↓
Paso 2: Clasificar cada bloque con fuzzy matching:
  - Match con Fatiha (surah 1) → type: "fatiha"
  - Match con otra surah (similarity ≥0.4) → type: "surah"
  - Sin match → type: "takbirat" (basura CTC / transición)
  ↓
Paso 3: Fatiha+Surah en mismo bloque → split por contenido
  ↓
Resultado: AnalyzedBlock[] (misma interface que antes)
```

### Qué se mantiene
- **Interface `AnalyzedBlock`** — no cambia, el resto del pipeline sigue funcionando
- **Firma de `analyzeBlocks()`** — `async (segments) → {blocks, segments}`
- **`QuranIndex`** y funciones de matching (`findCandidates`, `findBestRange`, `wordSimilarity`)
- **`normalize()` y `toWords()`** del módulo normalize
- **`buildResult()`** en section-builder.ts — no se toca
- **`splitBlocksOnGaps()`** — se reutiliza (cambiando umbral a 5s)
- **`detectFatiha()`** — se simplifica pero se reutiliza la lógica core
- **`splitFatihaFromSurah()`** — se reutiliza para bloques que tienen Fatiha+Surah juntos
- **`classifyAsSurah()`** — se reutiliza tal cual

### Qué se elimina
- `discardPrePrayerNoise()` — busca "الله أكبر" que nunca existe
- `isTakbiratSegment()` — busca frases takbirat que nunca existen
- `findRukuPoints()`, `findSalamPoints()`, `findLongTakbiratRuns()` — todo texto-based
- `groupIntoBlocks()` — depende de los anteriores, siempre produce 1 solo bloque
- `trimTakbiratFromBlockEdges()` — busca frases takbirat en texto
- `splitBlocksOnFatihaContent()` — hack para bloques gigantes que ya no existirán
- `trimSurahBlockTail()`, `trimSurahBlockHead()` — heurísticas que fallan con texto garbled
- `reclassifyTransitionBlocks()` — innecesario si la clasificación es correcta
- `hasAllahuAkbar()`, `hasSamiAllah()`, `hasSalam()`, `hasRukuDuaPattern()` — todo texto-based

### Cambios concretos

**Archivo**: `quran-app/src/lib/quran/matcher.ts`

#### `GAP_SPLIT_THRESHOLD`: 8 → 5

#### Nuevo `analyzeBlocks()` (3 pasos):
1. Poner todos los segmentos en un bloque
2. `splitBlocksOnGaps()` con umbral 5s
3. `classifyBlock()` para cada bloque resultante

#### Nueva `classifyBlock()`:
- Si ≤4 palabras sin match Corán → takbirat
- Si detecta Fatiha → `splitFatihaFromSurah()`
- Si match surah (similarity ≥0.4) → surah
- Si no match Y duración < 15s → takbirat
- Si no match Y duración ≥ 15s → surah (surah=null)

### Qué NO se toca
- `/api/recitations/[id]/analyze/route.ts`
- `section-builder.ts`
- `llm-analyzer.ts`
- `use-audio-processor.ts`
- `speech-extractor.ts`, `speech-filter.ts`

### Sobre el LLM y la 2ª pasada de WhisperX
No los eliminamos ahora. Son opcionales. Los eliminamos después si confirmamos buenos resultados.

## Verificación
1. `npm run build` — debe compilar
2. Re-procesar audio de An-Nisa (~27 min)
3. Escuchar: no Allahu Akbar, no silencios, no Fatiha tail, no ayahs perdidas

## Archivos a modificar
- `quran-app/src/lib/quran/matcher.ts` — reescribir `analyzeBlocks()`, eliminar funciones muertas
