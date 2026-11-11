-- Scenario test for 0038 (clients changing viewings, reminders). Scratch
-- database only; rolls back. Ends with "0038 checks passed".
begin;

insert into tenants (id, name, slug, timezone, assistant_mode) values
  ('99999999-0000-0000-0000-000000000381', 'Agency A', 'a-381', 'Europe/Warsaw', 'agency'),
  ('99999999-0000-0000-0000-000000000382', 'Agency B', 'b-382', 'Europe/Warsaw', 'agency'),
  ('99999999-0000-0000-0000-000000000383', 'Demo', 'demo-383', 'Europe/Warsaw', 'demo');
update tenants set status = 'cancelled' where assistant_mode = 'demo' and id <> '99999999-0000-0000-0000-000000000383';
insert into ai_config (tenant_id, google_calendar_id, whatsapp_phone_number_id) values
  ('99999999-0000-0000-0000-000000000381', 'cal-a', '111'),
  ('99999999-0000-0000-0000-000000000382', 'cal-b', null),
  ('99999999-0000-0000-0000-000000000383', 'cal-demo', null)
on conflict (tenant_id) do update set google_calendar_id = excluded.google_calendar_id, whatsapp_phone_number_id = excluded.whatsapp_phone_number_id;
insert into contacts (id, tenant_id, name, email, phone) values
  ('99999999-1111-0000-0000-000000000381', '99999999-0000-0000-0000-000000000381', 'Anna', 'anna@x.pl', '+48600'),
  ('99999999-1111-0000-0000-000000000382', '99999999-0000-0000-0000-000000000381', 'Bartek', 'bartek@x.pl', null),
  ('99999999-1111-0000-0000-000000000383', '99999999-0000-0000-0000-000000000383', 'Demo visitor', 'v@x.pl', null);
insert into conversations (id, tenant_id, contact_id, channel) values
  ('99999999-2222-0000-0000-000000000381', '99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000381', 'whatsapp');
insert into messages (tenant_id, conversation_id, role, content) values
  ('99999999-0000-0000-0000-000000000381', '99999999-2222-0000-0000-000000000381', 'user', 'Dzień dobry, szukam mieszkania');

-- tomorrow 10:00 and 12:00 Warsaw, and one in 3 days
insert into appointments (id, tenant_id, contact_id, starts_at, ends_at, timezone, external_calendar_id, conversation_id) values
  ('99999999-3333-0000-0000-000000000381', '99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000381',
   ((now() at time zone 'Europe/Warsaw')::date + 1 + time '10:00') at time zone 'Europe/Warsaw',
   ((now() at time zone 'Europe/Warsaw')::date + 1 + time '11:00') at time zone 'Europe/Warsaw', 'Europe/Warsaw', 'ev1', '99999999-2222-0000-0000-000000000381'),
  ('99999999-3333-0000-0000-000000000382', '99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000382',
   ((now() at time zone 'Europe/Warsaw')::date + 1 + time '12:00') at time zone 'Europe/Warsaw',
   ((now() at time zone 'Europe/Warsaw')::date + 1 + time '13:00') at time zone 'Europe/Warsaw', 'Europe/Warsaw', 'ev2', null),
  ('99999999-3333-0000-0000-000000000383', '99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000381',
   now() + interval '3 days', now() + interval '3 days 1 hour', 'Europe/Warsaw', 'ev3', null),
  ('99999999-3333-0000-0000-000000000384', '99999999-0000-0000-0000-000000000383', '99999999-1111-0000-0000-000000000383',
   ((now() at time zone 'Europe/Warsaw')::date + 1 + time '10:00') at time zone 'Europe/Warsaw',
   ((now() at time zone 'Europe/Warsaw')::date + 1 + time '11:00') at time zone 'Europe/Warsaw', 'Europe/Warsaw', 'ev4', null);

