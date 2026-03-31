"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Recitation } from "@/lib/db/types";
import { SURAH_NAMES } from "@/lib/mock-data";

type Tab = "noches" | "surahs";

const DELETE_BUTTON_WIDTH = 80;
const SWIPE_THRESHOLD = 50;

// ── Swipe-to-delete wrapper (Apple Notes style) ───────────────────────
function SwipeableRow({
  onDelete,
  children,
}: {
  onDelete: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [translateX, setTranslateX] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const touchStartX = useRef(0);
  const touchDeltaX = useRef(0);
  const wasOpen = useRef(false);
  const didDrag = useRef(false);

  const isOpen = translateX <= -(DELETE_BUTTON_WIDTH - 5);

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
    wasOpen.current = isOpen;
    didDrag.current = false;
  }

  function onTouchMove(e: React.TouchEvent) {
    const dx = e.touches[0].clientX - touchStartX.current;
    touchDeltaX.current = dx;
    if (Math.abs(dx) > 6) didDrag.current = true;

    const base = wasOpen.current ? -DELETE_BUTTON_WIDTH : 0;
    const next = Math.min(0, Math.max(-DELETE_BUTTON_WIDTH, base + dx));
    setTranslateX(next);
  }

  function onTouchEnd() {
    const dx = touchDeltaX.current;
    const base = wasOpen.current ? -DELETE_BUTTON_WIDTH : 0;
    const projected = base + dx;

    if (!wasOpen.current && projected < -SWIPE_THRESHOLD) {
      setTranslateX(-DELETE_BUTTON_WIDTH);
    } else if (wasOpen.current && projected > -DELETE_BUTTON_WIDTH + SWIPE_THRESHOLD) {
      setTranslateX(0);
    } else {
      setTranslateX(wasOpen.current ? -DELETE_BUTTON_WIDTH : 0);
    }
  }

  // If content is tapped while open → close without navigating
  function onContentClick(e: React.MouseEvent) {
    if (didDrag.current) { e.preventDefault(); return; }
    if (isOpen) { setTranslateX(0); e.preventDefault(); }
  }

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await onDelete();
    } catch {
      setIsDeleting(false);
      setTranslateX(0);
    }
  }

  return (
    <div className="relative overflow-hidden">
      {/* Delete button (revealed behind the row) */}
      <button
        onClick={handleDelete}
        disabled={isDeleting}
        style={{ width: DELETE_BUTTON_WIDTH }}
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-red-500 text-white text-sm font-semibold transition-opacity disabled:opacity-60"
      >
        {isDeleting ? (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : (
          "Borrar"
        )}
      </button>

      {/* Row content — slides left on swipe */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={onContentClick}
        style={{
          transform: `translateX(${translateX}px)`,
          transition: "transform 0.2s ease",
        }}
        className="bg-transparent"
      >
        {children}
      </div>
    </div>
  );
}

// ── Home ──────────────────────────────────────────────────────────────
export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("noches");
  const [recitations, setRecitations] = useState<Recitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/recitations")
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setRecitations(data); })
      .catch((err) => console.error("[home] Failed to fetch recitations:", err))
      .finally(() => setIsLoading(false));
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/recitations/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Error al borrar");
    }
    setRecitations((prev) => prev.filter((r) => r.id !== id));
  }, []);

  if (isLoading) {
    return (
      <div className="page-enter flex flex-col items-center gap-4 pt-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
        <p className="text-sm text-[var(--color-text-secondary)]">Cargando...</p>
      </div>
    );
  }

  if (recitations.length === 0) {
    return (
      <div className="page-enter flex flex-col items-center gap-6 pt-12">
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--color-text-secondary)] opacity-40"
        >
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        <div className="flex flex-col items-center gap-2">
          <span className="text-lg font-semibold">Sin grabaciones</span>
          <span className="text-sm text-[var(--color-text-secondary)]">
            Sube tu primer audio para empezar
          </span>
        </div>
        <Link
          href="/upload"
          className="rounded-full bg-[var(--color-accent)] px-8 py-3 font-semibold text-white transition-opacity hover:opacity-90"
        >
          Subir audio
        </Link>
      </div>
    );
  }

  return (
    <div className="page-enter flex flex-col gap-6">
      {/* Toggle pills */}
      <div className="flex justify-center">
        <div className="flex rounded-full bg-[var(--color-surface)] p-1">
          <button
            onClick={() => setActiveTab("noches")}
            className={`rounded-full px-5 py-1.5 text-sm font-medium transition-colors ${
              activeTab === "noches"
                ? "bg-[var(--color-accent)] text-white"
                : "text-[var(--color-text-secondary)]"
            }`}
          >
            Noches
          </button>
          <button
            onClick={() => setActiveTab("surahs")}
            className={`rounded-full px-5 py-1.5 text-sm font-medium transition-colors ${
              activeTab === "surahs"
                ? "bg-[var(--color-accent)] text-white"
                : "text-[var(--color-text-secondary)]"
            }`}
          >
            Surahs
          </button>
        </div>
      </div>

      <h1 className="text-2xl font-bold">Taraweh</h1>

      {activeTab === "noches" ? (
        <NochesView recitations={recitations} onDelete={handleDelete} />
      ) : (
        <SurahsView recitations={recitations} onDelete={handleDelete} />
      )}
    </div>
  );
}

