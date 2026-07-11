create extension if not exists pgcrypto with schema extensions;

create sequence if not exists public.sync_revision_seq;

do $$ begin
  create type public.lesson_status as enum ('scheduled', 'attended', 'canceled_rescheduled', 'no_show');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.billing_override as enum ('default', 'billable', 'non_billable');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.invoice_kind as enum ('consolidated', 'student');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.invoice_status as enum ('draft', 'finalized', 'void');
exception when duplicate_object then null; end $$;

create table if not exists public.business_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  tutor_name text not null default '',
  tutor_email text not null default '',
  tutor_phone text not null default '',
  tutor_address text not null default '',
  default_payer_name text not null default '',
  default_payer_email text not null default '',
  default_payer_address text not null default '',
  payment_terms_days integer not null default 7 check (payment_terms_days between 0 and 365),
  bank_details text not null default '',
  invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Za-z0-9-]+$'),
  timezone text not null default 'Africa/Johannesburg',
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  updated_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 200),
  guardian_name text,
  billing_email text,
  billing_address text,
  default_duration_minutes integer not null default 60 check (default_duration_minutes between 15 and 240),
  default_rate_cents integer not null default 0 check (default_rate_cents >= 0),
  active boolean not null default true,
  sync_revision bigint not null default nextval('public.sync_revision_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists students_owner_name_idx on public.students(owner_id, display_name) where deleted_at is null;
create index if not exists students_sync_idx on public.students(owner_id, sync_revision);

create table if not exists public.lesson_series (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id),
  starts_at_local timestamp not null,
  timezone text not null default 'Africa/Johannesburg',
  frequency text not null check (frequency in ('weekly', 'fortnightly')),
  weekdays smallint[] not null check (cardinality(weekdays) > 0),
  until date,
  exclusions date[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists lesson_series_owner_student_idx on public.lesson_series(owner_id, student_id) where deleted_at is null;

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id),
  series_id uuid references public.lesson_series(id) on delete set null,
  occurrence_key timestamptz,
  starts_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 1 and 1440),
  rate_cents integer not null check (rate_cents >= 0),
  status public.lesson_status not null default 'scheduled',
  billing_override public.billing_override not null default 'default',
  notes text not null default '' check (char_length(notes) <= 20000),
  replacement_lesson_id uuid references public.lessons(id) on delete set null,
  version integer not null default 1 check (version > 0),
  sync_revision bigint not null default nextval('public.sync_revision_seq'),
  invoiced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(series_id, occurrence_key)
);
create index if not exists lessons_owner_starts_idx on public.lessons(owner_id, starts_at) where deleted_at is null;
create index if not exists lessons_student_starts_idx on public.lessons(student_id, starts_at desc) where deleted_at is null;
create index if not exists lessons_sync_idx on public.lessons(owner_id, sync_revision);

create table if not exists public.invoice_counters (
  owner_id uuid not null references auth.users(id) on delete cascade,
  invoice_year integer not null,
  prefix text not null,
  current_sequence integer not null default 0,
  primary key(owner_id, invoice_year, prefix)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  number text,
  kind public.invoice_kind not null,
  status public.invoice_status not null default 'draft',
  student_id uuid references public.students(id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  tutor_snapshot jsonb not null default '{}',
  recipient_snapshot jsonb not null default '{}',
  total_cents integer not null default 0 check (total_cents >= 0),
  issued_at timestamptz,
  due_at timestamptz,
  pdf_path text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, number),
  check (period_end >= period_start),
  check (status <> 'void' or (voided_at is not null and char_length(void_reason) >= 3))
);
create index if not exists invoices_owner_created_idx on public.invoices(owner_id, created_at desc);

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id),
  student_name text not null,
  lesson_date timestamptz not null,
  duration_minutes integer not null,
  lesson_status public.lesson_status not null,
  amount_cents integer not null check (amount_cents >= 0),
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists one_active_invoice_per_lesson_idx on public.invoice_lines(lesson_id) where released_at is null;
create index if not exists invoice_lines_invoice_idx on public.invoice_lines(invoice_id);

