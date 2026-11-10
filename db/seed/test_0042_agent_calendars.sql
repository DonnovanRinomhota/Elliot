-- Scenario test for 0042 (agent calendars). Scratch database only; rolls
-- back. Ends with "0042 checks passed".
begin;

insert into tenants (id, name, slug, timezone, assistant_mode) values
  ('99999999-0000-0000-0000-000000000421', 'Agency A', 'a-421', 'Europe/Warsaw', 'agency');
insert into ai_config (tenant_id, google_calendar_id) values ('99999999-0000-0000-0000-000000000421', 'office@a.pl')
on conflict (tenant_id) do update set google_calendar_id = excluded.google_calendar_id;
insert into tenant_users (id, tenant_id, auth_user_id, email, role, full_name, receives_leads) values
  ('99999999-5555-0000-0000-000000000421', '99999999-0000-0000-0000-000000000421', 'aaaaaaaa-0000-0000-0000-000000000421', 'boss@a.pl', 'admin', 'Boss', true),
  ('99999999-5555-0000-0000-000000000422', '99999999-0000-0000-0000-000000000421', 'aaaaaaaa-0000-0000-0000-000000000422', 'ola@a.pl', 'agent', 'Ola', true),
  ('99999999-5555-0000-0000-000000000423', '99999999-0000-0000-0000-000000000421', 'aaaaaaaa-0000-0000-0000-000000000423', 'jan@a.pl', 'agent', 'Jan', true);
insert into contacts (id, tenant_id, name, email) values
  ('99999999-1111-0000-0000-000000000421', '99999999-0000-0000-0000-000000000421', 'Anna', 'anna@x.pl'),
  ('99999999-1111-0000-0000-000000000422', '99999999-0000-0000-0000-000000000421', 'Piotr', 'piotr@x.pl');
insert into leads (tenant_id, contact_id, assigned_to) values
  ('99999999-0000-0000-0000-000000000421', '99999999-1111-0000-0000-000000000421', '99999999-5555-0000-0000-000000000423');

