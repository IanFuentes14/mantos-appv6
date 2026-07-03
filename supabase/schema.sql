-- Mantos App - Supabase schema
-- Ejecutar en el SQL editor de Supabase.

create extension if not exists pgcrypto;

create table if not exists public.irrigation_measurements (
  id uuid primary key default gen_random_uuid(),
  operator_name text not null,
  pile text not null,
  phase text not null,
  module text not null,
  panel text,
  sample_1_ml numeric not null default 0,
  sample_2_ml numeric not null default 0,
  sample_3_ml numeric not null default 0,
  total_volume_ml numeric not null default 0,
  average_volume_ml numeric not null default 0,
  irrigation_rate_lh numeric not null default 0,
  observation text,
  measured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.conduction_documents (
  id uuid primary key default gen_random_uuid(),
  driver_name text not null,
  operator_name text,
  status text not null default 'Pendiente',
  file_name text not null,
  file_path text not null,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.irrigation_measurements enable row level security;
alter table public.conduction_documents enable row level security;

drop policy if exists "Public can insert irrigation measurements" on public.irrigation_measurements;
create policy "Public can insert irrigation measurements"
on public.irrigation_measurements
for insert
to anon, authenticated
with check (true);

drop policy if exists "Authenticated users can read irrigation measurements" on public.irrigation_measurements;
create policy "Authenticated users can read irrigation measurements"
on public.irrigation_measurements
for select
to authenticated
using (true);

drop policy if exists "Public can insert conduction documents" on public.conduction_documents;
create policy "Public can insert conduction documents"
on public.conduction_documents
for insert
to anon, authenticated
with check (true);

drop policy if exists "Authenticated users can read conduction documents" on public.conduction_documents;
create policy "Authenticated users can read conduction documents"
on public.conduction_documents
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can update conduction document status" on public.conduction_documents;
create policy "Authenticated users can update conduction document status"
on public.conduction_documents
for update
to authenticated
using (true)
with check (true);

insert into storage.buckets (id, name, public)
values ('conduction-documents', 'conduction-documents', false)
on conflict (id) do nothing;

drop policy if exists "Public can upload conduction documents" on storage.objects;
create policy "Public can upload conduction documents"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'conduction-documents');

drop policy if exists "Authenticated users can read conduction document files" on storage.objects;
create policy "Authenticated users can read conduction document files"
on storage.objects
for select
to authenticated
using (bucket_id = 'conduction-documents');

drop policy if exists "Authenticated users can update conduction document files" on storage.objects;
create policy "Authenticated users can update conduction document files"
on storage.objects
for update
to authenticated
using (bucket_id = 'conduction-documents')
with check (bucket_id = 'conduction-documents');
