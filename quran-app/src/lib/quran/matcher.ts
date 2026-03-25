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

// ── Known takbirat/prayer phrases ──────────────────────────────────
const TAKBIRAT_PHRASES = [
  // Correct forms
  "الله اكبر",
  "سمع الله لمن حمده",
  "ربنا ولك الحمد",
  "ربنا لك الحمد",
  "السلام عليكم ورحمه الله",
  "السلام عليكم ورحمة الله",
  "السلام عليكم",
  "استغفر الله",
  "سبحان ربي العظيم",
  "سبحان ربي الاعلى",
  // Whisper mangled forms (observed in real transcriptions)
  "يا الله من سيدنا",
  "يا الله من الحمد",
].map(normalize);

// Variants of "سمع الله لمن حمده" — the ruku marker that signals end of surah recitation
const SAMI_ALLAH_VARIANTS = [
  "سمع الله لمن حمده",
  "يا الله من سيدنا",
  "يا الله من الحمد",
].map(normalize);

const SALAM_MARKER = normalize("السلام عليكم");

const BASMALA = normalize("بسم الله الرحمن الرحيم");

// ── Fatiha structural markers (Whisper gets these right consistently) ─
const FATIHA_START_MARKER = normalize("الحمد لله رب العالمين");
const FATIHA_RAHMAAN_MARKER = normalize("الرحمن الرحيم");

// Fatiha unique markers — kept as secondary signal
const FATIHA_MARKERS = [
  "مالك يوم الدين",
  "اياك نعبد",
  "اهدنا الصراط",
  "غير المغضوب",
  "صراط الذين انعمت",
].map(normalize);

