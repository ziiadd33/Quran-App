import type { WhisperSegment, SpeechRegion } from "./types";
import { normalize } from "../quran/normalize";

// ── Fatiha markers unique enough at segment level (1 match = Fatiha) ──
const FATIHA_UNIQUE_MARKERS = [
  "مالك يوم الدين",
  "اياك نعبد",
  "اهدنا الصراط",
  "غير المغضوب",
];

// ── Hallucination phrases (Whisper repeats these from the prompt) ──
const HALLUCINATION_PHRASES = [
  "تلاوه من القران الكريم في صلاه التراويح",
  "بسم الله الرحمن الرحيم",
];

// ── Short prayer phrases (takbirat, tasbih, etc.) ──
const TAKBIRAT_PHRASES = [
  "الله اكبر",
  "سمع الله لمن حمده",
  "ربنا ولك الحمد",
  "ربنا لك الحمد",
  "السلام عليكم ورحمه الله",
  "السلام عليكم",
  "استغفر الله",
  "سبحان ربي العظيم",
  "سبحان ربي الاعلى",
  "امين",
];

export type SegmentLabel = "hallucination" | "fatiha" | "takbirat" | "keep";

function classifySegment(text: string): SegmentLabel {
  const norm = normalize(text);

  // A) Hallucination: remove known hallucination phrases, check if <15 chars remain
  let hallucinationRemaining = norm;
  for (const phrase of HALLUCINATION_PHRASES) {
    hallucinationRemaining = hallucinationRemaining.replaceAll(normalize(phrase), "");
  }
  if (hallucinationRemaining.replace(/\s+/g, "").length < 15) {
    return "hallucination";
  }

  // B) Fatiha: any unique marker is enough at segment level
  for (const marker of FATIHA_UNIQUE_MARKERS) {
    if (norm.includes(normalize(marker))) {
      return "fatiha";
    }
  }

  // C) Takbirat: remove all prayer phrases, check if <10 chars remain (no duration limit)
  let takbiratRemaining = norm;
  for (const phrase of TAKBIRAT_PHRASES) {
    takbiratRemaining = takbiratRemaining.replaceAll(normalize(phrase), "");
  }
  // Also remove basmala which often appears with takbirat
  takbiratRemaining = takbiratRemaining.replaceAll(normalize("بسم الله الرحمن الرحيم"), "");
  if (takbiratRemaining.replace(/\s+/g, "").length < 10) {
    return "takbirat";
  }

  return "keep";
}

export interface SegmentFilterResult {
  kept: WhisperSegment[];
  removedFatiha: WhisperSegment[];
  removedTakbirat: WhisperSegment[];
  removedHallucination: WhisperSegment[];
  labels: SegmentLabel[];
}

/**
 * Filter Whisper segments BEFORE merging into speech regions.
 * Each segment is classified independently, then an adjacency pass
 * catches "الحمد لله رب العالمين" segments next to confirmed Fatiha.
 */
export function filterWhisperSegments(segments: WhisperSegment[]): SegmentFilterResult {
  // First pass: classify each segment
  const labels: SegmentLabel[] = segments.map((s) => classifySegment(s.text));

  // Debug: log classifications
  console.log("[filter] === SEGMENT CLASSIFICATION ===");
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const d = (s.end - s.start).toFixed(1);
    console.log(`[filter] Seg ${i} [${labels[i]}] (${d}s): ${s.text.substring(0, 80)}`);
  }

  // Adjacency pass: segments with "الحمد لله رب العالمين" adjacent to confirmed Fatiha → Fatiha
  const hamdNorm = normalize("الحمد لله رب العالمين");
  for (let i = 0; i < segments.length; i++) {
    if (labels[i] !== "keep") continue;
    const norm = normalize(segments[i].text);
    if (!norm.includes(hamdNorm)) continue;

    // Check if next segment is confirmed Fatiha and gap < 2s
    const hasAdjacentFatiha =
      (i + 1 < segments.length && labels[i + 1] === "fatiha" && segments[i + 1].start - segments[i].end < 2) ||
      (i - 1 >= 0 && labels[i - 1] === "fatiha" && segments[i].start - segments[i - 1].end < 2);

    if (hasAdjacentFatiha) {
      labels[i] = "fatiha";
      console.log(`[filter] Seg ${i} reclassified as fatiha (adjacency to confirmed fatiha)`);
    }
  }

  console.log("[filter] === END CLASSIFICATION ===");

  // Partition segments by label
  const kept: WhisperSegment[] = [];
  const removedFatiha: WhisperSegment[] = [];
  const removedTakbirat: WhisperSegment[] = [];
  const removedHallucination: WhisperSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    switch (labels[i]) {
      case "fatiha":
        removedFatiha.push(segments[i]);
        break;
      case "takbirat":
        removedTakbirat.push(segments[i]);
        break;
      case "hallucination":
        removedHallucination.push(segments[i]);
        break;
      default:
        kept.push(segments[i]);
    }
  }

  return { kept, removedFatiha, removedTakbirat, removedHallucination, labels };
}

/**
 * Build speech regions by grouping consecutive "keep" segments.
 *
 * Walks through ALL original segments with their labels.
 * Consecutive "keep" segments form a single region — the audio between them
 * (natural pauses, breaths) is preserved. A region boundary is created only
 * where a non-keep segment (fatiha, takbirat, hallucination) interrupts.
 */
export function buildSpeechRegions(
  allSegments: WhisperSegment[],
  labels: SegmentLabel[]
): SpeechRegion[] {
  const regions: SpeechRegion[] = [];
  let runStart = -1;
  let runEnd = -1;
  const runTexts: string[] = [];

  function flushRun() {
    if (runStart >= 0) {
      regions.push({
        start: runStart,
        end: runEnd,
        text: runTexts.join(" "),
      });
      runStart = -1;
      runEnd = -1;
      runTexts.length = 0;
    }
  }

  for (let i = 0; i < allSegments.length; i++) {
    if (labels[i] === "keep") {
      if (runStart < 0) {
        runStart = allSegments[i].start;
      }
      runEnd = allSegments[i].end;
      runTexts.push(allSegments[i].text);
    } else {
      flushRun();
    }
  }
  flushRun();

  console.log(`[regions] Built ${regions.length} speech region(s) from ${allSegments.length} total segments`);
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    console.log(`[regions] Region ${i}: ${r.start.toFixed(1)}s – ${r.end.toFixed(1)}s (${(r.end - r.start).toFixed(1)}s)`);
  }

  return regions;
}
