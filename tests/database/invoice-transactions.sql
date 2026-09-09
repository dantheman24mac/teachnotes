insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'invoice-owner-one@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'invoice-owner-two@example.test');
update public.accounts
set status = 'approved', reviewed_at = now()
where user_id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

update public.business_settings
set tutor_name = '',
    tutor_email = '',
    tutor_phone = '',
    tutor_address = '',
    default_payer_name = '',
    default_payer_email = '',
    default_payer_address = '',
    bank_details = '',
    payment_terms_days = 7,
    invoice_prefix = 'INV',
    timezone = 'Africa/Johannesburg'
where owner_id = '11111111-1111-4111-8111-111111111111';

insert into public.students (
  id,
  owner_id,
  display_name,
  guardian_name,
  billing_email,
  billing_address,
  active,
  deleted_at
) values (
  '51000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'Archived student',
  null,
  null,
  null,
  false,
  '2031-03-01 00:00:00+00'
);

insert into public.lessons (
  id,
  owner_id,
  student_id,
  starts_at,
  duration_minutes,
  rate_cents,
  status,
  billing_override,
  deleted_at
) values
  ('51000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', '51000000-0000-4000-8000-000000000001', '2031-02-05 10:00:00+02', 60, 11000, 'attended', 'default', null),
  ('51000000-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111', '51000000-0000-4000-8000-000000000001', '2031-02-12 10:00:00+02', 45, 22000, 'no_show', 'default', null),
  ('51000000-0000-4000-8000-000000000013', '11111111-1111-4111-8111-111111111111', '51000000-0000-4000-8000-000000000001', '2031-02-19 10:00:00+02', 30, 33000, 'scheduled', 'billable', null),
  ('51000000-0000-4000-8000-000000000014', '11111111-1111-4111-8111-111111111111', '51000000-0000-4000-8000-000000000001', '2031-02-20 10:00:00+02', 30, 44000, 'attended', 'non_billable', null),
  ('51000000-0000-4000-8000-000000000015', '11111111-1111-4111-8111-111111111111', '51000000-0000-4000-8000-000000000001', '2031-02-21 10:00:00+02', 30, 55000, 'scheduled', 'default', null),
  ('51000000-0000-4000-8000-000000000016', '11111111-1111-4111-8111-111111111111', '51000000-0000-4000-8000-000000000001', '2031-02-22 10:00:00+02', 30, 66000, 'attended', 'default', '2031-02-23 00:00:00+02'),
  ('51000000-0000-4000-8000-000000000017', '11111111-1111-4111-8111-111111111111', '51000000-0000-4000-8000-000000000001', '2031-03-01 00:00:00+02', 30, 77000, 'attended', 'default', null);

create temporary table invoice_test_state (
  name text primary key,
  invoice_id uuid not null
);

insert into invoice_test_state (name, invoice_id)
values (
  'archived',
  public.finalize_invoice('2031-02', 'student', '51000000-0000-4000-8000-000000000001')
);

do $$
declare
  value public.invoices%rowtype;
  line_count integer;
begin
  select * into value
  from public.invoices
  where id = (select invoice_id from invoice_test_state where name = 'archived');

  select count(*) into line_count
  from public.invoice_lines
  where invoice_id = value.id and released_at is null;

  if value.status <> 'finalized' or value.total_cents <> 66000 or line_count <> 3 then
    raise exception 'finalized invoice did not use authoritative eligibility and totals: %, lines %', to_jsonb(value), line_count;
  end if;
  if value.period_start <> '2031-01-31 22:00:00+00' or value.period_end <> '2031-02-28 21:59:59.999+00' then
    raise exception 'invoice period did not use the settings timezone: % to %', value.period_start, value.period_end;
  end if;
  if value.tutor_snapshot <> '{"tutorName":"","tutorEmail":"","tutorPhone":"","tutorAddress":"","defaultPayerName":"","defaultPayerEmail":"","defaultPayerAddress":"","paymentTermsDays":7,"bankDetails":"","invoicePrefix":"INV","timezone":"Africa/Johannesburg","currency":"ZAR"}'::jsonb then
    raise exception 'blank business details were replaced in the snapshot: %', value.tutor_snapshot;
  end if;
  if value.recipient_snapshot <> '{"name":"Archived student","email":"","address":""}'::jsonb then
    raise exception 'archived student recipient snapshot was wrong: %', value.recipient_snapshot;
  end if;
  if exists (
    select 1 from public.lessons
    where id in (
      '51000000-0000-4000-8000-000000000011',
      '51000000-0000-4000-8000-000000000012',
      '51000000-0000-4000-8000-000000000013'
    ) and invoiced_at is null
  ) then raise exception 'eligible lessons were not marked invoiced'; end if;
  if exists (
    select 1 from public.lessons
    where id in (
      '51000000-0000-4000-8000-000000000014',
      '51000000-0000-4000-8000-000000000015',
      '51000000-0000-4000-8000-000000000016',
      '51000000-0000-4000-8000-000000000017'
    ) and invoiced_at is not null
  ) then raise exception 'an ineligible lesson was marked invoiced'; end if;