// Multiple variants of the end-of-Fatiha marker (Whisper mangles this every time)
const FATIHA_END_MARKERS = [
  "ولا الضالين",
  "ولا الظالين",
  "عليهم ولا الضالين",
  "عليهم ولا الظالين",
  // Whisper mangled variants
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

// ── Utility functions (kept from original) ─────────────────────────

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

// ── Step 0: Discard pre-prayer noise ─────────────────────────────

const ALLAHU_AKBAR = normalize("الله اكبر");

/**
 * Find the first segment containing "الله أكبر" and discard everything before it.
 * Audio before the first takbir is noise (people talking, mic setup, etc.).
 */
function discardPrePrayerNoise(segments: WhisperSegment[]): WhisperSegment[] {
  const firstTakbirIdx = segments.findIndex((seg) =>
    normalize(seg.text).includes(ALLAHU_AKBAR)
  );

  if (firstTakbirIdx <= 0) return segments; // nothing to discard

  console.log(
    `[matcher] Discarding ${firstTakbirIdx} pre-prayer noise segment(s) ` +
      `(0-${segments[firstTakbirIdx - 1].end.toFixed(1)}s)`
  );
  return segments.slice(firstTakbirIdx);
}

// ── Step 1: Identify takbirat segments ─────────────────────────────

/**
 * A segment is takbirat if:
 * - It contains at least one recognized takbirat phrase
 * - After removing ALL known takbirat phrases, the residue is < 10 chars
 * - AND the segment is short (< 15 seconds)
 *
 * Note: Basmala is NOT stripped — it's the start of a surah, not takbirat.
 */
function isTakbiratSegment(segment: WhisperSegment): boolean {
  const duration = segment.end - segment.start;

  const norm = normalize(segment.text);
  let residue = norm;
  let foundPhrase = false;
  let phraseCount = 0;

  for (const phrase of TAKBIRAT_PHRASES) {
    if (residue.includes(phrase)) {
      foundPhrase = true;
      phraseCount++;
      residue = residue.replaceAll(phrase, "");
    }
  }

  // Must have found at least one takbirat phrase
  if (!foundPhrase) return false;

  // Guard against Whisper hallucinations with per-phrase duration limits:
  // - 1 phrase: max 6s (Whisper hallucinates "الله أكبر" over slow tajweed)
  // - 2+ phrases: max 10s per phrase (prayer includes pauses between takbirats)
  if (phraseCount <= 1 && duration > 6) return false;
  if (phraseCount >= 2 && duration / phraseCount > 10) return false;

  return residue.replace(/\s+/g, "").length < 10;
}

// ── Step 2: Group segments into blocks ─────────────────────────────

interface RawBlock {
  type: "takbirat" | "recitation";
  segmentIndices: number[];
}

/**
 * Check if a segment contains "الله أكبر".
 */
function hasAllahuAkbar(seg: WhisperSegment): boolean {
  return normalize(seg.text).includes(ALLAHU_AKBAR);
}

/**
 * Check if a segment contains any "سمع الله لمن حمده" variant.
 */
function hasSamiAllah(seg: WhisperSegment): boolean {
  const norm = normalize(seg.text);
  return SAMI_ALLAH_VARIANTS.some((v) => norm.includes(v));
}

/**
 * Check if a segment contains "السلام عليكم".
 */
function hasSalam(seg: WhisperSegment): boolean {
  return normalize(seg.text).includes(SALAM_MARKER);
}

/**
 * Detect garbled ruku dua pattern in normalized text.
 * CTC garbles "سمع الله لمن حمده" into forms like "الهلله لمن حمد الالله".
 * We detect "لمن" near "حمد" as a universal signal.
 */
function hasRukuDuaPattern(norm: string): boolean {
  if (SAMI_ALLAH_VARIANTS.some((v) => norm.includes(v))) return true;
  const words = norm.split(/\s+/);
  const lmanIdx = words.findIndex((w) => w.includes(normalize("لمن")));
  if (lmanIdx >= 0) {
    for (let j = lmanIdx; j < Math.min(lmanIdx + 5, words.length); j++) {
      if (words[j].includes(normalize("حمد"))) return true;
    }
  }
  return false;
}

/**
 * Trim non-Quranic content (takbirat, garbled fragments, ruku dua) from
 * the end of a surah block's segment list. Scans backwards from the last segment.
 */
function trimSurahBlockTail(
  segIndices: number[],
  segments: WhisperSegment[],
  quranIndex: QuranIndex,
): number[] {
  if (segIndices.length <= 1) return segIndices;

  let lastQuranIdx = segIndices.length - 1;

  for (let i = segIndices.length - 1; i >= 1; i--) {
    const seg = segments[segIndices[i]];
    const duration = seg.end - seg.start;
    const norm = normalize(seg.text);
    const words = toWords(seg.text);

    // Strict takbirat check (whole segment is takbirat)
    if (isTakbiratSegment(seg)) {
      lastQuranIdx = i - 1;
      continue;
    }

    // Ruku dua pattern ("لمن" + "حمد") — may be mixed with surah content
    if (hasRukuDuaPattern(norm)) {
      // Find the word index where ruku dua starts
      const normWords = norm.split(/\s+/);
      const lmanNorm = normalize("لمن");
      const lmanIdx = normWords.findIndex((w) => w.includes(lmanNorm));

      // If there's substantial Quranic content before the ruku dua pattern,
      // trim within the segment rather than dropping it entirely
      if (lmanIdx > 3) {
        let newEnd: number;
        if (seg.words && seg.words.length > lmanIdx) {
          newEnd = seg.words[lmanIdx].start;
          console.log(
            `[matcher] Intra-segment ruku dua trim at word ${lmanIdx}/${words.length} ` +
              `→ new end=${newEnd.toFixed(3)}s (word-level timestamp)`
          );
        } else {
          const ratio = lmanIdx / normWords.length;
          newEnd = seg.start + (seg.end - seg.start) * ratio;
          console.log(
            `[matcher] Intra-segment ruku dua trim at word ${lmanIdx}/${words.length} ` +
              `→ new end=${newEnd.toFixed(1)}s (proportional)`
          );
        }
        // Clone segment to avoid corrupting shared array
        segments[segIndices[i]] = { ...seg, end: newEnd };
        break;
      }

      lastQuranIdx = i - 1;
      continue;
    }

    // Very short garbled fragment (< 2s, ≤ 2 words) — CTC transition noise
    if (duration < 2 && words.length <= 2) {
      lastQuranIdx = i - 1;
      continue;
    }

    // Content-based check: does this segment match any Quranic text?
    // Use n-gram existence (findCandidates) instead of wordSimilarity to avoid
    // the denominator problem: wordSimilarity(15 words, 3000 surah words) is always ~0.
    if (words.length >= 3) {
      const candidates = quranIndex.findCandidates(norm);
      if (candidates.length === 0) {
        // No n-gram matches — non-Quranic content
        console.log(
          `[matcher] Tail segment ${segIndices[i]} (${duration.toFixed(1)}s) has no Quran n-gram matches — trimming`
        );
        lastQuranIdx = i - 1;
        continue;
      }
    }

    // Has Quran n-gram matches — stop trimming
    break;
  }

  if (lastQuranIdx < segIndices.length - 1) {
    const trimmed = segIndices.slice(0, lastQuranIdx + 1);
    console.log(
      `[matcher] Trimmed ${segIndices.length - trimmed.length} tail segment(s) from surah block`
    );
    return trimmed;
  }
  return segIndices;
}

/** Trim non-Quranic content from the START of a surah block */
function trimSurahBlockHead(
  segIndices: number[],
  segments: WhisperSegment[],
  quranIndex: QuranIndex,
): number[] {
  if (segIndices.length <= 1) return segIndices;

  let firstQuranIdx = 0;

  for (let i = 0; i < segIndices.length - 1; i++) {
    const seg = segments[segIndices[i]];
    const duration = seg.end - seg.start;
    const words = toWords(seg.text);

    // Short garbled fragments at start
    if (duration < 2 && words.length <= 2) {
      firstQuranIdx = i + 1;
      continue;
    }

    // Content-based check against Quran index
    if (words.length >= 3) {
      const norm = normalize(seg.text);
      const candidates = quranIndex.findCandidates(norm);
      if (candidates.length === 0) {
        console.log(
          `[matcher] Head segment ${segIndices[i]} (${duration.toFixed(1)}s) has no Quran candidates — trimming`
        );
        firstQuranIdx = i + 1;
        continue;
      }
    }

    // Has Quranic content — stop trimming
    break;
  }

  if (firstQuranIdx > 0) {
    const trimmed = segIndices.slice(firstQuranIdx);
    console.log(
      `[matcher] Trimmed ${firstQuranIdx} head segment(s) from surah block`
    );
    return trimmed;
  }
  return segIndices;
}

/**
 * Find ruku points: "الله أكبر" segments where the next 1-3 segments
 * contain "سمع الله لمن حمده" (or its Whisper-mangled variants).
 * Returns the index of the "الله أكبر" segment that starts the ruku.
 */
function findRukuPoints(segments: WhisperSegment[]): number[] {
  const points: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (!hasAllahuAkbar(segments[i])) continue;
    // Look ahead 1-3 segments for سمع الله
    for (let j = 1; j <= 3 && i + j < segments.length; j++) {
      if (hasSamiAllah(segments[i + j])) {
        points.push(i);
        break;
      }
    }
  }
  return points;
}

