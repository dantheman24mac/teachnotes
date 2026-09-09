insert into auth.users (id, email) values
  ('33333333-3333-4333-8333-333333333333', 'recurrence-owner@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'recurrence-other@example.test');

update public.accounts
set status = 'approved', reviewed_at = now()
where user_id in (
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
);

insert into public.students (
  id, owner_id, display_name, default_duration_minutes, default_rate_cents
) values (
  '33333333-3333-4333-8333-333333333301',
  '33333333-3333-4333-8333-333333333333',
  'Recurring student',
  45,
  42000
);

insert into public.lesson_series (
  id, owner_id, student_id, starts_at_local, timezone, frequency, weekdays, until, exclusions
) values (
  '33333333-3333-4333-8333-333333333310',
  '33333333-3333-4333-8333-333333333333',
  '33333333-3333-4333-8333-333333333301',
  '2030-01-07 10:00:00',
  'Africa/Johannesburg',
  'weekly',
  '{1}',
  '2030-03-31',
  '{2030-02-04}'
);

insert into public.lessons (
  id, owner_id, student_id, series_id, occurrence_key, starts_at,
  duration_minutes, rate_cents, status, notes, invoiced_at
) values
  (
    '33333333-3333-4333-8333-333333333311',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333310',
    '2030-01-07 08:00:00+00',
    '2030-01-07 08:00:00+00',
    45, 42000, 'scheduled', 'one-only id', null
  ),
  (
    '33333333-3333-4333-8333-333333333312',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333310',
    '2030-01-14 08:00:00+00',
    '2030-01-14 08:00:00+00',
    45, 42000, 'scheduled', 'selected note', null
  ),
  (
    '33333333-3333-4333-8333-333333333313',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333310',
    '2030-01-21 08:00:00+00',
    clock_timestamp() - interval '1 day',
    45, 42000, 'scheduled', 'past note', null
  ),
  (
    '33333333-3333-4333-8333-333333333314',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333310',
    '2030-01-28 08:00:00+00',
    '2030-01-28 08:00:00+00',
    45, 42000, 'attended', 'completed note', null
  ),
  (
    '33333333-3333-4333-8333-333333333315',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333310',
    '2030-02-11 08:00:00+00',
    '2030-02-11 08:00:00+00',
    45, 42000, 'scheduled', 'invoiced note', '2030-02-12 00:00:00+00'
  ),
  (
    '33333333-3333-4333-8333-333333333316',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333310',
    '2030-02-18 08:00:00+00',
    '2030-02-20 08:00:00+00',
    45, 42000, 'scheduled', 'future exception note', null
  ),
  (
    '33333333-3333-4333-8333-333333333317',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333310',
    '2030-02-25 08:00:00+00',
    '2030-02-25 08:00:00+00',
    45, 42000, 'scheduled', 'normal future note', null
  ),
  (
    '33333333-3333-4333-8333-333333333318',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333310',
    '2030-03-04 08:00:00+00',
    '2030-03-04 08:00:00+00',
    45, 42000, 'scheduled', 'old tail', null
  );

set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);

select public.reschedule_lesson_series(
  p_lesson_id => '33333333-3333-4333-8333-333333333311',
  p_scope => 'one',
  p_next_starts_at => '2030-01-09 08:00:00+00'
);

do $$
begin
  if not exists (
    select 1 from public.lessons
    where id = '33333333-3333-4333-8333-333333333311'
      and starts_at = '2030-01-09 08:00:00+00'
      and occurrence_key = '2030-01-07 08:00:00+00'
  ) then raise exception 'one-only reschedule lost the occurrence identity'; end if;
  if not exists (
    select 1 from public.lesson_series
    where id = '33333333-3333-4333-8333-333333333310' and active
  ) then raise exception 'one-only reschedule retired the series'; end if;
end;
$$;

do $$
declare before_start timestamptz;
begin
  select starts_at into before_start
  from public.lessons where id = '33333333-3333-4333-8333-333333333313';
  begin
    perform public.reschedule_lesson_series(
      '33333333-3333-4333-8333-333333333313',
      'one',
      '2030-01-20 08:00:00+00'
    );
    raise exception 'past lesson was rescheduled';
  exception when others then
    if sqlerrm = 'past lesson was rescheduled' then raise; end if;
  end;
  if (select starts_at from public.lessons where id = '33333333-3333-4333-8333-333333333313') <> before_start then
    raise exception 'rejected past reschedule changed the lesson';
  end if;
