"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { MOCK_SESSIONS } from "@/lib/mock-data";

export default function ResultPage() {
  const session = MOCK_SESSIONS[0];
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const duration = session.durationMinutes * 60;

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

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = ratio * duration;
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return (
    <div className="page-enter flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Resultado</h1>

      {/* Summary card */}
      <div className="glass-card-highlight p-5">
        <div className="flex flex-col items-center gap-3">
          <span className="font-arabic text-3xl">{session.surahArabic}</span>
          <span className="text-sm text-[var(--color-text-secondary)]">
            Surah {session.surahNumber} — {session.surahName}
          </span>

          {/* 2×2 info grid */}
          <div className="mt-2 grid w-full grid-cols-2 gap-3 text-center text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="text-[var(--color-text-secondary)] text-xs">Noche</span>
              <span className="font-semibold">{session.night}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[var(--color-text-secondary)] text-xs">Ayahs</span>
              <span className="font-semibold">{session.startAyah} → {session.endAyah}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[var(--color-text-secondary)] text-xs">Duración</span>
              <span className="font-semibold">{session.durationMinutes} min</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[var(--color-text-secondary)] text-xs">Recitador</span>
              <span className="font-semibold">{session.reciterName}</span>
            </div>
          </div>

          <span className="mt-1 rounded-full bg-green-600/20 px-3 py-1 text-xs font-medium text-green-400">
            Completa
          </span>
        </div>
      </div>

      {/* Audio player */}
      <div className="glass-card p-4">
        <audio ref={audioRef} onTimeUpdate={handleTimeUpdate} />
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
              className="h-2 w-full cursor-pointer rounded-full bg-[var(--color-surface)]"
              onClick={handleSeek}
            >
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-100"
                style={{ width: `${(currentTime / duration) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-[var(--color-text-secondary)]">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <button className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--color-accent)] py-3 font-semibold text-white transition-opacity hover:opacity-90">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Descargar audio
      </button>

      <Link
        href="/"
        className="w-full rounded-full border border-[var(--color-glass-border)] py-3 text-center font-semibold text-[var(--color-text-primary)] transition-opacity hover:opacity-80"
      >
        Volver al inicio
      </Link>
    </div>
  );
}