/**
 * Find salam points: segments containing "السلام عليكم".
 */
function findSalamPoints(segments: WhisperSegment[]): number[] {
  const points: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (hasSalam(segments[i])) points.push(i);
  }
  return points;
}

/**
 * Fallback: find runs of 3+ consecutive takbirat segments spanning > 20 seconds.
 * Returns the index of the first segment in each such run.
 */
function findLongTakbiratRuns(
  segments: WhisperSegment[],
  isTakbirat: boolean[]
): number[] {
  const points: number[] = [];
  let i = 0;
  while (i < segments.length) {
    if (isTakbirat[i]) {
      const runStart = i;
      while (i < segments.length && isTakbirat[i]) i++;
      const runEnd = i - 1;
      const count = runEnd - runStart + 1;
      const duration = segments[runEnd].end - segments[runStart].start;
      if (count >= 3 && duration > 20) {
        points.push(runStart);
      }
    } else {
      i++;
    }
  }
  return points;
}

/**
 * Group segments into recitation and takbirat blocks using structural markers:
 * - Ruku points (الله أكبر + سمع الله pattern) mark end of surah recitation
 * - Salam points (السلام عليكم) mark end of 2-raka'ah set
 * - Fallback: 3+ consecutive takbirat segments > 20s
 *
 * Everything from a ruku/salam point until the next Fatiha start is takbirat.
 * Everything else is recitation.
 */