create table if not exists public.sync_operations (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists sync_operations_owner_created_idx on public.sync_operations(owner_id, created_at desc);

create or replace function public.touch_sync_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  new.sync_revision = nextval('public.sync_revision_seq');
  return new;
end;
$$;

drop trigger if exists students_touch_sync on public.students;
create trigger students_touch_sync before update on public.students for each row execute function public.touch_sync_revision();
drop trigger if exists lessons_touch_sync on public.lessons;
create trigger lessons_touch_sync before update on public.lessons for each row execute function public.touch_sync_revision();

create or replace function public.new_user_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.business_settings(owner_id, tutor_email) values (new.id, coalesce(new.email, '')) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_user_defaults();

create or replace function public.next_invoice_number(p_prefix text default 'INV')
returns text language plpgsql set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_year integer := extract(year from now())::integer;
  v_sequence integer;
begin
  if v_owner is null then raise exception 'not authenticated'; end if;
  insert into public.invoice_counters(owner_id, invoice_year, prefix, current_sequence)
  values (v_owner, v_year, upper(p_prefix), 1)
  on conflict (owner_id, invoice_year, prefix)
  do update set current_sequence = public.invoice_counters.current_sequence + 1
  returning current_sequence into v_sequence;
  return upper(p_prefix) || '-' || v_year || '-' || lpad(v_sequence::text, 4, '0');
end;
$$;

create or replace function public.apply_lesson_operation(
  p_operation_id uuid,
  p_lesson_id uuid,
  p_base_version integer,
  p_patch jsonb
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_lesson public.lessons%rowtype;
  v_student_name text;
  v_result jsonb;
begin
  if v_owner is null then raise exception 'not authenticated'; end if;
  select result into v_result from public.sync_operations where id = p_operation_id and owner_id = v_owner;
  if found then return v_result; end if;
  select * into v_lesson from public.lessons where id = p_lesson_id and owner_id = v_owner and deleted_at is null for update;
  if not found then raise exception 'lesson not found'; end if;
  select display_name into v_student_name from public.students where id = v_lesson.student_id;
  if v_lesson.version <> p_base_version then
    v_result := jsonb_build_object('status', 'conflict', 'lesson', to_jsonb(v_lesson) || jsonb_build_object('students', jsonb_build_object('display_name', v_student_name)));
  else
    update public.lessons set
      notes = coalesce(p_patch->>'notes', notes),
      status = coalesce((p_patch->>'status')::public.lesson_status, status),
      billing_override = coalesce((p_patch->>'billing_override')::public.billing_override, billing_override),
      version = version + 1
    where id = p_lesson_id
    returning * into v_lesson;
    v_result := jsonb_build_object('status', 'applied', 'lesson', to_jsonb(v_lesson) || jsonb_build_object('students', jsonb_build_object('display_name', v_student_name)));
  end if;
  insert into public.sync_operations(id, owner_id, lesson_id, result) values (p_operation_id, v_owner, p_lesson_id, v_result);
  return v_result;
end;
$$;

alter table public.business_settings enable row level security;
alter table public.students enable row level security;
alter table public.lesson_series enable row level security;
alter table public.lessons enable row level security;
alter table public.invoice_counters enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.sync_operations enable row level security;

create policy "owner manages business settings" on public.business_settings for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner manages students" on public.students for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner manages series" on public.lesson_series for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner manages lessons" on public.lessons for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner manages invoice counters" on public.invoice_counters for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner manages invoices" on public.invoices for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner manages invoice lines" on public.invoice_lines for all using (exists(select 1 from public.invoices i where i.id = invoice_id and i.owner_id = auth.uid())) with check (exists(select 1 from public.invoices i where i.id = invoice_id and i.owner_id = auth.uid()));
create policy "owner reads sync operations" on public.sync_operations for select using (owner_id = auth.uid());

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false;
create policy "owner reads invoice pdfs" on storage.objects for select using (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner uploads invoice pdfs" on storage.objects for insert with check (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner updates invoice pdfs" on storage.objects for update using (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);

grant usage on schema public to authenticated;
grant usage on type public.lesson_status, public.billing_override, public.invoice_kind, public.invoice_status to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.next_invoice_number(text) to authenticated;
grant execute on function public.apply_lesson_operation(uuid, uuid, integer, jsonb) to authenticated;
