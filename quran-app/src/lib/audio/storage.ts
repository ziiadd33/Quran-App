import { getSupabase } from "@/lib/supabase";

/**
 * Upload an audio Blob to Supabase Storage.
 * Returns the public URL.
 */
export async function uploadAudioBlob(
  path: string,
  blob: Blob
): Promise<string> {
  const supabase = getSupabase();

  // Delete existing file first (avoids needing UPDATE policy for upsert)
  await supabase.storage.from("audio").remove([path]);

  const { error } = await supabase.storage
    .from("audio")
    .upload(path, blob, {
      contentType: "audio/mpeg",
    });

  if (error) {
    throw new Error(`Storage upload failed (${path}): ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from("audio")
    .getPublicUrl(path);

  return urlData.publicUrl;
}
