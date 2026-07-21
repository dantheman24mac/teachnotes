do $$ begin
  create type public.account_role as enum ('admin', 'user');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.account_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role public.account_role not null default 'user',
  status public.account_status not null default 'pending',
  must_change_password boolean not null default false,
  is_protected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  check (not is_protected or (role = 'admin' and status = 'approved' and not must_change_password))
);

create unique index if not exists accounts_one_protected_admin_idx
  on public.accounts (is_protected)
  where is_protected;
create index if not exists accounts_status_created_idx
  on public.accounts (status, created_at);

alter table public.accounts enable row level security;

-- Public signup was disabled before this migration, so existing Auth users are
-- trusted as approved. The owner bootstrap promotes the configured account to
-- the sole protected administrator before signup is enabled.
insert into public.accounts (
  user_id,
  email,
  role,
  status,
  created_at,
  updated_at,
  reviewed_at
)
select
  id,
  coalesce(email, ''),
  'user'::public.account_role,
  'approved'::public.account_status,
  created_at,
  now(),
  now()
from auth.users
on conflict (user_id) do nothing;

insert into public.business_settings (owner_id, tutor_email)
select user_id, email
from public.accounts
where status = 'approved'
on conflict (owner_id) do nothing;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.new_user_defaults();

create or replace function public.sync_auth_user_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.accounts (user_id, email, created_at)
    values (new.id, coalesce(new.email, ''), new.created_at)
    on conflict (user_id) do update
      set email = excluded.email,
          updated_at = now();
  elsif new.email is distinct from old.email then
    update public.accounts
      set email = coalesce(new.email, ''),
          updated_at = now()
      where user_id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_account_created
after insert on auth.users
for each row execute function public.sync_auth_user_account();

create trigger on_auth_user_account_email_changed
after update of email on auth.users
for each row execute function public.sync_auth_user_account();

revoke all on function public.sync_auth_user_account() from public, anon, authenticated;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_account_is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select account.status = 'approved'::public.account_status
      and not account.must_change_password
    from public.accounts as account
    where account.user_id = (select auth.uid())
  ), false);
$$;

create or replace function private.current_account_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select account.role = 'admin'::public.account_role
      and account.status = 'approved'::public.account_status
      and not account.must_change_password
    from public.accounts as account
    where account.user_id = (select auth.uid())
  ), false);
$$;

revoke all on function private.current_account_is_approved() from public, anon;
revoke all on function private.current_account_is_admin() from public, anon;
grant execute on function private.current_account_is_approved() to authenticated;
grant execute on function private.current_account_is_admin() to authenticated;

create policy "account reads own record"
on public.accounts for select
to authenticated
using (user_id = (select auth.uid()));

create policy "admin reads accounts"
on public.accounts for select
to authenticated
using ((select private.current_account_is_admin()));

create or replace function public.touch_account_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists accounts_touch_updated_at on public.accounts;
create trigger accounts_touch_updated_at
before update on public.accounts
for each row execute function public.touch_account_updated_at();

revoke all on function public.touch_account_updated_at() from public, anon, authenticated;

create or replace function public.protect_bootstrap_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.is_protected then
    raise exception 'The bootstrap administrator cannot be deleted';
  end if;

  if tg_op = 'UPDATE'
    and old.is_protected
    and (
      new.user_id is distinct from old.user_id
      or new.role is distinct from old.role
      or new.status is distinct from old.status
      or new.must_change_password is distinct from old.must_change_password
      or new.is_protected is distinct from old.is_protected
    ) then
    raise exception 'The bootstrap administrator cannot be demoted, blocked, or unprotected';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists accounts_protect_bootstrap_admin on public.accounts;
create trigger accounts_protect_bootstrap_admin
before update or delete on public.accounts
for each row execute function public.protect_bootstrap_admin();

revoke all on function public.protect_bootstrap_admin() from public, anon, authenticated;

create or replace function public.review_account(
  p_user_id uuid,
  p_status public.account_status
)
returns public.accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewed public.accounts%rowtype;
begin
  if not (select private.current_account_is_admin()) then
    raise exception 'Administrator access required';
  end if;

  if p_status is null
    or p_status not in ('approved'::public.account_status, 'rejected'::public.account_status) then
    raise exception 'Accounts can only be approved or rejected';
  end if;

  select * into reviewed
  from public.accounts
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'Account not found';
  end if;

  if reviewed.is_protected then
    raise exception 'The bootstrap administrator cannot be reviewed';
  end if;

  update public.accounts
    set status = p_status,
        reviewed_at = now(),
        reviewed_by = (select auth.uid()),
        updated_at = now()
    where user_id = p_user_id
    returning * into reviewed;

  if p_status = 'approved'::public.account_status then
    insert into public.business_settings (owner_id, tutor_email)
    values (reviewed.user_id, reviewed.email)
    on conflict (owner_id) do nothing;
  end if;

  return reviewed;
end;
$$;

