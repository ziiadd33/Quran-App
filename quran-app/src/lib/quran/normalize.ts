/**
 * Shared Arabic text normalization for comparing Whisper output against Quran text.
 *
 * Whisper outputs simplified Arabic (no diacritics, simple letters).
 * The Quran JSON uses Uthmani script with tashkeel, small letters, and special marks.
 * This function brings both to a common form so they can be compared.
 */
export function normalize(text: string): string {
  return (
    text
      // Remove Arabic diacritics (tashkeel): fathatan through hamza below
      .replace(/[\u064B-\u065F]/g, "")
      // Remove superscript alef (U+0670)
      .replace(/\u0670/g, "")
      // Remove Quranic annotation signs (U+06D6-U+06ED) — sajda marks, meem signs, etc.
      .replace(/[\u06D6-\u06ED]/g, "")
      // Remove Arabic small high letters and marks (U+0610-U+061A)
      .replace(/[\u0610-\u061A]/g, "")
      // Remove tatweel (kashida)
      .replace(/\u0640/g, "")
      // Normalize alef variants: أ إ آ ٱ → ا
      .replace(/[إأآٱ]/g, "ا")
      // Normalize taa marbuta → haa
      .replace(/ة/g, "ه")
      // Normalize alef maqsura → yaa
      .replace(/ى/g, "ي")
      // Normalize waw with hamza → waw (Whisper often drops hamza)
      .replace(/ؤ/g, "و")
      // Normalize yaa with hamza → yaa
      .replace(/ئ/g, "ي")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Split normalized text into words (non-empty tokens).
 */
export function toWords(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((w) => w.length > 0);
}
