import type { WhisperSegment } from "@/lib/audio/types";
import { QuranIndex } from "./quran-index";
import { normalize } from "./normalize";

/**
 * Uses GPT-4o-mini to correct Whisper transcription text against the actual Quran.
 *
 * ONLY corrects Arabic text errors — does NOT fill gaps, add segments,
 * remove segments, or change timestamps. Gaps in salat recordings are
 * real (ruku, sujud) and should not be filled with Quran text.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

/**
 * Find the relevant portion of a surah's text based on which part
 * the recitation matches. For long surahs, we extract a window around
 * the matching region instead of truncating from the start.
 */
function extractRelevantPortion(
  surah: { normalizedText: string; words: string[] },
  recitationText: string,
  maxChars: number = 3000
): string {
  const fullText = surah.normalizedText;
  if (fullText.length <= maxChars) return fullText;

  // Find where the recitation text best matches within the surah
  // by looking for the first matching 3-word sequence
  const recWords = normalize(recitationText).split(/\s+/).filter(Boolean);
  let bestMatchPos = 0;

  if (recWords.length >= 3) {
    // Search for the first 3-gram that matches
    for (let i = 0; i <= recWords.length - 3; i++) {
      const trigram = recWords.slice(i, i + 3).join(" ");
      const pos = fullText.indexOf(trigram);
      if (pos >= 0) {
        bestMatchPos = pos;
        break;
      }
    }
  }

  // Extract a window centered on the match position
  const halfWindow = Math.floor(maxChars / 2);
  let start = Math.max(0, bestMatchPos - halfWindow);
  let end = Math.min(fullText.length, start + maxChars);

  // Adjust start if we hit the end
  if (end === fullText.length) {
    start = Math.max(0, end - maxChars);
  }

  // Snap to word boundaries
  if (start > 0) {
    const nextSpace = fullText.indexOf(" ", start);
    if (nextSpace > 0) start = nextSpace + 1;
  }
  if (end < fullText.length) {
    const prevSpace = fullText.lastIndexOf(" ", end);
    if (prevSpace > start) end = prevSpace;
  }

  const prefix = start > 0 ? "..." : "";
  const suffix = end < fullText.length ? "..." : "";
  return prefix + fullText.slice(start, end) + suffix;
}

/**
 * Build the candidate surah text for context.
 * For long surahs, extracts the relevant portion based on what was recited.
 */
