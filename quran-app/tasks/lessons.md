# Lessons Learned

_Registro de correcciones y patrones para evitar repetir errores._

## 2026-03-15: Unicode Arabic ranges — letters vs diacritics

**Error:** Regex `[\u0610-\u065F]` para quitar tashkeel eliminaba TAMBIÉN las letras árabes (U+0621–U+064A), dejando strings vacíos. `"".includes("")` === true en JS, causando que todo matcheara como Fatiha.

**Fix:** Usar rangos separados: `[\u0610-\u061A\u064B-\u065F\u0670]` (solo diacríticos, no letras).

**Regla:** Al trabajar con Unicode árabe, SIEMPRE verificar que los rangos no incluyan letras reales. Los rangos clave:
- U+0621–U+064A = letras árabes (NO tocar)
- U+064B–U+065F = tashkeel/diacríticos (estos sí se pueden quitar)
- U+0610–U+061A = signos coránicos de anotación (se pueden quitar)
- U+0670 = superscript alef (se puede quitar)

**Verificación:** Siempre testear `normalize()` con texto simple antes de usarlo en lógica de matching.

## 2026-03-19: Tarteel whisper-base NO sirve para audio largo

**Error:** Invertimos horas desplegando tarteel-ai/whisper-base-ar-quran en RunPod pensando que un modelo fine-tuned para Quran daría mejores resultados que OpenAI Whisper genérico.

**Resultado:** El modelo (74M params) es demasiado pequeño — alucinaciones masivas, timestamps rotos, solo 3 segmentos gigantes.

**Regla:** Modelos pequeños fine-tuned NO son mejores que modelos grandes genéricos para audio largo y complejo.

## 2026-03-19: RunPod serverless — problemas de estabilidad

**Problema:** RunPod tuvo múltiples problemas: GPUs no disponibles, workers unhealthy, builds lentos.

**Regla:** Siempre poner el idle timeout al mínimo (5s) — si el worker está idle estás pagando al mismo precio que si estuviera procesando.

## 2026-03-19: El prompt parameter de Whisper mejora transcripciones árabes

**Descubrimiento:** El parámetro `prompt` de la API de OpenAI Whisper condiciona el vocabulario hacia árabe coránico clásico.

**Regla:** Siempre usar el prompt parameter cuando se sabe qué tipo de contenido va a transcribir Whisper.

## 2026-03-19: Whisper salta secciones de audio

**Problema:** OpenAI Whisper a veces no genera segmentos para secciones de 30-60 segundos de recitación real.

**Causa raíz:** Whisper está entrenado para habla normal — con tajweed y pausas largas de recitación, alucina o simplemente omite secciones.

**Solución adoptada:** Cambiar a Wav2Vec2 CTC fine-tuned en Corán (`rabah2026/wav2vec2-large-xlsr-53-arabic-quran-v_final`).

## 2026-03-19: SIEMPRE actualizar el plan compartido

**Error:** No actualicé el plan cuando descartamos Tarteel/RunPod. El otro Claude leyó el plan viejo e implementó código obsoleto.

**Regla:** Cuando se cambia de estrategia, SIEMPRE actualizar INMEDIATAMENTE:
1. `quran-app/tasks/todo.md`
2. `quran-app/tasks/lessons.md`
3. `PLAN.md` en la raíz del proyecto

## 2026-03-23: Wav2Vec2 CTC — segment_by_silence no funciona para Corán

**Error:** El worker usaba detección de silencios (-40dB relativo) para segmentar el output CTC. Las pausas entre ayahs no llegan a ese umbral → todo el audio de 200s quedaba como un bloque → fallback: fuerza cortes cada 30s → timestamps completamente inventados (proporcional al tiempo).

**Síntomas:** Segmentos de exactamente 28.4s, matcher no detectaba Fatiha ni takbirat, solo 1 corte en todo el audio, identificación de ayah incorrecta (decía ayah 162 cuando empezaba en 148).

**Causa raíz:** Wav2Vec2 CTC SÍ produce timestamps reales a nivel de carácter (en los logits), pero el worker los ignoraba y usaba silence detection que no funciona para Corán.

**Fix:** Reemplazar `segment_by_silence` con `build_segments_from_ctc` que usa `batch_decode(output_char_offsets=True)` para extraer timestamps reales del modelo. Cada frame CTC = ~20ms de audio.

**Regla:** Con modelos CTC, SIEMPRE usar los char_offsets del modelo para timestamps — NUNCA intentar inferir timestamps con VAD/silencio sobre el audio. Los timestamps del CTC son la fuente de verdad.

## 2026-03-23: GitHub Actions workflow — branch name

**Error:** El workflow de deploy estaba configurado para dispararse en `master` pero el repo usa `main`. Dos commits llegaron a GitHub sin disparar el deploy antes de detectarlo.

**Regla:** Al crear workflows de GitHub Actions, verificar siempre el nombre del branch principal del repo (`main` vs `master`) antes de hacer el primer push.
