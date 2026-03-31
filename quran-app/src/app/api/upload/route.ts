import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// POST /api/upload — upload audio file + create recitation record
export async function POST(request: Request) {
  const supabase = getSupabase();
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const reciterName = formData.get("reciterName") as string | null;
  const night = formData.get("night") as string | null;

  if (!file || !reciterName) {
    return NextResponse.json(
      { error: "file and reciterName are required" },
      { status: 400 }
    );
  }

  // Generate a unique path in storage
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${timestamp}_${safeName}`;

  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from("audio")
    .upload(storagePath, file, {
      contentType: file.type || "audio/mpeg",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadError.message}` },
      { status: 500 }
    );
  }

  // Get the public URL
  const { data: urlData } = supabase.storage
    .from("audio")
    .getPublicUrl(storagePath);

  // Create DB record
  const { data: recitation, error: dbError } = await supabase
    .from("recitations")
    .insert({
      original_blob_url: urlData.publicUrl,
      original_filename: file.name,
      reciter_name: reciterName,
      night: night ? parseInt(night, 10) : 1,
      status: "pending",
    })
    .select()
    .single();

  if (dbError) {
    // Clean up the uploaded file on DB error
    await supabase.storage.from("audio").remove([storagePath]);
    return NextResponse.json(
      { error: `DB insert failed: ${dbError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { id: recitation.id, url: urlData.publicUrl },
    { status: 201 }
  );
}
