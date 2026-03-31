interface RawWhisperSegment {
  start: number;
  end: number;
  text: string;
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

/**
 * Transcribe a single audio segment via OpenAI Whisper API.
 * Returns raw segments with timestamps relative to the segment start.
 */
export async function transcribeSegment(
  blob: Blob,
  filename: string
): Promise<RawWhisperSegment[]> {
  const formData = new FormData();
  formData.append("file", blob, filename);
  formData.append("model", "whisper-1");
  formData.append("language", "ar");
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "segment");
  formData.append(
    "prompt",
    "بسم الله الرحمن الرحيم. الحمد لله رب العالمين. الرحمن الرحيم. مالك يوم الدين. إياك نعبد وإياك نستعين. اهدنا الصراط المستقيم. صراط الذين أنعمت عليهم غير المغضوب عليهم ولا الضالين. الله أكبر. سمع الله لمن حمده. ربنا ولك الحمد. السلام عليكم ورحمة الله."
  );

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenAI Whisper API failed (${res.status}): ${errorText}`);
  }

  const data = await res.json();

  // OpenAI returns segments in verbose_json format
  const segments: RawWhisperSegment[] = (data.segments ?? []).map(
    (seg: { start: number; end: number; text: string }) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text,
    })
  );

  return segments;
}
