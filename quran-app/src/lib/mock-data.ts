// ── Types ────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  night: number;
  reciterName: string;
  surahNumber: number;
  surahName: string;
  surahArabic: string;
  startAyah: number;
  endAyah: number;
  durationMinutes: number;
  status: "completed" | "processing" | "error";
  createdAt: string;
}

export interface ProcessingStep {
  id: string;
  label: string;
  description: string;
}

// ── Surah reference ──────────────────────────────────────────────────

export const SURAH_NAMES: Record<number, { arabic: string; latin: string; totalAyahs: number }> = {
  1:  { arabic: "الفاتحة",   latin: "Al-Fatiha",   totalAyahs: 7 },
  2:  { arabic: "البقرة",    latin: "Al-Baqarah",   totalAyahs: 286 },
  3:  { arabic: "آل عمران",  latin: "Ali 'Imran",   totalAyahs: 200 },
  4:  { arabic: "النساء",    latin: "An-Nisa",      totalAyahs: 176 },
  5:  { arabic: "المائدة",   latin: "Al-Ma'idah",   totalAyahs: 120 },
  6:  { arabic: "الأنعام",   latin: "Al-An'am",     totalAyahs: 165 },
  7:  { arabic: "الأعراف",   latin: "Al-A'raf",     totalAyahs: 206 },
  8:  { arabic: "الأنفال",   latin: "Al-Anfal",     totalAyahs: 75 },
  9:  { arabic: "التوبة",    latin: "At-Tawbah",    totalAyahs: 129 },
  10: { arabic: "يونس",     latin: "Yunus",        totalAyahs: 109 },
  11: { arabic: "هود",      latin: "Hud",          totalAyahs: 123 },
  12: { arabic: "يوسف",     latin: "Yusuf",        totalAyahs: 111 },
  13: { arabic: "الرعد",    latin: "Ar-Ra'd",      totalAyahs: 43 },
  14: { arabic: "إبراهيم",   latin: "Ibrahim",      totalAyahs: 52 },
  15: { arabic: "الحجر",    latin: "Al-Hijr",      totalAyahs: 99 },
  16: { arabic: "النحل",    latin: "An-Nahl",      totalAyahs: 128 },
  17: { arabic: "الإسراء",   latin: "Al-Isra",      totalAyahs: 111 },
  18: { arabic: "الكهف",    latin: "Al-Kahf",      totalAyahs: 110 },
};

// ── Processing pipeline steps — Phase 1: transcription only ──

export const PROCESSING_STEPS: ProcessingStep[] = [
  { id: "decode",     label: "Decodificando Audio",    description: "Leyendo y decodificando el archivo de audio" },
  { id: "segments",   label: "Preparando Segmentos",   description: "Dividiendo audio en segmentos de 200s" },
  { id: "transcribe", label: "Transcribiendo Árabe",   description: "Enviando a tarteel-ai Whisper via RunPod" },
];
