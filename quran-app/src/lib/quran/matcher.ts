import { normalize, toWords } from "./normalize";
import { QuranIndex, type SurahInfo } from "./quran-index";
import type { WhisperSegment } from "../audio/types";

export type SegmentType = "fatiha" | "surah" | "takbirat";

export interface AnalyzedBlock {
  type: SegmentType;
  start: number;
  end: number;
  /** Indices into the original segments array */
  segments: number[];
  /** Surah number (only for fatiha/surah) */
  surah: number | null;
  /** First matched verse (only for surah) */
  startVerse: number | null;
  /** Last matched verse (only for surah) */
  endVerse: number | null;
  /** Match confidence 0-1 */
  confidence: number;
}

// ── Fatiha structural markers ─────────────────────────────────────

const FATIHA_START_MARKER = normalize("الحمد لله رب العالمين");
const FATIHA_RAHMAAN_MARKER = normalize("الرحمن الرحيم");

const FATIHA_MARKERS = [
  "مالك يوم الدين",
  "اياك نعبد",
  "اهدنا الصراط",
  "غير المغضوب",
  "صراط الذين انعمت",
].map(normalize);

const FATIHA_END_MARKERS = [
  "ولا الضالين",
  "ولا الظالين",
  "عليهم ولا الضالين",
  "عليهم ولا الظالين",
  "ولا الضالمين",
  "ولا الطاليم",
  "ولا الضرانين",
  "وللطانين",
  "ولا الطادلين",
  "وللظالمين",
].map(normalize);

/** Max duration in seconds for a pure Fatiha block */
const MAX_FATIHA_DURATION = 45;
/** Typical Fatiha duration for time-based splitting */
const TYPICAL_FATIHA_DURATION = 35;

/** Common Arabic words excluded from Fatiha-specific word matching (too frequent in all surahs) */
const COMMON_ARABIC_WORDS = new Set([
  "الله", "لله", "بسم",
  "الرحمن", "الرحيم",
  "رب", "العالمين",
  "يوم", "الدين",
  "الذين", "عليهم", "غير",
  "ولا", "من", "في", "ما",
  "ان", "كان", "على", "هو",
  "مالك",
].map(normalize));

/** Minimum similarity to accept a surah match */
const MIN_SIMILARITY = 0.4;

// ── Utility functions ─────────────────────────────────────────────

/**
 * Compute word-level similarity using dynamic programming LCS.
 * Returns lcsLength / max(len_a, len_b).
 */