function groupIntoBlocks(
  segments: WhisperSegment[],
  isTakbirat: boolean[]
): RawBlock[] {
  const rukuPoints = findRukuPoints(segments);
  const salamPoints = findSalamPoints(segments);
  const longRuns = findLongTakbiratRuns(segments, isTakbirat);

  // Merge all boundary start points and deduplicate
  const boundaryStarts = new Set<number>([
    ...rukuPoints,
    ...salamPoints,
    ...longRuns,
  ]);

  console.log(
    `[matcher] Structural boundaries: ${rukuPoints.length} ruku, ` +
      `${salamPoints.length} salam, ${longRuns.length} long-run fallbacks`
  );

  // For each boundary start, find where the takbirat zone ends:
  // it ends at the next segment that starts Fatiha (الحمد لله رب العالمين)
  // or the next non-takbirat segment after a gap.
  // Build a set of segment indices that are in takbirat zones.
  const takbiratZone = new Set<number>();

  for (const startIdx of boundaryStarts) {
    // Mark from startIdx forward until we hit a Fatiha start marker
    // or run out of takbirat-like segments.
    // Track consecutive non-takbirat segments: 2+ in a row = recitation.
    let consecutiveNonTakbirat = 0;
    const pendingIndices: number[] = [];

    for (let j = startIdx; j < segments.length; j++) {
      const norm = normalize(segments[j].text);

      // Stop if we hit the start of Fatiha (next raka'ah)
      if (norm.includes(FATIHA_START_MARKER)) break;

      if (!isTakbirat[j] && !boundaryStarts.has(j)) {
        consecutiveNonTakbirat++;
        // 2+ consecutive non-takbirat segments = we've left the takbirat zone
        if (consecutiveNonTakbirat >= 2) {
          // Don't add the pending non-takbirat segments — they're recitation
          break;
        }
        // Hold this segment as pending — might be noise between takbirats
        pendingIndices.push(j);
      } else {
        // It's takbirat or a boundary: check pending before committing
        // A "long" pending segment (> 10s) is definitive recitation — not noise.
        // Committing it to takbirat would silently eat real Quran audio.
        const hasLongPending = pendingIndices.some(
          (idx) => segments[idx].end - segments[idx].start > 10
        );
        if (hasLongPending) break;

        // Short pending segments are likely inter-takbirat noise — commit them
        consecutiveNonTakbirat = 0;
        for (const idx of pendingIndices) takbiratZone.add(idx);
        pendingIndices.length = 0;
        takbiratZone.add(j);
      }
    }
  }

  // Build blocks from the zone classification
  const blocks: RawBlock[] = [];
  let i = 0;

  while (i < segments.length) {
    if (takbiratZone.has(i)) {
      const indices: number[] = [];
      while (i < segments.length && takbiratZone.has(i)) {
        indices.push(i);
        i++;
      }
      blocks.push({ type: "takbirat", segmentIndices: indices });
    } else {
      const indices: number[] = [];
      while (i < segments.length && !takbiratZone.has(i)) {
        indices.push(i);
        i++;
      }
      blocks.push({ type: "recitation", segmentIndices: indices });
    }
  }

  return blocks;
}

// ── Step 2b: Trim takbirat phrases from edges of recitation blocks ─

/**
 * When Whisper puts takbirat phrases ("Allahu Akbar", etc.) in the same
 * segment as surah text, isTakbiratSegment() can't catch them.
 * This function trims takbirat from the START and END of recitation blocks
 * by adjusting timestamps proportionally based on text length.
 */
function trimTakbiratFromBlockEdges(
  blocks: RawBlock[],
  segments: WhisperSegment[]
): void {
  for (const block of blocks) {
    if (block.type !== "recitation" || block.segmentIndices.length === 0)
      continue;

    // ── Trim END of block ──
    const lastIdx = block.segmentIndices[block.segmentIndices.length - 1];
    const lastSeg = segments[lastIdx];
    const lastNorm = normalize(lastSeg.text);

    for (const phrase of TAKBIRAT_PHRASES) {
      if (lastNorm.endsWith(phrase)) {
        const prefixLen = lastNorm.length - phrase.length;
        if (prefixLen <= 0) continue; // entire segment is takbirat, skip
        const totalLen = lastNorm.length;
        const ratio = prefixLen / totalLen;
        const newEnd = lastSeg.start + (lastSeg.end - lastSeg.start) * ratio;
        // Clone segment to avoid corrupting shared array
        segments[lastIdx] = { ...lastSeg, end: newEnd };
        console.log(
          `[matcher] Trimmed takbirat from END of segment ${lastIdx}: ` +
            `"${phrase}" → new end=${newEnd.toFixed(1)}s`
        );
        break;
      }
    }

    // ── Trim START of block ──
    const firstIdx = block.segmentIndices[0];
    const firstSeg = segments[firstIdx];
    const firstNorm = normalize(firstSeg.text);

    for (const phrase of TAKBIRAT_PHRASES) {
      if (firstNorm.startsWith(phrase)) {
        const suffixLen = firstNorm.length - phrase.length;
        if (suffixLen <= 0) continue; // entire segment is takbirat, skip
        const totalLen = firstNorm.length;
        const ratio = phrase.length / totalLen;
        const newStart =
          firstSeg.start + (firstSeg.end - firstSeg.start) * ratio;
        // Clone segment to avoid corrupting shared array
        segments[firstIdx] = { ...firstSeg, start: newStart };
        console.log(
          `[matcher] Trimmed takbirat from START of segment ${firstIdx}: ` +
            `"${phrase}" → new start=${newStart.toFixed(1)}s`
        );
        break;
      }
    }
  }
}

