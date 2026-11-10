-- Scenario test for 0036 (health checks and alerts). Scratch database only;
-- rolls back. Ends with "0036 checks passed".
begin;

delete from health_check_state;
update platform_alert_settings
   set email_enabled = true, email_to = 'owner@example.com',
       whatsapp_enabled = true, whatsapp_to = '+48 600 100 200', whatsapp_sender_id = '1328644853675927',
       daily_summary_enabled = true, repeat_hours = 6,
       last_event_scan_at = '2026-11-10 06:00+00', last_daily_summary_on = '2026-11-10';

insert into tenants (id, name, slug) values
  ('99999999-0000-0000-0000-000000000361', 'Alert Agency', 'alert-test'),
  ('99999999-0000-0000-0000-000000000362', 'Quiet Agency', 'alert-quiet-test');
insert into ai_config (tenant_id, alert_email_enabled, alert_email, alert_whatsapp_enabled, alert_whatsapp_number)
values ('99999999-0000-0000-0000-000000000361', true, 'boss@agency.pl', true, '+48 500-000-111'),
       ('99999999-0000-0000-0000-000000000362', false, 'off@agency.pl', false, null)
on conflict (tenant_id) do update set alert_email_enabled = excluded.alert_email_enabled, alert_email = excluded.alert_email,
  alert_whatsapp_enabled = excluded.alert_whatsapp_enabled, alert_whatsapp_number = excluded.alert_whatsapp_number;

create temp table plan_out as select * from health_alert_plan('[]'::jsonb, '2026-11-10 06:00+00') limit 0;

do $$
declare n int; r record;
  ok_all jsonb := '[{"key":"claude","label":"Claude","ok":true},{"key":"gmail","label":"Gmail","ok":true}]';
  gmail_down jsonb := '[{"key":"claude","label":"Claude","ok":true},{"key":"gmail","label":"Gmail","ok":false,"detail":"401 invalid_grant"}]';
