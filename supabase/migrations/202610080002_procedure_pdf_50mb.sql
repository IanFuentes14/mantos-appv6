begin;

alter table public.procedures
  drop constraint if exists procedures_size_bytes_check;

alter table public.procedures
  add constraint procedures_size_bytes_check check (size_bytes between 1 and 52428800);

update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['application/pdf']
where id = 'procedure-pdfs';

commit;