// ── Step 2c: Split large recitation blocks at Fatiha boundaries ─────
//
// CTC output is sparse and error-prone: exact marker detection (ruku, salam)
// often fails, leaving everything as one giant recitation block.
// This function scans per-segment Fatiha word similarity to find where
// repeated Fatiha recitations occur, and splits the block at those points.
// Each sub-block then gets processed by the existing classification logic.

function splitBlocksOnFatihaContent(
  blocks: RawBlock[],
  segments: WhisperSegment[],
  fatiha: SurahInfo,
): RawBlock[] {
  const MIN_BLOCK_DURATION = 120; // Only split blocks > 2 minutes
  const MIN_FATIHA_GAP = 30; // Fatiha zones must be ≥30s apart (minimum: Fatiha ~20s + shortest surah ~10s)

  const result: RawBlock[] = [];

  for (const block of blocks) {
    if (block.type !== "recitation") {
      result.push(block);
      continue;
    }

    const indices = block.segmentIndices;
    if (indices.length < 3) {
      result.push(block);
      continue;
    }

    const blockStart = segments[indices[0]].start;
    const blockEnd = segments[indices[indices.length - 1]].end;
    const blockDuration = blockEnd - blockStart;

    if (blockDuration < MIN_BLOCK_DURATION) {
      result.push(block);
      continue;
    }

    // Build set of Fatiha-specific words (excluding common Arabic words like الله)
    const fatihaWordSet = new Set(
      fatiha.words.filter((w) => !COMMON_ARABIC_WORDS.has(w))
    );

    // Find Fatiha split points via per-segment Fatiha word count
    // A segment with ≥2 Fatiha-specific words is a "Fatiha signal"
    const splitPoints: number[] = []; // local indices into block.segmentIndices
    let lastFatihaTime = -Infinity;

    for (let i = 0; i < indices.length; i++) {
      const seg = segments[indices[i]];
      const segWords = toWords(seg.text);
      if (segWords.length < 3) continue;

      // Count Fatiha-specific words in this segment (universal — no denominator problem)
      const fatihaHits = segWords.filter((w) => fatihaWordSet.has(w)).length;
      if (fatihaHits >= 2 && seg.start - lastFatihaTime > MIN_FATIHA_GAP) {
        splitPoints.push(i);
        lastFatihaTime = seg.start;
      }
    }

    // Need ≥2 Fatiha occurrences to justify splitting
    if (splitPoints.length < 2) {
      result.push(block);
      continue;
    }

    // Skip the first split point if at index 0 (block already starts with Fatiha)
    const effectiveSplits =
      splitPoints[0] === 0 ? splitPoints.slice(1) : splitPoints;

    if (effectiveSplits.length === 0) {
      result.push(block);
      continue;
    }

    // Split the block at each Fatiha boundary
    let prevEnd = 0;
    for (const splitAt of effectiveSplits) {
      if (splitAt > prevEnd) {
        result.push({
          type: "recitation",
          segmentIndices: indices.slice(prevEnd, splitAt),
        });
      }
      prevEnd = splitAt;
    }
    // Last sub-block
    if (prevEnd < indices.length) {
      result.push({
        type: "recitation",
        segmentIndices: indices.slice(prevEnd),
      });
    }

    console.log(
      `[matcher] Split ${blockDuration.toFixed(0)}s recitation block into ` +
        `${effectiveSplits.length + 1} sub-blocks at Fatiha boundaries`,
    );
  }

  return result;
}

// ── Step 3: Classify recitation blocks ─────────────────────────────

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

/**
 * Detect Fatiha using structural markers (Whisper gets these right) combined
 * with similarity and duration heuristics.
 */
function detectFatiha(
  norm: string,
  words: string[],
  duration: number,
  fatiha: SurahInfo | undefined,
  segmentFatihaScores?: number[],
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
  // No duration cap — if splitBlocksOnFatihaContent failed to split, we still need to detect
  const longBlockFatiha =
    duration > MAX_FATIHA_DURATION &&
    hasStartMarker &&
    (hasRahmaanMarker || markerCount >= 2);

  // Per-segment fuzzy detection for CTC output where exact markers fail
  // If any of the first segments have high word similarity to Fatiha, treat as Fatiha
  const segmentFuzzyFatiha =
    segmentFatihaScores !== undefined &&
    segmentFatihaScores.some((s) => s >= 0.12);

  const isFatiha = structuralMatch || fuzzyMatch || markerMatch || highSimilarity || longBlockFatiha || segmentFuzzyFatiha;

  let confidence = fatihaSim;
  if (structuralMatch) confidence = Math.max(confidence, 0.9);
  if (markerMatch) confidence = Math.max(confidence, 0.8);
  if (segmentFuzzyFatiha) confidence = Math.max(confidence, 0.7);

  return { isFatiha, fatihaSim, confidence };
}

