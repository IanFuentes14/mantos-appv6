-- Limpieza automatica de imagenes de conduccion antiguas.
-- Pegar y ejecutar en el SQL Editor de Supabase.
-- Requiere pg_cron habilitado en el proyecto.

create extension if not exists pg_cron with schema extensions;

create or replace function public.cleanup_old_conduction_documents()
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  delete from storage.objects as object
  using public.conduction_documents as document
  where object.bucket_id = 'conduction-documents'
    and object.name = document.file_path
    and coalesce(document.created_at, document.uploaded_at) < now() - interval '7 days';

  delete from public.conduction_documents
  where coalesce(created_at, uploaded_at) < now() - interval '7 days';
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'cleanup-old-conduction-documents') then
    perform cron.unschedule('cleanup-old-conduction-documents');
  end if;
end;
$$;

select cron.schedule(
  'cleanup-old-conduction-documents',
  '0 3 * * *',
  $$select public.cleanup_old_conduction_documents();$$
);