// ── Noches view ───────────────────────────────────────────────────────
function NochesView({
  recitations,
  onDelete,
}: {
  recitations: Recitation[];
  onDelete: (id: string) => Promise<void>;
}) {
  const latest = recitations[0];
  const previous = recitations.slice(1);

  return (
    <div className="flex flex-col gap-5">
      {/* Latest session */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
          Última sesión
        </span>
        <div className="glass-card-highlight overflow-hidden">
          <SwipeableRow onDelete={() => onDelete(latest.id)}>
            <RecitationContent recitation={latest} showStatus />
          </SwipeableRow>
        </div>
      </div>

      {/* Previous sessions */}
      {previous.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            Noches anteriores
          </span>
          <div className="glass-card divide-y divide-[var(--color-border)] overflow-hidden">
            {previous.map((rec) => (
              <SwipeableRow key={rec.id} onDelete={() => onDelete(rec.id)}>
                <RecitationContent recitation={rec} />
              </SwipeableRow>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Surahs view ───────────────────────────────────────────────────────
function SurahsView({
  recitations,
  onDelete,
}: {
  recitations: Recitation[];
  onDelete: (id: string) => Promise<void>;
}) {
  const completed = recitations.filter(
    (r) => r.status === "completed" && r.start_surah,
  );

  if (completed.length === 0) {
    return (
      <p className="text-center text-sm text-[var(--color-text-secondary)] pt-4">
        Aún no hay surahs procesadas
      </p>
    );
  }

  const grouped = completed.reduce<Record<number, Recitation[]>>((acc, r) => {
    const surah = r.start_surah!;
    if (!acc[surah]) acc[surah] = [];
    acc[surah].push(r);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      {Object.entries(grouped).map(([surahNum, recs]) => {
        const num = parseInt(surahNum, 10);
        const meta = SURAH_NAMES[num];
        return (
          <div key={surahNum} className="glass-card overflow-hidden">
            <div className="border-b border-[var(--color-border)] px-4 py-3">
              <span className="font-semibold">
                {meta?.arabic ?? ""} — {meta?.latin ?? `Surah ${num}`}
              </span>
            </div>
            <div className="divide-y divide-[var(--color-border)]">
              {recs.map((rec) => (
                <SwipeableRow key={rec.id} onDelete={() => onDelete(rec.id)}>
                  <RecitationContent recitation={rec} />
                </SwipeableRow>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Row content (navigable, used inside SwipeableRow) ─────────────────
function RecitationContent({
  recitation,
  showStatus = false,
}: {
  recitation: Recitation;
  showStatus?: boolean;
}) {
  const router = useRouter();

  function navigate() {
    if (recitation.status === "completed") {
      router.push(`/result?id=${recitation.id}`);
    } else if (recitation.status === "processing") {
      router.push(`/process?id=${recitation.id}`);
    }
  }

  const duration = recitation.processed_duration ?? recitation.duration_seconds;

  return (
    <div
      onClick={navigate}
      className={`flex items-center justify-between p-4 ${
        recitation.status === "completed" || recitation.status === "processing"
          ? "cursor-pointer"
          : ""
      }`}
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold">
          Noche {recitation.night}
          {recitation.surah_name ? ` — ${recitation.surah_name}` : ""}
        </span>
        <span className="text-sm text-[var(--color-text-secondary)]">
          {recitation.start_ayah && recitation.end_ayah
            ? `Ayah ${recitation.start_ayah} → ${recitation.end_ayah} · `
            : ""}
          {duration ? `${Math.round(duration / 60)} min` : ""}
        </span>
      </div>
      {showStatus ? (
        <StatusBadge status={recitation.status} />
      ) : (
        <span className="text-3xl font-bold text-[var(--color-text-secondary)]">
          {recitation.night}
        </span>
      )}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────
function StatusBadge({ status }: { status: Recitation["status"] }) {
  const styles: Record<string, string> = {
    completed: "bg-green-600/20 text-green-400",
    processing: "bg-yellow-600/20 text-yellow-400",
    pending: "bg-[var(--color-glass)] text-[var(--color-text-secondary)]",
    error: "bg-red-600/20 text-red-400",
  };
  const labels: Record<string, string> = {
    completed: "Completa",
    processing: "Procesando",
    pending: "Pendiente",
    error: "Error",
  };

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${styles[status] ?? ""}`}>
      {labels[status] ?? status}
    </span>
  );
}
