-- Scenario test for 0050 (trials, go-live checklist, failures per agency).
-- Scratch database only; rolls back. Ends with "0050 checks passed".
begin;
insert into tenants (id, name, slug, timezone, plan, trial_ends_at) values
  ('99999999-0000-0000-0000-000000000501', 'Old Trial Agency', 'old-501', 'Europe/Warsaw', 'trial', now() - interval '30 days'),
  ('99999999-0000-0000-0000-000000000502', 'New Agency', 'new-502', 'Europe/Warsaw', 'trial', null);
insert into ai_config (tenant_id) values ('99999999-0000-0000-0000-000000000501'), ('99999999-0000-0000-0000-000000000502')
  on conflict (tenant_id) do nothing;
insert into contacts (id, tenant_id, name, email) values
  ('99999999-0000-0000-0000-0000000050c1', '99999999-0000-0000-0000-000000000502', 'Kasia', 'kasia@example.com');
insert into conversations (id, tenant_id, contact_id, channel) values
  ('99999999-0000-0000-0000-0000000050d1', '99999999-0000-0000-0000-000000000502', '99999999-0000-0000-0000-0000000050c1', 'email');
insert into leads (id, tenant_id, contact_id, status, created_at) values
  ('99999999-0000-0000-0000-0000000050a1', '99999999-0000-0000-0000-000000000502', '99999999-0000-0000-0000-0000000050c1', 'WARM', now() - interval '3 days');
insert into follow_up_sequences (id, tenant_id, name, steps, is_active) values
  ('99999999-0000-0000-0000-0000000050e1', '99999999-0000-0000-0000-000000000502', 'S', '[{"day_offset":0,"channel":"email","subject":"Hi","body":"Hi"}]', true);
insert into follow_up_runs (id, tenant_id, lead_id, sequence_id, current_step_index, status, next_run_at, created_at) values
  ('99999999-0000-0000-0000-0000000050f1', '99999999-0000-0000-0000-000000000502', '99999999-0000-0000-0000-0000000050a1', '99999999-0000-0000-0000-0000000050e1', 0, 'running', now() + interval '1 hour', now());

do $$
declare
  OLD constant uuid := '99999999-0000-0000-0000-000000000501';
  NEW constant uuid := '99999999-0000-0000-0000-000000000502';
  CONV constant uuid := '99999999-0000-0000-0000-0000000050d1';
  t tenants; j jsonb; n int; r record;
