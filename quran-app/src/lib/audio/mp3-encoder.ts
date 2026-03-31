const DEFAULT_BITRATE = 128;
const SAMPLES_PER_FRAME = 1152;

/**
 * Load lamejs via script tag to bypass bundler issues.
 * lamejs uses internal globals (MPEGMode, etc.) that break with Turbopack/webpack.
 */
function loadLamejs(): Promise<{ Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
  flush(): Int8Array;
} }> {
  return new Promise((resolve, reject) => {
    // Already loaded?
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    if (win.lamejs?.Mp3Encoder) {
      resolve(win.lamejs);
      return;
    }

    const script = document.createElement("script");
    script.src = "/lame.min.js";
    script.onload = () => {
      if (win.lamejs?.Mp3Encoder) {
        resolve(win.lamejs);
      } else {
        reject(new Error("lamejs loaded but Mp3Encoder not found"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load lamejs"));
    document.head.appendChild(script);
  });
}

/**
 * Encode an AudioBuffer to MP3 on the main thread.
 * Yields to the event loop periodically to keep UI responsive.
 */
export async function encodeMp3(
  buffer: AudioBuffer,
  bitRate = DEFAULT_BITRATE,
  onProgress?: (pct: number) => void
): Promise<Blob> {
  const lamejs = await loadLamejs();

  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, bitRate);

  const left = floatToInt16(buffer.getChannelData(0));
  const right = numChannels > 1 ? floatToInt16(buffer.getChannelData(1)) : undefined;

  const totalSamples = left.length;
  const mp3Chunks: Int8Array[] = [];
  let lastReportedPct = 0;

  for (let i = 0; i < totalSamples; i += SAMPLES_PER_FRAME) {
    const end = Math.min(i + SAMPLES_PER_FRAME, totalSamples);
    const leftSlice = left.subarray(i, end);
    const rightSlice = right?.subarray(i, end);

    const mp3buf = encoder.encodeBuffer(leftSlice, rightSlice);
    if (mp3buf.length > 0) {
      mp3Chunks.push(mp3buf);
    }

    const pct = Math.round((i / totalSamples) * 100);
    if (pct >= lastReportedPct + 10) {
      lastReportedPct = pct;
      onProgress?.(pct);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const flush = encoder.flush();
  if (flush.length > 0) {
    mp3Chunks.push(flush);
  }

  onProgress?.(100);

  const totalLength = mp3Chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of mp3Chunks) {
    result.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), offset);
    offset += chunk.length;
  }

  return new Blob([result], { type: "audio/mpeg" });
}

/**
 * Encode multiple AudioBuffers to MP3 sequentially.
 */
export async function encodeMp3Batch(
  buffers: AudioBuffer[],
  bitRate = DEFAULT_BITRATE,
  onProgress?: (pct: number) => void
): Promise<Blob[]> {
  const results: Blob[] = [];

  for (let i = 0; i < buffers.length; i++) {
    const blob = await encodeMp3(buffers[i], bitRate, (chunkPct) => {
      const overallPct = Math.round(
        ((i + chunkPct / 100) / buffers.length) * 100
      );
      onProgress?.(overallPct);
    });
    results.push(blob);
  }

  onProgress?.(100);
  return results;
}

function floatToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}
