insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner-one@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'owner-two@example.test');
update public.accounts set status = 'approved', reviewed_at = now();

insert into public.students (id, owner_id, display_name) values
  ('11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', 'Owner one student'),
  ('22222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222222', 'Owner two student');
insert into public.lessons (id, owner_id, student_id, starts_at, duration_minutes, rate_cents) values
  ('11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', now(), 60, 50000),
  ('11111111-1111-4111-8111-111111111103', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101', now(), 60, 50000),
  ('22222222-2222-4222-8222-222222222203', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222202', now(), 60, 50000);

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

select public.apply_lesson_operation(
  '10000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"status":"attended"}',
  clock_timestamp() + interval '1 minute'
);
select public.apply_lesson_operation(
  '10000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"notes":"Consecutive note"}',
  clock_timestamp() + interval '2 minutes'
);

do $$
declare value public.lessons%rowtype;
begin
  select * into value from public.lessons where id = '11111111-1111-4111-8111-111111111102';
  if value.status <> 'attended' or value.notes <> 'Consecutive note' or value.version <> 3 then
    raise exception 'consecutive field saves did not merge: %', to_jsonb(value);
  end if;
end;
$$;

select public.apply_lesson_operation(
  '20000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"notes":"Newest note"}',
  clock_timestamp() + interval '4 minutes'
);
select public.apply_lesson_operation(
  '20000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"notes":"Older late arrival","billing_override":"billable"}',
  clock_timestamp() + interval '3 minutes'
);

do $$
declare value public.lessons%rowtype;
begin
  select * into value from public.lessons where id = '11111111-1111-4111-8111-111111111102';
  if value.notes <> 'Newest note' or value.billing_override <> 'billable' then
    raise exception 'per-field latest save failed: %', to_jsonb(value);
  end if;
end;
$$;

select public.apply_lesson_operation(
  '30000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"notes":"Equal timestamp winner"}',
  '2099-01-01 00:00:00+00'
);
select public.apply_lesson_operation(
  '30000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"notes":"Equal timestamp loser"}',
  '2099-01-01 00:00:00+00'
);
select public.apply_lesson_operation(
  '30000000-0000-4000-8000-000000000004',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"notes":"Greatest equal timestamp UUID"}',
  '2099-01-01 00:00:00+00'
);

do $$
declare
  value public.lessons%rowtype;
  before_version integer;
  after_version integer;
begin
  select * into value from public.lessons where id = '11111111-1111-4111-8111-111111111102';
  if value.notes <> 'Greatest equal timestamp UUID' then raise exception 'equal timestamp tie was not deterministic'; end if;
  if value.notes_saved_at <> '2099-01-01 00:00:00+00' or value.notes_saved_by <> '30000000-0000-4000-8000-000000000004' then
    raise exception 'equal timestamp winner clock was replaced by the direct-update trigger: %', to_jsonb(value);
  end if;
  before_version := value.version;
  perform public.apply_lesson_operation(
    '30000000-0000-4000-8000-000000000002',
    value.id,
    1,
    '{"notes":"must not run twice"}',
    '2099-01-01 00:00:00+00'
  );
  select version into after_version from public.lessons where id = value.id;
  if after_version <> before_version then raise exception 'duplicate operation changed lesson version'; end if;
  if (select count(*) from public.sync_operations where id = '30000000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'duplicate operation was not deduplicated';
  end if;
end;
$$;

select public.apply_lesson_operation(
  '30000000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"notes":"Later than the tie"}',
  '2100-01-01 00:00:00+00'
);
do $$
begin
  if (select notes from public.lessons where id = '11111111-1111-4111-8111-111111111102') <> 'Later than the tie' then
    raise exception 'a later client save did not beat the equal-timestamp winner';
  end if;
end;
$$;

do $$
declare retry_result jsonb;
begin
  retry_result := public.apply_lesson_operation(
    '30000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111102',
    1,
    '{"notes":"must not run twice"}',
    '2099-01-01 00:00:00+00'
  );
  if retry_result #>> '{lesson,notes}' <> 'Later than the tie' then
    raise exception 'idempotent retry returned a historical lesson snapshot: %', retry_result;
  end if;
end;
$$;

select public.apply_lesson_operation(
  '31000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"status":"attended"}',
  '2101-01-01 00:00:00+00'
);
select public.apply_lesson_operation(
  '31000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"status":"no_show"}',
  '2101-01-01 00:00:00+00'
);
select public.apply_lesson_operation(
  '31000000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"status":"canceled_rescheduled"}',
  '2101-01-01 00:00:00+00'
);

select public.apply_lesson_operation(
  '32000000-0000-4000-8000-000000000006',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"billing_override":"billable"}',
  '2102-01-01 00:00:00+00'
);
select public.apply_lesson_operation(
  '32000000-0000-4000-8000-000000000005',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"billing_override":"non_billable"}',
  '2102-01-01 00:00:00+00'
);
select public.apply_lesson_operation(
  '32000000-0000-4000-8000-000000000004',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"billing_override":"default"}',
  '2102-01-01 00:00:00+00'
);

