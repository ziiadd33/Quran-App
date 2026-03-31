import { encodeMp3 } from "./mp3-encoder";

export interface TimeSegment {
  index: number;
  blob: Blob;
  startTime: number;
  endTime: number;
}

/**
 * Split an AudioBuffer into time-based segments and encode each as MP3.
 * Default: ~10 min segments at 64 kbps (~4.7 MB each, well under Whisper's 25 MB limit).
 */
export async function splitByTime(
  buffer: AudioBuffer,
  segmentDurationSec = 600,
  bitRate = 64,
  onProgress?: (pct: number) => void
): Promise<TimeSegment[]> {
  const totalDuration = buffer.duration;
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const segmentCount = Math.ceil(totalDuration / segmentDurationSec);
  const segments: TimeSegment[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const startTime = i * segmentDurationSec;
    const endTime = Math.min((i + 1) * segmentDurationSec, totalDuration);

    const startSample = Math.floor(startTime * sampleRate);
    const endSample = Math.min(Math.floor(endTime * sampleRate), buffer.length);
    const length = endSample - startSample;

    const ctx = new OfflineAudioContext(numChannels, length, sampleRate);
    const segBuffer = ctx.createBuffer(numChannels, length, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      segBuffer.getChannelData(ch).set(
        buffer.getChannelData(ch).subarray(startSample, endSample)
      );
    }

    const blob = await encodeMp3(segBuffer, bitRate);

    segments.push({ index: i, blob, startTime, endTime });

    onProgress?.(Math.round(((i + 1) / segmentCount) * 100));
  }

  return segments;
}
