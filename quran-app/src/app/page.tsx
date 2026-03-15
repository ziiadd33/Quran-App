"use client";

import { useState } from "react";
import { MOCK_SESSIONS, type Session } from "@/lib/mock-data";

type Tab = "noches" | "surahs";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("noches");

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

      {activeTab === "noches" ? <NochesView /> : <SurahsView />}
    </div>
  );
}

function NochesView() {
  const latest = MOCK_SESSIONS[0];
  const previous = MOCK_SESSIONS.slice(1);

  return (
    <div className="flex flex-col gap-5">
      {/* Última sesión */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
          Última sesión
        </span>
        <div className="glass-card-highlight flex items-center justify-between p-4">
          <div className="flex flex-col gap-1">
            <span className="font-semibold">
              Noche {latest.night} — {latest.surahName}
            </span>
            <span className="text-sm text-[var(--color-text-secondary)]">
              Ayah {latest.startAyah} → {latest.endAyah} · {latest.durationMinutes} min
            </span>
          </div>
          <span className="rounded-full bg-[var(--color-glass)] px-3 py-1 text-xs text-[var(--color-text-primary)]">
            Completa
          </span>
        </div>
      </div>

      {/* Noches anteriores */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
          Noches anteriores
        </span>
        <div className="glass-card divide-y divide-[var(--color-border)]">
          {previous.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionRow({ session }: { session: Session }) {
  return (
    <div className="flex items-center justify-between p-4">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">
          Noche {session.night} — {session.surahName}
        </span>
        <span className="text-sm text-[var(--color-text-secondary)]">
          Ayah {session.startAyah} → {session.endAyah} · {session.durationMinutes} min
        </span>
      </div>
      <span className="text-3xl font-bold text-[var(--color-text-secondary)]">
        {session.night}
      </span>
    </div>
  );
}

function SurahsView() {
  // Group sessions by surah
  const grouped = MOCK_SESSIONS.reduce<Record<number, Session[]>>((acc, s) => {
    if (!acc[s.surahNumber]) acc[s.surahNumber] = [];
    acc[s.surahNumber].push(s);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      {Object.entries(grouped).map(([surahNum, sessions]) => (
        <div key={surahNum} className="glass-card overflow-hidden">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <span className="font-semibold">
              {sessions[0].surahArabic} — {sessions[0].surahName}
            </span>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
