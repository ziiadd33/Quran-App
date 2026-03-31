/**
 * Concatenate multiple AudioBuffers into a single AudioBuffer.
 * All buffers must have the same sample rate and channel count.
 */
export function concatenateBuffers(chunks: AudioBuffer[]): AudioBuffer {
  if (chunks.length === 0) {
    throw new Error("No buffers to concatenate");
  }
  if (chunks.length === 1) {
    return chunks[0];
  }

  const sampleRate = chunks[0].sampleRate;
  const numberOfChannels = chunks[0].numberOfChannels;
  const totalLength = chunks.reduce((sum, buf) => sum + buf.length, 0);

  const ctx = new OfflineAudioContext(numberOfChannels, totalLength, sampleRate);
  const output = ctx.createBuffer(numberOfChannels, totalLength, sampleRate);

  for (let ch = 0; ch < numberOfChannels; ch++) {
    const dest = output.getChannelData(ch);
    let offset = 0;
    for (const chunk of chunks) {
      dest.set(chunk.getChannelData(ch), offset);
      offset += chunk.length;
    }
  }

  return output;
}