begin
  -- 1. First run, everything fine, summary already sent today: nothing to send.
  select count(*) into n from health_alert_plan(ok_all, '2026-11-10 07:00+00');
  if n <> 0 then raise exception '1: expected silence, got %', n; end if;

  -- 2. Gmail breaks: platform email + WhatsApp, saying NEW.
  insert into plan_out select * from health_alert_plan(gmail_down, '2026-11-10 07:15+00');
  select count(*) into n from plan_out where audience = 'platform';
  if n <> 2 then raise exception '2: expected 2 platform messages, got %', n; end if;
  select * into r from plan_out where channel = 'email';
  if r.recipient <> 'owner@example.com' or r.body not like 'NEW PROBLEMS%Gmail -- 401 invalid_grant%' or r.subject not like '%1 check(s) failing' then
    raise exception '2: email wrong: % / %', r.subject, r.body; end if;
  select * into r from plan_out where channel = 'whatsapp';
  if r.recipient <> '48600100200' or r.sender_id <> '1328644853675927' or r.short <> 'Elliot alert: Gmail failing. Details in your email.' then
    raise exception '2: whatsapp wrong: % % %', r.recipient, r.sender_id, r.short; end if;
  if position(E'\n' in r.short) > 0 then raise exception '2: WhatsApp template text must be one line'; end if;
  truncate plan_out;

  -- 3. Still broken 15 minutes later: no repeat yet.
  select count(*) into n from health_alert_plan(gmail_down, '2026-11-10 07:30+00');
  if n <> 0 then raise exception '3: repeated too soon (%)', n; end if;

  -- 4. Still broken 6 hours after the first alert: reminder, STILL FAILING.
  insert into plan_out select * from health_alert_plan(gmail_down, '2026-11-10 13:15+00');
  select * into r from plan_out where channel = 'email';
  if r.body not like 'STILL FAILING%failing since 10 Nov 08:15%' then raise exception '4: %', r.body; end if;
  truncate plan_out;

  -- 5. Fixed: BACK TO NORMAL, then silence.
  insert into plan_out select * from health_alert_plan(ok_all, '2026-11-10 13:30+00');
  select * into r from plan_out where channel = 'email';
  if r.subject <> 'Elliot: back to normal' or r.body not like 'BACK TO NORMAL%Gmail%' then raise exception '5: % %', r.subject, r.body; end if;
  select * into r from plan_out where channel = 'whatsapp';
  if r.short <> 'Elliot: Gmail back to normal.' then raise exception '5 wa: %', r.short; end if;
  truncate plan_out;
  select count(*) into n from health_alert_plan(ok_all, '2026-11-10 13:45+00');
  if n <> 0 then raise exception '5: not silent after recovery'; end if;

  -- 6. Failures logged by workflows: platform hears about all of them,
  --    the agency only about its own, the quiet agency (alerts off) gets nothing.
  insert into audit_log (tenant_id, actor_type, actor_id, event_type, details, created_at) values
    ('99999999-0000-0000-0000-000000000361', 'system', 'auto_reply', 'email_send_failed', '{"error":"Invalid Credentials"}', '2026-11-10 13:50+00'),
    ('99999999-0000-0000-0000-000000000361', 'system', 'auto_reply', 'email_send_failed', '{"error":"Invalid Credentials"}', '2026-11-10 13:51+00'),
    ('99999999-0000-0000-0000-000000000362', 'system', 'workflow_25', 'whatsapp_send_failed', '{"error":"131047"}', '2026-11-10 13:52+00'),
    ('99999999-0000-0000-0000-000000000361', 'system', 'x', 'config_changed', '{}', '2026-11-10 13:53+00'),
    (null, 'system', 'workflow_34', 'workflow_error', '{"error":"01 - Main AI Agent / Call Claude: timeout"}', '2026-11-10 13:54+00');
  insert into plan_out select * from health_alert_plan(ok_all, '2026-11-10 14:00+00');

  select * into r from plan_out where audience = 'platform' and channel = 'email';
  if r.body not like 'FAILURES SINCE THE LAST CHECK%Alert Agency: 2 x email send failed -- Invalid Credentials%'
     or r.body not like '%Quiet Agency: 1 x whatsapp send failed -- 131047%'
     or r.body not like '%Platform: 1 x workflow error -- 01 - Main AI Agent / Call Claude: timeout%'
     or r.body like '%config changed%' then
    raise exception '6 platform: %', r.body; end if;

  select count(*) into n from plan_out where audience = 'agency';
  if n <> 2 then raise exception '6: expected email + WhatsApp for Alert Agency only, got %', n; end if;
  select * into r from plan_out where audience = 'agency' and channel = 'email';
  if r.recipient <> 'boss@agency.pl' or r.tenant_id <> '99999999-0000-0000-0000-000000000361'
     or r.body not like 'Hello Alert Agency%2 x an email reply to a client couldn''t be sent%' then
    raise exception '6 agency email: % %', r.recipient, r.body; end if;
  select * into r from plan_out where audience = 'agency' and channel = 'whatsapp';
  if r.recipient <> '48500000111' or r.short <> 'Elliot: 2 x an email reply to a client couldn''t be sent. See your dashboard.' then
    raise exception '6 agency wa: % %', r.recipient, r.short; end if;
  truncate plan_out;

  -- 7. The same events are not reported twice.
  select count(*) into n from health_alert_plan(ok_all, '2026-11-10 14:15+00');
  if n <> 0 then raise exception '7: events reported twice'; end if;

  -- 8. Switches: platform WhatsApp off, agency email off.
  update platform_alert_settings set whatsapp_enabled = false;
  update ai_config set alert_email_enabled = false where tenant_id = '99999999-0000-0000-0000-000000000361';
  insert into audit_log (tenant_id, actor_type, actor_id, event_type, details, created_at) values
    ('99999999-0000-0000-0000-000000000361', 'system', 'auto_reply', 'booking_failed', '{"error":"slot taken"}', '2026-11-10 14:20+00');
  insert into plan_out select * from health_alert_plan(ok_all, '2026-11-10 14:30+00');
  select count(*) into n from plan_out;
  if n <> 2 then raise exception '8: expected platform email + agency WhatsApp, got %', n; end if;
  if not exists (select 1 from plan_out where audience = 'platform' and channel = 'email') then raise exception '8: platform email missing'; end if;
  if not exists (select 1 from plan_out where audience = 'agency' and channel = 'whatsapp' and short like '%a viewing couldn''t be booked%') then raise exception '8: agency whatsapp missing'; end if;
  truncate plan_out;

  -- 9. Daily summary: next morning after 08:00 Warsaw, once.
  select count(*) into n from health_alert_plan(ok_all, '2026-11-11 06:30+00');  -- 07:30 Warsaw
  if n <> 0 then raise exception '9: summary too early'; end if;
  insert into plan_out select * from health_alert_plan(ok_all, '2026-11-11 07:05+00');  -- 08:05 Warsaw
  select * into r from plan_out;
  if r.subject <> 'Elliot daily check: all systems OK' or r.body not like '%OK: Claude%OK: Gmail%' then raise exception '9: %', r.subject; end if;
  truncate plan_out;
  select count(*) into n from health_alert_plan(ok_all, '2026-11-11 07:20+00');
  if n <> 0 then raise exception '9: summary sent twice'; end if;

  -- 10. Status JSON for the /health webhook.
  update health_check_state set checked_at = now() - interval '2 hours';
  if health_status()->>'status' <> 'stale' then raise exception '10: % (checks were in the past, expected stale)', health_status()->>'status'; end if;
  update health_check_state set checked_at = now();
  if health_status()->>'status' <> 'all_ok' then raise exception '10: %', health_status(); end if;
  update health_check_state set ok = false where check_key = 'gmail';
  if health_status()->>'status' <> 'degraded' then raise exception '10: degraded expected'; end if;

  -- 11. Workflow crash logging.
  perform log_workflow_error('16 - Email Inbound Trigger', 'Send Reply via Gmail', 'Invalid Credentials', 'https://n8n/execution/1');
  if not exists (select 1 from audit_log where event_type = 'workflow_error' and tenant_id is null
                 and details->>'error' = '16 - Email Inbound Trigger / Send Reply via Gmail: Invalid Credentials') then
    raise exception '11: workflow error not logged'; end if;

  -- 12. Delivery results and the test alert.
  perform record_alert_delivery('whatsapp', false, 'Template name does not exist (code 132001)', '48600100200');
  perform record_alert_delivery('email', true, 'via Resend', 'owner@example.com');
  if (select last_whatsapp_status from platform_alert_settings) <> 'FAILED to 48600100200: Template name does not exist (code 132001)'
     or (select last_email_status from platform_alert_settings) <> 'Delivered to owner@example.com: via Resend' then
    raise exception '12: delivery status not recorded'; end if;
  update platform_alert_settings set whatsapp_enabled = true;
  select count(*) into n from health_test_alert();
  if n <> 2 then raise exception '12: test alert should go to email and WhatsApp, got %', n; end if;
  if (select short from health_test_alert() where channel = 'whatsapp') <> 'Elliot test alert: WhatsApp alerts work.' then raise exception '12: wa test text'; end if;
  update platform_alert_settings set email_to = '  ';
  select count(*) into n from health_test_alert();
  if n <> 1 then raise exception '12: empty email address should be skipped'; end if;

  -- 13. Agencies can't read platform tables.
  if has_table_privilege('authenticated', 'platform_alert_settings', 'select') or has_table_privilege('anon', 'health_check_state', 'select')
     or has_function_privilege('authenticated', 'health_alert_plan(jsonb, timestamptz)', 'execute') then
    raise exception '12: platform tables or functions exposed'; end if;

  raise notice '0036 checks passed';
end $$;

rollback;
