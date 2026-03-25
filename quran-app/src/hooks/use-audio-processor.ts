"use client";

import { useState, useCallback, useRef } from "react";
import { splitByTime } from "@/lib/audio/time-splitter";
import { extractSpeechChunks } from "@/lib/audio/speech-extractor";
import { encodeMp3, encodeMp3Batch } from "@/lib/audio/mp3-encoder";
import { concatenateBuffers } from "@/lib/audio/audio-concatenator";
import { uploadAudioBlob } from "@/lib/audio/storage";
import { analyzeSegments } from "@/lib/audio/llm-analyzer";
import type { Recitation } from "@/lib/db/types";
import type { TranscriptionResult, AlignedAyah, AlignmentResult } from "@/lib/audio/types";
import { refineWithAlignment } from "@/lib/quran/section-builder";

/** Total number of pipeline steps (matching PROCESSING_STEPS in mock-data) */
const TOTAL_STEPS = 8;

/** Downsample Float32Array from srcRate to dstRate (simple linear interpolation) */
function downsample(samples: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate) return samples;
  const ratio = srcRate / dstRate;
  const newLength = Math.floor(samples.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIdx = i * ratio;
    const idx = Math.floor(srcIdx);
    const frac = srcIdx - idx;
    result[i] = idx + 1 < samples.length
      ? samples[idx] * (1 - frac) + samples[idx + 1] * frac
      : samples[idx];
  }
  return result;
}

/** Convert Float32Array PCM to WAV ArrayBuffer */
function float32ToWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // WAV header
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // subchunk1 size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  // PCM data
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

