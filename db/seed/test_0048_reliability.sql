-- Scenario test for 0048 (reliability). Scratch database only; rolls back.
-- Ends with "0048 checks passed".
begin;
insert into tenants (id, name, slug, timezone, assistant_mode) values
  ('99999999-0000-0000-0000-000000000481', 'Agency R', 'r-481', 'Europe/Warsaw', 'agency'),
  ('99999999-0000-0000-0000-000000000482', 'Agency S', 's-482', 'Europe/Warsaw', 'agency');
insert into ai_config (tenant_id, whatsapp_phone_number_id) values
  ('99999999-0000-0000-0000-000000000481', 'PNID-481'), ('99999999-0000-0000-0000-000000000482', 'PNID-482')
  on conflict (tenant_id) do update set whatsapp_phone_number_id = excluded.whatsapp_phone_number_id;
insert into contacts (id, tenant_id, name, email, phone) values
  ('99999999-0000-0000-0000-0000000048c1', '99999999-0000-0000-0000-000000000481', 'Anna', 'anna@example.com', '+48 600 481 001'),
  ('99999999-0000-0000-0000-0000000048c2', '99999999-0000-0000-0000-000000000481', 'Bartek', 'bartek@example.com', '+48 600 481 002'),
  ('99999999-0000-0000-0000-0000000048c3', '99999999-0000-0000-0000-000000000481', 'Celina', 'celina@example.com', null),
  ('99999999-0000-0000-0000-0000000048c4', '99999999-0000-0000-0000-000000000481', 'Darek', 'darek@example.com', null),
  ('99999999-0000-0000-0000-0000000048c5', '99999999-0000-0000-0000-000000000481', 'Ewa', 'ewa@example.com', null),
  ('99999999-0000-0000-0000-0000000048c9', '99999999-0000-0000-0000-000000000482', 'Other agency', 'o@example.com', '+48 600 481 001');
insert into conversations (id, tenant_id, contact_id, channel) values
  ('99999999-0000-0000-0000-0000000048d1', '99999999-0000-0000-0000-000000000481', '99999999-0000-0000-0000-0000000048c1', 'whatsapp'),
  ('99999999-0000-0000-0000-0000000048d2', '99999999-0000-0000-0000-000000000481', '99999999-0000-0000-0000-0000000048c2', 'email'),
  ('99999999-0000-0000-0000-0000000048d3', '99999999-0000-0000-0000-000000000481', '99999999-0000-0000-0000-0000000048c3', 'chat_widget'),
  ('99999999-0000-0000-0000-0000000048d9', '99999999-0000-0000-0000-000000000482', '99999999-0000-0000-0000-0000000048c9', 'whatsapp');
insert into leads (id, tenant_id, contact_id, status, created_at) values
  ('99999999-0000-0000-0000-0000000048a1', '99999999-0000-0000-0000-000000000481', '99999999-0000-0000-0000-0000000048c1', 'WARM', now() - interval '9 days'),
  ('99999999-0000-0000-0000-0000000048a2', '99999999-0000-0000-0000-000000000481', '99999999-0000-0000-0000-0000000048c2', 'WARM', now() - interval '9 days'),
  ('99999999-0000-0000-0000-0000000048a3', '99999999-0000-0000-0000-000000000481', '99999999-0000-0000-0000-0000000048c3', 'WARM', now() - interval '9 days'),
  ('99999999-0000-0000-0000-0000000048a4', '99999999-0000-0000-0000-000000000481', '99999999-0000-0000-0000-0000000048c4', 'LOST', now() - interval '9 days'),
  ('99999999-0000-0000-0000-0000000048a5', '99999999-0000-0000-0000-000000000481', '99999999-0000-0000-0000-0000000048c5', 'HOT', now() - interval '9 days');
insert into follow_up_sequences (id, tenant_id, name, steps, is_active) values
  ('99999999-0000-0000-0000-0000000048e1', '99999999-0000-0000-0000-000000000481', 'Three steps',
   '[{"day_offset": 0, "channel": "email", "subject": "One", "body": "Hi {{contact_name}}"},
     {"day_offset": 3, "channel": "email", "subject": "Two", "body": "Still looking?"},
     {"day_offset": 7, "channel": "whatsapp", "subject": "", "body": "Last one"}]', true);
