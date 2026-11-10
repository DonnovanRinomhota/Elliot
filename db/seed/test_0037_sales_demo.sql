-- Scenario test for 0037 (sales account, demo agency). Scratch database only;
-- rolls back. Ends with "0037 checks passed".
begin;

delete from tenants where assistant_mode in ('sales', 'demo');
insert into tenants (id, name, slug, assistant_mode, timezone) values
  ('99999999-0000-0000-0000-000000000371', 'Elliot', 'elliot-test', 'sales', 'Europe/Warsaw'),
  ('99999999-0000-0000-0000-000000000372', 'Demo Agency', 'demo-test', 'demo', 'Europe/Warsaw'),
  ('99999999-0000-0000-0000-000000000373', 'Real Agency', 'real-test', 'agency', 'Europe/Warsaw');
insert into ai_config (tenant_id, google_calendar_id) values
  ('99999999-0000-0000-0000-000000000372', 'demo@group.calendar.google.com')
on conflict (tenant_id) do update set google_calendar_id = excluded.google_calendar_id;

do $$
declare c1 uuid; c2 uuid; n int; r record; j jsonb;
begin
  -- 1. The accounts are found by mode.
  if sales_tenant_id() <> '99999999-0000-0000-0000-000000000371' then raise exception '1: sales tenant'; end if;
  if (select slug from demo_tenant()) <> 'demo-test' then raise exception '1: demo tenant'; end if;

  -- 2. A consultation booking creates a contact and a HOT lead with the details.
  c1 := upsert_sales_lead('Anna Nowak', ' Anna@Agency.PL ', '+48 600 100 200', 'Nowak Nieruchomości',
                          '{"call_type": "demo", "agents": "6-20", "crm": "ASARI"}', 'consultation_booking');
  select * into r from contacts where id = c1;
  if r.tenant_id <> '99999999-0000-0000-0000-000000000371' or r.email <> 'anna@agency.pl' or r.company <> 'Nowak Nieruchomości' or r.source <> 'consultation_booking' then
    raise exception '2: contact %', row_to_json(r); end if;
  select * into r from leads where contact_id = c1;
  if r.status <> 'HOT' or r.qualification_answers->>'crm' <> 'ASARI' or r.qualification_answers->>'agency' <> 'Nowak Nieruchomości'
     or r.qualification_answers->>'source' <> 'consultation_booking' then
    raise exception '2: lead %', r.qualification_answers; end if;

  -- 3. The same email again: same contact, details merged, nothing overwritten with blanks.
  c2 := upsert_sales_lead('', 'anna@agency.pl', null, null, '{"listings": "about 200"}', 'live_demo');
  if c2 <> c1 then raise exception '3: duplicate contact'; end if;
  select * into r from contacts where id = c1;
  if r.name <> 'Anna Nowak' or r.phone <> '+48 600 100 200' then raise exception '3: blanks overwrote details'; end if;
  select qualification_answers into j from leads where contact_id = c1;
  if j->>'crm' <> 'ASARI' or j->>'listings' <> 'about 200' or j->>'source' <> 'live_demo' then raise exception '3: merge %', j; end if;
  select count(*) into n from leads where contact_id = c1;
  if n <> 1 then raise exception '3: duplicate lead'; end if;

  -- 4. A converted lead stays converted.
  update leads set status = 'CONVERTED' where contact_id = c1;
  perform upsert_sales_lead('Anna Nowak', 'anna@agency.pl', null, null, '{}', 'website');
  if (select status from leads where contact_id = c1) <> 'CONVERTED' then raise exception '4: status reset'; end if;

  -- 5. A bad email is refused.
  begin
    perform upsert_sales_lead('X', 'not-an-email', null, null, '{}', 'website');
    raise exception '5: accepted a bad email';
  exception when others then
    if sqlerrm <> 'a valid email is required' then raise; end if;
  end;

  -- 6. Demo clean-up: only the demo account, only old data, calendar events listed first.
  insert into contacts (id, tenant_id, name, email, created_at) values
    ('99999999-1111-0000-0000-000000000001', '99999999-0000-0000-0000-000000000372', 'Old visitor', 'old@x.pl', now() - interval '5 days'),
    ('99999999-1111-0000-0000-000000000002', '99999999-0000-0000-0000-000000000372', 'New visitor', 'new@x.pl', now() - interval '1 hour'),
    ('99999999-1111-0000-0000-000000000003', '99999999-0000-0000-0000-000000000373', 'Real client', 'real@x.pl', now() - interval '30 days');
  insert into conversations (id, tenant_id, contact_id, channel, created_at, updated_at) values
    ('99999999-2222-0000-0000-000000000001', '99999999-0000-0000-0000-000000000372', '99999999-1111-0000-0000-000000000001', 'chat_widget', now() - interval '5 days', now() - interval '5 days'),
    ('99999999-2222-0000-0000-000000000002', '99999999-0000-0000-0000-000000000372', '99999999-1111-0000-0000-000000000002', 'chat_widget', now() - interval '1 hour', now() - interval '1 hour'),
    ('99999999-2222-0000-0000-000000000003', '99999999-0000-0000-0000-000000000373', '99999999-1111-0000-0000-000000000003', 'chat_widget', now() - interval '30 days', now() - interval '30 days');
  insert into appointments (tenant_id, contact_id, starts_at, ends_at, timezone, external_calendar_id, created_at) values
    ('99999999-0000-0000-0000-000000000372', '99999999-1111-0000-0000-000000000001', now() - interval '4 days', now() - interval '4 days' + interval '1 hour', 'Europe/Warsaw', 'ev-old', now() - interval '5 days'),
    ('99999999-0000-0000-0000-000000000372', '99999999-1111-0000-0000-000000000002', now() + interval '1 day', now() + interval '1 day 1 hour', 'Europe/Warsaw', 'ev-new', now() - interval '1 hour'),
    ('99999999-0000-0000-0000-000000000373', '99999999-1111-0000-0000-000000000003', now() - interval '29 days', now() - interval '29 days' + interval '1 hour', 'Europe/Warsaw', 'ev-real', now() - interval '30 days');

  select count(*) into n from demo_cleanup_events();
  if n <> 1 or (select event_id from demo_cleanup_events()) <> 'ev-old'
     or (select calendar_id from demo_cleanup_events()) <> 'demo@group.calendar.google.com' then
    raise exception '6: events %', n; end if;

  j := demo_cleanup();
  if (j->>'conversations_deleted')::int <> 1 or (j->>'contacts_deleted')::int <> 1 then raise exception '6: %', j; end if;
  if exists (select 1 from contacts where id = '99999999-1111-0000-0000-000000000001') then raise exception '6: old visitor kept'; end if;
  if not exists (select 1 from contacts where id = '99999999-1111-0000-0000-000000000002') then raise exception '6: new visitor deleted'; end if;
  if not exists (select 1 from contacts where id = '99999999-1111-0000-0000-000000000003') then raise exception '6: REAL agency data deleted'; end if;
  if not exists (select 1 from appointments where external_calendar_id = 'ev-real') then raise exception '6: real appointment deleted'; end if;
  if exists (select 1 from appointments where external_calendar_id = 'ev-old') then raise exception '6: old demo appointment kept'; end if;

  -- 7. Mode values are checked; business_hours exists with a default.
  begin
    update tenants set assistant_mode = 'robot' where id = '99999999-0000-0000-0000-000000000373';
    raise exception '7: accepted an unknown mode';
  exception when check_violation then null;
  end;
  if (select business_hours from ai_config where tenant_id = '99999999-0000-0000-0000-000000000372') <> '{}'::jsonb then
    raise exception '7: business_hours default'; end if;

  -- 8. Not callable by the website's anonymous role.
  if has_function_privilege('anon', 'upsert_sales_lead(text, text, text, text, jsonb, text)', 'execute')
     or has_function_privilege('authenticated', 'demo_cleanup(interval)', 'execute') then
    raise exception '8: functions exposed'; end if;

  -- 9. Stale follows the schedule: checks every 3 hours, last one 2 hours ago = fine; 9 hours ago = stale.
  delete from health_check_state;
  insert into health_check_state (check_key, label, ok, checked_at) values ('claude', 'Claude', true, now() - interval '5 hours');
  update health_check_state set checked_at = now() - interval '2 hours';
  if health_status()->>'status' <> 'all_ok' or (health_status()->>'expected_every_minutes')::int <> 180 then
    raise exception '9: %', health_status(); end if;
  update health_check_state set checked_at = now() - interval '9 hours', prev_checked_at = now() - interval '12 hours';
  if health_status()->>'status' <> 'stale' then raise exception '9: stale expected: %', health_status(); end if;
  -- every 15 minutes, last check 50 minutes ago = stale (the 45-minute floor)
  update health_check_state set checked_at = now() - interval '50 minutes', prev_checked_at = now() - interval '65 minutes';
  if health_status()->>'status' <> 'stale' then raise exception '9: floor'; end if;

  raise notice '0037 checks passed';
end $$;

rollback;
