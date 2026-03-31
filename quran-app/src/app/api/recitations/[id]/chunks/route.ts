import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// GET /api/recitations/[id]/chunks
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabase();
  const { id } = await params;

  const { data, error } = await supabase
    .from("recitation_chunks")
    .select("*")
    .eq("recitation_id", id)
    .order("chunk_index", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST /api/recitations/[id]/chunks — upsert a chunk record
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabase();
  const { id } = await params;
  const body = await request.json();

  const { data, error } = await supabase
    .from("recitation_chunks")
    .upsert(
      {
        recitation_id: id,
        chunk_index: body.chunk_index,
        blob_url: body.blob_url ?? null,
        transcription: body.transcription ?? null,
        is_fatiha: body.is_fatiha ?? false,
        status: body.status ?? "pending",
      },
      { onConflict: "recitation_id,chunk_index" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