function wordSimilarity(wordsA: string[], wordsB: string[]): number {
  const n = wordsA.length;
  const m = wordsB.length;
  if (n === 0 || m === 0) return 0;

  let prev = new Uint16Array(m + 1);
  let curr = new Uint16Array(m + 1);

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (wordsA[i - 1] === wordsB[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return prev[m] / Math.max(n, m);
}

/**
 * Find the best matching range within a surah for the given text.
 */
function findBestRange(
  segWords: string[],
  surah: SurahInfo,
  quranIndex: QuranIndex
): { startVerse: number; endVerse: number; similarity: number } {
  const surahWords = surah.words;

  if (segWords.length === 0 || surahWords.length === 0) {
    return { startVerse: 1, endVerse: 1, similarity: 0 };
  }

  const windowSize = Math.min(segWords.length + 10, surahWords.length);
  let bestSim = 0;
  let bestStart = 0;
  let bestEnd = surahWords.length - 1;

  const step = Math.max(1, Math.min(5, Math.floor(segWords.length / 3)));
  for (let i = 0; i <= surahWords.length - 1; i += step) {
    const end = Math.min(i + windowSize, surahWords.length);
    const window = surahWords.slice(i, end);
    const sim = wordSimilarity(segWords, window);
    if (sim > bestSim) {
      bestSim = sim;
      bestStart = i;
      bestEnd = end - 1;
    }
  }

  const fullSim = wordSimilarity(segWords, surahWords);
  if (fullSim > bestSim) {
    bestSim = fullSim;
    bestStart = 0;
    bestEnd = surahWords.length - 1;
  }

  const startVerse = quranIndex.wordIndexToVerse(surah, bestStart);
  const endVerse = quranIndex.wordIndexToVerse(surah, bestEnd);

  return { startVerse, endVerse, similarity: bestSim };
}

// ── Block types ───────────────────────────────────────────────────

interface RawBlock {
  type: "takbirat" | "recitation";
  segmentIndices: number[];
}

// ── Gap splitting ─────────────────────────────────────────────────
//
// With real WhisperX timestamps, gaps >5s between segments indicate
// ruku/sujud boundaries (prayer structure, not reciter speed — universal).
// The "Allahu Akbar" + "Samia Llahu" transition audio creates 5-7s gaps
// where CTC produces no output. Normal tajweed pauses are 1-4s max.

const GAP_SPLIT_THRESHOLD = 5; // seconds

function splitBlocksOnGaps(
  blocks: RawBlock[],
  segments: WhisperSegment[]
): RawBlock[] {
  const result: RawBlock[] = [];
  for (const block of blocks) {
    if (block.type !== "recitation" || block.segmentIndices.length < 2) {
      result.push(block);
      continue;
    }
    const indices = block.segmentIndices;
    let currentStart = 0;
    for (let i = 0; i < indices.length - 1; i++) {
      const gap =
        segments[indices[i + 1]].start - segments[indices[i]].end;
      if (gap > GAP_SPLIT_THRESHOLD) {
        if (i >= currentStart) {
          result.push({
            type: "recitation",
            segmentIndices: indices.slice(currentStart, i + 1),
          });
        }
        currentStart = i + 1;
        console.log(
          `[matcher] Gap split: ${gap.toFixed(1)}s gap at ${segments[indices[i]].end.toFixed(1)}s`
        );
      }
    }
    if (currentStart < indices.length) {
      result.push({
        type: "recitation",
        segmentIndices: indices.slice(currentStart),
      });
    }
  }
  return result;
}

// ── Surah classification ──────────────────────────────────────────

/**
 * Classify a block as a surah using n-gram matching.
 */
function classifyAsSurah(
  segIndices: number[],
  segments: WhisperSegment[],
  quranIndex: QuranIndex
): AnalyzedBlock {
  const combinedText = segIndices.map((i) => segments[i].text).join(" ");
  const words = toWords(combinedText);
  const norm = normalize(combinedText);
  const start = segments[segIndices[0]].start;
  const end = segments[segIndices[segIndices.length - 1]].end;

  if (words.length >= 3) {
    const candidates = quranIndex.findCandidates(norm);

    for (const candidate of candidates.slice(0, 3)) {
      const surah = quranIndex.getSurah(candidate.surahNumber);
      if (!surah) continue;

      const { startVerse, endVerse, similarity } = findBestRange(
        words,
        surah,
        quranIndex
      );

      if (similarity >= MIN_SIMILARITY) {
        return {
          type: "surah",
          start,
          end,
          segments: segIndices,
          surah: candidate.surahNumber,
          startVerse,
          endVerse,
          confidence: similarity,
        };
      }
    }
  }

  // Couldn't identify which surah — still keep as surah (don't cut it)
  return {
    type: "surah",
    start,
    end,
    segments: segIndices,
    surah: null,
    startVerse: null,
    endVerse: null,
    confidence: 0,
  };
}

// ── Fatiha detection ──────────────────────────────────────────────

/**
 * Detect Fatiha using structural markers (Whisper gets these right) combined
 * with similarity and duration heuristics.
 */
function detectFatiha(
  norm: string,
  words: string[],
  duration: number,
  fatiha: SurahInfo | undefined,
): { isFatiha: boolean; fatihaSim: number; confidence: number } {
  const hasStartMarker = norm.includes(FATIHA_START_MARKER);
  const hasRahmaanMarker = norm.includes(FATIHA_RAHMAAN_MARKER);
  const hasOtherMarker = FATIHA_MARKERS.some((m) => norm.includes(m));

  let fatihaSim = 0;
  if (fatiha) {
    fatihaSim = wordSimilarity(words, fatiha.words);
  }

  // Count unique markers found
  const markerCount = FATIHA_MARKERS.filter((m) => norm.includes(m)).length;

  // Structural detection: starts with "الحمد لله رب العالمين" + "الرحمن الرحيم"
  // and block is short (< 45s) → very likely Fatiha
  const structuralMatch =
    hasStartMarker && hasRahmaanMarker && duration < MAX_FATIHA_DURATION;

  // Lowered threshold (0.3) + any structural signal — but cap duration at 135s
  const fuzzyMatch =
    fatihaSim > 0.3 &&
    (hasStartMarker || hasRahmaanMarker || hasOtherMarker) &&
    duration < 135;

  // Classic marker-based detection — require duration guard:
  // single marker only valid for short blocks; multi-marker allows up to 90s
  const markerMatch = hasOtherMarker && (
    (markerCount >= 2 && duration < 90) ||
    (markerCount === 1 && duration < MAX_FATIHA_DURATION)
  );

  // High similarity alone — only for blocks < 90s
  const highSimilarity = fatihaSim > 0.5 && duration < 90;

  // Long block Fatiha: for blocks > 45s, require strong evidence (will be split downstream)
  const longBlockFatiha =
    duration > MAX_FATIHA_DURATION &&
    hasStartMarker &&
    (hasRahmaanMarker || markerCount >= 2);

  const isFatiha = structuralMatch || fuzzyMatch || markerMatch || highSimilarity || longBlockFatiha;

  let confidence = fatihaSim;
  if (structuralMatch) confidence = Math.max(confidence, 0.9);
  if (markerMatch) confidence = Math.max(confidence, 0.8);

  return { isFatiha, fatihaSim, confidence };
}

/**
 * Split a block into Fatiha + Surah parts.
 * First tries text-based split at "ولا الضالين" markers.
 * Falls back to similarity-based or time-based split.
 */
function splitFatihaFromSurah(
  segIndices: number[],
  segments: WhisperSegment[],
  quranIndex: QuranIndex,
  fatihaSim: number,
  confidence: number,
): AnalyzedBlock[] {
  const start = segments[segIndices[0]].start;
  const end = segments[segIndices[segIndices.length - 1]].end;
  const duration = end - start;

  // If block is short enough to be pure Fatiha, don't split
  if (duration <= MAX_FATIHA_DURATION) {
    return [
      {
        type: "fatiha",
        start,
        end,
        segments: segIndices,
        surah: 1,
        startVerse: null,
        endVerse: null,
        confidence,
      },
    ];
  }

  // Segment-level split: find the FIRST end marker within the first ~60s
  const searchWindowEnd = start + 60;
  let splitSegIdx = -1;

  for (let si = 0; si < segIndices.length; si++) {
    if (segments[segIndices[si]].start > searchWindowEnd) break;
    const segNorm = normalize(segments[segIndices[si]].text);
    for (const marker of FATIHA_END_MARKERS) {
      if (segNorm.includes(marker)) {
        splitSegIdx = si;
        break;
      }
    }
    if (splitSegIdx !== -1) break;
  }

  if (splitSegIdx === -1) {
    // Similarity-based fallback: scan segments for Fatiha word similarity.
    const fatiha = quranIndex.getSurah(1);
    if (fatiha) {
      const SIM_THRESHOLD = 0.10;
      let lastFatihaIdx = 0;
      let foundAnyFatiha = false;
      for (let si = 0; si < segIndices.length; si++) {
        const seg = segments[segIndices[si]];
        const segWords = toWords(seg.text);
        if (segWords.length < 3) continue;
        const sim = wordSimilarity(segWords, fatiha.words);
        if (sim >= SIM_THRESHOLD) {
          lastFatihaIdx = si;
          foundAnyFatiha = true;
        } else if (foundAnyFatiha) {
          break;
        }
      }
      splitSegIdx = lastFatihaIdx;
      console.log(
        `[matcher] Similarity-based Fatiha split at segment ${splitSegIdx} ` +
          `(${segments[segIndices[splitSegIdx]].end.toFixed(1)}s)`
      );
    } else {
      // Ultimate fallback if Fatiha surah not loaded
      const splitTime = start + TYPICAL_FATIHA_DURATION;
      for (let si = 0; si < segIndices.length; si++) {
        if (segments[segIndices[si]].end >= splitTime) {
          splitSegIdx = si;
          break;
        }
      }
      if (splitSegIdx === -1) splitSegIdx = segIndices.length - 1;
      console.log(
        `[matcher] Time-based Fatiha split at ${splitTime.toFixed(1)}s ` +
          `(segment index ${splitSegIdx})`
      );
    }
  } else {
    console.log(
      `[matcher] Segment-level Fatiha split at segment ${splitSegIdx} ` +
        `(${segments[segIndices[splitSegIdx]].end.toFixed(1)}s)`
    );
  }

  // Phase B: Intra-segment split for merged Fatiha+surah segments.
  let fatihaEndTime: number | null = null;
  const splitSeg = segments[segIndices[splitSegIdx]];
  const splitWords = toWords(splitSeg.text);

  if (splitWords.length >= 6) {
    const fatihaRef = quranIndex.getSurah(1);
    if (fatihaRef) {
      const fatihaWordSet = new Set(
        fatihaRef.words.filter((w) => !COMMON_ARABIC_WORDS.has(w))
      );
      const WINDOW = 4;
      let splitWord = -1;

      for (let w = 0; w <= splitWords.length - WINDOW; w++) {
        const windowWords = splitWords.slice(w, w + WINDOW);
        const matches = windowWords.filter((word) => fatihaWordSet.has(word)).length;
        if (matches === 0 && w >= 3) {
          splitWord = w;
          break;
        }
      }

      if (splitWord > 0) {
        if (splitSeg.words && splitSeg.words.length > splitWord) {
          fatihaEndTime = splitSeg.words[splitWord].start;
          console.log(
            `[matcher] Intra-segment Fatiha split at word ${splitWord}/${splitWords.length} ` +
              `→ ${fatihaEndTime.toFixed(3)}s (word-level timestamp)`
          );
        } else {
          const ratio = splitWord / splitWords.length;
          fatihaEndTime = splitSeg.start + (splitSeg.end - splitSeg.start) * ratio;
          console.log(
            `[matcher] Intra-segment Fatiha split at word ${splitWord}/${splitWords.length} ` +
              `→ ${fatihaEndTime.toFixed(1)}s (ratio ${ratio.toFixed(2)})`
          );
        }
      }
    }
  }

  const fatihaSegIndices = segIndices.slice(0, splitSegIdx + 1);

  let surahSegIndices: number[];
  if (fatihaEndTime !== null) {
    surahSegIndices = segIndices.slice(splitSegIdx);
    const orig = segments[segIndices[splitSegIdx]];
    segments[segIndices[splitSegIdx]] = {
      ...orig,
      start: fatihaEndTime,
      words: orig.words?.filter((w) => w.start >= fatihaEndTime),
    };
  } else {
    surahSegIndices = segIndices.slice(splitSegIdx + 1);
  }

  const fatihaEnd = fatihaEndTime ?? segments[segIndices[splitSegIdx]].end;

  const results: AnalyzedBlock[] = [
    {
      type: "fatiha",
      start: segments[fatihaSegIndices[0]].start,
      end: fatihaEnd,
      segments: fatihaSegIndices,
      surah: 1,
      startVerse: null,
      endVerse: null,
      confidence,
    },
  ];

  if (surahSegIndices.length > 0) {
    results.push(classifyAsSurah(surahSegIndices, segments, quranIndex));
  } else if (duration > MAX_FATIHA_DURATION) {
    console.log(
      `[matcher] Fatiha split left no surah content in ${duration.toFixed(1)}s block — reclassifying as surah`
    );
    return [classifyAsSurah(segIndices, segments, quranIndex)];
  }

  return results;
}

// ── Block classification (simplified) ─────────────────────────────

function makeTakbiratBlock(
  segIndices: number[],
  segments: WhisperSegment[],
  confidence: number
): AnalyzedBlock {
  return {
    type: "takbirat",
    start: segments[segIndices[0]].start,
    end: segments[segIndices[segIndices.length - 1]].end,
    segments: segIndices,
    surah: null,
    startVerse: null,
    endVerse: null,
    confidence,
  };
}

/**
 * Classify a block using fuzzy matching:
 * - ≤4 words + no Quran match → takbirat (CTC garbage)
 * - Fatiha detected → split Fatiha from Surah
 * - Surah match (similarity ≥0.4) → surah
 * - No match + short (< 15s) → takbirat
 * - No match + long (≥ 15s) → surah (unidentified)
 */
function classifyBlock(
  block: RawBlock,
  segments: WhisperSegment[],
  quranIndex: QuranIndex
): AnalyzedBlock[] {
  const segIndices = block.segmentIndices;
  const combinedText = segIndices.map((i) => segments[i].text).join(" ");
  const norm = normalize(combinedText);
  const words = toWords(combinedText);
  const start = segments[segIndices[0]].start;
  const end = segments[segIndices[segIndices.length - 1]].end;
  const duration = end - start;

  // Short blocks with no Quran match → takbirat (CTC garbage)
  if (words.length <= 4 && words.length > 0) {
    const candidates = quranIndex.findCandidates(norm);
    if (candidates.length === 0) {
      console.log(
        `[matcher] Short block ${start.toFixed(1)}s-${end.toFixed(1)}s ` +
          `(${words.length} words, no Quran match) → takbirat`
      );
      return [makeTakbiratBlock(segIndices, segments, 0.9)];
    }
  }

  // Check for Fatiha
  const fatiha = quranIndex.getSurah(1);
  const { isFatiha, fatihaSim, confidence } = detectFatiha(
    norm,
    words,
    duration,
    fatiha
  );

  if (isFatiha) {
    return splitFatihaFromSurah(
      segIndices,
      segments,
      quranIndex,
      fatihaSim,
      confidence
    );
  }

  // Try to identify as a specific surah
  const surahBlock = classifyAsSurah(segIndices, segments, quranIndex);

  // Unidentified + short → takbirat (CTC garbage from prayer transitions)
  if (surahBlock.surah === null && duration < 15) {
    console.log(
      `[matcher] Unidentified block ${start.toFixed(1)}s-${end.toFixed(1)}s ` +
        `(${duration.toFixed(1)}s, no surah match) → takbirat`
    );
    return [makeTakbiratBlock(segIndices, segments, 0.7)];
  }

  return [surahBlock];
}

// ── Main entry point ──────────────────────────────────────────────

/**
 * Analyze all Whisper segments using a simplified 3-step approach:
 * 1. Split by time gaps ≥5s → independent blocks
 * 2. Classify each block: fatiha / surah / takbirat
 * 3. Return AnalyzedBlock[] (same interface as before)
 */
export async function analyzeBlocks(
  rawSegments: WhisperSegment[]
): Promise<{ blocks: AnalyzedBlock[]; segments: WhisperSegment[] }> {
  const quranIndex = await QuranIndex.load();
  const segments = rawSegments;

  // Step 1: Put all segments in one block, then split by gaps ≥5s
  const allIndices = segments.map((_, i) => i);
  const initialBlocks: RawBlock[] = [
    { type: "recitation", segmentIndices: allIndices },
  ];
  const splitBlocks = splitBlocksOnGaps(initialBlocks, segments);

  console.log(
    `[matcher] ${segments.length} segments → ${splitBlocks.length} blocks ` +
      `after gap split (threshold=${GAP_SPLIT_THRESHOLD}s)`
  );

  // Step 2: Classify each block
  const analyzedBlocks: AnalyzedBlock[] = [];
  for (const block of splitBlocks) {
    const classified = classifyBlock(block, segments, quranIndex);
    analyzedBlocks.push(...classified);
  }

  // Log results
  for (const b of analyzedBlocks) {
    const surahStr = b.surah ? ` surah=${b.surah}` : "";
    const verseStr =
      b.startVerse && b.endVerse ? ` v${b.startVerse}-${b.endVerse}` : "";
    console.log(
      `[matcher] Block [${b.type}]${surahStr}${verseStr} ` +
        `(${(b.confidence * 100).toFixed(0)}%) ` +
        `${b.start.toFixed(1)}s-${b.end.toFixed(1)}s ` +
        `(${b.segments.length} segments)`
    );
  }

  return { blocks: analyzedBlocks, segments };
}