end;
$$;

do $$
declare
  before_count integer;
begin
  select count(*) into before_count from public.lesson_series;
  begin
    perform public.reschedule_lesson_series(
      p_lesson_id => '33333333-3333-4333-8333-333333333312',
      p_scope => 'following',
      p_next_starts_at => '2030-01-13 08:00:00+00',
      p_materialize_from => '2030-01-13 08:00:00+00',
      p_new_starts_at_local => '2030-01-06 10:00:00',
      p_new_timezone => 'Africa/Johannesburg',
      p_new_frequency => 'weekly',
      p_new_weekdays => '{0}',
      p_new_week_starts_on => 0::smallint,
      p_new_until => '2030-03-31',
      p_new_exclusions => '{2030-02-04}',
      p_occurrences => '[]'
    );
    raise exception 'empty replacement payload was accepted';
  exception when others then
    if sqlerrm = 'empty replacement payload was accepted' then raise; end if;
  end;
  if (select count(*) from public.lesson_series) <> before_count
    or not (select active from public.lesson_series where id = '33333333-3333-4333-8333-333333333310') then
    raise exception 'invalid replacement did not roll back';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
do $$
begin
  begin
    perform public.reschedule_lesson_series(
      '33333333-3333-4333-8333-333333333312',
      'one',
      '2030-01-13 08:00:00+00'
    );
    raise exception 'another owner rescheduled the lesson';
  exception when others then
    if sqlerrm = 'another owner rescheduled the lesson' then raise; end if;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);

select public.reschedule_lesson_series(
  p_lesson_id => '33333333-3333-4333-8333-333333333312',
  p_scope => 'following',
  p_next_starts_at => '2030-01-13 08:00:00+00',
  p_materialize_from => '2030-01-13 08:00:00+00',
  p_new_starts_at_local => '2030-01-06 10:00:00',
  p_new_timezone => 'Africa/Johannesburg',
  p_new_frequency => 'weekly',
  p_new_weekdays => '{0}',
  p_new_week_starts_on => 0::smallint,
  p_new_until => '2030-03-31',
  p_new_exclusions => '{2030-02-04}',
  p_occurrences => '[
    {"sourceKey":"2030-01-14T08:00:00Z","startsAt":"2030-01-13T08:00:00Z"},
    {"sourceKey":"2030-01-21T08:00:00Z","startsAt":"2030-01-20T08:00:00Z"},
    {"sourceKey":"2030-01-28T08:00:00Z","startsAt":"2030-01-27T08:00:00Z"},
    {"sourceKey":"2030-02-04T08:00:00Z","startsAt":"2030-02-03T08:00:00Z"},
    {"sourceKey":"2030-02-11T08:00:00Z","startsAt":"2030-02-10T08:00:00Z"},
    {"sourceKey":"2030-02-18T08:00:00Z","startsAt":"2030-02-17T08:00:00Z"},
    {"sourceKey":"2030-02-25T08:00:00Z","startsAt":"2030-02-24T08:00:00Z"}
  ]'
);

do $$
declare
  replacement_id uuid;
  replacement public.lesson_series%rowtype;