-- Runs started 2 days ago; every one is due now.
insert into follow_up_runs (id, tenant_id, lead_id, sequence_id, current_step_index, status, next_run_at, created_at) values
  ('99999999-0000-0000-0000-0000000048f1', '99999999-0000-0000-0000-000000000481', '99999999-0000-0000-0000-0000000048a1', '99999999-0000-0000-0000-0000000048e1', 0, 'running', now() - interval '1 minute', now() - interval '2 days'),
  ('99999999-0000-0000-0000-0000000048f2', '99999999-0000-0000-0000-000000000481', '99999999-0000-0000-0000-0000000048a2', '99999999-0000-0000-0000-0000000048e1', 2, 'running', now() - interval '1 minute', now() - interval '2 days'),
  ('99999999-0000-0000-0000-0000000048f3', '99999999-0000-0000-0000-000000000481', '99999999-0000-0000-0000-0000000048a3', '99999999-0000-0000-0000-0000000048e1', 3, 'running', now() - interval '1 minute', now() - interval '2 days'),
  ('99999999-0000-0000-0000-0000000048f4', '99999999-0000-0000-0000-000000000481', '99999999-0000-0000-0000-0000000048a4', '99999999-0000-0000-0000-0000000048e1', 0, 'running', now() - interval '1 minute', now() - interval '2 days'),
  ('99999999-0000-0000-0000-0000000048f5', '99999999-0000-0000-0000-000000000481', '99999999-0000-0000-0000-0000000048a5', '99999999-0000-0000-0000-0000000048e1', 1, 'running', now() + interval '1 day',    now() - interval '2 days');

do $$
declare
  n int; r record; f follow_up_runs; v uuid; v2 uuid; b boolean;
  T constant uuid := '99999999-0000-0000-0000-000000000481';