end;
$$;

do $$
declare
  invoice_count integer;
  line_count integer;
begin
  begin
    perform public.finalize_invoice('2031-02', 'student', '51000000-0000-4000-8000-000000000001');
    raise exception 'duplicate finalization unexpectedly succeeded';
  exception
    when others then
      if sqlerrm = 'duplicate finalization unexpectedly succeeded' then raise; end if;
  end;

  select count(*) into invoice_count
  from public.invoices
  where owner_id = '11111111-1111-4111-8111-111111111111'
    and student_id = '51000000-0000-4000-8000-000000000001'
    and period_start = '2031-01-31 22:00:00+00';
  select count(*) into line_count
  from public.invoice_lines
  where lesson_id in (
    '51000000-0000-4000-8000-000000000011',
    '51000000-0000-4000-8000-000000000012',
    '51000000-0000-4000-8000-000000000013'
  ) and released_at is null;
  if invoice_count <> 1 or line_count <> 3 then
    raise exception 'duplicate finalization changed invoices or active lines';
  end if;
end;
$$;

insert into public.students (id, owner_id, display_name)
values ('52000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Rollback student');
insert into public.lessons (
  id, owner_id, student_id, starts_at, duration_minutes, rate_cents, status
) values (
  '52000000-0000-4000-8000-000000000011',
  '11111111-1111-4111-8111-111111111111',
  '52000000-0000-4000-8000-000000000001',
  '2031-04-10 10:00:00+02',
  60,
  88000,
  'attended'
);

reset role;
create function public.test_fail_invoice_lesson_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id = '52000000-0000-4000-8000-000000000011' and new.invoiced_at is not null then
    raise exception 'injected invoice lesson failure';
  end if;
  return new;
end;
$$;
create trigger test_fail_invoice_lesson_update
before update of invoiced_at on public.lessons
for each row execute function public.test_fail_invoice_lesson_update();

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

do $$
declare
  counter_before bigint;
  counter_after bigint;
begin
  select coalesce(sum(current_sequence), 0) into counter_before
  from public.invoice_counters
  where owner_id = '11111111-1111-4111-8111-111111111111';

  begin
    perform public.finalize_invoice('2031-04', 'student', '52000000-0000-4000-8000-000000000001');
    raise exception 'failure injection unexpectedly succeeded';
  exception
    when others then
      if sqlerrm <> 'injected invoice lesson failure' then raise; end if;
  end;

  select coalesce(sum(current_sequence), 0) into counter_after
  from public.invoice_counters
  where owner_id = '11111111-1111-4111-8111-111111111111';

  if counter_after <> counter_before then raise exception 'invoice number allocation survived a failed finalization'; end if;
  if exists (select 1 from public.invoices where student_id = '52000000-0000-4000-8000-000000000001') then
    raise exception 'invoice survived a failed finalization';
  end if;
  if exists (select 1 from public.invoice_lines where lesson_id = '52000000-0000-4000-8000-000000000011') then
    raise exception 'invoice line survived a failed finalization';
  end if;
  if (select invoiced_at from public.lessons where id = '52000000-0000-4000-8000-000000000011') is not null then
    raise exception 'lesson flag survived a failed finalization';
  end if;
end;
$$;