/**
 * Split a block into Fatiha + Surah parts.
 * First tries text-based split at "ولا الضالين" markers.
 * Falls back to time-based split at ~35 seconds (typical Fatiha duration).
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

  // Always try to split long blocks, regardless of fatihaSim.
  // If fatihaSim > 0.6 on a long block, it just means Fatiha dominates the text,
  // but there's still surah content after it that we must not lose.

  // Segment-level split: find the FIRST end marker within the first ~60s
  // Fatiha is always at the start, so searching for the last marker can
  // match deep into surah text (Whisper mangling) and eat real content.
  const searchWindowEnd = start + 60;
  let splitSegIdx = -1;

  for (let si = 0; si < segIndices.length; si++) {
    // Stop searching beyond 60s from block start
    if (segments[segIndices[si]].start > searchWindowEnd) break;
    const segNorm = normalize(segments[segIndices[si]].text);
    for (const marker of FATIHA_END_MARKERS) {
      if (segNorm.includes(marker)) {
        splitSegIdx = si;
        break; // Use the FIRST segment with a Fatiha end marker
      }
    }
    if (splitSegIdx !== -1) break;
  }

  if (splitSegIdx === -1) {
    // Similarity-based fallback: scan segments for Fatiha word similarity.
    // While similarity is high → still Fatiha. When it drops → surah starts.
    // No time cap — purely content-based, adapts to any reciter speed.
    const fatiha = quranIndex.getSurah(1);
    if (fatiha) {
      const SIM_THRESHOLD = 0.10;
      let lastFatihaIdx = 0; // at minimum, first segment is Fatiha
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
          // Similarity dropped after finding Fatiha content → Fatiha is done
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
  // If the split segment contains BOTH Fatiha and surah text (common in CTC),
  // find the boundary using Fatiha word set density with a sliding window.
  // When 4 consecutive words have ZERO matches with Fatiha-specific words,
  // surah body has started. This is content-based and universal.
  let fatihaEndTime: number | null = null;
  const splitSeg = segments[segIndices[splitSegIdx]];
  const splitWords = toWords(splitSeg.text);

  if (splitWords.length >= 6) {
    const fatihaRef = quranIndex.getSurah(1);
    if (fatihaRef) {
      // Build set of Fatiha-specific words (excluding common Arabic words)
      const fatihaWordSet = new Set(
        fatihaRef.words.filter((w) => !COMMON_ARABIC_WORDS.has(w))
      );
      const WINDOW = 4;
      let splitWord = -1;

      // Find first position where WINDOW consecutive words have 0 Fatiha matches
      for (let w = 0; w <= splitWords.length - WINDOW; w++) {
        const windowWords = splitWords.slice(w, w + WINDOW);
        const matches = windowWords.filter((word) => fatihaWordSet.has(word)).length;
        if (matches === 0 && w >= 3) {
          splitWord = w;
          break;
        }
      }

      if (splitWord > 0) {
        // Prefer actual word timestamp if available (word-level CTC output)
        if (splitSeg.words && splitSeg.words.length > splitWord) {
          fatihaEndTime = splitSeg.words[splitWord].start;
          console.log(
            `[matcher] Intra-segment Fatiha split at word ${splitWord}/${splitWords.length} ` +
              `→ ${fatihaEndTime.toFixed(3)}s (word-level timestamp)`
          );
        } else {
          // Fallback: proportional estimate
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

  // For intra-segment splits, include the split segment in BOTH blocks:
  // Fatiha gets it up to fatihaEndTime, surah gets it from fatihaEndTime onward.
  // Without this, the surah portion of the split segment is LOST.
  let surahSegIndices: number[];
  if (fatihaEndTime !== null) {
    surahSegIndices = segIndices.slice(splitSegIdx); // Include split segment
    // Clone the split segment to avoid corrupting shared array
    const orig = segments[segIndices[splitSegIdx]];
    segments[segIndices[splitSegIdx]] = {
      ...orig,
      start: fatihaEndTime,
      words: orig.words?.filter((w) => w.start >= fatihaEndTime),
    };
  } else {
    surahSegIndices = segIndices.slice(splitSegIdx + 1);
  }

  // Compute Fatiha block end time
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
    // Split produced no surah portion but block is too long for pure Fatiha.
    // This is a false positive — reclassify entire block as surah.
    console.log(
      `[matcher] Fatiha split left no surah content in ${duration.toFixed(1)}s block — reclassifying as surah`
    );
    return [classifyAsSurah(segIndices, segments, quranIndex)];
  }

  return results;
}

/**
 * Classify a recitation block. May return 1 block (pure fatiha or pure surah)
 * or 2 blocks (fatiha + surah) if the block contains both.
 */
