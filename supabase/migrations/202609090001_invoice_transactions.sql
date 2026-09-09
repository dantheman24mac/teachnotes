create or replace function public.finalize_invoice(
  p_month text,
  p_kind public.invoice_kind,
  p_student_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_month_date date;
  v_period_start timestamptz;
  v_next_period_start timestamptz;
  v_now timestamptz := clock_timestamp();
  v_timezone text := 'Africa/Johannesburg';
  v_prefix text := 'INV';
  v_terms integer := 7;
  v_settings jsonb := jsonb_build_object(
    'tutorName', '',
    'tutorEmail', '',
    'tutorPhone', '',
    'tutorAddress', '',
    'defaultPayerName', '',
    'defaultPayerEmail', '',
    'defaultPayerAddress', '',
    'paymentTermsDays', 7,
    'bankDetails', '',
    'invoicePrefix', 'INV',
    'timezone', 'Africa/Johannesburg',
    'currency', 'ZAR'
  );
  v_recipient jsonb;
  v_student public.students%rowtype;
  v_lesson_ids uuid[];
  v_total bigint;
  v_invoice_id uuid;
  v_number text;
  v_changed integer;
begin
  if v_owner is null then raise exception 'not authenticated'; end if;
  if not (select private.current_account_is_approved()) then raise exception 'account is not approved'; end if;
  if p_kind is null then raise exception 'invoice kind is required'; end if;
  if p_month is null or p_month !~ '^\d{4}-\d{2}$' then raise exception 'invalid invoice month'; end if;

  v_month_date := to_date(p_month || '-01', 'YYYY-MM-DD');
  if to_char(v_month_date, 'YYYY-MM') <> p_month then raise exception 'invalid invoice month'; end if;

  select
    settings.timezone,
    settings.invoice_prefix,
    settings.payment_terms_days,
    jsonb_build_object(
      'tutorName', settings.tutor_name,
      'tutorEmail', settings.tutor_email,
      'tutorPhone', settings.tutor_phone,
      'tutorAddress', settings.tutor_address,
      'defaultPayerName', settings.default_payer_name,
      'defaultPayerEmail', settings.default_payer_email,
      'defaultPayerAddress', settings.default_payer_address,
      'paymentTermsDays', settings.payment_terms_days,
      'bankDetails', settings.bank_details,
      'invoicePrefix', settings.invoice_prefix,
      'timezone', settings.timezone,
      'currency', 'ZAR'
    )
  into v_timezone, v_prefix, v_terms, v_settings
  from public.business_settings as settings
  where settings.owner_id = v_owner
  for share;

  if not found then
    v_timezone := 'Africa/Johannesburg';
    v_prefix := 'INV';
    v_terms := 7;
    v_settings := jsonb_build_object(
      'tutorName', '',
      'tutorEmail', '',
      'tutorPhone', '',
      'tutorAddress', '',
      'defaultPayerName', '',
      'defaultPayerEmail', '',
      'defaultPayerAddress', '',
      'paymentTermsDays', 7,
      'bankDetails', '',
      'invoicePrefix', 'INV',
      'timezone', 'Africa/Johannesburg',
      'currency', 'ZAR'
    );
  end if;

  if p_kind = 'student'::public.invoice_kind then
    if p_student_id is null then raise exception 'student is required'; end if;
    select * into v_student
    from public.students
    where id = p_student_id and owner_id = v_owner
    for share;
    if not found then raise exception 'student not found'; end if;
    v_recipient := jsonb_build_object(
      'name', coalesce(nullif(v_student.guardian_name, ''), v_student.display_name, ''),
      'email', coalesce(v_student.billing_email, ''),
      'address', coalesce(v_student.billing_address, '')
    );
  else
    if p_student_id is not null then raise exception 'student is only valid for a student invoice'; end if;
    v_recipient := jsonb_build_object(
      'name', v_settings->>'defaultPayerName',
      'email', v_settings->>'defaultPayerEmail',
      'address', v_settings->>'defaultPayerAddress'
    );
  end if;

  v_period_start := v_month_date::timestamp at time zone v_timezone;
  v_next_period_start := (v_month_date + interval '1 month')::timestamp at time zone v_timezone;

  select coalesce(array_agg(eligible.id order by eligible.id), '{}'::uuid[])
  into v_lesson_ids
  from (
    select lesson.id
    from public.lessons as lesson
    join public.students as student on student.id = lesson.student_id
    where lesson.owner_id = v_owner
      and student.owner_id = v_owner
      and lesson.deleted_at is null
      and lesson.invoiced_at is null
      and lesson.starts_at >= v_period_start
      and lesson.starts_at < v_next_period_start
      and (p_kind = 'consolidated'::public.invoice_kind or lesson.student_id = p_student_id)
      and (
        lesson.billing_override = 'billable'::public.billing_override
        or (
          lesson.billing_override = 'default'::public.billing_override
          and lesson.status in ('attended'::public.lesson_status, 'no_show'::public.lesson_status)
        )
      )
      and not exists (
        select 1
        from public.invoice_lines as active_line
        where active_line.lesson_id = lesson.id and active_line.released_at is null
      )
    order by lesson.id
    for update of lesson
  ) as eligible;

  if cardinality(v_lesson_ids) = 0 then
    raise exception 'there are no uninvoiced billable lessons in this selection';
  end if;

  select sum(lesson.rate_cents)
  into v_total
  from public.lessons as lesson
  where lesson.id = any(v_lesson_ids);

  v_number := public.next_invoice_number(v_prefix);

  insert into public.invoices (
    owner_id,
    number,
    kind,
    status,
    document_format,
    student_id,
    period_start,
    period_end,
    tutor_snapshot,
    recipient_snapshot,
    total_cents,
    issued_at,
    due_at
  ) values (
    v_owner,
    v_number,
    p_kind,
    'finalized'::public.invoice_status,
    'spreadsheet_v1',
    p_student_id,
    v_period_start,
    v_next_period_start - interval '1 millisecond',
    v_settings,
    v_recipient,
    v_total,
    v_now,
    v_now + make_interval(days => v_terms)
  )
  returning id into v_invoice_id;

  insert into public.invoice_lines (
    invoice_id,
    lesson_id,
    student_name,
    lesson_date,
    duration_minutes,
    lesson_status,
    amount_cents
  )
  select
    v_invoice_id,
    lesson.id,
    student.display_name,
    lesson.starts_at,
    lesson.duration_minutes,
    lesson.status,
    lesson.rate_cents
  from public.lessons as lesson
  join public.students as student on student.id = lesson.student_id
  where lesson.id = any(v_lesson_ids)
  order by lesson.id;

  get diagnostics v_changed = row_count;
  if v_changed <> cardinality(v_lesson_ids) then raise exception 'invoice line count changed during finalization'; end if;

  update public.lessons
  set invoiced_at = v_now
  where owner_id = v_owner
    and id = any(v_lesson_ids)
    and invoiced_at is null;

  get diagnostics v_changed = row_count;
  if v_changed <> cardinality(v_lesson_ids) then raise exception 'lesson count changed during finalization'; end if;

  return v_invoice_id;
end;
$$;

create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_invoice public.invoices%rowtype;
  v_lesson_ids uuid[];
  v_now timestamptz := clock_timestamp();
begin
  if v_owner is null then raise exception 'not authenticated'; end if;
  if not (select private.current_account_is_approved()) then raise exception 'account is not approved'; end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and owner_id = v_owner
  for update;

  if not found then raise exception 'invoice not found'; end if;
  if v_invoice.status = 'void'::public.invoice_status then return v_invoice.id; end if;
  if v_invoice.status <> 'finalized'::public.invoice_status then raise exception 'only finalized invoices can be voided'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then raise exception 'void reason must be at least 3 characters'; end if;

  select coalesce(array_agg(active_line.lesson_id order by active_line.lesson_id), '{}'::uuid[])
  into v_lesson_ids
  from (
    select invoice_line.lesson_id
    from public.invoice_lines as invoice_line
    where invoice_line.invoice_id = v_invoice.id
      and invoice_line.released_at is null
    order by invoice_line.lesson_id
    for update of invoice_line
  ) as active_line;

  perform 1
  from public.lessons as lesson
  where lesson.owner_id = v_owner and lesson.id = any(v_lesson_ids)
  order by lesson.id
  for update;

  update public.invoice_lines
  set released_at = v_now
  where invoice_id = v_invoice.id and released_at is null;

  update public.lessons as lesson
  set invoiced_at = null
  where lesson.owner_id = v_owner
    and lesson.id = any(v_lesson_ids)
    and not exists (
      select 1
      from public.invoice_lines as active_line
      where active_line.lesson_id = lesson.id and active_line.released_at is null
    );

  update public.invoices
  set status = 'void'::public.invoice_status,
      void_reason = trim(p_reason),
      voided_at = v_now
  where id = v_invoice.id and owner_id = v_owner;

  return v_invoice.id;
end;
$$;

revoke all on function public.finalize_invoice(text, public.invoice_kind, uuid) from public, anon;
revoke all on function public.void_invoice(uuid, text) from public, anon;
grant execute on function public.finalize_invoice(text, public.invoice_kind, uuid) to authenticated;
grant execute on function public.void_invoice(uuid, text) to authenticated;
