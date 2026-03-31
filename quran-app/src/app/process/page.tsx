"use client";

import { useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PROCESSING_STEPS } from "@/lib/mock-data";
import { useAudioProcessor } from "@/hooks/use-audio-processor";

function ProcessContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  const { currentStep, stepProgress, isDone, error, start, retry } =
    useAudioProcessor(id);

  const totalSteps = PROCESSING_STEPS.length;

  useEffect(() => {
    if (id) start();
  }, [id, start]);

  if (!id) {
    return (
      <div className="page-enter flex flex-col items-center gap-4 pt-12">
        <p className="text-[var(--color-text-secondary)]">
          No se encontró el ID de recitación.
        </p>
        <Link
          href="/upload"
          className="rounded-full bg-[var(--color-accent)] px-6 py-2 text-sm font-semibold text-white"
        >
          Subir audio
        </Link>
      </div>
    );
  }

  return (
    <div className="page-enter flex flex-col gap-6">
      <h1 className="text-2xl font-bold">
        {error ? "Error" : isDone ? "Procesado" : "Procesando..."}
      </h1>

      {/* Stepper */}
      <div className="flex flex-col">
        {PROCESSING_STEPS.map((step, index) => {
          const isCompleted = index < currentStep;
          const isActive = index === currentStep;

          return (
            <div key={step.id} className="flex gap-4">
              {/* Vertical line + circle column */}
              <div className="flex flex-col items-center">
                {/* Circle */}
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                    isCompleted
                      ? "bg-green-600"
                      : isActive
                        ? "bg-[var(--color-accent)] animate-pulse"
                        : "bg-[var(--color-surface)]"
                  }`}
                >
                  {isCompleted ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <span
                      className={`text-xs font-medium ${
                        isActive ? "text-white" : "text-[var(--color-text-secondary)]"
                      }`}
                    >
                      {index + 1}
                    </span>
                  )}
                </div>
                {/* Connector line */}
                {index < totalSteps - 1 && (
                  <div
                    className={`w-px flex-1 min-h-6 ${
                      isCompleted
                        ? "bg-green-600"
                        : "bg-[var(--color-border)]"
                    }`}
                  />
                )}
              </div>

              {/* Text content + progress bar */}
              <div className="flex-1 pb-6">
                <span
                  className={`text-sm font-medium ${
                    isCompleted
                      ? "text-[var(--color-text-primary)]"
                      : isActive
                        ? "text-[var(--color-accent-light)]"
                        : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {step.label}
                </span>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {step.description}
                </p>

                {/* Progress bar for active step */}
                {isActive && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300"
                      style={{ width: `${stepProgress}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Error state */}
      {error && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-red-400 text-center">{error}</p>
          <button
            onClick={retry}
            className="w-full rounded-full bg-[var(--color-accent)] py-3 text-center font-semibold text-white transition-opacity hover:opacity-90"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Done button */}
      {isDone && (
        <Link
          href={`/result?id=${id}`}
          className="w-full rounded-full bg-[var(--color-accent)] py-3 text-center font-semibold text-white transition-opacity hover:opacity-90"
        >
          Ver resultado
        </Link>
      )}
    </div>
  );
}

export default function ProcessPage() {
  return (
    <Suspense
      fallback={
        <div className="page-enter flex flex-col gap-6">
          <h1 className="text-2xl font-bold">Cargando...</h1>
        </div>
      }
    >
      <ProcessContent />
    </Suspense>
  );
}
