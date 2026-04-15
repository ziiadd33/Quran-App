import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

/** Tipos de output de debug */
export type DebugOutputType =
  | 'whisper-tarteel'   // Output de tarteel-ai/whisper-base-ar-quran (Phase 1)
  | 'alignment';        // Datos de forced alignment (ayahs, words por sección — Phase 3)

export interface DebugSaverOptions {
  /** Tipo de output para determinar la carpeta de destino */
  type: DebugOutputType;
  /** Counter para el nombre del archivo (usar counter del pipeline) */
  counter: number;
  /** Datos a guardar en formato JSON */
  data: unknown;
  /** Opcional: override del nombre del archivo */
  filename?: string;
  /** Opcional: timestamp personalizado (default: now) */
  timestamp?: string;
}

/**
 * Guarda outputs de debug en la carpeta centralizada debug-outputs/{type}/
 *
 * Nombres de archivos siguen el patrón: {type}-{counter}-{timestamp}.json
 *
 * @example
 * await saveDebugOutput({
 *   type: 'wav2vec2-raw',
 *   counter: 1,
 *   data: allWhisperSegments
 * });
 * // → debug-outputs/wav2vec2-raw/wav2vec2-raw-1-2026-04-06-17-30-00.json
 */
export async function saveDebugOutput(options: DebugSaverOptions): Promise<void> {
  const { type, counter, data, filename, timestamp } = options;

  try {
    // Generar nombre de archivo
    const ts = timestamp ? new Date(timestamp) : new Date();
    const safeFilename = filename ?? generateFilename(type, counter, ts);

    // Ruta completa: debug-outputs/{type}/{filename}
    const baseDir = join(process.cwd(), "..", "debug-outputs", type);

    // Asegurar que la carpeta existe
    await mkdir(baseDir, { recursive: true });

    // Guardar archivo
    const dest = join(baseDir, safeFilename);
    await writeFile(dest, JSON.stringify(data, null, 2), "utf-8");

    console.log(`[debug-saver] Saved ${type}/${safeFilename}`);
  } catch (err) {
    console.warn(`[debug-saver] Failed to save ${options.type}:`, err);
  }
}

/**
 * Genera nombre de archivo en formato: {type}-{counter}-{timestamp}.json
 */
function generateFilename(type: DebugOutputType, counter: number, timestamp: Date): string {
  const ts = timestamp.toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "-")
    .slice(0, -5); // Quitar milisegundos y Z

  return `${type}-${counter}-${ts}.json`;
}

/**
 * Guarda múltiples outputs de debug en una sola llamada
 * Útil para guardar todos los outputs al final del pipeline
 */
export async function saveDebugBatch(
  outputs: Array<{ type: DebugOutputType; filename: string; data: unknown }>
): Promise<void> {
  await Promise.all(
    outputs.map(({ type, filename, data }) =>
      saveDebugOutput({ type, counter: 0, data, filename })
    )
  );
}
