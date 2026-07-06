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
  delete_token text,
  owner_id uuid default auth.uid(),
  measured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.conduction_documents (
  id uuid primary key default gen_random_uuid(),
  driver_name text not null,
  operator_name text,
  file_name text not null,
  file_path text not null,
  delete_token text,
  owner_id uuid default auth.uid(),
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.conduction_documents
drop column if exists status;

alter table public.irrigation_measurements enable row level security;
alter table public.conduction_documents enable row level security;

grant insert on public.irrigation_measurements to anon, authenticated;
grant select on public.irrigation_measurements to authenticated;
grant delete on public.irrigation_measurements to authenticated;
grant insert on public.conduction_documents to anon, authenticated;
grant select on public.conduction_documents to authenticated;
revoke update on public.conduction_documents from anon;
revoke update on public.conduction_documents from authenticated;
grant delete on public.conduction_documents to authenticated;

drop policy if exists "Public can insert irrigation measurements" on public.irrigation_measurements;
create policy "Public can insert irrigation measurements"
on public.irrigation_measurements
for insert
to anon, authenticated
with check (
  length(trim(operator_name)) between 1 and 120
  and length(trim(pile)) between 1 and 80
  and length(trim(phase)) between 1 and 80
  and length(trim(module)) between 1 and 80
  and sample_1_ml >= 0
  and sample_2_ml >= 0
  and sample_3_ml >= 0
  and total_volume_ml >= 0
  and average_volume_ml >= 0
  and irrigation_rate_lh >= 0
  and measured_at <= now() + interval '1 day'
);

drop policy if exists "Authenticated users can read irrigation measurements" on public.irrigation_measurements;
create policy "Authenticated users can read irrigation measurements"
on public.irrigation_measurements
for select
to authenticated
using (true);

drop policy if exists "Public can delete irrigation measurements" on public.irrigation_measurements;
drop policy if exists "Operator can delete own irrigation measurements" on public.irrigation_measurements;
create policy "Operator can delete own irrigation measurements"
on public.irrigation_measurements
for delete
to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists "Public can insert conduction documents" on public.conduction_documents;
create policy "Public can insert conduction documents"
on public.conduction_documents
for insert
to anon, authenticated
with check (
  length(trim(driver_name)) between 1 and 120
  and length(trim(file_name)) between 1 and 255
  and length(trim(file_path)) between 1 and 500
  and uploaded_at <= now() + interval '1 day'
);

drop policy if exists "Authenticated users can read conduction documents" on public.conduction_documents;
create policy "Authenticated users can read conduction documents"
on public.conduction_documents
for select
to authenticated
using (true);

drop policy if exists "Public can delete conduction documents" on public.conduction_documents;
drop policy if exists "Operator can delete own conduction documents" on public.conduction_documents;
create policy "Operator can delete own conduction documents"
on public.conduction_documents
for delete
to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists "Authenticated users can update conduction document status" on public.conduction_documents;

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

drop policy if exists "Public can delete conduction document files" on storage.objects;
drop policy if exists "Operator can delete own conduction document files" on storage.objects;
create policy "Operator can delete own conduction document files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'conduction-documents'
  and owner = (select auth.uid())
);