begin
  -- 1. Agencies from before 0050 keep working, whatever their old trial date.
  if tenant_service_state(OLD) <> 'serving' then raise exception '1: an old trial agency was paused'; end if;
  if tenant_service_state(NEW) <> 'serving' then raise exception '1: an agency being set up should be serving'; end if;
  if tenant_service_state('99999999-0000-0000-0000-0000000005ff') <> 'unknown' then raise exception '1: unknown agency'; end if;
  -- A new agency has no trial date until one is started.
  insert into tenants (id, name, slug) values ('99999999-0000-0000-0000-000000000503', 'Fresh', 'fresh-503');
  if (select trial_ends_at from tenants where id = '99999999-0000-0000-0000-000000000503') is not null then
    raise exception '1: new agencies should not get a trial date by default'; end if;

  -- 2. Start a 7-day trial.
  t := start_trial(NEW, 7, 'donnovan@example.com');
  if t.plan <> 'trial' or t.trial_started_at is null or abs(extract(epoch from (t.trial_ends_at - now() - interval '7 days'))) > 5 then
    raise exception '2: trial is %', row_to_json(t); end if;
  if not exists (select 1 from audit_log where tenant_id = NEW and event_type = 'platform.trial_started' and actor_id = 'donnovan@example.com') then
    raise exception '2: not in the activity log'; end if;
  if tenant_service_state(NEW) <> 'serving' then raise exception '2: a running trial must serve'; end if;
  if (start_trial(NEW, 500)).trial_ends_at > now() + interval '61 days' then raise exception '2: trial length not capped'; end if;
  perform start_trial(NEW, 7);

  -- 3. The trial ends: paused.
  update tenants set trial_ends_at = now() - interval '1 minute' where id = NEW;
  if tenant_service_state(NEW) <> 'trial_ended' then raise exception '3: should be trial_ended'; end if;

  -- 3a. The client gets one holding reply a day; their message is saved.
  j := paused_reply(NEW, CONV, 'Is the flat still available?', 'Thank you. The team will get back to you.');
  if j->>'reply' is null or (j->>'conversation_id')::uuid <> CONV then raise exception '3a: first reply %', j; end if;
  select count(*) into n from messages where conversation_id = CONV;
  if n <> 2 then raise exception '3a: % messages saved, expected the question and the holding reply', n; end if;
  j := paused_reply(NEW, CONV, 'Hello?', 'Thank you. The team will get back to you.');
  if j->>'reply' is not null or (j->>'human')::boolean is not true then raise exception '3a: second reply the same day %', j; end if;
  select count(*) into n from messages where conversation_id = CONV;
  if n <> 3 then raise exception '3a: the second message was not saved (% messages)', n; end if;
  -- A new website visitor who gave their details: a new conversation and a contact.
  j := paused_reply(NEW, null, 'Hi', 'Thanks!', 'Jan Nowak', 'jan.0050@example.com', '');
  if j->>'reply' <> 'Thanks!' then raise exception '3a: new visitor %', j; end if;
  if not exists (select 1 from conversations c join contacts k on k.id = c.contact_id
                 where c.id = (j->>'conversation_id')::uuid and k.email = 'jan.0050@example.com') then
    raise exception '3a: the visitor''s details were not saved'; end if;
  -- Another agency's conversation id is never written into.
  j := paused_reply(NEW, (select id from conversations where tenant_id <> NEW limit 1), 'x', 'y');
  if (select tenant_id from conversations where id = (j->>'conversation_id')::uuid) <> NEW then
    raise exception '3a: wrote into another agency''s conversation'; end if;

  -- 3b. Nothing goes out on Elliot's own initiative.
  update follow_up_runs set next_run_at = now() - interval '1 minute' where id = '99999999-0000-0000-0000-0000000050f1';
  select count(*) into n from claim_due_follow_up_runs(100) c where c.tenant_id = NEW;
  if n <> 0 then raise exception '3b: a follow-up was handed out for a paused agency'; end if;
  if (select status from follow_up_runs where id = '99999999-0000-0000-0000-0000000050f1') <> 'running' then
    raise exception '3b: the run should wait untouched'; end if;
  update follow_up_sequences set auto_enrol = true, auto_enrol_after_hours = 1 where id = '99999999-0000-0000-0000-0000000050e1';
  -- (Switching auto-enrol on only picks up later leads; date it back so this lead counts.)
  update follow_up_sequences set auto_enrol_since = now() - interval '10 days' where id = '99999999-0000-0000-0000-0000000050e1';
  update messages set created_at = now() - interval '2 hours' where conversation_id = CONV;
  delete from follow_up_runs where id = '99999999-0000-0000-0000-0000000050f1';
  select count(*) into n from enrol_quiet_leads(100) e where e.tenant_id = NEW;
  if n <> 0 then raise exception '3b: auto-enrol ran for a paused agency'; end if;
  insert into appointments (tenant_id, contact_id, starts_at, ends_at, status, timezone)
  values (NEW, '99999999-0000-0000-0000-0000000050c1',
          ((now() at time zone 'Europe/Warsaw')::date + 1 + time '11:00') at time zone 'Europe/Warsaw',
          ((now() at time zone 'Europe/Warsaw')::date + 1 + time '11:30') at time zone 'Europe/Warsaw', 'confirmed', 'Europe/Warsaw');
  update ai_config set reminders_enabled = true where tenant_id = NEW;
  select count(*) into n from due_viewing_reminders() d where d.tenant_id = NEW;
  if n <> 0 then raise exception '3b: a reminder was due for a paused agency'; end if;

  -- 3c. They continue: everything resumes.
  update tenants set plan = 'starter' where id = NEW;
  if tenant_service_state(NEW) <> 'serving' then raise exception '3c: a paying agency must serve'; end if;
  select count(*) into n from due_viewing_reminders() d where d.tenant_id = NEW;
  if n <> 1 then raise exception '3c: the reminder should be due again (%)', n; end if;
  -- (A booked viewing keeps a lead out of auto-enrol, so cancel it first.)
  update appointments set status = 'cancelled' where tenant_id = NEW;
  -- (And Kasia wrote a moment ago; auto-enrol waits until a lead goes quiet.)
  update messages set created_at = now() - interval '2 hours' where conversation_id = CONV;
  select count(*) into n from enrol_quiet_leads(100) e where e.tenant_id = NEW;
  if n <> 1 then raise exception '3c: auto-enrol should run again (%)', n; end if;
  update tenants set status = 'suspended' where id = NEW;
  if tenant_service_state(NEW) <> 'suspended' then raise exception '3c: suspended'; end if;
  update tenants set status = 'active' where id = NEW;

  -- 4. Go-live checklist.
  select count(*) into n from onboarding_checklist('99999999-0000-0000-0000-000000000503');
  if n <> 13 then raise exception '4: % checklist rows', n; end if;
  if exists (select 1 from onboarding_checklist('99999999-0000-0000-0000-000000000503') where done and step not in (13)) then
    raise exception '4: an empty agency has something done: %', (select string_agg(item, ', ') from onboarding_checklist('99999999-0000-0000-0000-000000000503') where done); end if;
  if not (select done from onboarding_checklist(NEW) where step = 12) then raise exception '4: test conversation (holding replies count as answers)'; end if;
  if not (select done from onboarding_checklist(NEW) where step = 13) then raise exception '4: trial started / paying'; end if;
  insert into listings (tenant_id, title, transaction_type) values (NEW, 'Flat', 'sale');
  if not (select done from onboarding_checklist(NEW) where step = 4) then raise exception '4: listings'; end if;
  update ai_config set autonomy_rules = '{"book_appointment":{"mode":"autonomous"}}' where tenant_id = NEW;
  if (select detail from onboarding_checklist(NEW) where step = 6) <> 'Bookings: autonomous' then raise exception '4: rules detail'; end if;
  if exists (select 1 from onboarding_checklist('99999999-0000-0000-0000-0000000005ff')) then raise exception '4: unknown agency'; end if;

  -- 5. The control panel sees failures per agency.
  insert into audit_log (tenant_id, actor_type, event_type, details) values
    (NEW, 'system', 'whatsapp_send_failed', '{}'), (NEW, 'system', 'whatsapp_send_failed', '{}'),
    (NEW, 'system', 'booking_failed', '{}'), (NEW, 'system', 'follow_up_opt_out', '{}');
  select * into r from platform_tenant_overview(30) o where o.tenant_id = NEW;
  if r.failures_7d <> 3 or r.failure_kinds not like 'whatsapp_send_failed x2%' or r.service_state <> 'serving' or r.trial_started_at is null then
    raise exception '5: overview %', row_to_json(r); end if;
  insert into tenant_users (tenant_id, auth_user_id, email, role, receives_leads, calendar_status)
  values (NEW, gen_random_uuid(), 'a.0050@example.com', 'agent', true, 'not_shared');
  if (select calendar_problems from platform_tenant_overview(30) o where o.tenant_id = NEW) <> 1 then raise exception '5: calendar problems'; end if;

  -- 6. Nothing here is reachable from the Supabase API.
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('tenant_service_state', 'start_trial', 'paused_reply', 'onboarding_checklist', 'platform_tenant_overview')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if n <> 0 then raise exception '6: % functions callable from the API', n; end if;
end $$;

select '0050 checks passed' as result;
rollback;
