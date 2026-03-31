// ── Database types (matches supabase/schema.sql) ────────────────────

export interface Recitation {
  id: string;
  status: "pending" | "processing" | "completed" | "error";
  original_blob_url: string;
  processed_blob_url: string | null;
  original_filename: string;
  reciter_name: string;
  night: number;
  duration_seconds: number | null;
  processed_duration: number | null;
  start_surah: number | null;
  start_ayah: number | null;
  end_surah: number | null;
  end_ayah: number | null;
  surah_name: string | null;
  surah_arabic: string | null;
  full_text: string | null;
  total_chunks: number | null;
  fatiha_chunks: number | null;
  silences_removed: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecitationChunk {
  id: string;
  recitation_id: string;
  chunk_index: number;
  blob_url: string | null;
  transcription: string | null;
  is_fatiha: boolean;
  status: "pending" | "transcribed" | "error";
  created_at: string;
}
