import { NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { join } from "path";

// POST /api/debug-save
// Body: { filename: string, data: unknown }
// Writes the JSON file directly to the Quran-App root folder (one level above the Next.js app).
export async function POST(request: Request) {
  try {
    const { filename, data } = await request.json();

    if (!filename || typeof filename !== "string") {
      return NextResponse.json({ error: "Missing filename" }, { status: 400 });
    }

    // Sanitize: allow only alphanumeric, hyphens, underscores, dots
    const safe = filename.replace(/[^a-zA-Z0-9\-_.]/g, "");
    if (!safe.endsWith(".json")) {
      return NextResponse.json({ error: "Only .json files allowed" }, { status: 400 });
    }

    // Route to dedicated folders based on filename prefix
    const subdir = safe.startsWith("llm-corrected")
      ? "llm-corrected-outputs"
      : safe.startsWith("wav2vec2")
        ? "wav2vec2-outputs"
        : "outputs";
    const dir = join(process.cwd(), "..", subdir);
    await import("fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
    const dest = join(dir, safe);
    await writeFile(dest, JSON.stringify(data, null, 2), "utf-8");

    console.log(`[debug-save] Saved ${dest}`);
    return NextResponse.json({ ok: true, path: dest });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save file";
    console.error("[debug-save]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
