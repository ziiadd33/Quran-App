"use client";

import { useRef, useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { Recitation } from "@/lib/db/types";

function ResultContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  const audioRef = useRef<HTMLAudioElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [recitation, setRecitation] = useState<Recitation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!audioRef.current) return;
      if (e.key === "ArrowRight") {
        audioRef.current.currentTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 5);
      } else if (e.key === "ArrowLeft") {
        audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!id) {
      setIsLoading(false);
      return;
    }

    fetch(`/api/recitations/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Recitación no encontrada");
        return res.json();
      })
      .then((data: Recitation) => setRecitation(data))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Error al cargar"),
      )
      .finally(() => setIsLoading(false));
  }, [id]);

  function togglePlay() {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  }

  function handleTimeUpdate() {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }

  function handleLoadedMetadata() {
    if (audioRef.current && isFinite(audioRef.current.duration)) {
      setDuration(audioRef.current.duration);
    }
  }

  function seekToClientX(clientX: number) {
    if (!duration || !progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = ratio * duration;
    setCurrentTime(newTime);
    if (audioRef.current) audioRef.current.currentTime = newTime;
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    isDragging.current = true;
    seekToClientX(e.clientX);

    function onMouseMove(ev: MouseEvent) {
      if (isDragging.current) seekToClientX(ev.clientX);
    }
    function onMouseUp(ev: MouseEvent) {
      if (isDragging.current) { seekToClientX(ev.clientX); isDragging.current = false; }
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function handleEnded() {
    setIsPlaying(false);
    setCurrentTime(0);
  }

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/recitations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
      router.push("/");
    } catch {
      setIsDeleting(false);
    }
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  if (isLoading) {
    return (
      <div className="page-enter flex flex-col items-center gap-4 pt-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
        <p className="text-sm text-[var(--color-text-secondary)]">Cargando...</p>
      </div>
    );
  }

  if (error || !recitation) {
    return (
      <div className="page-enter flex flex-col items-center gap-4 pt-12">
        <p className="text-sm text-red-400">{error ?? "Recitación no encontrada"}</p>
        <Link
          href="/"
          className="rounded-full bg-[var(--color-accent)] px-6 py-2 text-sm font-semibold text-white"
        >
          Volver al inicio
        </Link>
      </div>
    );
  }

  const displayDuration = recitation.processed_duration ?? recitation.duration_seconds ?? 0;

  return (
    <div className="page-enter flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Resultado</h1>
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
        >
          {isDeleting ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
        </button>
      </div>

      {/* Summary card */}
      <div className="glass-card-highlight p-5">
        <div className="flex flex-col items-center gap-3">
          {recitation.surah_arabic && (
            <span className="font-arabic text-3xl">{recitation.surah_arabic}</span>
          )}
          <span className="text-sm text-[var(--color-text-secondary)]">
            {recitation.start_surah
              ? `Surah ${recitation.start_surah} — ${recitation.surah_name ?? ""}`
              : "Surah sin identificar"}
          </span>

          {/* 2x2 info grid */}
          <div className="mt-2 grid w-full grid-cols-2 gap-3 text-center text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="text-[var(--color-text-secondary)] text-xs">Noche</span>
              <span className="font-semibold">{recitation.night}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[var(--color-text-secondary)] text-xs">Ayahs</span>
              <span className="font-semibold">
                {recitation.start_ayah && recitation.end_ayah
                  ? `${recitation.start_ayah} → ${recitation.end_ayah}`
                  : "—"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[var(--color-text-secondary)] text-xs">Duración</span>
              <span className="font-semibold">
                {displayDuration > 0 ? `${Math.round(displayDuration / 60)} min` : "—"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[var(--color-text-secondary)] text-xs">Recitador</span>
              <span className="font-semibold">{recitation.reciter_name}</span>
            </div>
          </div>

          <span className="mt-1 rounded-full bg-green-600/20 px-3 py-1 text-xs font-medium text-green-400">
            Completa
          </span>
        </div>
      </div>

      {/* Audio player */}
      {recitation.processed_blob_url && (
        <div className="glass-card p-4">
          <audio
            ref={audioRef}
            src={recitation.processed_blob_url}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={handleEnded}
            preload="metadata"
          />
          <div className="flex items-center gap-3">
            {/* Play/pause button */}
            <button
              onClick={togglePlay}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] transition-opacity hover:opacity-90"
            >
              {isPlaying ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <polygon points="6,4 20,12 6,20" />
                </svg>
              )}
            </button>

            {/* Progress bar + time */}
            <div className="flex flex-1 flex-col gap-1">
              <div
                ref={progressBarRef}
                className="h-2 w-full cursor-pointer rounded-full bg-[var(--color-surface)] select-none"
                onMouseDown={handleMouseDown}
              >
                <div
                  className="h-full rounded-full bg-[var(--color-accent)]"
                  style={{
                    width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-[var(--color-text-secondary)]">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration || displayDuration)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Phase 1: transcription text (shown when no processed audio yet) */}
      {!recitation.processed_blob_url && recitation.full_text && (
        <div className="glass-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
              Texto transcrito
            </span>
            <span className="rounded-full bg-yellow-600/20 px-2 py-0.5 text-xs font-medium text-yellow-400">
              Identificación pendiente (Fase 2)
            </span>
          </div>
          <p
            dir="rtl"
            className="font-arabic text-base leading-relaxed text-[var(--color-text-primary)]"
          >
            {recitation.full_text}
          </p>
        </div>
      )}

      {/* Download button */}
      {recitation.processed_blob_url && (
        <a
          href={recitation.processed_blob_url}
          download={`noche-${recitation.night}-${recitation.surah_name ?? "recitacion"}.mp3`}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--color-accent)] py-3 font-semibold text-white transition-opacity hover:opacity-90"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Descargar audio
        </a>
      )}

      <Link
        href="/"
        className="w-full rounded-full border border-[var(--color-glass-border)] py-3 text-center font-semibold text-[var(--color-text-primary)] transition-opacity hover:opacity-80"
      >
        Volver al inicio
      </Link>
    </div>
  );
}

export default function ResultPage() {
  return (
    <Suspense
      fallback={
        <div className="page-enter flex flex-col items-center gap-4 pt-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
        </div>
      }
    >
      <ResultContent />
    </Suspense>
  );
}