begin
  select id into replacement_id
  from public.lesson_series
  where id <> '33333333-3333-4333-8333-333333333310' and student_id = '33333333-3333-4333-8333-333333333301';
  select * into replacement from public.lesson_series where id = replacement_id;

  if (select active from public.lesson_series where id = '33333333-3333-4333-8333-333333333310')
    or (select schedule_revision from public.lesson_series where id = '33333333-3333-4333-8333-333333333310') <> 2 then
    raise exception 'old recurrence was not retired';
  end if;
  if replacement.starts_at_local <> '2030-01-06 10:00:00'
    or replacement.weekdays <> '{0}'
    or replacement.week_starts_on <> 0
    or replacement.until <> '2030-03-31'
    or not replacement.active then
    raise exception 'replacement recurrence is wrong: %', to_jsonb(replacement);
  end if;
  if not replacement.exclusions @> array[
    '2030-02-04', '2030-01-20', '2030-01-27', '2030-02-10'
  ]::date[] then raise exception 'protected dates were not excluded: %', replacement.exclusions; end if;

  if not exists (
    select 1 from public.lessons
    where id = '33333333-3333-4333-8333-333333333312'
      and series_id = replacement_id
      and starts_at = '2030-01-13 08:00:00+00'
      and notes = 'selected note'
  ) then raise exception 'selected lesson did not move with its id and note'; end if;
  if not exists (
    select 1 from public.lessons
    where id = '33333333-3333-4333-8333-333333333316'
      and series_id = replacement_id
      and starts_at = '2030-02-17 08:00:00+00'
      and notes = 'future exception note'
  ) then raise exception 'future one-off lesson was not folded into the replacement'; end if;
  if not exists (
    select 1 from public.lessons
    where id = '33333333-3333-4333-8333-333333333317'
      and series_id = replacement_id
      and starts_at = '2030-02-24 08:00:00+00'
  ) then raise exception 'ordinary future lesson did not move'; end if;
  if not exists (
    select 1 from public.lessons
    where series_id = replacement_id and starts_at = '2030-02-03 08:00:00+00'
  ) then raise exception 'unchanged explicit exclusion dates corrupted source mapping'; end if;

  if exists (
    select 1 from public.lessons
    where id in (
      '33333333-3333-4333-8333-333333333313',
      '33333333-3333-4333-8333-333333333314',
      '33333333-3333-4333-8333-333333333315'
    ) and (deleted_at is not null or notes = '')
  ) then raise exception 'past, completed, invoiced, or occupied lesson changed'; end if;
  if exists (
    select 1 from public.lessons
    where series_id = replacement_id
      and starts_at in (
        '2030-01-20 08:00:00+00',
        '2030-01-27 08:00:00+00',
        '2030-02-10 08:00:00+00'
      )
  ) then raise exception 'replacement duplicated a protected or occupied lesson'; end if;
  if not exists (
    select 1 from public.lessons
    where id = '33333333-3333-4333-8333-333333333318'
      and series_id = replacement_id
      and starts_at = '2030-03-03 08:00:00+00'
      and notes = 'old tail'
  ) then raise exception 'existing occurrence omitted by the client lost its id or note'; end if;
end;
$$;

do $$
begin
  begin
    perform public.materialize_lesson_series(
      '33333333-3333-4333-8333-333333333310',
      1,
      '["2030-03-18T08:00:00Z"]'
    );
    raise exception 'stale materialization revived the retired recurrence';
  exception when others then
    if sqlerrm = 'stale materialization revived the retired recurrence' then raise; end if;
  end;
end;
$$;

-- A previously one-off moved lesson still anchors following changes to its original occurrence key.
insert into public.lesson_series (
  id, owner_id, student_id, starts_at_local, timezone, frequency, weekdays
) values (
  '33333333-3333-4333-8333-333333333330',
  '33333333-3333-4333-8333-333333333333',
  '33333333-3333-4333-8333-333333333301',
  '2020-01-06 10:00:00',
  'Africa/Johannesburg',
  'weekly',
  '{1}'
);
insert into public.lessons (
  id, owner_id, student_id, series_id, occurrence_key, starts_at,
  duration_minutes, rate_cents, notes
) values (
  '33333333-3333-4333-8333-333333333331',
  '33333333-3333-4333-8333-333333333333',
  '33333333-3333-4333-8333-333333333301',
  '33333333-3333-4333-8333-333333333330',
  '2020-01-06 08:00:00+00',
  '2030-01-14 08:00:00+00',
  45, 42000, 'moved years later'
);

select public.reschedule_lesson_series(
  p_lesson_id => '33333333-3333-4333-8333-333333333331',
  p_scope => 'following',
  p_next_starts_at => '2030-01-15 08:00:00+00',
  p_materialize_from => '2030-01-15 08:00:00+00',
  p_new_starts_at_local => '2030-01-15 10:00:00',
  p_new_timezone => 'Africa/Johannesburg',
  p_new_frequency => 'weekly',
  p_new_weekdays => '{2}',
  p_new_week_starts_on => 2::smallint,
  p_new_until => null,
  p_new_exclusions => '{}',
  p_occurrences => '[{"sourceKey":"2020-01-06T08:00:00Z","startsAt":"2030-01-15T08:00:00Z"}]'
);

do $$
begin
  if not exists (
    select 1 from public.lessons lesson
    join public.lesson_series series on series.id = lesson.series_id
    where lesson.id = '33333333-3333-4333-8333-333333333331'
      and lesson.starts_at = '2030-01-15 08:00:00+00'
      and lesson.occurrence_key = '2030-01-15 08:00:00+00'
      and series.starts_at_local = '2030-01-15 10:00:00'
      and series.weekdays = '{2}'
  ) then raise exception 'one-off source did not use its original recurrence anchor'; end if;
