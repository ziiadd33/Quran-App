"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PROCESSING_STEPS } from "@/lib/mock-data";

export default function ProcessPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const totalSteps = PROCESSING_STEPS.length;
  const isDone = currentStep >= totalSteps;

  useEffect(() => {
    if (isDone) return;
    const timer = setInterval(() => {
      setCurrentStep((prev) => prev + 1);
    }, 1500);
    return () => clearInterval(timer);
  }, [isDone]);

  return (
    <div className="page-enter flex flex-col gap-6">
      <h1 className="text-2xl font-bold">
        {isDone ? "Procesado" : "Procesando..."}
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

              {/* Text content */}
              <div className="pb-6">
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
              </div>
            </div>
          );
        })}
      </div>

      {/* Done button */}
      {isDone && (
        <Link
          href="/result"
          className="w-full rounded-full bg-[var(--color-accent)] py-3 text-center font-semibold text-white transition-opacity hover:opacity-90"
        >
          Ver resultado
        </Link>
      )}
    </div>
  );
}
