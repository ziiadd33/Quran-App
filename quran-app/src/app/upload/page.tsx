"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function UploadPage() {
  const [reciterName, setReciterName] = useState("");
  const [night, setNight] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);
  const router = useRouter();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      fileRef.current = file;
      setFileName(file.name);
    }
  }

  function handleDropZoneClick() {
    fileInputRef.current?.click();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      fileRef.current = file;
      setFileName(file.name);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  async function handleSubmit() {
    setError(null);

    if (!fileRef.current) {
      setError("Selecciona un archivo de audio");
      return;
    }
    if (!reciterName.trim()) {
      setError("Introduce el nombre del recitador");
      return;
    }
    if (!night || parseInt(night, 10) < 1 || parseInt(night, 10) > 30) {
      setError("Introduce un número de noche válido (1-30)");
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", fileRef.current);
      formData.append("reciterName", reciterName.trim());
      formData.append("night", night);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed (${res.status})`);
      }

      const { id } = await res.json();
      router.push(`/process?id=${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir el archivo");
      setIsUploading(false);
    }
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
        disabled={isUploading}
        className="glass-card w-full bg-transparent px-4 py-3 text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none disabled:opacity-50"
      />

      {/* Night number input */}
      <input
        type="number"
        inputMode="numeric"
        value={night}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "");
          if (v === "" || (parseInt(v, 10) >= 1 && parseInt(v, 10) <= 30)) {
            setNight(v);
          }
        }}
        placeholder="Número de noche (1-30)"
        min={1}
        max={30}
        disabled={isUploading}
        className="glass-card w-full bg-transparent px-4 py-3 text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />

      {/* Drop zone */}
      <button
        type="button"
        onClick={handleDropZoneClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        disabled={isUploading}
        className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[var(--color-glass-border)] px-6 py-12 transition-colors hover:border-[var(--color-accent)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* Error message */}
      {error && (
        <p className="text-sm text-red-400 text-center">{error}</p>
      )}

      {/* Process button */}
      <button
        onClick={handleSubmit}
        disabled={isUploading}
        className="w-full rounded-full bg-[var(--color-accent)] py-3 text-center font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isUploading ? "Subiendo..." : "Procesar"}
      </button>
    </div>
  );
}