do $$
declare n int; r record; j jsonb; ok boolean;
begin
  -- 1. Elliot sees the ids of the client's viewings.
  j := identify_chat_visitor('99999999-0000-0000-0000-000000000381', '99999999-2222-0000-0000-000000000381', null, null, null, true); -- 0047: verified channel
  if jsonb_array_length(j->'upcoming_viewings') <> 2 or j->'upcoming_viewings'->0->>'appointment_id' <> '99999999-3333-0000-0000-000000000381'
     or (j->'upcoming_viewings'->0->>'client_confirmed')::boolean then
    raise exception '1: %', j; end if;

  -- 2. Only the client's own viewing is found.
  select count(*) into n from client_appointment('99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000381', '99999999-3333-0000-0000-000000000381');
  if n <> 1 then raise exception '2: own viewing not found'; end if;
  select count(*) into n from client_appointment('99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000381', '99999999-3333-0000-0000-000000000382');
  if n <> 0 then raise exception '2: someone else''s viewing found'; end if;
  select count(*) into n from client_appointment('99999999-0000-0000-0000-000000000382', '99999999-1111-0000-0000-000000000381', '99999999-3333-0000-0000-000000000381');
  if n <> 0 then raise exception '2: other agency'; end if;
  select * into r from client_appointment('99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000381', '99999999-3333-0000-0000-000000000381');
  if r.google_calendar_id <> 'cal-a' or r.external_calendar_id <> 'ev1' or r.contact_email <> 'anna@x.pl' or r.booking_notice_minutes <> 120 then
    raise exception '2: details %', row_to_json(r); end if;

  -- 3. Confirm: only own, sets once.
  if client_confirm_appointment('99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000382', '99999999-3333-0000-0000-000000000381') then
    raise exception '3: confirmed someone else''s'; end if;
  if not client_confirm_appointment('99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000381', '99999999-3333-0000-0000-000000000381') then
    raise exception '3: confirm failed'; end if;
  if (select client_confirmed_at from appointments where id = '99999999-3333-0000-0000-000000000381') is null then raise exception '3: not set'; end if;

  -- 4. Reschedule onto Bartek's 12:00: refused, nothing changes.
  j := client_reschedule_appointment('99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000381', '99999999-3333-0000-0000-000000000381',
        ((now() at time zone 'Europe/Warsaw')::date + 1 + time '12:30') at time zone 'Europe/Warsaw',
        ((now() at time zone 'Europe/Warsaw')::date + 1 + time '13:30') at time zone 'Europe/Warsaw');
  if j->>'error' <> 'slot_unavailable' then raise exception '4: %', j; end if;
  if (select previous_starts_at from appointments where id = '99999999-3333-0000-0000-000000000381') is not null then raise exception '4: changed anyway'; end if;

  -- 5. Reschedule to 15:00: moves, remembers the old time, resets reminder and confirmation.
  update appointments set reminder_sent_at = now() where id = '99999999-3333-0000-0000-000000000381';
  j := client_reschedule_appointment('99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000381', '99999999-3333-0000-0000-000000000381',
        ((now() at time zone 'Europe/Warsaw')::date + 1 + time '15:00') at time zone 'Europe/Warsaw',
        ((now() at time zone 'Europe/Warsaw')::date + 1 + time '16:00') at time zone 'Europe/Warsaw');
  if not (j->>'ok')::boolean then raise exception '5: %', j; end if;
  select * into r from appointments where id = '99999999-3333-0000-0000-000000000381';
  if to_char(r.starts_at at time zone 'Europe/Warsaw', 'HH24:MI') <> '15:00' or to_char(r.previous_starts_at at time zone 'Europe/Warsaw', 'HH24:MI') <> '10:00'
     or r.reminder_sent_at is not null or r.client_confirmed_at is not null or r.status <> 'confirmed' then
    raise exception '5: %', row_to_json(r); end if;

  -- 6. Past times and someone else's viewing are refused.
  if client_reschedule_appointment('99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000381', '99999999-3333-0000-0000-000000000381',
       now() - interval '1 hour', now())->>'error' <> 'in_the_past' then raise exception '6: past'; end if;
  if client_reschedule_appointment('99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000381', '99999999-3333-0000-0000-000000000382',
       now() + interval '5 days', now() + interval '5 days 1 hour')->>'error' <> 'not_found' then raise exception '6: other client'; end if;

  -- 7. Reminders: tomorrow's two agency viewings, not the one in 3 days, not the demo agency.
  update appointments set reminder_sent_at = null where tenant_id = '99999999-0000-0000-0000-000000000381';
  select count(*) into n from due_viewing_reminders() where tenant_id in ('99999999-0000-0000-0000-000000000381', '99999999-0000-0000-0000-000000000383');
  if n <> 2 then raise exception '7: expected 2, got %', n; end if;
  select * into r from due_viewing_reminders() where appointment_id = '99999999-3333-0000-0000-000000000381';
  if r.conversation_channel <> 'whatsapp' or r.whatsapp_phone_number_id <> '111' or r.last_client_message <> 'Dzień dobry, szukam mieszkania' or r.contact_phone <> '+48600' then
    raise exception '7: %', row_to_json(r); end if;
  select * into r from due_viewing_reminders() where appointment_id = '99999999-3333-0000-0000-000000000382';
  if r.conversation_id is not null or r.contact_email <> 'bartek@x.pl' then raise exception '7: no-conversation case %', row_to_json(r); end if;

  -- 8. Recording: sent = logged into the conversation, not due again; failed = audit + not retried.
  perform record_viewing_reminder('99999999-3333-0000-0000-000000000381', 'whatsapp', true, 'Przypominamy o prezentacji jutro', '99999999-2222-0000-0000-000000000381');
  perform record_viewing_reminder('99999999-3333-0000-0000-000000000382', 'email', false, 'Invalid Credentials', null);
  select count(*) into n from due_viewing_reminders() where tenant_id = '99999999-0000-0000-0000-000000000381';
  if n <> 0 then raise exception '8: still due'; end if;
  if not exists (select 1 from messages where conversation_id = '99999999-2222-0000-0000-000000000381' and role = 'assistant' and content = 'Przypominamy o prezentacji jutro') then
    raise exception '8: reminder not in conversation'; end if;
  if (select reminder_channel from appointments where id = '99999999-3333-0000-0000-000000000382') <> 'failed:email' then raise exception '8: failed channel'; end if;
  if not exists (select 1 from audit_log where event_type = 'reminder_failed' and details->>'appointment_id' = '99999999-3333-0000-0000-000000000382') then
    raise exception '8: failure not logged (health alerts read *_failed)'; end if;

  -- 9. Reminders switched off: nothing due.
  update appointments set reminder_sent_at = null where tenant_id = '99999999-0000-0000-0000-000000000381';
  update ai_config set reminders_enabled = false where tenant_id = '99999999-0000-0000-0000-000000000381';
  select count(*) into n from due_viewing_reminders() where tenant_id = '99999999-0000-0000-0000-000000000381';
  if n <> 0 then raise exception '9: reminders off but due'; end if;

  -- 10. Cancel by the client.
  if not client_cancel_appointment('99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000381', '99999999-3333-0000-0000-000000000383') then
    raise exception '10: cancel failed'; end if;
  select * into r from appointments where id = '99999999-3333-0000-0000-000000000383';
  if r.status <> 'cancelled' or r.cancelled_by <> 'client' then raise exception '10: %', row_to_json(r); end if;
  if client_cancel_appointment('99999999-0000-0000-0000-000000000381', '99999999-1111-0000-0000-000000000381', '99999999-3333-0000-0000-000000000383') then
    raise exception '10: cancelled twice'; end if;

  -- 11. Settings: defaults and limits.
  if (select booking_notice_minutes from ai_config where tenant_id = '99999999-0000-0000-0000-000000000382') <> 120
     or (select booking_buffer_minutes from ai_config where tenant_id = '99999999-0000-0000-0000-000000000382') <> 30 then
    raise exception '11: defaults'; end if;
  begin
    update ai_config set booking_buffer_minutes = 999 where tenant_id = '99999999-0000-0000-0000-000000000382';
    raise exception '11: accepted a 999-minute buffer';
  exception when check_violation then null;
  end;

  -- 12. Not callable by the website's roles.
  if has_function_privilege('anon', 'client_cancel_appointment(uuid, uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'due_viewing_reminders(timestamptz)', 'execute') then
    raise exception '12: exposed'; end if;

  raise notice '0038 checks passed';
end $$;

rollback;
