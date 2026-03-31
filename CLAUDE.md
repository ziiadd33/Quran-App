## Estructura detallada del rezo de Tarawih (LEER ANTES DE TOCAR CUALQUIER LÓGICA DE AUDIO)

Esta app procesa grabaciones de **rezos de Tarawih** (rezo islámico nocturno de Ramadán). Es **crítico** entender la estructura exacta para saber qué audio conservar y qué eliminar.

### Unidad básica: la Raka'ah
Una **raka'ah** es la unidad mínima de rezo. Contiene en orden:
1. **Takbir de apertura**: el imam dice "الله أكبر" (Allahu Akbar)
2. **Surah Al-Fatiha**: el imam recita la Fatiha completa. La **última palabra es "ضالين" (DAAALIIIINN)**. Inmediatamente después, la congregación responde "آمين" (AAAMIIIINN).
3. **Cuerpo de surah**: el imam empieza a recitar una sección de una surah del Quran (esto es lo que queremos guardar).
4. **Takbir de ruku**: el imam dice "الله أكبر" y se inclina (ruku). Después dice "سمع الله لمن حمده" (Samia Llahu li man hamidah) — marcador de fin de recitación.
5. **Ruku y sujud**: serie de postraciones. En esta parte **solo se escuchan takbirat** — "الله أكبر" repetido varias veces, con silencios entre medias. **Todo esto se elimina.**

### Estructura de 2 raka'ahs (unidad de Tarawih)
Los rezos de Tarawih se hacen **de dos en dos raka'ahs**:

1. **Primera raka'ah**: Takbir → Fatiha → "daaaliiin" → "Amiiiin" → Cuerpo surah → "Allahu Akbar" → Ruku/Sujud (solo takbirat)
2. **Segunda raka'ah**: Takbir → Fatiha → "daaaliiin" → "Amiiiin" → **Continuación del mismo punto de la surah** → "Allahu Akbar" → Ruku/Sujud (solo takbirat)
3. **Salam**: el imam dice "السلام عليكم ورحمة الله" **dos veces** → fin del bloque de 2 raka'ahs.
4. **Nuevo bloque de 2 raka'ahs**: todo el proceso se repite desde el principio.

### Continuidad de la surah en Tarawih (Ramadán)
En Tarawih de Ramadán, la surah se recita en **orden consecutivo de ayahs a lo largo de toda la noche**:
- Raka'ah 1 termina en la ayah 156 → Raka'ah 2 empieza en la ayah 157.
- El siguiente bloque de 2 raka'ahs empieza donde terminó el anterior.
- Así durante toda la noche, avanzando por el Quran en orden.

### Qué guardar vs qué eliminar
| Contenido | Acción |
|---|---|
| Surah Al-Fatiha (completa) | **ELIMINAR** |
| "daaaliiin" + "Amiiiin" | **ELIMINAR** (son el final de Fatiha) |
| **Cuerpo de surah** (post-Amiin hasta justo ANTES del "Allahu Akbar" de ruku) | **GUARDAR** ← esto es el objetivo |
| "الله أكبر" de takbir/ruku/sujud | **ELIMINAR** |
| "سمع الله لمن حمده" (Samia Llahu) | **ELIMINAR** (marcador de fin de recitación) |
| Silencios de ruku/sujud + takbirat intermedios | **ELIMINAR** |
| "السلام عليكم" (Salam) x2 | **ELIMINAR** |

### Implicaciones para el algoritmo
- El **inicio exacto** del cuerpo de surah es justo después de que la congregación dice "Amiiiin".
- El **fin exacto** del cuerpo de surah es justo **antes del "Allahu Akbar" de ruku** — el "Allahu Akbar" NO debe escucharse en el output.
- "سمع الله لمن حمده" (Samia Llahu) viene DESPUÉS del "Allahu Akbar" de ruku — útil para detectar el fin, pero el corte debe ir antes del "Allahu Akbar" que lo precede.
- El resultado ideal: al concatenar raka'ah 1 + raka'ah 2, la transición suena **completamente fluida** — última ayah de raka 1 → primera ayah de raka 2, sin ningún "Allahu Akbar" de por medio.
- Entre dos rakas del mismo bloque, **no hay pausa larga** — solo Fatiha (~20s) separa los dos cuerpos de surah.
- Entre dos bloques de 2 raka'ahs hay una **pausa más larga** (salam + descanso breve).
- El audio final deseado es la **concatenación de todos los cuerpos de surah** de toda la grabación, en orden, sin interrupciones de rezo.
