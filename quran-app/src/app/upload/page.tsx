"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function UploadPage() {
  const [reciterName, setReciterName] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setFileName(file.name);
  }

  function handleDropZoneClick() {
    fileInputRef.current?.click();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) setFileName(file.name);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  return (
    <div className="page-enter flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Subir Audio</h1>

      {/* Reciter name input */}
      <input
        type="text"
        value={reciterName}
        onChange={(e) => setReciterName(e.target.value)}
        placeholder="Nombre del recitador"
        className="glass-card w-full bg-transparent px-4 py-3 text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none"
      />

      {/* Drop zone */}
      <button
        type="button"
        onClick={handleDropZoneClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[var(--color-glass-border)] px-6 py-12 transition-colors hover:border-[var(--color-accent)] cursor-pointer"
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--color-text-secondary)]"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        {fileName ? (
          <span className="text-sm text-[var(--color-accent-light)]">{fileName}</span>
        ) : (
          <>
            <span className="text-sm text-[var(--color-text-primary)]">
              Arrastra tu audio aquí
            </span>
            <span className="text-xs text-[var(--color-text-secondary)]">
              o haz clic para seleccionar
            </span>
          </>
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Process button */}
      <button
        onClick={() => router.push("/process")}
        className="w-full rounded-full bg-[var(--color-accent)] py-3 text-center font-semibold text-white transition-opacity hover:opacity-90"
      >
        Procesar
      </button>
    </div>
  );
}