function formatCandidatesForPrompt(
  quranIndex: QuranIndex,
  candidates: { surahNumber: number; matchCount: number }[],
  recitationText: string
): string {
  const lines: string[] = [];
  const top = candidates.slice(0, 5);

  for (const c of top) {
    const surah = quranIndex.getSurah(c.surahNumber);
    if (!surah) continue;
    const text = extractRelevantPortion(surah, recitationText);
    lines.push(`--- Surah ${c.surahNumber} (${surah.totalVerses} ayahs) ---`);
    lines.push(text);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Filter segments to only those containing Quran recitation text (not takbirat/salam).
 * Only these need text correction.
 */
function isRecitationSegment(seg: WhisperSegment): boolean {
  const text = seg.text.trim();
  const takbiratPhrases = [
    "الله أكبر",
    "الله اكبر",
    "سمع الله لمن حمده",
    "ربنا ولك الحمد",
    "السلام عليكم ورحمة الله",
    "السلام عليكم",
    "الصلاة والسلام",
    "آمين",
  ];

  // If the entire segment is just takbirat/salam phrases, skip it
  let remaining = normalize(text);
  for (const phrase of takbiratPhrases) {
    remaining = remaining.replaceAll(normalize(phrase), "").trim();
  }
  // Also remove punctuation
  remaining = remaining.replace(/[.،,؟!]/g, "").trim();

  return remaining.length > 10;
}

/**
 * Call GPT-4o-mini to correct ONLY the text of recitation segments.
 * Returns a map of segment index → corrected text.
 */
async function correctTexts(
  segments: WhisperSegment[],
  recitationIndices: number[],
  candidateText: string
): Promise<Map<number, string>> {
  // Build compact list of only recitation segments
  const segmentLines = recitationIndices
    .map((i) => `[${i}] ${segments[i].text.trim()}`)
    .join("\n");

  const systemPrompt = `You are a Quran transcription corrector. You receive Arabic text segments from Whisper ASR of a Quran recitation. Your job is to fix text errors by matching against the provided reference Quran text.

RULES:
1. ONLY fix Arabic text errors (misspellings, wrong words, missing diacritical marks)
2. Do NOT add new segments or remove segments
3. Do NOT change segment indices
4. If a segment's text is already correct, return it unchanged
5. Match each segment against the Quran reference to find the correct wording
6. Keep the text natural — don't force-fit text that doesn't match

OUTPUT FORMAT:
Return a JSON object mapping segment index to corrected text: { "0": "corrected text", "5": "corrected text", ... }
Only include segments whose text you actually changed. If no changes needed, return {}.
Return ONLY the JSON object, no markdown, no explanation.`;

  const userPrompt = `RECITATION SEGMENTS TO CORRECT:
${segmentLines}

QURAN REFERENCE TEXT:
${candidateText}

Fix any Arabic text errors in the segments above.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GPT-4o-mini API failed (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? "";

  const jsonStr = content.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
  const parsed = JSON.parse(jsonStr);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("GPT-4o-mini returned unexpected format");
  }

  const corrections = new Map<number, string>();
  for (const [key, value] of Object.entries(parsed)) {
    const idx = parseInt(key, 10);
    if (!isNaN(idx) && typeof value === "string" && value.trim().length > 0) {
      corrections.set(idx, value);
    }
  }

  return corrections;
}

/**
 * Main entry point: correct Whisper segment TEXT using GPT-4o-mini + Quran reference.
 * Timestamps and segment count are preserved exactly as Whisper reported them.
 */
export async function llmCorrectSegments(
  segments: WhisperSegment[],
  quranIndex: QuranIndex
): Promise<WhisperSegment[]> {
  if (segments.length === 0) return segments;

  // 1. Find candidate surahs
  const allText = segments.map((s) => s.text).join(" ");
  const normalizedAll = normalize(allText);
  const candidates = quranIndex.findCandidates(normalizedAll);

  if (candidates.length === 0) {
    console.log("[llm-corrector] No candidate surahs found, skipping correction");
    return segments;
  }

  console.log(
    `[llm-corrector] Top candidates: ${candidates
      .slice(0, 3)
      .map((c) => `surah ${c.surahNumber} (${c.matchCount} hits)`)
      .join(", ")}`
  );

  // 2. Identify which segments are recitation (not takbirat/salam)
  const recitationIndices: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (isRecitationSegment(segments[i])) {
      recitationIndices.push(i);
    }
  }

  if (recitationIndices.length === 0) {
    console.log("[llm-corrector] No recitation segments found, skipping");
    return segments;
  }

  console.log(
    `[llm-corrector] ${recitationIndices.length}/${segments.length} segments are recitation`
  );

  // 3. Build candidate text (extract relevant portions for long surahs)
  const recitationText = recitationIndices.map((i) => segments[i].text).join(" ");
  const candidateText = formatCandidatesForPrompt(quranIndex, candidates, recitationText);

  // 4. Call GPT-4o-mini for text-only corrections
  console.log("[llm-corrector] Sending to GPT-4o-mini for text correction...");
  const corrections = await correctTexts(segments, recitationIndices, candidateText);

  console.log(`[llm-corrector] ${corrections.size} segments corrected`);

  // 5. Apply corrections — same segment count, same timestamps
  return segments.map((seg, i) => {
    const correctedText = corrections.get(i);
    if (correctedText) {
      return { start: seg.start, end: seg.end, text: correctedText };
    }
    return seg;
  });
}
