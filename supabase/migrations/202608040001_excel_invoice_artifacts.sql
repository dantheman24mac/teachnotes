alter table public.invoices
  add column if not exists document_format text not null default 'legacy_pdf',
  add column if not exists xlsx_path text;

alter table public.invoices
  drop constraint if exists invoices_document_format_check;

alter table public.invoices
  add constraint invoices_document_format_check
  check (document_format in ('legacy_pdf', 'spreadsheet_v1'));

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
where id = 'invoices';

drop policy if exists "approved owner updates invoice pdfs" on storage.objects;
