-- Next.js may probe a child route before a protected parent layout redirects.
-- Anonymous callers need relation-level SELECT, while RLS still returns no rows.
grant usage on schema public to anon;
grant select on public.business_settings, public.students, public.lesson_series,
  public.lessons, public.invoices, public.invoice_lines to anon;