revoke all on function public.review_account(uuid, public.account_status) from public, anon;
grant execute on function public.review_account(uuid, public.account_status) to authenticated;

drop policy if exists "owner manages business settings" on public.business_settings;
create policy "approved owner manages business settings"
on public.business_settings for all
to authenticated
using ((select private.current_account_is_approved()) and owner_id = (select auth.uid()))
with check ((select private.current_account_is_approved()) and owner_id = (select auth.uid()));

drop policy if exists "owner manages students" on public.students;
create policy "approved owner manages students"
on public.students for all
to authenticated
using ((select private.current_account_is_approved()) and owner_id = (select auth.uid()))
with check ((select private.current_account_is_approved()) and owner_id = (select auth.uid()));

drop policy if exists "owner manages series" on public.lesson_series;
create policy "approved owner manages series"
on public.lesson_series for all
to authenticated
using ((select private.current_account_is_approved()) and owner_id = (select auth.uid()))
with check ((select private.current_account_is_approved()) and owner_id = (select auth.uid()));

drop policy if exists "owner manages lessons" on public.lessons;
create policy "approved owner manages lessons"
on public.lessons for all
to authenticated
using ((select private.current_account_is_approved()) and owner_id = (select auth.uid()))
with check ((select private.current_account_is_approved()) and owner_id = (select auth.uid()));

drop policy if exists "owner manages invoice counters" on public.invoice_counters;
create policy "approved owner manages invoice counters"
on public.invoice_counters for all
to authenticated
using ((select private.current_account_is_approved()) and owner_id = (select auth.uid()))
with check ((select private.current_account_is_approved()) and owner_id = (select auth.uid()));

drop policy if exists "owner manages invoices" on public.invoices;
create policy "approved owner manages invoices"
on public.invoices for all
to authenticated
using ((select private.current_account_is_approved()) and owner_id = (select auth.uid()))
with check ((select private.current_account_is_approved()) and owner_id = (select auth.uid()));

drop policy if exists "owner manages invoice lines" on public.invoice_lines;
create policy "approved owner manages invoice lines"
on public.invoice_lines for all
to authenticated
using (
  (select private.current_account_is_approved())
  and exists (
    select 1 from public.invoices as invoice
    where invoice.id = invoice_id
      and invoice.owner_id = (select auth.uid())
  )
)
with check (
  (select private.current_account_is_approved())
  and exists (
    select 1 from public.invoices as invoice
    where invoice.id = invoice_id
      and invoice.owner_id = (select auth.uid())
  )
);

drop policy if exists "owner reads sync operations" on public.sync_operations;
create policy "approved owner reads sync operations"
on public.sync_operations for select
to authenticated
using ((select private.current_account_is_approved()) and owner_id = (select auth.uid()));

drop policy if exists "approved owner inserts sync operations" on public.sync_operations;
create policy "approved owner inserts sync operations"
on public.sync_operations for insert
to authenticated
with check ((select private.current_account_is_approved()) and owner_id = (select auth.uid()));

drop policy if exists "owner reads invoice pdfs" on storage.objects;
create policy "approved owner reads invoice pdfs"
on storage.objects for select
to authenticated
using (
  (select private.current_account_is_approved())
  and bucket_id = 'invoices'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "owner uploads invoice pdfs" on storage.objects;
create policy "approved owner uploads invoice pdfs"
on storage.objects for insert
to authenticated
with check (
  (select private.current_account_is_approved())
  and bucket_id = 'invoices'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "owner updates invoice pdfs" on storage.objects;
create policy "approved owner updates invoice pdfs"
on storage.objects for update
to authenticated
using (
  (select private.current_account_is_approved())
  and bucket_id = 'invoices'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  (select private.current_account_is_approved())
  and bucket_id = 'invoices'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create or replace function public.next_invoice_number(p_prefix text default 'INV')
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_year integer := extract(year from now())::integer;
  v_sequence integer;
begin
  if v_owner is null then raise exception 'not authenticated'; end if;
  if not (select private.current_account_is_approved()) then raise exception 'account is not approved'; end if;
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
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_lesson public.lessons%rowtype;
  v_student_name text;
  v_result jsonb;
begin
  if v_owner is null then raise exception 'not authenticated'; end if;
  if not (select private.current_account_is_approved()) then raise exception 'account is not approved'; end if;
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
  insert into public.sync_operations(id, owner_id, lesson_id, result)
  values (p_operation_id, v_owner, p_lesson_id, v_result);
  return v_result;
end;
$$;

revoke all on function public.next_invoice_number(text) from public, anon;
revoke all on function public.apply_lesson_operation(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.next_invoice_number(text) to authenticated;
grant execute on function public.apply_lesson_operation(uuid, uuid, integer, jsonb) to authenticated;

grant select on public.accounts to authenticated;
grant select, insert, update, delete on public.accounts to service_role;
grant select, insert, update on public.business_settings to service_role;
grant usage on type public.account_role, public.account_status to authenticated, service_role;