end;
$$;

-- All-future moves include lessons before the selected occurrence and retire the old series.
insert into public.lesson_series (
  id, owner_id, student_id, starts_at_local, timezone, frequency, weekdays
) values (
  '33333333-3333-4333-8333-333333333340',
  '33333333-3333-4333-8333-333333333333',
  '33333333-3333-4333-8333-333333333301',
  '2031-01-06 10:00:00',
  'Africa/Johannesburg',
  'weekly',
  '{1}'
);
insert into public.lessons (
  id, owner_id, student_id, series_id, occurrence_key, starts_at, duration_minutes, rate_cents
) values
  (
    '33333333-3333-4333-8333-333333333341',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333340',
    '2031-01-06 08:00:00+00', '2031-01-06 08:00:00+00', 45, 42000
  ),
  (
    '33333333-3333-4333-8333-333333333342',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333340',
    '2031-01-13 08:00:00+00', '2031-01-13 08:00:00+00', 45, 42000
  ),
  (
    '33333333-3333-4333-8333-333333333343',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333340',
    '2033-01-03 08:00:00+00', '2033-01-03 08:00:00+00', 45, 42000
  );

select public.reschedule_lesson_series(
  p_lesson_id => '33333333-3333-4333-8333-333333333342',
  p_scope => 'all_future',
  p_next_starts_at => '2031-01-13 10:00:00+00',
  p_cutoff => clock_timestamp(),
  p_materialize_from => '2031-01-06 10:00:00+00',
  p_new_starts_at_local => '2031-01-06 12:00:00',
  p_new_timezone => 'Africa/Johannesburg',
  p_new_frequency => 'weekly',
  p_new_weekdays => '{1}',
  p_new_week_starts_on => 1::smallint,
  p_new_until => null,
  p_new_exclusions => '{}',
  p_occurrences => '[
    {"sourceKey":"2031-01-06T08:00:00Z","startsAt":"2031-01-06T10:00:00Z"},
    {"sourceKey":"2031-01-13T08:00:00Z","startsAt":"2031-01-13T10:00:00Z"}
  ]'
);

do $$
begin
  if (select active from public.lesson_series where id = '33333333-3333-4333-8333-333333333340') then
    raise exception 'all-future left the old recurrence active';
  end if;
  if (select count(distinct series_id) from public.lessons where id in (
    '33333333-3333-4333-8333-333333333341',
    '33333333-3333-4333-8333-333333333342'
  )) <> 1 then raise exception 'all-future did not move the whole future schedule'; end if;
  if not exists (
    select 1 from public.lessons
    where id = '33333333-3333-4333-8333-333333333342'
      and starts_at = '2031-01-13 10:00:00+00'
  ) then raise exception 'all-future selected lesson missed its requested time'; end if;
  if not exists (
    select 1 from public.lessons
    where id = '33333333-3333-4333-8333-333333333343'
      and starts_at = '2033-01-03 10:00:00+00'
      and deleted_at is null
  ) then raise exception 'far future lesson omitted by the client lost its id'; end if;
end;
$$;

-- Moving into the next occurrence's current slot succeeds because that row moves too.
insert into public.lesson_series (
  id, owner_id, student_id, starts_at_local, timezone, frequency, weekdays
) values (
  '33333333-3333-4333-8333-333333333350',
  '33333333-3333-4333-8333-333333333333',
  '33333333-3333-4333-8333-333333333301',
  '2034-01-02 10:00:00',
  'Africa/Johannesburg',
  'weekly',
  '{1}'
);
insert into public.lessons (
  id, owner_id, student_id, series_id, occurrence_key, starts_at, duration_minutes, rate_cents, notes
) values
  (
    '33333333-3333-4333-8333-333333333351',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333350',
    '2034-01-02 08:00:00+00', '2034-01-02 08:00:00+00', 45, 42000, 'first'
  ),
  (
    '33333333-3333-4333-8333-333333333352',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333350',
    '2034-01-09 08:00:00+00', '2034-01-09 08:00:00+00', 45, 42000, 'second'
  ),
  (
    '33333333-3333-4333-8333-333333333353',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333350',
    '2034-01-16 08:00:00+00', '2034-01-16 08:00:00+00', 45, 42000, 'third'
  );

