import type { WhisperSegment, SpeechRegion } from "./types";
import {
  filterWhisperSegments,
  buildSpeechRegions,
} from "./speech-filter";

export interface AnalyzedSection {
  type: "fatiha" | "surah" | "takbirat" | "hallucination";
  start: number;
  end: number;
  segments: number[];
  surah?: number | null;
  startVerse?: number | null;
  endVerse?: number | null;
}

export interface SurahIdentification {
  startSurah: number | null;
  startAyah: number | null;
  endSurah: number | null;
  endAyah: number | null;
}

export interface AnalysisResult {
  sections: AnalyzedSection[];
  speechRegions: SpeechRegion[];
  removedFatihaCount: number;
  removedTakbiratCount: number;
  removedHallucinationCount: number;
  surahInfo: SurahIdentification;
}

/**
 * Send all Whisper segments to the analyze endpoint (Quran matcher).
 * Falls back to regex-based classification if the call fails.
 */
export async function analyzeSegments(
  recitationId: string,
  segments: WhisperSegment[],
  counter: number = 0
): Promise<AnalysisResult> {
  try {
    const res = await fetch(`/api/recitations/${recitationId}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Analyze endpoint returned ${res.status}`);
    }

    const data = await res.json();
    const sections: AnalyzedSection[] = data.sections;
    const surahInfo: SurahIdentification = data.surahInfo ?? {
      startSurah: null, startAyah: null, endSurah: null, endAyah: null,
    };

    // Use processedSegments from the server (post-noise-discard) so indices match
    const processedSegs: WhisperSegment[] = data.processedSegments ?? segments;

    // DEBUG: save LLM-corrected segments directly to project folder
    if (data.correctedSegments) {
      fetch("/api/debug-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: `llm-corrected-output-${counter}.json`, data: data.correctedSegments }),
      }).catch((e) => console.warn("[analyzer-debug] Failed to save corrected JSON:", e));
    }

    // Build speech regions from kept sections (surah only — ALL Fatiha removed)
    const speechRegions: SpeechRegion[] = [];

    for (const s of sections) {
      if (s.type === "surah") {
        speechRegions.push({
          start: s.start,
          end: s.end,
          text: s.segments.map((i) => processedSegs[i]?.text ?? "").join(" "),
        });
      }
    }

    const removedFatihaCount = sections.filter(
      (s) => s.type === "fatiha"
    ).length;
    const removedTakbiratCount = sections.filter((s) => s.type === "takbirat").length;
    const removedHallucinationCount = sections.filter((s) => s.type === "hallucination").length;

    console.log(
      `[analyzer] Quran matcher: ${speechRegions.length} kept region(s), ` +
      `${removedFatihaCount} fatiha removed, ${removedTakbiratCount} takbirat, ` +
      `${removedHallucinationCount} hallucination`
    );

    // Debug: log each speechRegion so we can verify the cuts
    for (const r of speechRegions) {
      console.log(
        `[analyzer] Region: ${r.start.toFixed(1)}s–${r.end.toFixed(1)}s (${(r.end - r.start).toFixed(1)}s) "${r.text.slice(0, 60)}..."`
      );
    }

    // Debug: log each section type
    for (const s of sections) {
      console.log(
        `[analyzer] Section: ${s.type} ${s.start.toFixed(1)}s–${s.end.toFixed(1)}s`
      );
    }

    return {
      sections,
      speechRegions,
      removedFatihaCount,
      removedTakbiratCount,
      removedHallucinationCount,
      surahInfo,
    };
  } catch (err) {
    console.warn("[analyzer] ⚠️ Quran matcher FAILED, falling back to regex:", err);

    // Fallback to regex-based classifier
    const filterResult = filterWhisperSegments(segments);
    const speechRegions = buildSpeechRegions(segments, filterResult.labels);

    // Debug: show fallback regions
    console.log(`[analyzer] Fallback produced ${speechRegions.length} regions`);
    for (const r of speechRegions) {
      console.log(
        `[analyzer] Fallback region: ${r.start.toFixed(1)}s–${r.end.toFixed(1)}s (${(r.end - r.start).toFixed(1)}s)`
      );
    }

    return {
      sections: [],
      speechRegions,
      removedFatihaCount: filterResult.removedFatiha.length,
      removedTakbiratCount: filterResult.removedTakbirat.length,
      removedHallucinationCount: filterResult.removedHallucination.length,
      surahInfo: { startSurah: null, startAyah: null, endSurah: null, endAyah: null },
    };
  }
}
