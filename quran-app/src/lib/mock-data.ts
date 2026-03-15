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

// ── Mock sessions ────────────────────────────────────────────────────

export const MOCK_SESSIONS: Session[] = [
  {
    id: "s1",
    night: 14,
    reciterName: "Ahmad Al-Sayed",
    surahNumber: 18,
    surahName: "Al-Kahf",
    surahArabic: "الكهف",
    startAyah: 1,
    endAyah: 110,
    durationMinutes: 47,
    status: "completed",
    createdAt: "2026-03-14T22:30:00Z",
  },
  {
    id: "s2",
    night: 13,
    reciterName: "Ahmad Al-Sayed",
    surahNumber: 17,
    surahName: "Al-Isra",
    surahArabic: "الإسراء",
    startAyah: 1,
    endAyah: 111,
    durationMinutes: 43,
    status: "completed",
    createdAt: "2026-03-13T22:15:00Z",
  },
  {
    id: "s3",
    night: 12,
    reciterName: "Ahmad Al-Sayed",
    surahNumber: 16,
    surahName: "An-Nahl",
    surahArabic: "النحل",
    startAyah: 1,
    endAyah: 128,
    durationMinutes: 51,
    status: "completed",
    createdAt: "2026-03-12T22:00:00Z",
  },
  {
    id: "s4",
    night: 11,
    reciterName: "Ahmad Al-Sayed",
    surahNumber: 15,
    surahName: "Al-Hijr",
    surahArabic: "الحجر",
    startAyah: 1,
    endAyah: 99,
    durationMinutes: 38,
    status: "completed",
    createdAt: "2026-03-11T22:10:00Z",
  },
  {
    id: "s5",
    night: 10,
    reciterName: "Ahmad Al-Sayed",
    surahNumber: 14,
    surahName: "Ibrahim",
    surahArabic: "إبراهيم",
    startAyah: 1,
    endAyah: 52,
    durationMinutes: 35,
    status: "completed",
    createdAt: "2026-03-10T22:05:00Z",
  },
];

// ── Processing pipeline steps ────────────────────────────────────────

export const PROCESSING_STEPS: ProcessingStep[] = [
  { id: "decode",     label: "Decoding Audio",        description: "Reading and decoding the audio file" },
  { id: "silence",    label: "Detecting Silences",     description: "Analyzing waveform for silence gaps" },
  { id: "split",      label: "Splitting Chunks",       description: "Dividing audio into segments" },
  { id: "transcribe", label: "Transcribing Arabic",    description: "Converting speech to text" },
  { id: "fatiha",     label: "Detecting Al-Fatiha",    description: "Identifying repeated Fatiha" },
  { id: "identify",   label: "Identifying Surah:Ayah", description: "Matching text to Quran" },
  { id: "concat",     label: "Producing Clean Audio",  description: "Concatenating final segments" },
];