reset role;
drop trigger test_fail_invoice_lesson_update on public.lessons;
drop function public.test_fail_invoice_lesson_update();

create extension if not exists dblink with schema extensions;
insert into public.students (id, owner_id, display_name)
values ('52500000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Concurrent student');
insert into public.lessons (
  id, owner_id, student_id, starts_at, duration_minutes, rate_cents, status
) values (
  '52500000-0000-4000-8000-000000000011',
  '11111111-1111-4111-8111-111111111111',
  '52500000-0000-4000-8000-000000000001',
  '2031-06-10 10:00:00+02',
  60,
  77000,
  'attended'
);
create function public.test_hold_invoice_lesson_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id = '52500000-0000-4000-8000-000000000011' and new.invoiced_at is not null then
    perform pg_catalog.pg_sleep(1);
  end if;
  return new;
end;
$$;
create trigger test_hold_invoice_lesson_update
before update of invoiced_at on public.lessons
for each row execute function public.test_hold_invoice_lesson_update();

do $$
declare
  connection_string text := 'host=/tmp dbname=' || current_database() || ' user=postgres';
  winner uuid;
  loser_error text;
begin
  perform extensions.dblink_connect('invoice_student', connection_string);
  perform extensions.dblink_connect('invoice_consolidated', connection_string);
  perform extensions.dblink_send_query(
    'invoice_student',
    'select public.finalize_invoice(''2031-06'', ''student'', ''52500000-0000-4000-8000-000000000001'') as invoice_id where set_config(''request.jwt.claim.sub'', ''11111111-1111-4111-8111-111111111111'', false) is not null'
  );
  perform pg_catalog.pg_sleep(0.2);
  perform extensions.dblink_send_query(
    'invoice_consolidated',
    'select public.finalize_invoice(''2031-06'', ''consolidated'', null) as invoice_id where set_config(''request.jwt.claim.sub'', ''11111111-1111-4111-8111-111111111111'', false) is not null'
  );

  select result.invoice_id into winner
  from extensions.dblink_get_result('invoice_student') as result(invoice_id uuid);
  perform *
  from extensions.dblink_get_result('invoice_consolidated', false) as result(invoice_id uuid);
  loser_error := extensions.dblink_error_message('invoice_consolidated');

  perform extensions.dblink_disconnect('invoice_student');
  perform extensions.dblink_disconnect('invoice_consolidated');

  if winner is null then raise exception 'overlapping finalization did not produce an invoice'; end if;
  if loser_error not like 'ERROR:%no uninvoiced billable lessons%' then
    raise exception 'overlapping finalization did not reject the second claim: %', loser_error;
  end if;
  if (select count(*) from public.invoice_lines where lesson_id = '52500000-0000-4000-8000-000000000011' and released_at is null) <> 1 then
    raise exception 'overlapping finalization created duplicate active lines';
  end if;
  if (select count(*) from public.invoices
      where owner_id = '11111111-1111-4111-8111-111111111111'
        and period_start = '2031-05-31 22:00:00+00') <> 1 then
    raise exception 'overlapping finalization created duplicate invoice headers';
  end if;
end;
$$;

drop trigger test_hold_invoice_lesson_update on public.lessons;
drop function public.test_hold_invoice_lesson_update();

insert into public.students (id, owner_id, display_name)
values ('53000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Pending owner student');
insert into public.lessons (
  id, owner_id, student_id, starts_at, duration_minutes, rate_cents, status
) values (
  '53000000-0000-4000-8000-000000000011',
  '22222222-2222-4222-8222-222222222222',
  '53000000-0000-4000-8000-000000000001',
  '2031-05-10 10:00:00+02',
  60,
  99000,
  'attended'
);
update public.accounts
set status = 'pending', reviewed_at = null
where user_id = '22222222-2222-4222-8222-222222222222';

set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
do $$
begin
  begin
    perform public.finalize_invoice('2031-05', 'student', '53000000-0000-4000-8000-000000000001');
    raise exception 'pending account unexpectedly finalized an invoice';
  exception
    when others then
      if sqlerrm <> 'account is not approved' then raise; end if;
  end;
  begin
    perform public.void_invoice(
      (select invoice_id from invoice_test_state where name = 'archived'),
      'Pending account attempt'
    );
    raise exception 'pending account unexpectedly voided an invoice';
  exception
    when others then
      if sqlerrm <> 'account is not approved' then raise; end if;
  end;