function classifyRecitationBlock(
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

  // Early check: short blocks (< 8s) that are predominantly takbirat phrases
  // should be classified as takbirat, not surah (catches e.g. "الله أكبر" segments)
  if (duration < 8) {
    let residue = norm;
    for (const phrase of TAKBIRAT_PHRASES) {
      while (residue.includes(phrase)) {
        residue = residue.replace(phrase, "");
      }
    }
    residue = residue.replace(/\s+/g, "").trim();
    if (residue.length < 10) {
      return [{
        type: "takbirat",
        start,
        end,
        segments: segIndices,
        surah: null,
        startVerse: null,
        endVerse: null,
        confidence: 0.9,
      }];
    }
  }

  const fatiha = quranIndex.getSurah(1);

  // Compute per-segment Fatiha similarity for CTC-friendly detection
  // When exact markers fail (garbled text), individual segments may still
  // have enough matching words to identify Fatiha content
  const segmentFatihaScores = fatiha
    ? segIndices.slice(0, 5).map((idx) => {
        const segWords = toWords(segments[idx].text);
        return segWords.length >= 3
          ? wordSimilarity(segWords, fatiha.words)
          : 0;
      })
    : undefined;

  const { isFatiha, fatihaSim, confidence } = detectFatiha(
    norm,
    words,
    duration,
    fatiha,
    segmentFatihaScores,
  );

  if (!isFatiha) {
    return [classifyAsSurah(segIndices, segments, quranIndex)];
  }

  return splitFatihaFromSurah(
    segIndices,
    segments,
    quranIndex,
    fatihaSim,
    confidence,
  );
}

// ── Step 4: Reclassify transition blocks ─────────────────────────────

/**
 * After classification, find surah transitions and reclassify unidentified
 * blocks between them as takbirat.
 *
 * Pattern: [surah N] → [unknown blocks] → [fatiha or surah M] (M != N)
 * The unknown blocks are prayer (tashahud, salam, opening takbir) — not recitation.
 *
 * Also catches: [surah N] → [unknown blocks] → end of audio (trailing prayer).
 */
function reclassifyTransitionBlocks(blocks: AnalyzedBlock[]): void {
  let reclassified = 0;

  for (let i = 0; i < blocks.length; i++) {
    // Only look at unidentified blocks (surah=null, not already takbirat)
    if (blocks[i].type === "takbirat") continue;
    if (blocks[i].surah !== null) continue;

    // Duration guard: blocks > 60s contain real content, not prayer transitions
    const blockDuration = blocks[i].end - blocks[i].start;
    if (blockDuration > 60) continue;

    // This is an unidentified block. Check if it's between two identified blocks.
    // Find the previous identified block (surah with surah !== null)
    let prevSurah: AnalyzedBlock | null = null;
    for (let p = i - 1; p >= 0; p--) {
      if (blocks[p].surah !== null) {
        prevSurah = blocks[p];
        break;
      }
    }

    // Find the next identified block (surah/fatiha with surah !== null)
    let nextIdentified: AnalyzedBlock | null = null;
    for (let n = i + 1; n < blocks.length; n++) {
      if (blocks[n].surah !== null || blocks[n].type === "fatiha") {
        nextIdentified = blocks[n];
        break;
      }
    }

    // Reclassify as takbirat if:
    // 1. There's a previous identified surah AND a next identified block
    //    (transition between recitation sections)
    // 2. OR there's a previous identified surah and no next block
    //    (trailing prayer after last surah)
    if (prevSurah) {
      const isSurahTransition =
        nextIdentified &&
        (nextIdentified.type === "fatiha" ||
          (nextIdentified.surah !== null && nextIdentified.surah !== prevSurah.surah));
      const isTrailingPrayer = !nextIdentified;

      if (isSurahTransition || isTrailingPrayer) {
        console.log(
          `[matcher] Reclassifying unidentified block ${blocks[i].start.toFixed(1)}s-${blocks[i].end.toFixed(1)}s ` +
            `as takbirat (between surah ${prevSurah.surah} and ${nextIdentified?.surah ?? "end"})`,
        );
        blocks[i].type = "takbirat";
        blocks[i].confidence = 0.8;
        reclassified++;
      }
    }
  }

  if (reclassified > 0) {
    console.log(`[matcher] Reclassified ${reclassified} unidentified block(s) as takbirat`);
  }
}

