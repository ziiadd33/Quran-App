import { normalize, toWords } from "./normalize";

interface QuranVerse {
  chapter: number;
  verse: number;
  text: string;
}

type QuranData = Record<string, QuranVerse[]>;

export interface SurahInfo {
  number: number;
  /** All verses concatenated, normalized */
  normalizedText: string;
  /** Word array of the normalized full text */
  words: string[];
  /** Verse boundaries: verseWordStarts[v] = index in words[] where verse v+1 begins */
  verseWordStarts: number[];
  /** Total number of verses */
  totalVerses: number;
}

export interface NgramHit {
  surahNumber: number;
  wordIndex: number;
}

/** N-gram size for the lookup index */
const NGRAM_SIZE = 3;

let cachedIndex: QuranIndex | null = null;

export class QuranIndex {
  readonly surahs: Map<number, SurahInfo> = new Map();
  /** Maps "word1 word2 word3" → list of (surah, wordIndex) */
  private readonly ngramMap: Map<string, NgramHit[]> = new Map();

  private constructor(data: QuranData) {
    this.buildIndex(data);
  }

  private buildIndex(data: QuranData) {
    for (const [key, verses] of Object.entries(data)) {
      const surahNum = parseInt(key, 10);

      const allWords: string[] = [];
      const verseWordStarts: number[] = [];

      for (const verse of verses) {
        verseWordStarts.push(allWords.length);
        const words = toWords(verse.text);
        allWords.push(...words);
      }

      const info: SurahInfo = {
        number: surahNum,
        normalizedText: allWords.join(" "),
        words: allWords,
        verseWordStarts,
        totalVerses: verses.length,
      };

      this.surahs.set(surahNum, info);

      // Build n-gram index (skip surah 1 / Fatiha — handled separately)
      if (surahNum === 1) continue;

      for (let i = 0; i <= allWords.length - NGRAM_SIZE; i++) {
        const ngram = allWords.slice(i, i + NGRAM_SIZE).join(" ");
        let hits = this.ngramMap.get(ngram);
        if (!hits) {
          hits = [];
          this.ngramMap.set(ngram, hits);
        }
        hits.push({ surahNumber: surahNum, wordIndex: i });
      }
    }
  }

  /**
   * Find candidate surahs for a piece of text using the n-gram index.
   * Returns surahs sorted by number of matching n-grams (most matches first).
   */
  findCandidates(text: string): { surahNumber: number; matchCount: number }[] {
    const words = toWords(text);
    if (words.length < NGRAM_SIZE) return [];

    const surahHits = new Map<number, number>();

    for (let i = 0; i <= words.length - NGRAM_SIZE; i++) {
      const ngram = words.slice(i, i + NGRAM_SIZE).join(" ");
      const hits = this.ngramMap.get(ngram);
      if (hits) {
        for (const hit of hits) {
          surahHits.set(hit.surahNumber, (surahHits.get(hit.surahNumber) || 0) + 1);
        }
      }
    }

    return Array.from(surahHits.entries())
      .map(([surahNumber, matchCount]) => ({ surahNumber, matchCount }))
      .sort((a, b) => b.matchCount - a.matchCount);
  }

  /**
   * Get a specific surah's info.
   */
  getSurah(surahNumber: number): SurahInfo | undefined {
    return this.surahs.get(surahNumber);
  }

  /**
   * Given a surah and a word index, find which verse that word belongs to.
   */
  wordIndexToVerse(surah: SurahInfo, wordIndex: number): number {
    let verse = 1;
    for (let v = 0; v < surah.verseWordStarts.length; v++) {
      if (surah.verseWordStarts[v] <= wordIndex) {
        verse = v + 1;
      } else {
        break;
      }
    }
    return verse;
  }

  /**
   * Load or return cached index. Uses dynamic import for the JSON file.
   */
  static async load(): Promise<QuranIndex> {
    if (cachedIndex) return cachedIndex;

    // Dynamic import works in Next.js for JSON files
    const data: QuranData = (await import("./quran.json")).default;
    cachedIndex = new QuranIndex(data);
    return cachedIndex;
  }

  /**
   * Synchronous access after first load.
   */
  static getCached(): QuranIndex | null {
    return cachedIndex;
  }
}
