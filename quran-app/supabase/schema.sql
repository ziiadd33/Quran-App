-- ══════════════════════════════════════════════════════════════════════
-- Quran App — Database Schema
-- Run this in the Supabase SQL Editor (supabase.com → your project → SQL Editor)
-- ══════════════════════════════════════════════════════════════════════

-- ── Table: recitations ──────────────────────────────────────────────

create table if not exists recitations (
  id                uuid primary key default gen_random_uuid(),
  status            text not null default 'pending'
                    check (status in ('pending', 'processing', 'completed', 'error')),
  original_blob_url text not null,
  processed_blob_url text,
  original_filename text not null,
  reciter_name      text not null,
  night             integer not null,
  duration_seconds  integer,
  processed_duration integer,
  start_surah       integer,
  start_ayah        integer,
  end_surah         integer,
  end_ayah          integer,
  surah_name        text,
  surah_arabic      text,
  full_text         text,
  total_chunks      integer,
  fatiha_chunks     integer,
  silences_removed  integer,
  error_message     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Table: recitation_chunks ────────────────────────────────────────

create table if not exists recitation_chunks (
  id              uuid primary key default gen_random_uuid(),
  recitation_id   uuid not null references recitations(id) on delete cascade,
  chunk_index     integer not null,
  blob_url        text,
  transcription   text,
  is_fatiha       boolean not null default false,
  status          text not null default 'pending'
                  check (status in ('pending', 'transcribed', 'error')),
  created_at      timestamptz not null default now()
);

create index if not exists idx_chunks_recitation on recitation_chunks(recitation_id);

-- Unique constraint for safe upsert of chunks
alter table recitation_chunks
  add constraint uq_chunk_index unique (recitation_id, chunk_index);

-- ── Auto-update updated_at trigger ──────────────────────────────────

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger recitations_updated_at
  before update on recitations
  for each row execute function update_updated_at();

-- ── Storage bucket ──────────────────────────────────────────────────
-- Create a public bucket called "audio" in Supabase Dashboard → Storage
-- Or run:
insert into storage.buckets (id, name, public)
values ('audio', 'audio', true)
on conflict (id) do nothing;

-- ── RLS policies (allow all — no auth in this phase) ────────────────

alter table recitations enable row level security;
alter table recitation_chunks enable row level security;

create policy "Allow all on recitations" on recitations
  for all using (true) with check (true);

create policy "Allow all on recitation_chunks" on recitation_chunks
  for all using (true) with check (true);

-- Allow public read/write on audio bucket
create policy "Allow public upload" on storage.objects
  for insert with check (bucket_id = 'audio');

create policy "Allow public read" on storage.objects
  for select using (bucket_id = 'audio');

create policy "Allow public delete" on storage.objects
  for delete using (bucket_id = 'audio');