// ── Main entry point ───────────────────────────────────────────────

/**
 * Analyze all Whisper segments using block-level detection.
 *
 * Instead of classifying each segment independently, this:
 * 1. Finds takbirat boundaries (the ONLY reliable cut points)
 * 2. Groups everything between takbirat into blocks
 * 3. Classifies each block as fatiha or surah
 *
 * Result: a small number of large blocks with no mid-recitation cuts.
 */
export async function analyzeBlocks(
  rawSegments: WhisperSegment[]
): Promise<{ blocks: AnalyzedBlock[]; segments: WhisperSegment[] }> {
  const quranIndex = await QuranIndex.load();

  // Step 0: Discard pre-prayer noise
  const segments = discardPrePrayerNoise(rawSegments);

  // Step 1: Identify takbirat segments
  const isTakbirat = segments.map((seg) => isTakbiratSegment(seg));

  const takbiratCount = isTakbirat.filter(Boolean).length;
  console.log(
    `[matcher] ${segments.length} segments, ${takbiratCount} classified as takbirat`
  );

  // Step 2: Group into blocks
  const rawBlocks = groupIntoBlocks(segments, isTakbirat);

  console.log(
    `[matcher] ${rawBlocks.length} raw blocks ` +
      `(${rawBlocks.filter((b) => b.type === "takbirat").length} takbirat, ` +
      `${rawBlocks.filter((b) => b.type === "recitation").length} recitation)`
  );

  // Step 2b: Trim takbirat phrases from edges of recitation blocks
  trimTakbiratFromBlockEdges(rawBlocks, segments);

  // Step 2c: Split large recitation blocks at Fatiha boundaries
  // CTC output often lacks structural markers (ruku/salam), so all segments
  // end up in one giant block. This splits at per-segment Fatiha detection.
  const fatihaInfo = quranIndex.getSurah(1);
  let processedBlocks: RawBlock[] = rawBlocks;
  if (fatihaInfo) {
    processedBlocks = splitBlocksOnFatihaContent(rawBlocks, segments, fatihaInfo);
    if (processedBlocks.length !== rawBlocks.length) {
      console.log(
        `[matcher] After Fatiha split: ${processedBlocks.length} blocks ` +
          `(was ${rawBlocks.length})`,
      );
    }
  }

  // Step 3: Classify each block
  const analyzedBlocks: AnalyzedBlock[] = [];

  for (const block of processedBlocks) {
    if (block.type === "takbirat") {
      const segIndices = block.segmentIndices;
      analyzedBlocks.push({
        type: "takbirat",
        start: segments[segIndices[0]].start,
        end: segments[segIndices[segIndices.length - 1]].end,
        segments: segIndices,
        surah: null,
        startVerse: null,
        endVerse: null,
        confidence: 1,
      });
    } else {
      const classified = classifyRecitationBlock(block, segments, quranIndex);
      for (const b of classified) {
        if (b.type === "surah") {
          // Trim non-Quranic tail (takbirat, garbled fragments, ruku dua, no-match content)
          let trimmed = trimSurahBlockTail(b.segments, segments, quranIndex);
          // Trim non-Quranic head (leaked Fatiha tail, garbled transitions)
          trimmed = trimSurahBlockHead(trimmed, segments, quranIndex);
          if (trimmed.length > 0) {
            b.segments = trimmed;
            b.start = segments[trimmed[0]].start;
            b.end = segments[trimmed[trimmed.length - 1]].end;
          }
        }
        analyzedBlocks.push(b);
      }
    }
  }

  // Step 4: Reclassify unidentified blocks between surah transitions as takbirat.
  // At a surah transition (e.g., An-Nisa → Al-Ma'idah), there's tashahud + salam +
  // opening takbir + Fatiha. Some of these segments aren't recognized as takbirat
  // (tashahud text, mangled Whisper output), so they end up as surah with surah=null.
  // Everything between two identified surahs (or between identified surah and fatiha)
  // that has surah=null should be takbirat — it's prayer, not recitation.
  reclassifyTransitionBlocks(analyzedBlocks);

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