end;
$$;

reset role;
update public.accounts
set status = 'approved', reviewed_at = now()
where user_id = '22222222-2222-4222-8222-222222222222';

set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
do $$
begin
  begin
    perform public.finalize_invoice('2031-02', 'student', '51000000-0000-4000-8000-000000000001');
    raise exception 'another owner unexpectedly finalized the invoice';
  exception
    when others then
      if sqlerrm <> 'student not found' then raise; end if;
  end;
  begin
    perform public.void_invoice(
      (select invoice_id from invoice_test_state where name = 'archived'),
      'Another owner attempt'
    );
    raise exception 'another owner unexpectedly voided the invoice';
  exception
    when others then
      if sqlerrm <> 'invoice not found' then raise; end if;
  end;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

reset role;
create function public.test_fail_invoice_void()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id = '51000000-0000-4000-8000-000000000011' and old.invoiced_at is not null and new.invoiced_at is null then
    raise exception 'injected invoice void failure';
  end if;
  return new;
end;
$$;
create trigger test_fail_invoice_void
before update of invoiced_at on public.lessons
for each row execute function public.test_fail_invoice_void();

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
do $$
declare
  target_invoice uuid := (select invoice_id from invoice_test_state where name = 'archived');
begin
  begin
    perform public.void_invoice(target_invoice, 'Testing rollback');
    raise exception 'void failure injection unexpectedly succeeded';
  exception
    when others then
      if sqlerrm <> 'injected invoice void failure' then raise; end if;
  end;

  if (select status from public.invoices where id = target_invoice) <> 'finalized' then
    raise exception 'failed void changed invoice status';
  end if;
  if exists (
    select 1 from public.invoice_lines where invoice_id = target_invoice and released_at is not null
  ) then raise exception 'failed void released invoice lines'; end if;
  if exists (
    select 1 from public.lessons
    where id in (
      '51000000-0000-4000-8000-000000000011',
      '51000000-0000-4000-8000-000000000012',
      '51000000-0000-4000-8000-000000000013'
    ) and invoiced_at is null
  ) then raise exception 'failed void cleared lesson flags'; end if;
end;
$$;

reset role;
drop trigger test_fail_invoice_void on public.lessons;
drop function public.test_fail_invoice_void();

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

select public.void_invoice(
  (select invoice_id from invoice_test_state where name = 'archived'),
  'Invoice replaced'
);

insert into invoice_test_state (name, invoice_id)
values (
  'replacement',
  public.finalize_invoice('2031-02', 'student', '51000000-0000-4000-8000-000000000001')
);

select public.void_invoice(
  (select invoice_id from invoice_test_state where name = 'archived'),
  'Repeated void'
);

do $$
declare
  old_invoice uuid := (select invoice_id from invoice_test_state where name = 'archived');
  replacement_invoice uuid := (select invoice_id from invoice_test_state where name = 'replacement');
begin
  if (select status from public.invoices where id = old_invoice) <> 'void' then
    raise exception 'invoice was not voided';
  end if;
  if (select count(*) from public.invoice_lines where invoice_id = old_invoice and released_at is null) <> 0 then
    raise exception 'voided invoice retained active lines';
  end if;
  if (select count(*) from public.invoice_lines where invoice_id = replacement_invoice and released_at is null) <> 3 then
    raise exception 'replacement invoice did not claim all lessons';
  end if;
  if exists (
    select 1 from public.lessons
    where id in (
      '51000000-0000-4000-8000-000000000011',
      '51000000-0000-4000-8000-000000000012',
      '51000000-0000-4000-8000-000000000013'
    ) and invoiced_at is null
  ) then raise exception 'repeated void cleared flags after reinvoicing'; end if;
end;
$$;

reset role;
delete from public.invoice_lines as invoice_line
using public.invoices as invoice
where invoice_line.invoice_id = invoice.id
  and invoice.owner_id in (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  );
delete from public.invoices
where owner_id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);
delete from public.lessons
where owner_id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);
delete from public.students
where owner_id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);
delete from auth.users
where id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);
