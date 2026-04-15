"use client";

import { useState, useCallback, useRef } from "react";
import { splitByTime } from "@/lib/audio/time-splitter";
import type { Recitation } from "@/lib/db/types";

/** Total number of pipeline steps — Phase 1: decode, segments, transcribe */
const TOTAL_STEPS = 3;

/** Downsample Float32Array from srcRate to dstRate (linear interpolation) */
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

/** Convert Float32Array PCM to WAV ArrayBuffer (16-bit mono) */
function float32ToWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bitsPerSample = 16;
  const byteRate = sampleRate * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, bitsPerSample / 8, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

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

/** Save debug output via API route */
async function saveDebugViaApi(options: {
  type: string;
  counter: number;
  data: unknown;
}): Promise<void> {
  try {
    await fetch("/api/debug-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
  } catch (err) {
    console.warn("[debug-save] Failed:", err);
  }
}

export function useAudioProcessor(recitationId: string | null) {
  const [currentStep, setCurrentStep] = useState(-1);
  const [stepProgress, setStepProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
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

  const start = useCallback(async () => {
    if (!recitationId || isProcessing || startedRef.current) return;
    startedRef.current = true;

    const counter = (parseInt(typeof window !== "undefined"
      ? (localStorage.getItem("quran_process_counter") || "0")
      : "0", 10)) + 1;
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

      await patchRecitation({ status: "processing" });

      // ── Step 0: Decode Audio ────────────────────────────────────
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

      // 200s segments: WAV 16kHz mono ≈ 6MB raw, ~8MB base64 (under RunPod 20MB limit)
      const timeSegments = await splitByTime(audioBuffer, 200, 64, (pct) =>
        setStepProgress(pct)
      );

      // ── Step 2: Transcribe via tarteel-ai Whisper ──────────────
      setCurrentStep(2);
      setStepProgress(0);

      const TRANSCRIBE_SAMPLE_RATE = 16000;
      const allChunks: { text: string; timestamp: [number | null, number | null] }[] = [];
      const textParts: string[] = [];

      for (let i = 0; i < timeSegments.length; i++) {
        const seg = timeSegments[i];

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
        textParts.push(result.text);

        // Offset chunk timestamps to absolute position in the full audio
        for (const chunk of result.chunks) {
          allChunks.push({
            text: chunk.text,
            timestamp: [
              chunk.timestamp[0] !== null ? chunk.timestamp[0] + seg.startTime : null,
              chunk.timestamp[1] !== null ? chunk.timestamp[1] + seg.startTime : null,
            ],
          });
        }

        setStepProgress(Math.round(((i + 1) / timeSegments.length) * 100));
      }

      const fullText = textParts.join(" ").trim();

      // Save debug output for validation
      await saveDebugViaApi({
        type: "whisper-tarteel",
        counter,
        data: { text: fullText, chunks: allChunks },
      });

      if (!fullText) {
        throw new Error("No text transcribed from audio");
      }

      console.log(`[processor] Transcription complete: ${fullText.length} chars, ${allChunks.length} chunks`);

      // ── Finalize ──────────────────────────────────────────────
      await patchRecitation({
        status: "completed",
        full_text: fullText,
        duration_seconds: Math.round(originalDuration),
      });

      setCurrentStep(TOTAL_STEPS);
      setIsDone(true);

      audioCtx.close().catch(() => {});
      audioCtxRef.current = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown processing error";
      setError(message);
      await patchRecitation({ status: "error", error_message: message }).catch(() => {});
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    } finally {
      setIsProcessing(false);
    }
  }, [recitationId, isProcessing, patchRecitation]);

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
