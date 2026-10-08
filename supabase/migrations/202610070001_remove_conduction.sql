begin;

-- Vaciar y eliminar conduction-documents desde Storage antes de ejecutar.
do $$
begin
  if exists (select 1 from storage.buckets where id = 'conduction-documents') then
    raise exception 'Elimine primero el bucket conduction-documents mediante Supabase Storage.';
  end if;
end $$;

drop policy if exists "Public can upload conduction documents" on storage.objects;
drop policy if exists "Authenticated users can upload conduction documents" on storage.objects;
drop policy if exists "Authenticated users can read conduction document files" on storage.objects;
drop policy if exists "Authenticated users can update conduction document files" on storage.objects;
drop policy if exists "Public can delete conduction document files" on storage.objects;
drop policy if exists "Operator can delete own conduction document files" on storage.objects;

drop table if exists public.conduction_documents restrict;

notify pgrst, 'reload schema';
commit;
