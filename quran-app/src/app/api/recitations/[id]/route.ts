import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// GET /api/recitations/[id]
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabase();
  const { id } = await params;

  const { data, error } = await supabase
    .from("recitations")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json(data);
}

// PATCH /api/recitations/[id]
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabase();
  const { id } = await params;
  const body = await request.json();

  const { data, error } = await supabase
    .from("recitations")
    .update(body)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// DELETE /api/recitations/[id]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabase();
  const { id } = await params;

  // Get the recitation first to find storage files
  const { data: recitation } = await supabase
    .from("recitations")
    .select("original_blob_url, processed_blob_url")
    .eq("id", id)
    .single();

  // Delete storage files if they exist
  if (recitation) {
    const filesToDelete: string[] = [];
    if (recitation.original_blob_url) {
      const path = extractStoragePath(recitation.original_blob_url);
      if (path) filesToDelete.push(path);
    }
    if (recitation.processed_blob_url) {
      const path = extractStoragePath(recitation.processed_blob_url);
      if (path) filesToDelete.push(path);
    }
    if (filesToDelete.length > 0) {
      await supabase.storage.from("audio").remove(filesToDelete);
    }
  }

  // Delete the DB record (chunks cascade automatically)
  const { error } = await supabase
    .from("recitations")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/** Extract the file path from a Supabase Storage public URL */
function extractStoragePath(url: string): string | null {
  const marker = "/storage/v1/object/public/audio/";
  const index = url.indexOf(marker);
  if (index === -1) return null;
  return url.slice(index + marker.length);
}
