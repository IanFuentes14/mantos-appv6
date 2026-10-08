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

create table if not exists public.survey_events (
  id uuid primary key default gen_random_uuid(),
  operator_name text not null,
  survey_category text not null,
  survey_title text not null,
  survey_url text not null,
  owner_id uuid default auth.uid(),
  opened_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.irrigation_measurements enable row level security;
alter table public.survey_events enable row level security;

revoke all on public.irrigation_measurements from anon;
revoke all on public.survey_events from anon;
grant insert on public.irrigation_measurements to authenticated;
grant select on public.irrigation_measurements to authenticated;
grant update on public.irrigation_measurements to authenticated;
grant delete on public.irrigation_measurements to authenticated;
grant insert on public.survey_events to authenticated;
grant select on public.survey_events to authenticated;

drop policy if exists "Public can insert irrigation measurements" on public.irrigation_measurements;
drop policy if exists "Authenticated users can insert irrigation measurements" on public.irrigation_measurements;
create policy "Authenticated users can insert irrigation measurements"
on public.irrigation_measurements
for insert
to authenticated
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

drop policy if exists "Operator can update own irrigation measurements" on public.irrigation_measurements;
create policy "Operator can update own irrigation measurements"
on public.irrigation_measurements
for update
to authenticated
using (owner_id = (select auth.uid()))
with check (
  owner_id = (select auth.uid())
  and length(trim(operator_name)) between 1 and 120
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

drop policy if exists "Authenticated users can insert survey events" on public.survey_events;
create policy "Authenticated users can insert survey events"
on public.survey_events
for insert
to authenticated
with check (
  length(trim(operator_name)) between 1 and 120
  and length(trim(survey_category)) between 1 and 80
  and length(trim(survey_title)) between 1 and 180
  and length(trim(survey_url)) between 1 and 500
  and opened_at <= now() + interval '1 day'
);

drop policy if exists "Authenticated users can read survey events" on public.survey_events;
create policy "Authenticated users can read survey events"
on public.survey_events
for select
to authenticated
using (true);
