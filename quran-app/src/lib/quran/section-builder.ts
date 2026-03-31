import type { AnalyzedBlock } from "./matcher";
import type { WhisperSegment, SpeechRegion, AlignedAyah } from "../audio/types";
import type { AnalyzedSection } from "../audio/llm-analyzer";

/**
 * Build the final analysis result from classified blocks + processed segments.
 *
 * Called by analyze/route.ts after `analyzeBlocks()` returns blocks.
 * Converts AnalyzedBlock[] → AnalyzedSection[] + surah identification.
 */
export function buildResult(
  blocks: AnalyzedBlock[],
  segments: WhisperSegment[],
): {
  sections: AnalyzedSection[];
  surahInfo: { startSurah: number | null; startAyah: number | null; endSurah: number | null; endAyah: number | null };
} {
  const sections: AnalyzedSection[] = blocks.map((block) => ({
    type: block.type,
    start: block.start,
    end: block.end,
    segments: block.segments,
    surah: block.surah,
    startVerse: block.startVerse,
    endVerse: block.endVerse,
  }));

  // Extract surah identification from first and last surah blocks
  const surahBlocks = blocks.filter((b) => b.type === "surah" && b.surah !== null);

  let startSurah: number | null = null;
  let startAyah: number | null = null;
  let endSurah: number | null = null;
  let endAyah: number | null = null;

  if (surahBlocks.length > 0) {
    const first = surahBlocks[0];
    const last = surahBlocks[surahBlocks.length - 1];
    startSurah = first.surah;
    startAyah = first.startVerse;
    endSurah = last.surah;
    endAyah = last.endVerse;
  }

  return {
    sections,
    surahInfo: { startSurah, startAyah, endSurah, endAyah },
  };
}

/**
 * Refine speech region boundaries using precise ayah-level timestamps
 * from WhisperX forced alignment.
 *
 * Called by use-audio-processor.ts after the alignment step.
 * For each surah section that has alignment data, tighten the region's
 * start/end to match the first/last aligned ayah timestamps.
 */
export function refineWithAlignment(
  regions: SpeechRegion[],
  sections: AnalyzedSection[],
  alignmentMap: Map<number, AlignedAyah[]>,
): SpeechRegion[] {
  // Build a mapping: for each surah section index, find which region it belongs to
  // by matching time overlap between sections and regions.
  const refined = regions.map((region) => ({ ...region }));

  for (const [sectionIndex, ayahs] of alignmentMap.entries()) {
    const section = sections[sectionIndex];
    if (!section || ayahs.length === 0) continue;

    // Find the region that overlaps with this section
    const regionIndex = refined.findIndex(
      (r) => r.start <= section.end && r.end >= section.start,
    );
    if (regionIndex === -1) continue;

    // Ayah timestamps are relative to section.start (pre-adjusted by the hook).
    // Convert to absolute by adding section.start.
    const firstAyah = ayahs[0];
    const lastAyah = ayahs[ayahs.length - 1];

    const alignedStart = section.start + firstAyah.start;
    const alignedEnd = section.start + lastAyah.end;

    // Only tighten — never expand beyond the original region
    refined[regionIndex] = {
      ...refined[regionIndex],
      start: Math.max(refined[regionIndex].start, alignedStart),
      end: Math.min(refined[regionIndex].end, alignedEnd),
    };
  }

  return refined;
}