begin
  -- ── 1. Follow-ups are claimed once ─────────────────────────
  -- 1a. Only what should be sent comes back: Anna's step 0 and Bartek's last
  --     step. Not the finished run, the closed lead, or the run not due yet.
  select count(*) into n from claim_due_follow_up_runs(25) c where c.tenant_id = T;
  if n <> 2 then raise exception '1a: % steps claimed, expected 2', n; end if;

  -- 1b. The runs have already moved on.
  select * into f from follow_up_runs where id = '99999999-0000-0000-0000-0000000048f1';
  if f.current_step_index <> 1 or f.status <> 'running'
     or f.next_run_at <> f.created_at + interval '3 days' then
    raise exception '1b: run 1 is % / % / %', f.current_step_index, f.status, f.next_run_at; end if;
  select * into f from follow_up_runs where id = '99999999-0000-0000-0000-0000000048f2';
  if f.status <> 'completed' or f.next_run_at is not null or f.current_step_index <> 3 then
    raise exception '1b: the last step should complete the run: % / %', f.status, f.current_step_index; end if;
  select * into f from follow_up_runs where id = '99999999-0000-0000-0000-0000000048f3';
  if f.status <> 'completed' then raise exception '1b: a run past its last step should be completed, is %', f.status; end if;
  select * into f from follow_up_runs where id = '99999999-0000-0000-0000-0000000048f4';
  if f.status <> 'stopped' or f.stop_reason <> 'lead_closed' then
    raise exception '1b: a LOST lead should stop the run: % / %', f.status, f.stop_reason; end if;
  select * into f from follow_up_runs where id = '99999999-0000-0000-0000-0000000048f5';
  if f.status <> 'running' or f.current_step_index <> 1 then raise exception '1b: a run not due yet was touched'; end if;

  -- 1c. The crash case: the sweep runs again straight away (or overlaps).
  --     Nothing is handed out twice.
  select count(*) into n from claim_due_follow_up_runs(25) c where c.tenant_id = T;
  if n <> 0 then raise exception '1c: % steps were handed out a second time', n; end if;

  -- 1d. A reply from the client stops the run.
  update follow_up_runs set next_run_at = now() - interval '1 minute' where id = '99999999-0000-0000-0000-0000000048f1';
  insert into messages (tenant_id, conversation_id, role, content)
  values (T, '99999999-0000-0000-0000-0000000048d1', 'user', 'Yes, still interested, can I see it on Friday?');
  select count(*) into n from claim_due_follow_up_runs(25) c where c.tenant_id = T;
  select * into f from follow_up_runs where id = '99999999-0000-0000-0000-0000000048f1';
  if n <> 0 or f.status <> 'stopped' or f.stop_reason <> 'contact_replied' then
    raise exception '1d: after a reply: % claimed, run % / %', n, f.status, f.stop_reason; end if;

  -- 1e. The row has what workflow 20 needs.
  update follow_up_runs set status = 'running', next_run_at = now() - interval '1 minute', created_at = now()
   where id = '99999999-0000-0000-0000-0000000048f5';
  select * into r from claim_due_follow_up_runs(25) c where c.tenant_id = T;
  if r.run_id <> '99999999-0000-0000-0000-0000000048f5' or r.current_step_index <> 1 or r.contact_email <> 'ewa@example.com'
     or r.contact_name <> 'Ewa' or jsonb_array_length(r.steps) <> 3 or r.contact_replied or r.wa_conversation_id is not null then
    raise exception '1e: claimed row is %', to_jsonb(r); end if;

  -- ── 2. STOP ────────────────────────────────────────────────
  if follow_up_opt_word('STOP') <> 'stop' or follow_up_opt_word(' Wypisz mnie! ') <> 'stop'
     or follow_up_opt_word(E'unsubscribe\n\n> On Monday you wrote') <> 'stop' or follow_up_opt_word('start') <> 'start'
     or follow_up_opt_word('Please stop by on Friday') is not null or follow_up_opt_word('Can we stop at the park first?') is not null
     or follow_up_opt_word('') is not null or follow_up_opt_word(null) is not null then
    raise exception '2: opt-out words'; end if;

  -- 2a. Bartek writes STOP by email: remembered, his run stops, the team sees why.
  insert into follow_up_runs (id, tenant_id, lead_id, sequence_id, current_step_index, status, next_run_at, created_at) values
    ('99999999-0000-0000-0000-0000000048f6', T, '99999999-0000-0000-0000-0000000048a2', '99999999-0000-0000-0000-0000000048e1', 0, 'running', now() + interval '1 day', now());
  insert into messages (tenant_id, conversation_id, role, content)
  values (T, '99999999-0000-0000-0000-0000000048d2', 'user', 'Stop.');
  select * into f from follow_up_runs where id = '99999999-0000-0000-0000-0000000048f6';
  if f.status <> 'stopped' or f.stop_reason <> 'opted_out' then raise exception '2a: run is % / %', f.status, f.stop_reason; end if;
  if (select follow_up_opt_out_at from contacts where id = '99999999-0000-0000-0000-0000000048c2') is null then
    raise exception '2a: opt-out not remembered'; end if;
  select count(*) into n from messages where conversation_id = '99999999-0000-0000-0000-0000000048d2' and role = 'system' and content like '%no more follow-up%';
  if n <> 1 then raise exception '2a: % notes in the conversation', n; end if;
  -- Saying it twice changes nothing more.
  insert into messages (tenant_id, conversation_id, role, content) values (T, '99999999-0000-0000-0000-0000000048d2', 'user', 'STOP');
  select count(*) into n from messages where conversation_id = '99999999-0000-0000-0000-0000000048d2' and role = 'system';
  if n <> 1 then raise exception '2a: a second STOP added another note'; end if;

  -- 2b. A run started later for the same person is stopped at its first step, not sent.
  insert into follow_up_runs (id, tenant_id, lead_id, sequence_id, current_step_index, status, next_run_at, created_at) values
    ('99999999-0000-0000-0000-0000000048f7', T, '99999999-0000-0000-0000-0000000048a2', '99999999-0000-0000-0000-0000000048e1', 0, 'running', now() - interval '1 minute', now());
  select count(*) into n from claim_due_follow_up_runs(25) c where c.tenant_id = T;
  select * into f from follow_up_runs where id = '99999999-0000-0000-0000-0000000048f7';
  if n <> 0 or f.stop_reason <> 'opted_out' then raise exception '2b: % claimed, reason %', n, f.stop_reason; end if;

  -- 2c. START brings them back. An agent's or Elliot's "stop" does nothing. Website chat is ignored.
  insert into messages (tenant_id, conversation_id, role, content) values (T, '99999999-0000-0000-0000-0000000048d2', 'user', 'start');
  if (select follow_up_opt_out_at from contacts where id = '99999999-0000-0000-0000-0000000048c2') is not null then
    raise exception '2c: START did not clear the opt-out'; end if;
  insert into messages (tenant_id, conversation_id, role, content) values
    (T, '99999999-0000-0000-0000-0000000048d1', 'assistant', 'stop'),
    (T, '99999999-0000-0000-0000-0000000048d1', 'human_agent', 'STOP'),
    (T, '99999999-0000-0000-0000-0000000048d3', 'user', 'stop');
  select count(*) into n from contacts where tenant_id = T and follow_up_opt_out_at is not null;
  if n <> 0 then raise exception '2c: % contacts opted out by someone else''s word', n; end if;

  -- ── 3. Elliot couldn't answer ──────────────────────────────
  v := record_elliot_failure(T, '99999999-0000-0000-0000-0000000048d1', 'whatsapp', 'Claude: 529 overloaded', 'Sorry, someone will get back to you.');
  if v is null then raise exception '3: no escalation'; end if;
  select * into r from escalations where id = v;
  if r.priority <> 'high' or r.status <> 'open' or r.reason <> 'other' or r.context_summary not like 'Elliot could not answer%' then
    raise exception '3: escalation is %', to_jsonb(r); end if;
  select count(*) into n from audit_log where tenant_id = T and event_type = 'whatsapp_elliot_failed' and details->>'error' = 'Claude: 529 overloaded';
  if n <> 1 then raise exception '3: % audit rows', n; end if;
  select count(*) into n from messages where conversation_id = '99999999-0000-0000-0000-0000000048d1' and role = 'assistant' and content = 'Sorry, someone will get back to you.';
  if n <> 1 then raise exception '3: the client''s holding reply is not in the conversation'; end if;
  -- A second failure in the same hour: logged, but not a second escalation.
  v2 := record_elliot_failure(T, '99999999-0000-0000-0000-0000000048d1', 'whatsapp', 'again', null);
  select count(*) into n from escalations where conversation_id = '99999999-0000-0000-0000-0000000048d1';
  if v2 <> v or n <> 1 then raise exception '3: % escalations for one conversation', n; end if;
  -- Channel names; another agency's conversation is never touched.
  perform record_elliot_failure(T, '99999999-0000-0000-0000-0000000048d3', 'chat_widget', 'x', null);
  perform record_elliot_failure(T, '99999999-0000-0000-0000-0000000048d2', 'email', 'x', null);
  select count(*) into n from audit_log where tenant_id = T and event_type in ('chat_elliot_failed', 'email_elliot_failed');
  if n <> 2 then raise exception '3: channel event names (%)', n; end if;
  v := record_elliot_failure(T, '99999999-0000-0000-0000-0000000048d9', 'whatsapp', 'x', 'hello');
  select count(*) into n from escalations where conversation_id = '99999999-0000-0000-0000-0000000048d9';
  if v is not null or n <> 0 or exists (select 1 from messages where conversation_id = '99999999-0000-0000-0000-0000000048d9') then
    raise exception '3: wrote into another agency''s conversation'; end if;
  if record_elliot_failure(null, null, 'email', 'x', null) is not null then raise exception '3: null agency'; end if;

  -- ── 4. A tool failed ───────────────────────────────────────
  perform record_tool_failure(T, '99999999-0000-0000-0000-0000000048d3', 'book_appointment', 'Google Calendar: invalid_grant');
  perform record_tool_failure(T, '99999999-0000-0000-0000-0000000048d3', 'search_listings', 'timeout');
  select count(*) filter (where event_type = 'booking_failed') * 10 + count(*) filter (where event_type = 'tool_failed') into n
    from audit_log where tenant_id = T and actor_id = 'workflow_01' and details->>'conversation_id' = '99999999-0000-0000-0000-0000000048d3'
     and event_type in ('booking_failed', 'tool_failed');
  if n <> 11 then raise exception '4: booking_failed/tool_failed rows: %', n; end if;
  select count(*) into n from escalations where conversation_id = '99999999-0000-0000-0000-0000000048d3';
  if n <> 1 then raise exception '4: a failed search should not escalate by itself (%)', n; end if;
  -- A hand-over that failed still reaches the team.
  perform record_tool_failure(T, '99999999-0000-0000-0000-0000000048d3', 'escalate_to_human', 'workflow not found');
  select count(*) into n from escalations where conversation_id = '99999999-0000-0000-0000-0000000048d3' and context_summary like '%hand-over failed%';
  if n <> 1 then raise exception '4: failed hand-over not escalated'; end if;

  -- ── 5. WhatsApp not delivered ──────────────────────────────
  b := record_whatsapp_delivery_failure('PNID-481', '48600481001', 'wamid.FAIL1', 'Message undeliverable (code 131026)');
  if not b then raise exception '5: first report not recorded'; end if;
  select count(*) into n from messages where conversation_id = '99999999-0000-0000-0000-0000000048d1' and role = 'system' and content like '%not delivered: Message undeliverable%';
  if n <> 1 then raise exception '5: no note in the conversation'; end if;
  -- Meta repeats it: once only.
  if record_whatsapp_delivery_failure('PNID-481', '48600481001', 'wamid.FAIL1', 'again') then raise exception '5: recorded twice'; end if;
  select count(*) into n from audit_log where tenant_id = T and event_type = 'whatsapp_delivery_failed';
  if n <> 1 then raise exception '5: % audit rows', n; end if;
  -- The same client number at another agency is that agency's conversation, not ours.
  select count(*) into n from messages where conversation_id = '99999999-0000-0000-0000-0000000048d9';
  if n <> 0 then raise exception '5: wrote into another agency''s conversation'; end if;
  -- Unknown number, unknown recipient, no id.
  if record_whatsapp_delivery_failure('PNID-NOPE', '48600481001', 'wamid.X', 'e') then raise exception '5: unknown sending number'; end if;
  if record_whatsapp_delivery_failure('PNID-481', '48600481001', '', 'e') then raise exception '5: no message id'; end if;
  if not record_whatsapp_delivery_failure('PNID-481', '48999000111', 'wamid.FAIL2', 'e') then raise exception '5: unknown recipient should still be logged'; end if;

  -- ── 6. CRM retries wait longer each time ───────────────────
  insert into crm_sync_log (id, tenant_id, entity_type, entity_id, crm_provider, status, retry_count, updated_at) values
    ('99999999-0000-0000-0000-000000048701', T, 'contact', '99999999-0000-0000-0000-0000000048c1', 'webhook', 'pending', 0, now()),
    ('99999999-0000-0000-0000-000000048702', T, 'contact', '99999999-0000-0000-0000-0000000048c1', 'webhook', 'pending', 1, now() - interval '10 minutes'),
    ('99999999-0000-0000-0000-000000048703', T, 'contact', '99999999-0000-0000-0000-0000000048c1', 'webhook', 'pending', 1, now() - interval '16 minutes'),
    ('99999999-0000-0000-0000-000000048704', T, 'contact', '99999999-0000-0000-0000-0000000048c1', 'webhook', 'pending', 3, now() - interval '2 hours'),
    ('99999999-0000-0000-0000-000000048705', T, 'contact', '99999999-0000-0000-0000-0000000048c1', 'webhook', 'pending', 3, now() - interval '3 hours'),
    ('99999999-0000-0000-0000-000000048706', T, 'contact', '99999999-0000-0000-0000-0000000048c1', 'webhook', 'failed',  5, now() - interval '3 days'),
    ('99999999-0000-0000-0000-000000048707', T, 'contact', '99999999-0000-0000-0000-0000000048c1', 'webhook', 'synced',  0, now() - interval '3 days');
  -- crm_sync_log has an updated_at trigger; set the ages again after insert.
  update crm_sync_log set updated_at = now() - interval '10 minutes' where id = '99999999-0000-0000-0000-000000048702';
  if (select array_agg(right(d.sync_id::text, 2) order by d.sync_id) from due_crm_syncs(100) d
       where d.sync_id::text like '99999999-0000-0000-0000-0000000487%') is distinct from array['01', '03', '05'] then
    raise exception '6: due syncs are %', (select array_agg(right(d.sync_id::text, 2) order by d.sync_id) from due_crm_syncs(100) d where d.sync_id::text like '99999999-0000-0000-0000-0000000487%'); end if;

  -- ── 7. None of it is callable from the dashboard or the public key ──
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('claim_due_follow_up_runs', 'record_elliot_failure', 'record_tool_failure', 'record_whatsapp_delivery_failure', 'due_crm_syncs')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if n <> 0 then raise exception '7: % functions callable from the API', n; end if;
  if has_table_privilege('anon', 'whatsapp_delivery_failures', 'select') or has_table_privilege('authenticated', 'whatsapp_delivery_failures', 'select') then
    raise exception '7: whatsapp_delivery_failures readable from the API'; end if;
end $$;

select '0048 checks passed' as result;
rollback;
