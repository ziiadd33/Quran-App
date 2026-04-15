import { NextResponse } from "next/server";
import { saveDebugOutput } from "@/lib/debug/debug-saver";

// 200s segments at 16kHz mono = ~8MB base64
export const bodySizeLimit = "12mb";

interface RunPodWhisperResponse {
  text: string;
  chunks: {
    text: string;
    timestamp: [number | null, number | null];
  }[];
}

/**
 * Call the RunPod worker (tarteel-ai/whisper-base-ar-quran) using async polling.
 * Uses /run (async) + polls /status until complete.
 * Cold starts may take several minutes while models load.
 */
async function callRunPodWhisper(audioBase64: string): Promise<RunPodWhisperResponse> {
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
    body: JSON.stringify({ input: { audio: audioBase64 } }),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => "");
    throw new Error(`RunPod submit failed (${submitRes.status}): ${errText}`);
  }

  const { id: jobId } = await submitRes.json();
  if (!jobId) throw new Error("RunPod did not return a job ID");

  console.log(`[transcribe] RunPod job submitted: ${jobId}`);

  while (true) {
    await new Promise((r) => setTimeout(r, 3000));

    const statusRes = await fetch(`${endpoint}/status/${jobId}`, { headers });
    if (!statusRes.ok) continue;

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
// Body: { audioBase64: string, index: number, startTime: number }
// Returns: { index, startTime, text, chunks }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { index, startTime, audioBase64 } = body;

    if (!audioBase64) {
      return NextResponse.json({ error: "audioBase64 is required" }, { status: 400 });
    }

    console.log(`[transcribe] recitation=${id}: transcribing segment ${index} via tarteel-ai Whisper`);

    const result = await callRunPodWhisper(audioBase64);

    console.log(
      `[transcribe] recitation=${id}: segment ${index} → ${result.chunks.length} chunks, ${result.text.length} chars`
    );

    // Save raw Whisper output for debug/validation
    await saveDebugOutput({
      type: "whisper-tarteel",
      counter: Date.now(),
      data: { segment: index, startTime, text: result.text, chunks: result.chunks },
    });

    return NextResponse.json({
      index,
      startTime,
      text: result.text,
      chunks: result.chunks,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    console.error(`[transcribe] recitation=${id}:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