do $$
declare n int; r record; s timestamptz := date_trunc('hour', now()) + interval '2 days 10 hours'; e timestamptz;
begin
  e := s + interval '1 hour';

  -- 1. No agent calendars: the agency calendar, as before; the owner is the agent.
  select count(*) into n from availability_calendars('99999999-0000-0000-0000-000000000421');
  if n <> 1 then raise exception '1: % calendars', n; end if;
  select * into r from booking_candidates('99999999-0000-0000-0000-000000000421', '99999999-1111-0000-0000-000000000421', s, e);
  if r.calendar_id <> 'office@a.pl' or r.mode <> 'agency' or r.agent_id <> '99999999-5555-0000-0000-000000000423' or r.is_owner then
    raise exception '1: %', row_to_json(r); end if;

  -- 2. Two agents add calendars: those are used instead; Jan is Anna's agent.
  update tenant_users set google_calendar_id = 'ola@a.pl' where id = '99999999-5555-0000-0000-000000000422';
  update tenant_users set google_calendar_id = 'jan@a.pl', calendar_status = 'ok' where id = '99999999-5555-0000-0000-000000000423';
  select count(*) into n from availability_calendars('99999999-0000-0000-0000-000000000421') where mode = 'agents';
  if n <> 2 then raise exception '2: % agent calendars', n; end if;
  select count(*) into n from booking_candidates('99999999-0000-0000-0000-000000000421', '99999999-1111-0000-0000-000000000421', s, e)
   where is_owner and calendar_id = 'jan@a.pl' and agent_name = 'Jan';
  if n <> 1 then raise exception '2: owner'; end if;

  -- 3. Two viewings at the same time in different agents' calendars: fine. Same calendar: refused.
  insert into appointments (tenant_id, contact_id, starts_at, ends_at, status, booked_calendar_id, agent_id, timezone) values
    ('99999999-0000-0000-0000-000000000421', '99999999-1111-0000-0000-000000000421', s, e, 'confirmed', 'jan@a.pl', '99999999-5555-0000-0000-000000000423', 'Europe/Warsaw'),
    ('99999999-0000-0000-0000-000000000421', '99999999-1111-0000-0000-000000000422', s, e, 'confirmed', 'ola@a.pl', '99999999-5555-0000-0000-000000000422', 'Europe/Warsaw');
  begin
    insert into appointments (tenant_id, contact_id, starts_at, ends_at, status, booked_calendar_id, timezone) values
      ('99999999-0000-0000-0000-000000000421', '99999999-1111-0000-0000-000000000422', s + interval '30 minutes', e, 'confirmed', 'ola@a.pl', 'Europe/Warsaw');
    raise exception '3: double booking in one calendar';
  exception when exclusion_violation then null;
  end;

  -- 4. The dashboard's own bookings show up as busy.
  select count(*) into n from booking_candidates('99999999-0000-0000-0000-000000000421', '99999999-1111-0000-0000-000000000421', s, e) where db_busy;
  if n <> 2 then raise exception '4: % busy', n; end if;
  select count(*) into n from booking_candidates('99999999-0000-0000-0000-000000000421', '99999999-1111-0000-0000-000000000421', e, e + interval '1 hour') where db_busy;
  if n <> 0 then raise exception '4b'; end if;
  select upcoming into n from booking_candidates('99999999-0000-0000-0000-000000000421', null, s, e) where calendar_id = 'ola@a.pl';
  if n <> 1 then raise exception '4c: upcoming %', n; end if;

  -- 5. A calendar found unshared or read-only is left out; someone not getting leads too.
  update tenant_users set calendar_status = 'not_shared' where id = '99999999-5555-0000-0000-000000000422';
  select count(*) into n from availability_calendars('99999999-0000-0000-0000-000000000421');
  if n <> 1 then raise exception '5: %', n; end if;
  update tenant_users set receives_leads = false where id = '99999999-5555-0000-0000-000000000423';
  select count(*) into n from availability_calendars('99999999-0000-0000-0000-000000000421') where calendar_id = 'office@a.pl';
  if n <> 1 then raise exception '5b: back to the agency calendar'; end if;
  update tenant_users set receives_leads = true where id = '99999999-5555-0000-0000-000000000423';

  -- 6. Changing a calendar clears its status.
  update tenant_users set google_calendar_id = 'ola2@a.pl' where id = '99999999-5555-0000-0000-000000000422';
  select count(*) into n from tenant_users where id = '99999999-5555-0000-0000-000000000422' and calendar_status is null;
  if n <> 1 then raise exception '6'; end if;

  -- 7. Workflow 41: what to check, and saving the results + Elliot's account.
  select jsonb_array_length(calendars_to_check('99999999-0000-0000-0000-000000000421')) into n;
  if n <> 3 then raise exception '7: % to check', n; end if;
  perform record_calendar_checks('99999999-0000-0000-0000-000000000421', jsonb_build_array(
    jsonb_build_object('kind', 'agent', 'member_id', '99999999-5555-0000-0000-000000000422', 'calendar_id', 'ola2@a.pl', 'status', 'read_only', 'role', 'reader', 'error', ''),
    jsonb_build_object('kind', 'agency', 'calendar_id', 'office@a.pl', 'status', 'ok')), ' Elliot.Calendar@Gmail.com ');
  select count(*) into n from tenant_users where id = '99999999-5555-0000-0000-000000000422' and calendar_status = 'read_only' and calendar_role = 'reader' and calendar_checked_at is not null;
  if n <> 1 then raise exception '7: agent status'; end if;
  select count(*) into n from ai_config where tenant_id = '99999999-0000-0000-0000-000000000421' and calendar_status = 'ok';
  if n <> 1 then raise exception '7: agency status'; end if;
  if elliot_calendar_account() <> 'elliot.calendar@gmail.com' then raise exception '7: account %', elliot_calendar_account(); end if;

  -- 8. Moves and cancellations use the calendar the viewing is in.
  select google_calendar_id into r from client_appointment('99999999-0000-0000-0000-000000000421', '99999999-1111-0000-0000-000000000421',
    (select id from appointments where booked_calendar_id = 'jan@a.pl' limit 1));
  if r.google_calendar_id <> 'jan@a.pl' then raise exception '8: %', r.google_calendar_id; end if;

  raise notice '0042 checks passed';
end $$;

-- 9. An agent sets their own calendar; nonsense is refused; not someone else's.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000422', true),
       set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000422"}', true);
do $$
declare n int;
begin
  perform update_team_member('99999999-5555-0000-0000-000000000422', '{"google_calendar_id": " Ola@A.pl "}');
  select count(*) into n from tenant_users where id = '99999999-5555-0000-0000-000000000422' and google_calendar_id = 'ola@a.pl';
  if n <> 1 then raise exception '9: own calendar not saved'; end if;
  begin perform update_team_member('99999999-5555-0000-0000-000000000422', '{"google_calendar_id": "my calendar"}'); raise exception '9: nonsense saved';
  exception when raise_exception then if sqlerrm like '9:%' then raise; end if; end;
  begin perform update_team_member('99999999-5555-0000-0000-000000000423', '{"google_calendar_id": "x@a.pl"}'); raise exception '9: changed Jan''s';
  exception when raise_exception then if sqlerrm like '9:%' then raise; end if; end;
  perform update_team_member('99999999-5555-0000-0000-000000000422', '{"google_calendar_id": ""}');
  select count(*) into n from tenant_users where id = '99999999-5555-0000-0000-000000000422' and google_calendar_id is null;
  if n <> 1 then raise exception '9: clearing'; end if;
  raise notice '0042 team checks passed';
end $$;
rollback;
