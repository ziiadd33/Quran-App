import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// 200s segments at 16kHz mono = ~8MB base64
export const bodySizeLimit = "12mb";

interface RunPodTranscribeResponse {
  segments: {
    start: number;
    end: number;
    text: string;
    words?: { word: string; start: number; end: number }[];
  }[];
}

/**
 * Call the RunPod worker in "transcribe_ctc" mode using async polling.
 * Uses /run (async) + polls /status until complete.
 * This handles cold starts: worker may take several minutes to load models.
 */
async function callRunPodTranscribe(
  audioBase64: string,
): Promise<RunPodTranscribeResponse> {
  const endpoint = process.env.RUNPOD_ENDPOINT_URL;
  const apiKey = process.env.RUNPOD_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error("RUNPOD_ENDPOINT_URL and RUNPOD_API_KEY must be configured");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  // Submit job asynchronously
  const submitRes = await fetch(`${endpoint}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: {
        mode: "transcribe_ctc",
        audio: audioBase64,
      },
    }),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => "");
    throw new Error(`RunPod submit failed (${submitRes.status}): ${errText}`);
  }

  const { id: jobId } = await submitRes.json();
  if (!jobId) throw new Error("RunPod did not return a job ID");

  console.log(`[transcribe] RunPod job submitted: ${jobId}`);

  const pollInterval = 3000; // 3s between polls

  while (true) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const statusRes = await fetch(`${endpoint}/status/${jobId}`, { headers });
    if (!statusRes.ok) continue; // transient error, keep polling

    const status = await statusRes.json();
    console.log(`[transcribe] RunPod job ${jobId} status: ${status.status}`);

    if (status.status === "COMPLETED") {
      const output = status.output;
      if (!output) throw new Error("RunPod job completed but output is empty");
      return output;
    }

    if (status.status === "FAILED") {
      throw new Error(`RunPod job failed: ${JSON.stringify(status.error ?? status)}`);
    }

    // IN_QUEUE, IN_PROGRESS → keep polling
  }
}

// POST /api/recitations/[id]/transcribe
// Accepts JSON with:
//   - "audioBase64": base64-encoded audio
//   - "index": segment index
//   - "startTime": offset in original audio
// Returns { index, startTime, segments[] } for client-side merging.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const contentType = request.headers.get("content-type") || "";

    let index: number;
    let startTime: number;
    let audioBase64: string;

    if (contentType.includes("application/json")) {
      // New JSON-based flow (Wav2Vec2 CTC via RunPod)
      const body = await request.json();
      index = body.index;
      startTime = body.startTime;
      audioBase64 = body.audioBase64;

      if (!audioBase64) {
        return NextResponse.json(
          { error: "audioBase64 is required" },
          { status: 400 },
        );
      }
    } else {
      // Legacy multipart flow (OpenAI Whisper) — kept for backwards compatibility
      const formData = await request.formData();
      const singleMeta = formData.get("segment") as string | null;
      if (!singleMeta) {
        return NextResponse.json(
          { error: "Missing segment metadata" },
          { status: 400 },
        );
      }
      const meta: { index: number; startTime: number } = JSON.parse(singleMeta);
      index = meta.index;
      startTime = meta.startTime;

      const audioFile = formData.get("audio") as File | null;
      if (!audioFile) {
        return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
      }

      // Convert file to base64
      const arrayBuffer = await audioFile.arrayBuffer();
      audioBase64 = Buffer.from(arrayBuffer).toString("base64");
    }

    console.log(
      `[transcribe] recitation=${id}: transcribing segment ${index} via Wav2Vec2 CTC`,
    );

    const result = await callRunPodTranscribe(audioBase64);

    console.log(
      `[transcribe] recitation=${id}: segment ${index} → ${result.segments.length} segments`,
    );

    // Save raw Wav2Vec2 output to file for inspection (like whisper-output-xxx.json)
    try {
      const outputPath = path.join(process.cwd(), "..", `wav2vec2-output-${id}.json`);
      let existing: { segments: object[] } = { segments: [] };
      if (fs.existsSync(outputPath)) {
        existing = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
      }
      existing.segments.push(...result.segments.map((s) => ({ ...s, _chunk: index, _startTime: startTime })));
      fs.writeFileSync(outputPath, JSON.stringify(existing, null, 2), "utf-8");
    } catch {
      // non-fatal
    }

    return NextResponse.json({
      index,
      startTime,
      segments: result.segments,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    console.error(`[transcribe] recitation=${id}:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
