alter table public.lessons
  add column if not exists notes_saved_at timestamptz,
  add column if not exists notes_saved_by uuid,
  add column if not exists status_saved_at timestamptz,
  add column if not exists status_saved_by uuid,
  add column if not exists billing_override_saved_at timestamptz,
  add column if not exists billing_override_saved_by uuid;

update public.lessons set
  notes_saved_at = coalesce(notes_saved_at, updated_at),
  status_saved_at = coalesce(status_saved_at, updated_at),
  billing_override_saved_at = coalesce(billing_override_saved_at, updated_at);

alter table public.lessons
  alter column notes_saved_at set default clock_timestamp(),
  alter column notes_saved_at set not null,
  alter column status_saved_at set default clock_timestamp(),
  alter column status_saved_at set not null,
  alter column billing_override_saved_at set default clock_timestamp(),
  alter column billing_override_saved_at set not null;

create or replace function public.capture_lesson_field_saves()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_direct_change_id constant uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
begin
  if new.notes is distinct from old.notes
    and new.notes_saved_at is not distinct from old.notes_saved_at
    and new.notes_saved_by is not distinct from old.notes_saved_by then
    new.notes_saved_at := clock_timestamp();
    new.notes_saved_by := v_direct_change_id;
  end if;
  if new.status is distinct from old.status
    and new.status_saved_at is not distinct from old.status_saved_at
    and new.status_saved_by is not distinct from old.status_saved_by then
    new.status_saved_at := clock_timestamp();
    new.status_saved_by := v_direct_change_id;
  end if;
  if new.billing_override is distinct from old.billing_override
    and new.billing_override_saved_at is not distinct from old.billing_override_saved_at
    and new.billing_override_saved_by is not distinct from old.billing_override_saved_by then
    new.billing_override_saved_at := clock_timestamp();
    new.billing_override_saved_by := v_direct_change_id;
  end if;
  return new;
end;
$$;

drop trigger if exists lessons_capture_field_saves on public.lessons;
create trigger lessons_capture_field_saves
before update on public.lessons
for each row execute function public.capture_lesson_field_saves();

create or replace function public.apply_lesson_operation(
  p_operation_id uuid,
  p_lesson_id uuid,
  p_base_version integer,
  p_patch jsonb,
  p_client_timestamp timestamptz
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
  v_notes_wins boolean;
  v_status_wins boolean;
  v_billing_wins boolean;
begin
  if v_owner is null then raise exception 'not authenticated'; end if;
  if not (select private.current_account_is_approved()) then raise exception 'account is not approved'; end if;
  if p_client_timestamp is null then raise exception 'client timestamp is required'; end if;
  if not (p_patch ?| array['notes', 'status', 'billing_override']) then raise exception 'lesson patch is empty'; end if;
  if p_patch ? 'notes' and coalesce(jsonb_typeof(p_patch->'notes'), '') <> 'string' then raise exception 'invalid notes'; end if;
  if p_patch ? 'status' and coalesce(p_patch->>'status', '') not in ('scheduled', 'attended', 'canceled_rescheduled', 'no_show') then raise exception 'invalid lesson status'; end if;
  if p_patch ? 'billing_override' and coalesce(p_patch->>'billing_override', '') not in ('default', 'billable', 'non_billable') then raise exception 'invalid billing override'; end if;

  select result into v_result
  from public.sync_operations
  where id = p_operation_id and owner_id = v_owner;
  if found then
    select * into v_lesson
    from public.lessons
    where id = p_lesson_id and owner_id = v_owner and deleted_at is null;
    if not found then return v_result; end if;
    select display_name into v_student_name from public.students where id = v_lesson.student_id;
    return v_result || jsonb_build_object(
      'lesson', to_jsonb(v_lesson) || jsonb_build_object('students', jsonb_build_object('display_name', v_student_name))
    );
  end if;

  select * into v_lesson
  from public.lessons
  where id = p_lesson_id and owner_id = v_owner and deleted_at is null
  for update;
  if not found then raise exception 'lesson not found'; end if;

  select result into v_result
  from public.sync_operations
  where id = p_operation_id and owner_id = v_owner;
  if found then
    select display_name into v_student_name from public.students where id = v_lesson.student_id;
    return v_result || jsonb_build_object(
      'lesson', to_jsonb(v_lesson) || jsonb_build_object('students', jsonb_build_object('display_name', v_student_name))
    );
  end if;

  select display_name into v_student_name from public.students where id = v_lesson.student_id;
  v_notes_wins := p_patch ? 'notes' and (p_client_timestamp, p_operation_id::text) > (v_lesson.notes_saved_at, coalesce(v_lesson.notes_saved_by::text, ''));
  v_status_wins := p_patch ? 'status' and (p_client_timestamp, p_operation_id::text) > (v_lesson.status_saved_at, coalesce(v_lesson.status_saved_by::text, ''));
  v_billing_wins := p_patch ? 'billing_override' and (p_client_timestamp, p_operation_id::text) > (v_lesson.billing_override_saved_at, coalesce(v_lesson.billing_override_saved_by::text, ''));

  if v_notes_wins or v_status_wins or v_billing_wins then
    update public.lessons set
      notes = case when v_notes_wins then p_patch->>'notes' else notes end,
      notes_saved_at = case when v_notes_wins then p_client_timestamp else notes_saved_at end,
      notes_saved_by = case when v_notes_wins then p_operation_id else notes_saved_by end,
      status = case when v_status_wins then (p_patch->>'status')::public.lesson_status else status end,
      status_saved_at = case when v_status_wins then p_client_timestamp else status_saved_at end,
      status_saved_by = case when v_status_wins then p_operation_id else status_saved_by end,
      billing_override = case when v_billing_wins then (p_patch->>'billing_override')::public.billing_override else billing_override end,
      billing_override_saved_at = case when v_billing_wins then p_client_timestamp else billing_override_saved_at end,
      billing_override_saved_by = case when v_billing_wins then p_operation_id else billing_override_saved_by end,
      version = version + 1
    where id = p_lesson_id
    returning * into v_lesson;
  end if;

  v_result := jsonb_build_object(
    'status', 'applied',
    'lesson', to_jsonb(v_lesson) || jsonb_build_object('students', jsonb_build_object('display_name', v_student_name))
  );
  insert into public.sync_operations(id, owner_id, lesson_id, result)
  values (p_operation_id, v_owner, p_lesson_id, v_result);
  return v_result;
end;
$$;

create or replace function public.apply_lesson_operation(
  p_operation_id uuid,
  p_lesson_id uuid,
  p_base_version integer,
  p_patch jsonb
)
returns jsonb
language sql
set search_path = ''
as $$
  select public.apply_lesson_operation(
    p_operation_id,
    p_lesson_id,
    p_base_version,
    p_patch,
    clock_timestamp()
  );
$$;

revoke all on function public.apply_lesson_operation(uuid, uuid, integer, jsonb, timestamptz) from public, anon;
revoke all on function public.apply_lesson_operation(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.apply_lesson_operation(uuid, uuid, integer, jsonb, timestamptz) to authenticated;
grant execute on function public.apply_lesson_operation(uuid, uuid, integer, jsonb) to authenticated;
