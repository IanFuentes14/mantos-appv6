begin;
create table if not exists public.procedures (
  id uuid primary key,
  category text not null check (category in ('operacionales','seguridad','equipos','administrativos')),
  title text not null check (length(title) between 1 and 180),
  description text not null default '',
  storage_path text not null,
  filename text not null,
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  version integer not null check (version > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null
);
alter table public.procedures enable row level security;
revoke all on public.procedures from anon, authenticated;
grant select on public.procedures to authenticated;
drop policy if exists procedures_read on public.procedures;
create policy procedures_read on public.procedures for select to authenticated using (true);

create table if not exists public.procedure_uploads (
  id uuid primary key,
  procedure_id uuid not null,
  expected_version integer not null,
  owner_email text not null,
  metadata jsonb not null,
  storage_path text not null unique,
  completed_result jsonb,
  created_at timestamptz not null default now()
);
alter table public.procedure_uploads enable row level security;
revoke all on public.procedure_uploads from anon, authenticated;
grant all on public.procedures, public.procedure_uploads to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('procedure-pdfs','procedure-pdfs',false,52428800,array['application/pdf'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists procedures_pdf_read on storage.objects;
create policy procedures_pdf_read on storage.objects for select to authenticated
using (bucket_id='procedure-pdfs' and exists (select 1 from public.procedures p where p.storage_path=name and p.is_active));

-- Serialize publication and return the same result if confirmation is retried.
create or replace function public.finalize_procedure_upload(upload_id uuid, admin_email text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ticket public.procedure_uploads; current_doc public.procedures; published public.procedures;
begin
  select * into ticket from public.procedure_uploads where id=upload_id for update;
  if not found or ticket.owner_email<>admin_email then raise exception 'Carga no autorizada'; end if;
  if ticket.completed_result is not null then return ticket.completed_result; end if;
  perform pg_advisory_xact_lock(hashtextextended(ticket.procedure_id::text,0));
  select * into current_doc from public.procedures where id=ticket.procedure_id for update;
  if coalesce(current_doc.version,0)<>ticket.expected_version then raise exception 'La versión cambió. Actualice el catálogo antes de reemplazar.'; end if;
  insert into public.procedures(id,category,title,description,storage_path,filename,size_bytes,version,sha256,is_active,updated_by)
  values(ticket.procedure_id,ticket.metadata->>'category',ticket.metadata->>'title',ticket.metadata->>'description',ticket.storage_path,ticket.metadata->>'filename',(ticket.metadata->>'size_bytes')::bigint,ticket.expected_version+1,ticket.metadata->>'sha256',true,admin_email)
  on conflict (id) do update set category=excluded.category,title=excluded.title,description=excluded.description,storage_path=excluded.storage_path,filename=excluded.filename,size_bytes=excluded.size_bytes,version=excluded.version,sha256=excluded.sha256,is_active=true,updated_by=excluded.updated_by,updated_at=now()
  returning * into published;
  update public.procedure_uploads set completed_result=to_jsonb(published) where id=upload_id;
  return to_jsonb(published);
end $$;
revoke all on function public.finalize_procedure_upload(uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_procedure_upload(uuid,text) to service_role;
commit;
