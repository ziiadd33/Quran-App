import { NextResponse } from "next/server";
import { QuranIndex } from "@/lib/quran/quran-index";
import type { AlignedWord, AlignedAyah } from "@/lib/audio/types";

export const maxDuration = 300; // 5 min serverless timeout

// Audio sections can be large (~15 MB base64 for 6-minute sections at 16kHz)
export const bodySizeLimit = "20mb";

interface AlignRequest {
  /** Base64-encoded audio of the surah section */
  audioBase64: string;
  surahNumber: number;
  startAyah: number;
  endAyah: number;
}

interface RunPodAlignResponse {
  word_segments: { word: string; start: number; end: number; score: number }[];
  segments: { text: string; start: number; end: number }[];
}

/**
 * Call the RunPod worker in "align" mode.
 * Sends audio + known Quran text → receives per-word timestamps.
 */
async function callRunPodAlign(
  audioBase64: string,
  text: string,
): Promise<RunPodAlignResponse> {
  const endpoint = process.env.RUNPOD_ENDPOINT_URL;
  const apiKey = process.env.RUNPOD_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error("RUNPOD_ENDPOINT_URL and RUNPOD_API_KEY must be configured");
  }

  // RunPod serverless /runsync endpoint for synchronous execution
  const url = `${endpoint}/runsync`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: {
        mode: "align",
        audio: audioBase64,
        text,
        language: "ar",
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`RunPod align failed (${res.status}): ${errText}`);
  }

  const data = await res.json();

  // RunPod wraps the response in { output: ... }
  if (data.output) return data.output;
  return data;
}

/**
 * Given per-word timestamps and verse boundaries, group words into ayahs.
 */
function groupWordsIntoAyahs(
  words: AlignedWord[],
  surahNumber: number,
  startAyah: number,
  endAyah: number,
  quranIndex: QuranIndex,
): AlignedAyah[] {
  const surah = quranIndex.getSurah(surahNumber);
  if (!surah) return [];

  // Get the text of each ayah to know how many words each has
  const ayahWordCounts: { ayah: number; wordCount: number }[] = [];
  for (let ayah = startAyah; ayah <= endAyah; ayah++) {
    const verseIdx = ayah - 1; // 0-based index into verseWordStarts
    const wordStart = surah.verseWordStarts[verseIdx] ?? 0;
    const wordEnd =
      verseIdx + 1 < surah.verseWordStarts.length
        ? surah.verseWordStarts[verseIdx + 1]
        : surah.words.length;
    ayahWordCounts.push({ ayah, wordCount: wordEnd - wordStart });
  }

  // Assign aligned words to ayahs based on word counts
  const ayahs: AlignedAyah[] = [];
  let wordIdx = 0;

  for (const { ayah, wordCount } of ayahWordCounts) {
    const ayahWords = words.slice(wordIdx, wordIdx + wordCount);
    wordIdx += wordCount;

    if (ayahWords.length === 0) continue;

    const validStarts = ayahWords.filter((w) => w.start > 0 || w === ayahWords[0]);
    const validEnds = ayahWords.filter((w) => w.end > 0 || w === ayahWords[ayahWords.length - 1]);

    ayahs.push({
      surah: surahNumber,
      ayah,
      start: validStarts.length > 0 ? validStarts[0].start : 0,
      end: validEnds.length > 0 ? validEnds[validEnds.length - 1].end : 0,
      words: ayahWords,
    });
  }

  return ayahs;
}

// POST /api/recitations/[id]/align
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body: AlignRequest = await request.json();
    const { audioBase64, surahNumber, startAyah, endAyah } = body;

    if (!audioBase64 || !surahNumber || !startAyah || !endAyah) {
      return NextResponse.json(
        { error: "audioBase64, surahNumber, startAyah, and endAyah are required" },
        { status: 400 },
      );
    }

    console.log(
      `[align] recitation=${id}: aligning surah ${surahNumber} ayahs ${startAyah}-${endAyah}`,
    );

    // Load Quran index to get the exact text
    const quranIndex = await QuranIndex.load();
    const surah = quranIndex.getSurah(surahNumber);

    if (!surah) {
      return NextResponse.json(
        { error: `Surah ${surahNumber} not found` },
        { status: 400 },
      );
    }

    // Build the text for the requested ayah range
    // Get words for the range startAyah..endAyah
    const startWordIdx = surah.verseWordStarts[startAyah - 1] ?? 0;
    const endWordIdx =
      endAyah < surah.verseWordStarts.length
        ? surah.verseWordStarts[endAyah]
        : surah.words.length;
    const rangeText = surah.words.slice(startWordIdx, endWordIdx).join(" ");

    console.log(
      `[align] Text length: ${rangeText.length} chars, ${endWordIdx - startWordIdx} words`,
    );

    // Call RunPod forced alignment
    const alignResult = await callRunPodAlign(audioBase64, rangeText);

    // Convert to typed AlignedWord[]
    const alignedWords: AlignedWord[] = (alignResult.word_segments || []).map(
      (ws) => ({
        word: ws.word,
        start: ws.start,
        end: ws.end,
        score: ws.score,
      }),
    );

    // Group words into ayahs
    const ayahs = groupWordsIntoAyahs(
      alignedWords,
      surahNumber,
      startAyah,
      endAyah,
      quranIndex,
    );

    console.log(
      `[align] Result: ${alignedWords.length} words aligned into ${ayahs.length} ayahs`,
    );

    return NextResponse.json({
      ayahs,
      words: alignedWords,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Alignment failed";
    console.error(`[align] recitation=${id}:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
