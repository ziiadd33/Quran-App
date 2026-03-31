import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { WhisperSegment } from "@/lib/audio/types";
import { analyzeBlocks } from "@/lib/quran/matcher";
import { buildResult } from "@/lib/quran/section-builder";
import { llmCorrectSegments } from "@/lib/quran/llm-corrector";
import { QuranIndex } from "@/lib/quran/quran-index";

/** Save debug JSON to dedicated output folders */
async function dumpDebug(filename: string, data: unknown) {
  try {
    // Route LLM-corrected outputs to llm-corrected-outputs/, rest to wav2vec2-outputs/
    const subdir = filename.startsWith("llm-corrected")
      ? "llm-corrected-outputs"
      : "wav2vec2-outputs";
    const dir = join(process.cwd(), "..", subdir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), JSON.stringify(data, null, 2), "utf-8");
    console.log(`[analyze] Saved ${subdir}/${filename}`);
  } catch (err) {
    console.warn(`[analyze] Failed to save ${filename}:`, err);
  }
}

export const maxDuration = 120;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { segments }: { segments: WhisperSegment[] } = await request.json();

    if (!Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json(
        { error: "segments must be a non-empty array" },
        { status: 400 }
      );
    }

    console.log(
      `[analyze] recitation=${id}: analyzing ${segments.length} segments with block-level detection`
    );

    // Dump raw Whisper output
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    await dumpDebug(`whisper-raw-${id}-${ts}.json`, segments);

    // 0. LLM correction: fix Whisper errors and fill gaps using GPT-4o-mini
    let correctedSegments = segments;
    if (process.env.OPENAI_API_KEY) {
      try {
        const quranIndex = await QuranIndex.load();
        correctedSegments = await llmCorrectSegments(segments, quranIndex);
        console.log(
          `[analyze] LLM correction: ${segments.length} → ${correctedSegments.length} segments`
        );
        // Dump LLM-corrected output
        await dumpDebug(`llm-corrected-${id}-${ts}.json`, correctedSegments);
      } catch (err) {
        console.warn("[analyze] LLM correction failed, using raw segments:", err);
      }
    }

    // 1. Identify takbirat boundaries → group into blocks → classify each block
    const { blocks, segments: processedSegments } = await analyzeBlocks(correctedSegments);

    // 2. Apply Fatiha rule, build speech regions, extract surah info
    // Use processedSegments (post-noise-discard) so indices match block.segments
    const result = buildResult(blocks, processedSegments);

    // Log results
    for (const s of result.sections) {
      const surahStr = s.surah ? ` (surah ${s.surah})` : "";
      console.log(
        `[analyze] ${s.type}${surahStr}: ${s.start.toFixed(1)}s-${s.end.toFixed(1)}s (${s.segments.length} segments)`
      );
    }

    return NextResponse.json({
      sections: result.sections,
      surahInfo: result.surahInfo,
      processedSegments,
      correctedSegments,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    console.error(`[analyze] recitation=${id}:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