/** Convert ArrayBuffer to base64 string */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Retry helper */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export function useAudioProcessor(recitationId: string | null) {
  const [currentStep, setCurrentStep] = useState(-1);
  const [stepProgress, setStepProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track AudioContext for cleanup
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Guard against double-invocation (React Strict Mode)
  const startedRef = useRef(false);

  const patchRecitation = useCallback(
    async (body: Partial<Recitation>) => {
      if (!recitationId) return;
      await fetch(`/api/recitations/${recitationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    [recitationId]
  );

  const createChunkRecord = useCallback(
    async (chunkIndex: number, blobUrl: string) => {
      if (!recitationId) return;
      await fetch(`/api/recitations/${recitationId}/chunks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunk_index: chunkIndex, blob_url: blobUrl }),
      });
    },
    [recitationId]
  );

  const start = useCallback(async () => {
    if (!recitationId || isProcessing || startedRef.current) return;
    startedRef.current = true;

    // Auto-increment session counter for debug filenames
    const counter = (parseInt(typeof window !== "undefined" ? (localStorage.getItem("quran_process_counter") || "0") : "0", 10)) + 1;
    if (typeof window !== "undefined") localStorage.setItem("quran_process_counter", String(counter));

    setIsProcessing(true);
    setError(null);
    setIsDone(false);

    try {
      // Fetch recitation data
      const res = await fetch(`/api/recitations/${recitationId}`);
      const recitation: Recitation = await res.json();
      if (!recitation.original_blob_url) {
        throw new Error("No audio URL found for this recitation");
      }

      // Set status to processing
      await patchRecitation({ status: "processing" });

      // ── Step 0: Decode Audio ──────────────────────────────────
      setCurrentStep(0);
      setStepProgress(0);

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const audioResponse = await fetch(recitation.original_blob_url);
      const arrayBuffer = await audioResponse.arrayBuffer();
      setStepProgress(50);

      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      setStepProgress(100);

      const originalDuration = audioBuffer.duration;

      // ── Step 1: Prepare Audio Segments ─────────────────────────
      setCurrentStep(1);
      setStepProgress(0);

      // 200s segments: WAV 16kHz mono = ~6MB raw, ~8MB base64 — under RunPod's 20MB limit
      const timeSegments = await splitByTime(audioBuffer, 200, 64, (pct) =>
        setStepProgress(pct)
      );

      // ── Step 2: Detect Speech (AI) ────────────────────────────
      setCurrentStep(2);
      setStepProgress(0);

      // Send each segment to RunPod Wav2Vec2 CTC for transcription
      const segmentResults: { startTime: number; segments: { start: number; end: number; text: string; words?: { word: string; start: number; end: number }[] }[] }[] = [];
      const TRANSCRIBE_SAMPLE_RATE = 16000;

      for (let i = 0; i < timeSegments.length; i++) {
        const seg = timeSegments[i];

        // Extract raw audio for this segment and convert to 16kHz WAV base64
        const startSample = Math.floor(seg.startTime * audioBuffer.sampleRate);
        const endSample = Math.min(
          Math.floor(seg.endTime * audioBuffer.sampleRate),
          audioBuffer.length,
        );
        const segmentData = audioBuffer.getChannelData(0).slice(startSample, endSample);
        const downsampled = downsample(segmentData, audioBuffer.sampleRate, TRANSCRIBE_SAMPLE_RATE);
        const wavBuffer = float32ToWav(downsampled, TRANSCRIBE_SAMPLE_RATE);
        const audioBase64 = arrayBufferToBase64(wavBuffer);

        const transcribeRes = await fetch(
          `/api/recitations/${recitationId}/transcribe`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              index: seg.index,
              startTime: seg.startTime,
              audioBase64,
            }),
          },
        );

        if (!transcribeRes.ok) {
          const errData = await transcribeRes.json().catch(() => ({}));
          throw new Error(errData.error || `Transcription failed for segment ${i}`);
        }

        const result = await transcribeRes.json();
        segmentResults.push({ startTime: result.startTime, segments: result.segments });

        setStepProgress(Math.round(((i + 1) / timeSegments.length) * 100));
      }

      // Merge all segment results client-side
      const allWhisperSegments: { start: number; end: number; text: string; words?: { word: string; start: number; end: number }[] }[] = [];
      for (const group of segmentResults) {
        for (const seg of group.segments) {
          allWhisperSegments.push({
            start: seg.start + group.startTime,
            end: seg.end + group.startTime,
            text: seg.text,
            words: seg.words?.map((w: { word: string; start: number; end: number }) => ({
              word: w.word,
              start: w.start + group.startTime,
              end: w.end + group.startTime,
            })),
          });
        }
      }
      allWhisperSegments.sort((a, b) => a.start - b.start);

      // DEBUG: save raw Whisper output directly to project folder
      fetch("/api/debug-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: `whisper-output-${counter}.json`, data: allWhisperSegments }),
      }).catch((e) => console.warn("[whisper-debug] Failed to save JSON:", e));

      setStepProgress(100);

      if (allWhisperSegments.length === 0) {
        throw new Error("No speech detected in the recording");
      }

      // ── Step 3: Filter Fatiha, Takbirat & Hallucinations ──────────
      setCurrentStep(3);
      setStepProgress(0);

      const analysisResult = await analyzeSegments(recitationId, allWhisperSegments, counter);
      const filteredRegions = analysisResult.speechRegions;

      console.log(
        `[filter] Removed ${analysisResult.removedFatihaCount} Fatiha section(s), ` +
        `${analysisResult.removedTakbiratCount} takbirat section(s), ` +
        `${analysisResult.removedHallucinationCount} hallucination section(s). ` +
        `Kept ${filteredRegions.length} surah region(s).`
      );

      const transcription: TranscriptionResult = {
        segments: allWhisperSegments,
        speechRegions: filteredRegions,
        fullText: filteredRegions.map((r) => r.text).join(" "),
      };

      setStepProgress(100);

      if (filteredRegions.length === 0) {
        throw new Error("No surah recitation found after filtering Fatiha and takbirat");
      }

      // ── Step 4: Surah ID ─────────────────────────────────────────
      setCurrentStep(4);
      setStepProgress(0);

      // Extract surah identification from the analysis result
      const { surahInfo } = analysisResult;
      if (surahInfo.startSurah) {
        // Dynamically import surah names for display
        const { SURAH_NAMES } = await import("@/lib/mock-data");
        const surahMeta = SURAH_NAMES[surahInfo.startSurah];
        if (surahMeta) {
          await patchRecitation({
            start_surah: surahInfo.startSurah,
            start_ayah: surahInfo.startAyah,
            end_surah: surahInfo.endSurah,
            end_ayah: surahInfo.endAyah,
            surah_name: surahMeta.latin,
            surah_arabic: surahMeta.arabic,
          });
        }
        console.log(
          `[processor] Identified: surah ${surahInfo.startSurah}:${surahInfo.startAyah} → ${surahInfo.endSurah}:${surahInfo.endAyah}`
        );
      }

      setStepProgress(100);

      // ── Step 5: Forced Alignment (precise ayah timestamps) ─────
      setCurrentStep(5);
      setStepProgress(0);

      let finalRegions = filteredRegions;

      // Only attempt alignment if we have surah identification
      const surahSections = analysisResult.sections.filter(
        (s: { type: string }) => s.type === "surah"
      );

      // Padding (seconds) added before/after each section clip for alignment.
      // Ensures edge ayahs aren't clipped by inaccurate Whisper timestamps.
      const ALIGN_PADDING_SEC = 3;

      if (surahSections.length > 0 && surahInfo.startSurah) {
        try {
          const alignmentMap = new Map<number, AlignedAyah[]>();
          let alignedCount = 0;
          const allAlignmentData: Record<string, AlignmentResult> = {};

          for (let si = 0; si < analysisResult.sections.length; si++) {
            const section = analysisResult.sections[si];
            if (
              section.type !== "surah" ||
              !section.surah ||
              !section.startVerse ||
              !section.endVerse
            ) continue;

            // Extract the audio for this section with padding for alignment accuracy
            const sampleRate = audioBuffer.sampleRate;
            const paddedStart = Math.max(0, section.start - ALIGN_PADDING_SEC);
            const paddedEnd = Math.min(
              audioBuffer.duration,
              section.end + ALIGN_PADDING_SEC,
            );
            const startSample = Math.floor(paddedStart * sampleRate);
            const endSample = Math.min(
              Math.floor(paddedEnd * sampleRate),
              audioBuffer.length,
            );
            const length = endSample - startSample;

            if (length <= 0) continue;

            // Extract mono audio for the section (with padding)
            const sectionData = new Float32Array(length);
            audioBuffer.getChannelData(0).subarray(startSample, endSample)
              .forEach((v, i) => { sectionData[i] = v; });

            // Downsample to 16kHz (RunPod/WhisperX uses 16kHz anyway).
            // This reduces the WAV size by ~3x for 48kHz sources.
            const ALIGN_SAMPLE_RATE = 16000;
            const downsampled = downsample(sectionData, sampleRate, ALIGN_SAMPLE_RATE);

            // Convert to 16-bit PCM WAV for the aligner
            const wavBuffer = float32ToWav(downsampled, ALIGN_SAMPLE_RATE);
            const base64Audio = arrayBufferToBase64(wavBuffer);

            // Call the alignment endpoint
            const alignRes = await fetch(
              `/api/recitations/${recitationId}/align`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  audioBase64: base64Audio,
                  surahNumber: section.surah,
                  startAyah: section.startVerse,
                  endAyah: section.endVerse,
                }),
              },
            );

            if (alignRes.ok) {
              const alignData: AlignmentResult = await alignRes.json();
              if (alignData.ayahs && alignData.ayahs.length > 0) {
                // Adjust timestamps: aligner returns relative to padded clip start.
                // Convert to relative-to-section.start so refineWithAlignment
                // can simply add section.start to get absolute timestamps.
                const actualPadding = section.start - paddedStart;
                for (const ayah of alignData.ayahs) {
                  ayah.start = ayah.start - actualPadding;
                  ayah.end = ayah.end - actualPadding;
                  for (const w of ayah.words) {
                    w.start = w.start - actualPadding;
                    w.end = w.end - actualPadding;
                  }
                }

                alignmentMap.set(si, alignData.ayahs);
                alignedCount++;
                allAlignmentData[`section_${si}_surah${section.surah}_v${section.startVerse}-${section.endVerse}`] = alignData;
                console.log(
                  `[processor] Aligned section ${si}: ${alignData.ayahs.length} ayahs, ` +
                    `${alignData.words.length} words (padding=${actualPadding.toFixed(1)}s)`,
                );
              }
            } else {
              console.warn(
                `[processor] Alignment failed for section ${si}: ${alignRes.status}`,
              );
            }

            setStepProgress(
              Math.round(((si + 1) / analysisResult.sections.length) * 100),
            );
          }

          // DEBUG: save alignment data directly to project folder
          if (Object.keys(allAlignmentData).length > 0) {
            fetch("/api/debug-save", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ filename: `alignment-output-${counter}.json`, data: allAlignmentData }),
            }).catch((e) => console.warn("[alignment-debug] Failed to save JSON:", e));
          }

          // Refine regions with alignment data
          // Timestamps were pre-adjusted to be relative to section.start
          if (alignmentMap.size > 0) {
            finalRegions = refineWithAlignment(
              filteredRegions,
              analysisResult.sections,
              alignmentMap,
            );
            console.log(
              `[processor] Refined ${alignmentMap.size} region(s) with forced alignment`,
            );
          }
        } catch (alignErr) {
          // Alignment is optional — fall back to Whisper timestamps
          console.warn("[processor] Forced alignment failed, using Whisper timestamps:", alignErr);
        }
      } else {
        console.log("[processor] No surah identified — skipping forced alignment");
      }

      // Update transcription with final regions
      transcription.speechRegions = finalRegions;
      transcription.fullText = finalRegions.map((r) => r.text).join(" ");

      setStepProgress(100);

      // ── Step 6: Extract Recitation ─────────────────────────────
      setCurrentStep(6);
      setStepProgress(0);

      const chunks = extractSpeechChunks(
        audioBuffer,
        finalRegions,
        (pct) => setStepProgress(pct)
      );

      // ── Step 7: Produce Clean Audio ───────────────────────────
      setCurrentStep(7);
      setStepProgress(0);

      const chunkBuffers = chunks.map((c) => c.buffer);
      const totalSubSteps = chunkBuffers.length + 2; // encode batch + concat + final encode
      let completedSubSteps = 0;

      // Encode each chunk to MP3 and upload
      const chunkBlobs = await encodeMp3Batch(chunkBuffers, 128, (pct) => {
        setStepProgress(
          Math.round(((completedSubSteps + pct / 100) / totalSubSteps) * 100)
        );
      });
      completedSubSteps = chunkBuffers.length;

      // Upload chunks with retry
      const chunkUrls: string[] = [];
      for (let i = 0; i < chunkBlobs.length; i++) {
        const path = `chunks/${recitationId}/${i}.mp3`;
        const url = await withRetry(
          () => uploadAudioBlob(path, chunkBlobs[i]),
          3
        );
        chunkUrls.push(url);
        await createChunkRecord(i, url);
      }

      // Concatenate all chunk buffers into final audio
      const concatenated = concatenateBuffers(chunkBuffers);
      completedSubSteps++;
      setStepProgress(
        Math.round((completedSubSteps / totalSubSteps) * 100)
      );

      // Encode final concatenated audio
      const finalBlob = await encodeMp3(concatenated, 128, (pct) => {
        setStepProgress(
          Math.round(
            ((completedSubSteps + pct / 100) / totalSubSteps) * 100
          )
        );
      });

      // Upload final audio
      const finalPath = `processed/${recitationId}/final.mp3`;
      const processedBlobUrl = await withRetry(
        () => uploadAudioBlob(finalPath, finalBlob),
        3
      );

      setStepProgress(100);

      // ── Finalize ──────────────────────────────────────────────
      const processedDuration = concatenated.duration;

      await patchRecitation({
        status: "completed",
        processed_blob_url: processedBlobUrl,
        duration_seconds: Math.round(originalDuration),
        processed_duration: Math.round(processedDuration),
        total_chunks: chunks.length,
        silences_removed: transcription.speechRegions.length,
        fatiha_chunks: analysisResult.removedFatihaCount,
        full_text: transcription.fullText,
      });

      setCurrentStep(TOTAL_STEPS);
      setIsDone(true);

      // Cleanup
      audioCtx.close().catch(() => {});
      audioCtxRef.current = null;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown processing error";
      setError(message);
      await patchRecitation({
        status: "error",
        error_message: message,
      }).catch(() => {});

      // Cleanup on error
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    } finally {
      setIsProcessing(false);
    }
  }, [recitationId, isProcessing, patchRecitation, createChunkRecord]);

  const retry = useCallback(() => {
    startedRef.current = false;
    setError(null);
    setCurrentStep(-1);
    setStepProgress(0);
    setIsDone(false);
    start();
  }, [start]);

  return {
    currentStep,
    stepProgress,
    isProcessing,
    isDone,
    error,
    start,
    retry,
  };
}
