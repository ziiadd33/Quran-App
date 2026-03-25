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

/** Result of transcribing a full recording via Whisper */
export interface TranscriptionResult {
  segments: WhisperSegment[];
  speechRegions: SpeechRegion[];
  fullText: string;
}

/** A word-level alignment result from the forced aligner (WhisperX) */
export interface AlignedWord {
  word: string;
  start: number;
  end: number;
  score: number;
}

/** Alignment result for a single ayah */
export interface AlignedAyah {
  surah: number;
  ayah: number;
  start: number;
  end: number;
  words: AlignedWord[];
}

/** Full alignment result for a surah section */
export interface AlignmentResult {
  /** Per-ayah timestamps */
  ayahs: AlignedAyah[];
  /** All word-level alignments */
  words: AlignedWord[];
}