insert into public.lessons (
  id, owner_id, student_id, starts_at, duration_minutes, rate_cents, status, notes
) values (
  '33333333-3333-4333-8333-333333333354',
  '33333333-3333-4333-8333-333333333333',
  '33333333-3333-4333-8333-333333333301',
  '2034-01-16 08:00:00+00',
  45, 42000, 'scheduled', 'external collision'
);

do $$
begin
  begin
    perform public.reschedule_lesson_series(
      p_lesson_id => '33333333-3333-4333-8333-333333333351',
      p_scope => 'following',
      p_next_starts_at => '2034-01-09 08:00:00+00',
      p_materialize_from => '2034-01-09 08:00:00+00',
      p_new_starts_at_local => '2034-01-09 10:00:00',
      p_new_timezone => 'Africa/Johannesburg',
      p_new_frequency => 'weekly',
      p_new_weekdays => '{1}',
      p_new_week_starts_on => 1::smallint,
      p_new_until => null,
      p_new_exclusions => '{}',
      p_occurrences => '[
        {"sourceKey":"2034-01-02T08:00:00Z","startsAt":"2034-01-09T08:00:00Z"},
        {"sourceKey":"2034-01-09T08:00:00Z","startsAt":"2034-01-16T08:00:00Z"},
        {"sourceKey":"2034-01-16T08:00:00Z","startsAt":"2034-01-23T08:00:00Z"}
      ]'
    );
    raise exception 'external collision was accepted';
  exception when others then
    if sqlerrm = 'external collision was accepted' then raise; end if;
  end;
  if not (select active from public.lesson_series where id = '33333333-3333-4333-8333-333333333350')
    or (select count(*) from public.lessons where series_id = '33333333-3333-4333-8333-333333333350' and deleted_at is null) <> 3 then
    raise exception 'collision rejection did not roll back';
  end if;
  if (select array_agg(starts_at order by id) from public.lessons where id in (
    '33333333-3333-4333-8333-333333333351',
    '33333333-3333-4333-8333-333333333352',
    '33333333-3333-4333-8333-333333333353'
  )) <> array[
    '2034-01-02 08:00:00+00',
    '2034-01-09 08:00:00+00',
    '2034-01-16 08:00:00+00'
  ]::timestamptz[]
    or (select array_agg(notes order by id) from public.lessons where id in (
      '33333333-3333-4333-8333-333333333351',
      '33333333-3333-4333-8333-333333333352',
      '33333333-3333-4333-8333-333333333353'
    )) <> array['first', 'second', 'third'] then
    raise exception 'collision rejection changed source lessons';
  end if;
end;
$$;

update public.lessons
set deleted_at = clock_timestamp()
where id = '33333333-3333-4333-8333-333333333354';

select public.reschedule_lesson_series(
  p_lesson_id => '33333333-3333-4333-8333-333333333351',
  p_scope => 'following',
  p_next_starts_at => '2034-01-09 08:00:00+00',
  p_materialize_from => '2034-01-09 08:00:00+00',
  p_new_starts_at_local => '2034-01-09 10:00:00',
  p_new_timezone => 'Africa/Johannesburg',
  p_new_frequency => 'weekly',
  p_new_weekdays => '{1}',
  p_new_week_starts_on => 1::smallint,
  p_new_until => null,
  p_new_exclusions => '{}',
  p_occurrences => '[
    {"sourceKey":"2034-01-02T08:00:00Z","startsAt":"2034-01-09T08:00:00Z"},
    {"sourceKey":"2034-01-09T08:00:00Z","startsAt":"2034-01-16T08:00:00Z"},
    {"sourceKey":"2034-01-16T08:00:00Z","startsAt":"2034-01-23T08:00:00Z"}
  ]'
);

do $$
begin
  if (select count(distinct series_id) from public.lessons where id in (
    '33333333-3333-4333-8333-333333333351',
    '33333333-3333-4333-8333-333333333352',
    '33333333-3333-4333-8333-333333333353'
  )) <> 1 then raise exception 'overlapping shift split the recurrence'; end if;
  if (select array_agg(starts_at order by starts_at) from public.lessons where id in (
    '33333333-3333-4333-8333-333333333351',
    '33333333-3333-4333-8333-333333333352',
    '33333333-3333-4333-8333-333333333353'
  )) <> array[
    '2034-01-09 08:00:00+00',
    '2034-01-16 08:00:00+00',
    '2034-01-23 08:00:00+00'
  ]::timestamptz[] then raise exception 'overlapping shift produced wrong dates'; end if;
end;
$$;

reset role;
