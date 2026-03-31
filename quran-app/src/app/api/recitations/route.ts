import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// GET /api/recitations — list all recitations
export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("recitations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST /api/recitations — create a new recitation record
export async function POST(request: Request) {
  const supabase = getSupabase();
  const body = await request.json();

  const { data, error } = await supabase
    .from("recitations")
    .insert(body)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
