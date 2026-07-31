create or replace function public.archive_student(p_student_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_archived_at timestamptz := now();
  v_student_count integer;
begin
  if v_owner is null then
    raise exception 'student not found';
  end if;

  update public.students
  set active = false,
      deleted_at = coalesce(deleted_at, v_archived_at)
  where id = p_student_id
    and owner_id = v_owner;

  get diagnostics v_student_count = row_count;
  if v_student_count = 0 then
    raise exception 'student not found';
  end if;

  update public.lesson_series
  set active = false,
      updated_at = v_archived_at,
      deleted_at = coalesce(deleted_at, v_archived_at)
  where student_id = p_student_id
    and owner_id = v_owner;

  update public.lessons
  set deleted_at = v_archived_at
  where student_id = p_student_id
    and owner_id = v_owner
    and deleted_at is null
    and starts_at >= v_archived_at
    and status = 'scheduled'::public.lesson_status
    and invoiced_at is null;
end;
$$;

create or replace function public.restore_student(p_student_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_student_count integer;
begin
  if v_owner is null then
    raise exception 'student not found';
  end if;

  update public.students
  set active = true,
      deleted_at = null
  where id = p_student_id
    and owner_id = v_owner;

  get diagnostics v_student_count = row_count;
  if v_student_count = 0 then
    raise exception 'student not found';
  end if;
end;
$$;

revoke all on function public.archive_student(uuid) from public, anon;
revoke all on function public.restore_student(uuid) from public, anon;
grant execute on function public.archive_student(uuid) to authenticated;
grant execute on function public.restore_student(uuid) to authenticated;
