/** A chunk of audio extracted from the original */
export interface AudioChunk {
  index: number;
  buffer: AudioBuffer;
  startTime: number;
  endTime: number;
}

/** A segment returned by Whisper with absolute timestamps */
export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  words?: { word: string; start: number; end: number }[];
}

/** A contiguous region of speech (merged from consecutive Whisper segments) */
export interface SpeechRegion {
  start: number;
  end: number;
  text: string;
}

/** Result from Phase 1: tarteel-ai Whisper transcription */
export interface TranscriptionV2Result {
  /** Full transcribed text (all segments joined) */
  text: string;
  /** Chunk-level timestamps from Whisper (approximate — use only for validation) */
  chunks: {
    text: string;
    timestamp: [number | null, number | null];
  }[];
}

/** A word-level alignment result from the forced aligner (Phase 3) */
export interface AlignedWord {
  word: string;
  start: number;
  end: number;
  score: number;
}

/** Alignment result for a single ayah (Phase 3) */
export interface AlignedAyah {
  surah: number;
  ayah: number;
  start: number;
  end: number;
  words: AlignedWord[];
}

/** Full alignment result for a surah section (Phase 3) */
export interface AlignmentResult {
  ayahs: AlignedAyah[];
  words: AlignedWord[];
}