do $$
declare value public.lessons%rowtype;
begin
  select * into value from public.lessons where id = '11111111-1111-4111-8111-111111111102';
  if value.status <> 'canceled_rescheduled' or value.status_saved_by <> '31000000-0000-4000-8000-000000000003' then
    raise exception 'ascending equal-time operations did not choose the greatest UUID: %', to_jsonb(value);
  end if;
  if value.billing_override <> 'billable' or value.billing_override_saved_by <> '32000000-0000-4000-8000-000000000006' then
    raise exception 'reverse equal-time operations did not keep the greatest UUID: %', to_jsonb(value);
  end if;
end;
$$;

select public.apply_lesson_operation(
  '33000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"status":"attended","billing_override":"non_billable"}',
  '2103-01-01 00:00:00+00'
);
do $$
begin
  if (select (status, billing_override) from public.lessons where id = '11111111-1111-4111-8111-111111111102')
    <> row('attended'::public.lesson_status, 'non_billable'::public.billing_override) then
    raise exception 'later client timestamp did not beat equal-time winners';
  end if;
end;
$$;

update public.lessons
set status = 'scheduled', status_saved_at = clock_timestamp(), status_saved_by = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
where id = '11111111-1111-4111-8111-111111111102';
select public.apply_lesson_operation(
  '40000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111102',
  1,
  '{"status":"no_show"}',
  clock_timestamp() - interval '1 minute'
);

do $$
begin
  if (select status from public.lessons where id = '11111111-1111-4111-8111-111111111102') <> 'scheduled' then
    raise exception 'older offline attendance overwrote a scheduling action';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
do $$
begin
  begin
    perform public.apply_lesson_operation(
      '50000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111102',
      1,
      '{"notes":"cross-account write"}',
      clock_timestamp() + interval '1 day'
    );
    raise exception 'cross-account sync unexpectedly succeeded';
  exception
    when others then
      if sqlerrm = 'cross-account sync unexpectedly succeeded' then raise; end if;
  end;
  if exists (select 1 from public.sync_operations where id = '50000000-0000-4000-8000-000000000001') then
    raise exception 'cross-account operation was recorded';
  end if;
end;
$$;

reset role;
do $$
begin
  if to_regprocedure('public.apply_lesson_operation(uuid,uuid,integer,jsonb)') is null then
    raise exception 'legacy four-argument sync RPC is missing';
  end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.apply_lesson_operation(
  '60000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111103',
  1,
  '{"billing_override":"non_billable"}'
);
do $$
begin
  if (select billing_override from public.lessons where id = '11111111-1111-4111-8111-111111111103') <> 'non_billable' then
    raise exception 'legacy RPC rejected a stale base version';
  end if;
end;
$$;
reset role;
