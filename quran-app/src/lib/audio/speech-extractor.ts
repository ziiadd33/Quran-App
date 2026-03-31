import type { AudioChunk, SpeechRegion } from "./types";

/** Crossfade duration in ms — smooths hard cuts to avoid audible pops/clicks */
const CROSSFADE_MS = 50;

/**
 * Extract speech chunks from an AudioBuffer using Whisper-detected speech regions.
 * Applies a short fade-in/fade-out to each chunk to eliminate clicks at cut boundaries.
 */
export function extractSpeechChunks(
  buffer: AudioBuffer,
  speechRegions: SpeechRegion[],
  onProgress?: (pct: number) => void
): AudioChunk[] {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const crossfadeSamples = Math.floor((CROSSFADE_MS / 1000) * sampleRate);
  const chunks: AudioChunk[] = [];

  for (let i = 0; i < speechRegions.length; i++) {
    const region = speechRegions[i];
    const startSample = Math.floor(region.start * sampleRate);
    const endSample = Math.min(Math.floor(region.end * sampleRate), buffer.length);
    const length = endSample - startSample;

    if (length <= 0) continue;

    const ctx = new OfflineAudioContext(numChannels, length, sampleRate);
    const regionBuffer = ctx.createBuffer(numChannels, length, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      regionBuffer.getChannelData(ch).set(
        buffer.getChannelData(ch).subarray(startSample, endSample)
      );
    }

    // Apply crossfade: fade-in at start, fade-out at end
    const fadeInLen = Math.min(crossfadeSamples, length);
    const fadeOutLen = Math.min(crossfadeSamples, length);

    for (let ch = 0; ch < numChannels; ch++) {
      const data = regionBuffer.getChannelData(ch);
      for (let s = 0; s < fadeInLen; s++) {
        data[s] *= s / fadeInLen;
      }
      for (let s = 0; s < fadeOutLen; s++) {
        data[length - 1 - s] *= s / fadeOutLen;
      }
    }

    chunks.push({
      index: chunks.length,
      buffer: regionBuffer,
      startTime: region.start,
      endTime: region.end,
    });

    onProgress?.(Math.round(((i + 1) / speechRegions.length) * 100));
  }

  onProgress?.(100);
  return chunks;
}
