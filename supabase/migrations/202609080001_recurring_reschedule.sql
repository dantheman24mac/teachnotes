alter table public.lesson_series
  add column if not exists schedule_revision integer not null default 1 check (schedule_revision > 0),
  add column if not exists materialize_from timestamptz,
  add column if not exists week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6);

create or replace function private.lesson_series_occurrence_is_valid(
  p_series public.lesson_series,
  p_occurrence timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_occurrence is not null
    and (p_occurrence at time zone p_series.timezone)::date >= p_series.starts_at_local::date
    and (p_series.materialize_from is null or p_occurrence >= p_series.materialize_from)
    and extract(dow from p_occurrence at time zone p_series.timezone)::smallint = any(p_series.weekdays)
    and (p_occurrence at time zone p_series.timezone)::time = p_series.starts_at_local::time
    and (
      p_series.until is null
      or (p_occurrence at time zone p_series.timezone)::date <= p_series.until
    )
    and not ((p_occurrence at time zone p_series.timezone)::date = any(p_series.exclusions))
    and mod(
      (
        (
          (p_occurrence at time zone p_series.timezone)::date
          - mod(
              extract(dow from p_occurrence at time zone p_series.timezone)::integer
              - p_series.week_starts_on + 7,
              7
            )
        )
        - (
          p_series.starts_at_local::date
          - mod(
              extract(dow from p_series.starts_at_local)::integer
              - p_series.week_starts_on + 7,
              7
            )
        )
      ) / 7,
      case when p_series.frequency = 'fortnightly' then 2 else 1 end
    ) = 0;
$$;

revoke all on function private.lesson_series_occurrence_is_valid(public.lesson_series, timestamptz)
from public, anon;
grant execute on function private.lesson_series_occurrence_is_valid(public.lesson_series, timestamptz)
to authenticated;

create or replace function public.materialize_lesson_series(
  p_series_id uuid,
  p_schedule_revision integer,
  p_occurrences jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_series public.lesson_series%rowtype;
  v_student public.students%rowtype;
  v_occurrence_text text;
  v_occurrence timestamptz;
  v_previous timestamptz;
  v_inserted integer := 0;
begin
  if v_owner is null then raise exception 'not authenticated'; end if;
  if not (select private.current_account_is_approved()) then raise exception 'account is not approved'; end if;
  if jsonb_typeof(p_occurrences) <> 'array' or jsonb_array_length(p_occurrences) > 1000 then
    raise exception 'invalid occurrences';
  end if;

  select * into v_series
  from public.lesson_series
  where id = p_series_id and owner_id = v_owner and active and deleted_at is null
  for update;
  if not found then raise exception 'lesson series not found'; end if;
  if v_series.schedule_revision <> p_schedule_revision then raise exception 'lesson series changed'; end if;

  select * into v_student
  from public.students
  where id = v_series.student_id and owner_id = v_owner and active and deleted_at is null;
  if not found then raise exception 'student not found'; end if;

  for v_occurrence_text in select value #>> '{}' from jsonb_array_elements(p_occurrences)
  loop
    begin
      v_occurrence := v_occurrence_text::timestamptz;
    exception when others then
      raise exception 'invalid occurrence';
    end;
    if v_previous is not null and v_occurrence <= v_previous then raise exception 'occurrences must be ordered'; end if;
    if not private.lesson_series_occurrence_is_valid(v_series, v_occurrence) then raise exception 'occurrence does not match lesson series'; end if;

    insert into public.lessons (
      owner_id, student_id, series_id, occurrence_key, starts_at, duration_minutes, rate_cents
    ) select
      v_owner, v_series.student_id, v_series.id, v_occurrence, v_occurrence,
      v_student.default_duration_minutes, v_student.default_rate_cents
    where not exists (
      select 1
      from public.lessons occupied
      where occupied.owner_id = v_owner
        and occupied.student_id = v_series.student_id
        and occupied.starts_at = v_occurrence
        and occupied.deleted_at is null
    )
    on conflict (series_id, occurrence_key) do nothing;
    v_inserted := v_inserted + case when found then 1 else 0 end;
    v_previous := v_occurrence;
  end loop;

  return v_inserted;
end;
$$;

create or replace function public.reschedule_lesson_series(
  p_lesson_id uuid,
  p_scope text,
  p_next_starts_at timestamptz,
  p_cutoff timestamptz default null,
  p_materialize_from timestamptz default null,
  p_new_starts_at_local timestamp default null,
  p_new_timezone text default null,
  p_new_frequency text default null,
  p_new_weekdays smallint[] default null,
  p_new_week_starts_on smallint default null,
  p_new_until date default null,
  p_new_exclusions date[] default '{}',
  p_occurrences jsonb default '[]'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_lesson public.lessons%rowtype;
  v_old_series public.lesson_series%rowtype;
  v_new_series public.lesson_series%rowtype;
  v_source_lesson public.lessons%rowtype;
  v_student public.students%rowtype;
  v_item jsonb;
  v_source_key timestamptz;
  v_target timestamptz;
  v_expected_target timestamptz;
  v_previous_source timestamptz;
  v_previous_target timestamptz;
  v_first_target timestamptz;
  v_reused_ids uuid[] := '{}';
  v_excluded_target date;
  v_source_anchor timestamptz;
  v_source_local timestamp;
  v_target_local timestamp;
  v_local_delta interval;
  v_day_delta integer;
  v_expected_weekdays smallint[];
  v_expected_week_starts_on smallint;
  v_source_found boolean;
  v_source_is_protected boolean;
  v_target_is_occupied boolean;
  v_selected_seen boolean := false;
begin
  if v_owner is null then raise exception 'not authenticated'; end if;
  if not (select private.current_account_is_approved()) then raise exception 'account is not approved'; end if;
  if p_scope not in ('one', 'following', 'all_future') then raise exception 'invalid reschedule scope'; end if;
  if p_next_starts_at is null then raise exception 'new lesson time is required'; end if;

  select * into v_lesson
  from public.lessons
  where id = p_lesson_id and owner_id = v_owner and deleted_at is null;
  if not found then raise exception 'lesson not found'; end if;

  if p_scope = 'one' or v_lesson.series_id is null then
    select * into v_lesson
    from public.lessons
    where id = p_lesson_id and owner_id = v_owner and deleted_at is null
    for update;
    if not found then raise exception 'lesson not found'; end if;
    if v_lesson.status <> 'scheduled'::public.lesson_status or v_lesson.invoiced_at is not null then
      raise exception 'completed or invoiced lessons cannot be rescheduled';
    end if;
    if v_lesson.starts_at < v_now then
      raise exception 'past lessons cannot be rescheduled';
    end if;
    update public.lessons
    set starts_at = p_next_starts_at
    where id = v_lesson.id;
    return null;
  end if;

  select * into v_old_series
  from public.lesson_series
  where id = v_lesson.series_id and owner_id = v_owner and active and deleted_at is null
  for update;
  if not found then raise exception 'lesson series not found'; end if;

  select * into v_lesson
  from public.lessons
  where id = p_lesson_id
    and owner_id = v_owner
    and series_id = v_old_series.id
    and deleted_at is null
  for update;
  if not found then raise exception 'lesson not found'; end if;
  if v_lesson.status <> 'scheduled'::public.lesson_status or v_lesson.invoiced_at is not null then
    raise exception 'completed or invoiced lessons cannot be rescheduled';
  end if;
  if v_lesson.starts_at < v_now then
    raise exception 'past lessons cannot start a series reschedule';
  end if;

  v_source_anchor := coalesce(v_lesson.occurrence_key, v_lesson.starts_at);
  v_source_local := v_source_anchor at time zone v_old_series.timezone;
  v_target_local := p_next_starts_at at time zone v_old_series.timezone;
  v_local_delta := v_target_local - v_source_local;
  v_day_delta := v_target_local::date - v_source_local::date;
  v_expected_week_starts_on := mod(
    mod(v_old_series.week_starts_on::integer + v_day_delta, 7) + 7,
    7
  )::smallint;
  select array_agg(
    mod(mod(day::integer + v_day_delta, 7) + 7, 7)::smallint
    order by position
  ) into v_expected_weekdays
  from unnest(v_old_series.weekdays) with ordinality shifted(day, position);

  if p_new_starts_at_local is null
    or p_new_starts_at_local is distinct from v_old_series.starts_at_local + v_local_delta
    or p_new_timezone is distinct from v_old_series.timezone
    or p_new_frequency is distinct from v_old_series.frequency
    or p_new_weekdays is distinct from v_expected_weekdays
    or p_new_week_starts_on is distinct from v_expected_week_starts_on
    or p_new_until is distinct from v_old_series.until
    or p_new_exclusions is distinct from v_old_series.exclusions
    or jsonb_typeof(p_occurrences) <> 'array'
    or jsonb_array_length(p_occurrences) = 0
    or jsonb_array_length(p_occurrences) > 5000 then
    raise exception 'invalid replacement series';
  end if;

  p_cutoff := case
    when p_scope = 'following' then v_source_anchor
    else coalesce(p_cutoff, v_now)
  end;
  if p_scope = 'all_future' and abs(extract(epoch from p_cutoff - v_now)) > 300 then
    raise exception 'invalid all-future cutoff';
  end if;
  p_materialize_from := coalesce(p_materialize_from, p_next_starts_at);
  if p_materialize_from < v_now then
    raise exception 'replacement schedule cannot start in the past';
  end if;

  select * into v_student
  from public.students
  where id = v_old_series.student_id and owner_id = v_owner and active and deleted_at is null;
  if not found then raise exception 'student not found'; end if;

  insert into public.lesson_series (
    owner_id, student_id, starts_at_local, timezone, frequency, weekdays, until,
    exclusions, active, materialize_from, week_starts_on
  ) values (
    v_owner, v_old_series.student_id, p_new_starts_at_local, p_new_timezone,
    p_new_frequency, p_new_weekdays, p_new_until, p_new_exclusions, true,
    p_materialize_from, p_new_week_starts_on
  ) returning * into v_new_series;

  with supplied as (
    select
      (value->>'sourceKey')::timestamptz as source_key,
      (value->>'startsAt')::timestamptz as target
    from jsonb_array_elements(p_occurrences)
  ), existing as (
    select
      lesson.occurrence_key as source_key,
      (
        (lesson.occurrence_key at time zone v_old_series.timezone) + v_local_delta
      ) at time zone v_old_series.timezone as target
    from public.lessons lesson
    where lesson.owner_id = v_owner
      and lesson.series_id = v_old_series.id
      and lesson.occurrence_key is not null
      and lesson.deleted_at is null
      and (
        (p_scope = 'following' and lesson.occurrence_key >= p_cutoff)
        or (
          p_scope = 'all_future'
          and (lesson.occurrence_key >= p_cutoff or lesson.id = v_lesson.id)
        )
      )
  ), combined as (
    select source_key, target from supplied
    union
    select source_key, target
    from existing
    where target >= p_materialize_from
      and private.lesson_series_occurrence_is_valid(v_new_series, target)
  )
  select jsonb_agg(
    jsonb_build_object('sourceKey', source_key, 'startsAt', target)
    order by source_key, target
  ) into p_occurrences
  from combined;

  if jsonb_array_length(p_occurrences) > 5000 then
    raise exception 'replacement series is too large';
  end if;

  for v_item in select value from jsonb_array_elements(p_occurrences)
  loop
    begin
      v_source_key := (v_item->>'sourceKey')::timestamptz;
      v_target := (v_item->>'startsAt')::timestamptz;
    exception when others then
      raise exception 'invalid replacement occurrence';
    end;
    if v_source_key is null or v_target is null or v_target < p_materialize_from then
      raise exception 'replacement occurrence precedes cutoff';
    end if;
    if p_scope = 'following' and v_source_key < p_cutoff then
      raise exception 'replacement occurrence precedes cutoff';
    end if;
    if v_previous_source is not null and v_source_key <= v_previous_source then
      raise exception 'replacement source occurrences must be ordered';
    end if;
    if v_previous_target is not null and v_target <= v_previous_target then
      raise exception 'replacement occurrences must be ordered';
    end if;
    v_expected_target := (
      (v_source_key at time zone v_old_series.timezone) + v_local_delta
    ) at time zone v_old_series.timezone;
    if v_target is distinct from v_expected_target then
      raise exception 'replacement occurrence has an invalid shift';
    end if;
    if not private.lesson_series_occurrence_is_valid(v_new_series, v_target) then
      raise exception 'occurrence does not match replacement series';
    end if;

    if v_first_target is null then v_first_target := v_target; end if;

    select * into v_source_lesson
    from public.lessons
    where owner_id = v_owner
      and series_id = v_old_series.id
      and occurrence_key = v_source_key
      and deleted_at is null
    for update;
    v_source_found := found;
    v_source_is_protected := v_source_found
      and v_source_lesson.id <> v_lesson.id
      and (
        v_source_lesson.starts_at < v_now
        or v_source_lesson.status <> 'scheduled'::public.lesson_status
        or v_source_lesson.invoiced_at is not null
      );

    select exists (
      select 1
      from public.lessons occupied
      where occupied.owner_id = v_owner
        and occupied.student_id = v_old_series.student_id
        and occupied.starts_at = v_target
        and occupied.deleted_at is null
        and (not v_source_found or occupied.id <> v_source_lesson.id)
        and not (
          occupied.series_id is not distinct from v_old_series.id
          and occupied.starts_at >= v_now
          and occupied.status = 'scheduled'::public.lesson_status
          and occupied.invoiced_at is null
          and (
            p_scope = 'all_future'
            or coalesce(occupied.occurrence_key, occupied.starts_at) >= p_cutoff
          )
        )
    ) into v_target_is_occupied;

    if v_target_is_occupied and v_source_found and not v_source_is_protected then
      raise exception 'new lesson time is already occupied';
    elsif v_source_is_protected or v_target_is_occupied then
      v_excluded_target := (v_target at time zone v_new_series.timezone)::date;
      update public.lesson_series
      set exclusions = case
        when v_excluded_target = any(exclusions) then exclusions
        else array_append(exclusions, v_excluded_target)
      end
      where id = v_new_series.id
      returning * into v_new_series;
    elsif v_source_found then
      update public.lessons
      set series_id = v_new_series.id,
          occurrence_key = v_target,
          starts_at = v_target
      where id = v_source_lesson.id;
      v_reused_ids := array_append(v_reused_ids, v_source_lesson.id);
      if v_source_lesson.id = v_lesson.id and v_target = p_next_starts_at then
        v_selected_seen := true;
      end if;
    else
      insert into public.lessons (
        owner_id, student_id, series_id, occurrence_key, starts_at, duration_minutes, rate_cents
      ) values (
        v_owner, v_old_series.student_id, v_new_series.id, v_target, v_target,
        v_student.default_duration_minutes, v_student.default_rate_cents
      );
    end if;
    v_previous_source := v_source_key;
    v_previous_target := v_target;
  end loop;

  if not v_selected_seen then
    raise exception 'replacement does not include the selected lesson at its new time';
  end if;
  if v_first_target is distinct from p_materialize_from then
    raise exception 'invalid replacement start';
  end if;

  update public.lessons
  set deleted_at = v_now
  where owner_id = v_owner
    and series_id = v_old_series.id
    and starts_at >= v_now
    and (
      p_scope = 'all_future'
      or coalesce(occurrence_key, starts_at) >= p_cutoff
    )
    and status = 'scheduled'::public.lesson_status
    and invoiced_at is null
    and not (id = any(v_reused_ids));

  update public.lesson_series
  set active = false,
      schedule_revision = schedule_revision + 1,
      updated_at = v_now
  where id = v_old_series.id;

  return v_new_series.id;
end;
$$;

revoke all on function public.materialize_lesson_series(uuid, integer, jsonb) from public, anon;
revoke all on function public.reschedule_lesson_series(uuid, text, timestamptz, timestamptz, timestamptz, timestamp, text, text, smallint[], smallint, date, date[], jsonb) from public, anon;
grant execute on function public.materialize_lesson_series(uuid, integer, jsonb) to authenticated;
grant execute on function public.reschedule_lesson_series(uuid, text, timestamptz, timestamptz, timestamptz, timestamp, text, text, smallint[], smallint, date, date[], jsonb) to authenticated;
