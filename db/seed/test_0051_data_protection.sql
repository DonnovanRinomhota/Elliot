-- Scenario test for 0051 (export, erasure, retention, removing an agency).
-- Scratch database only; rolls back. Ends with "0051 checks passed".
begin;
insert into tenants (id, name, slug, timezone, status) values
  ('99999999-0000-0000-0000-000000000511', 'Agency P', 'p-511', 'Europe/Warsaw', 'active'),
  ('99999999-0000-0000-0000-000000000512', 'Agency Q', 'q-512', 'Europe/Warsaw', 'active');
insert into ai_config (tenant_id) values ('99999999-0000-0000-0000-000000000511'), ('99999999-0000-0000-0000-000000000512') on conflict do nothing;
insert into auth.users (id, email) values
  ('99999999-aaaa-0000-0000-000000000511', 'admin@p.test'), ('99999999-aaaa-0000-0000-000000000512', 'agent@p.test'),
  ('99999999-aaaa-0000-0000-000000000513', 'admin@q.test'), ('99999999-aaaa-0000-0000-000000000514', 'both@p.test');
insert into tenant_users (tenant_id, auth_user_id, email, role) values
  ('99999999-0000-0000-0000-000000000511', '99999999-aaaa-0000-0000-000000000511', 'admin@p.test', 'admin'),
  ('99999999-0000-0000-0000-000000000511', '99999999-aaaa-0000-0000-000000000512', 'agent@p.test', 'agent'),
  ('99999999-0000-0000-0000-000000000512', '99999999-aaaa-0000-0000-000000000513', 'admin@q.test', 'admin'),
  ('99999999-0000-0000-0000-000000000511', '99999999-aaaa-0000-0000-000000000514', 'both@p.test', 'agent'),
  ('99999999-0000-0000-0000-000000000512', '99999999-aaaa-0000-0000-000000000514', 'both@p.test', 'agent');
-- Anna (to erase) and Bob (stays) at agency P.
insert into contacts (id, tenant_id, name, email, phone) values
  ('99999999-cccc-0000-0000-000000000511', '99999999-0000-0000-0000-000000000511', 'Anna Erase', 'anna.erase@example.com', '+48600511511'),
  ('99999999-cccc-0000-0000-000000000512', '99999999-0000-0000-0000-000000000511', 'Bob Stays', 'bob.stays@example.com', null);
insert into conversations (id, tenant_id, contact_id, channel) values
  ('99999999-dddd-0000-0000-000000000511', '99999999-0000-0000-0000-000000000511', '99999999-cccc-0000-0000-000000000511', 'email'),
  ('99999999-dddd-0000-0000-000000000512', '99999999-0000-0000-0000-000000000511', '99999999-cccc-0000-0000-000000000512', 'chat_widget');
insert into messages (tenant_id, conversation_id, role, content) values
  ('99999999-0000-0000-0000-000000000511', '99999999-dddd-0000-0000-000000000511', 'user', 'I am Anna, my number is +48600511511'),
  ('99999999-0000-0000-0000-000000000511', '99999999-dddd-0000-0000-000000000511', 'assistant', 'Thanks Anna'),
  ('99999999-0000-0000-0000-000000000511', '99999999-dddd-0000-0000-000000000512', 'user', 'Bob here');
insert into leads (id, tenant_id, contact_id, status, qualification_answers) values
  ('99999999-eeee-0000-0000-000000000511', '99999999-0000-0000-0000-000000000511', '99999999-cccc-0000-0000-000000000511', 'HOT', '{"budget": 800000}'),
  ('99999999-eeee-0000-0000-000000000512', '99999999-0000-0000-0000-000000000511', '99999999-cccc-0000-0000-000000000512', 'WARM', '{}');
insert into follow_up_sequences (id, tenant_id, name, steps) values ('99999999-ffff-0000-0000-000000000511', '99999999-0000-0000-0000-000000000511', 'S', '[]');
insert into follow_up_runs (tenant_id, lead_id, sequence_id, status) values ('99999999-0000-0000-0000-000000000511', '99999999-eeee-0000-0000-000000000511', '99999999-ffff-0000-0000-000000000511', 'running');
insert into appointments (id, tenant_id, contact_id, conversation_id, starts_at, ends_at, status, external_calendar_id, booked_calendar_id, timezone) values
  ('99999999-bbbb-0000-0000-000000000511', '99999999-0000-0000-0000-000000000511', '99999999-cccc-0000-0000-000000000511', '99999999-dddd-0000-0000-000000000511',
   now() + interval '2 days', now() + interval '2 days 30 minutes', 'confirmed', 'gcal-511', 'ola@p.test', 'Europe/Warsaw');
insert into escalations (tenant_id, conversation_id, reason, priority, context_summary) values
  ('99999999-0000-0000-0000-000000000511', '99999999-dddd-0000-0000-000000000511', 'other', 'high', 'Anna wants a call');
insert into email_drafts (tenant_id, conversation_id, contact_id, to_email, subject, body, status, category) values
  ('99999999-0000-0000-0000-000000000511', '99999999-dddd-0000-0000-000000000511', '99999999-cccc-0000-0000-000000000511', 'anna.erase@example.com', 'Hi', 'Hi Anna', 'pending', 'other');
insert into message_attachments (tenant_id, conversation_id, source, filename, content_type, size_bytes, storage_path) values
  ('99999999-0000-0000-0000-000000000511', '99999999-dddd-0000-0000-000000000511', 'email', 'mortgage.pdf', 'application/pdf', 1000,
   '99999999-0000-0000-0000-000000000511/99999999-dddd-0000-0000-000000000511/1-mortgage.pdf');
insert into tool_call_log (tenant_id, conversation_id, tool_name, tool_input, decision) values
  ('99999999-0000-0000-0000-000000000511', '99999999-dddd-0000-0000-000000000511', 'capture_lead', '{"email":"anna.erase@example.com"}', 'auto_approved');
insert into crm_sync_log (tenant_id, entity_type, entity_id, crm_provider, status) values
  ('99999999-0000-0000-0000-000000000511', 'contact', '99999999-cccc-0000-0000-000000000511', 'webhook', 'synced');
insert into audit_log (tenant_id, actor_type, event_type, details) values
  ('99999999-0000-0000-0000-000000000511', 'system', 'whatsapp_send_failed', '{"conversation_id":"99999999-dddd-0000-0000-000000000511","error":"to +48600511511"}'),
  ('99999999-0000-0000-0000-000000000511', 'system', 'other_event', '{"conversation_id":"99999999-dddd-0000-0000-000000000512"}');

-- ── 1. Who may ──
select set_config('request.jwt.claim.sub', '99999999-aaaa-0000-0000-000000000512', true);  -- agent at P
set local role authenticated;
do $$ begin
  begin perform export_client('99999999-cccc-0000-0000-000000000511'); raise exception 'FAIL: an agent exported'; exception when insufficient_privilege then null; end;
  begin perform erase_client('99999999-cccc-0000-0000-000000000511'); raise exception 'FAIL: an agent erased'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '99999999-aaaa-0000-0000-000000000513', true);  -- admin at Q
set local role authenticated;
do $$ begin
  begin perform erase_client('99999999-cccc-0000-0000-000000000511'); raise exception 'FAIL: another agency erased'; exception when no_data_found then null; end;
  begin perform export_client('99999999-cccc-0000-0000-000000000511'); raise exception 'FAIL: another agency exported'; exception when no_data_found then null; end;
  begin perform erase_client_data('99999999-0000-0000-0000-000000000511', '99999999-cccc-0000-0000-000000000511', 'x', 'x'); raise exception 'FAIL: internal function callable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ── 2. Export (admin at P) ──
select set_config('request.jwt.claim.sub', '99999999-aaaa-0000-0000-000000000511', true);
set local role authenticated;
do $$
declare j jsonb;
begin
  j := export_client('99999999-cccc-0000-0000-000000000511');
  if j #>> '{contact,email}' <> 'anna.erase@example.com' then raise exception '2: contact %', j -> 'contact'; end if;
  if jsonb_array_length(j #> '{conversations,0,messages}') <> 2 or j #>> '{conversations,0,messages,1,from}' <> 'Elliot (AI)' then raise exception '2: messages %', j -> 'conversations'; end if;
  if j #>> '{conversations,0,files,0,name}' <> 'mortgage.pdf' then raise exception '2: files'; end if;
  if j #>> '{enquiries,0,status}' <> 'HOT' or jsonb_array_length(j -> 'appointments') <> 1 or jsonb_array_length(j -> 'messages_drafted') <> 1 then raise exception '2: rest %', j; end if;
  if j::text like '%Bob%' then raise exception '2: another client in the export'; end if;
end $$;

-- ── 3. Erase ──
do $$
declare j jsonb; n int;
begin
  j := erase_client('99999999-cccc-0000-0000-000000000511');
  if (j ->> 'conversations')::int <> 1 or (j ->> 'messages')::int <> 2 or (j ->> 'leads')::int <> 1 or (j ->> 'appointments')::int <> 1
     or (j ->> 'drafts')::int <> 1 or (j ->> 'files')::int <> 1 then raise exception '3: counts %', j; end if;
  if j -> 'storage_paths' <> '["99999999-0000-0000-0000-000000000511/99999999-dddd-0000-0000-000000000511/1-mortgage.pdf"]' then raise exception '3: files %', j -> 'storage_paths'; end if;
  if j #>> '{calendar_events,0,event_id}' <> 'gcal-511' then raise exception '3: calendar events %', j -> 'calendar_events'; end if;
end $$;
reset role;
do $$
declare n int;
begin
  select (select count(*) from contacts where id = '99999999-cccc-0000-0000-000000000511')
       + (select count(*) from conversations where id = '99999999-dddd-0000-0000-000000000511')
       + (select count(*) from messages where conversation_id = '99999999-dddd-0000-0000-000000000511')
       + (select count(*) from leads where id = '99999999-eeee-0000-0000-000000000511')
       + (select count(*) from follow_up_runs where lead_id = '99999999-eeee-0000-0000-000000000511')
       + (select count(*) from appointments where id = '99999999-bbbb-0000-0000-000000000511')
       + (select count(*) from escalations where conversation_id = '99999999-dddd-0000-0000-000000000511')
       + (select count(*) from email_drafts where to_email = 'anna.erase@example.com')
       + (select count(*) from message_attachments where filename = 'mortgage.pdf')
       + (select count(*) from tool_call_log where tool_input::text like '%anna.erase%')
       + (select count(*) from crm_sync_log where entity_id = '99999999-cccc-0000-0000-000000000511')
       + (select count(*) from audit_log where details::text like '%48600511511%')
    into n;
  if n <> 0 then raise exception '3: % rows about Anna remain', n; end if;
  -- Bob is untouched.
  if (select count(*) from messages where conversation_id = '99999999-dddd-0000-0000-000000000512') <> 1
     or not exists (select 1 from leads where id = '99999999-eeee-0000-0000-000000000512')
     or not exists (select 1 from audit_log where event_type = 'other_event') then raise exception '3: another client was touched'; end if;
  -- One record that it happened, with no personal data.
  if (select count(*) from audit_log where event_type = 'privacy.client_erased' and tenant_id = '99999999-0000-0000-0000-000000000511') <> 1 then raise exception '3: no erasure record'; end if;
  if exists (select 1 from audit_log where event_type like 'privacy.%' and details::text ~* 'anna|erase@|4860') then raise exception '3: the erasure record holds personal data'; end if;
end $$;

-- ── 4. Retention ──
do $$
declare j jsonb; n int;
begin
  insert into contacts (id, tenant_id, name, email, created_at, updated_at) values
    ('99999999-cccc-0000-0000-000000000521', '99999999-0000-0000-0000-000000000512', 'Old Client', 'old@example.com', now() - interval '20 months', now() - interval '20 months'),
    ('99999999-cccc-0000-0000-000000000522', '99999999-0000-0000-0000-000000000512', 'Old But Booked', 'booked@example.com', now() - interval '20 months', now() - interval '20 months'),
    ('99999999-cccc-0000-0000-000000000523', '99999999-0000-0000-0000-000000000512', 'Old, Wrote Lately', 'recent@example.com', now() - interval '20 months', now() - interval '20 months');
  insert into conversations (id, tenant_id, contact_id, channel) values ('99999999-dddd-0000-0000-000000000523', '99999999-0000-0000-0000-000000000512', '99999999-cccc-0000-0000-000000000523', 'email');
  insert into messages (tenant_id, conversation_id, role, content, created_at) values ('99999999-0000-0000-0000-000000000512', '99999999-dddd-0000-0000-000000000523', 'user', 'hi', now() - interval '2 months');
  insert into appointments (tenant_id, contact_id, starts_at, ends_at, status, timezone) values
    ('99999999-0000-0000-0000-000000000512', '99999999-cccc-0000-0000-000000000522', now() + interval '3 days', now() + interval '3 days 1 hour', 'confirmed', 'Europe/Warsaw');
  update appointments set updated_at = now() - interval '20 months' where contact_id = '99999999-cccc-0000-0000-000000000522';
  -- Off by default: nothing to erase.
  if exists (select 1 from retention_preview() where tenant_id = '99999999-0000-0000-0000-000000000512') then raise exception '4: retention without a setting'; end if;
  update ai_config set retention_months = 12 where tenant_id = '99999999-0000-0000-0000-000000000512';
  select count(*) into n from retention_preview() where tenant_id = '99999999-0000-0000-0000-000000000512';
  if n <> 1 or not exists (select 1 from retention_preview() where contact_id = '99999999-cccc-0000-0000-000000000521') then
    raise exception '4: preview should list only the old client with nothing coming up (%)', n; end if;
  j := apply_retention(500);
  if (j ->> 'clients_erased')::int < 1 or exists (select 1 from contacts where id = '99999999-cccc-0000-0000-000000000521') then raise exception '4: not erased %', j; end if;
  if not exists (select 1 from contacts where id = '99999999-cccc-0000-0000-000000000522') or not exists (select 1 from contacts where id = '99999999-cccc-0000-0000-000000000523') then
    raise exception '4: erased someone with a viewing to come or recent messages'; end if;
  begin update ai_config set retention_months = 1 where tenant_id = '99999999-0000-0000-0000-000000000512'; raise exception '4: 1 month allowed';
  exception when check_violation then null; end;
end $$;

-- ── 5. Removing an agency ──
do $$
declare j jsonb;
begin
  insert into storage.objects (bucket_id, name) values
    ('email-attachments', '99999999-0000-0000-0000-000000000512/c/1-a.pdf'),
    ('listing-photos', '99999999-0000-0000-0000-000000000512/l/p.jpg'),
    ('listing-photos', '99999999-0000-0000-0000-000000000511/l/keep.jpg');
  begin perform erase_agency('99999999-0000-0000-0000-000000000512', 'q-512'); raise exception '5: an active agency was erased';
  exception when raise_exception then if sqlerrm not like 'Set the agency to Cancelled%' then raise; end if; end;
  update tenants set status = 'cancelled' where id = '99999999-0000-0000-0000-000000000512';
  begin perform erase_agency('99999999-0000-0000-0000-000000000512', 'wrong'); raise exception '5: wrong confirmation accepted';
  exception when raise_exception then if sqlerrm not like 'Type the agency%' then raise; end if; end;
  j := erase_agency('99999999-0000-0000-0000-000000000512', 'q-512', 'don@example.com');
  if exists (select 1 from tenants where id = '99999999-0000-0000-0000-000000000512')
     or exists (select 1 from contacts where tenant_id = '99999999-0000-0000-0000-000000000512') then raise exception '5: data left behind'; end if;
  if jsonb_array_length(j -> 'files') <> 2 or j::text like '%keep.jpg%' then raise exception '5: files %', j -> 'files'; end if;
  if j -> 'logins' <> '["99999999-aaaa-0000-0000-000000000513"]' then raise exception '5: logins % (a person in another agency keeps theirs)', j -> 'logins'; end if;
  if not exists (select 1 from audit_log where event_type = 'platform.agency_erased' and details ->> 'slug' = 'q-512') then raise exception '5: not recorded'; end if;
  if exists (select 1 from tenant_users where tenant_id = '99999999-0000-0000-0000-000000000511' and email = 'both@p.test') is false then raise exception '5: removed a membership at another agency'; end if;
end $$;

-- ── 6. Permissions ──
do $$
declare n int;
begin
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('client_data', 'erase_client_data', 'retention_preview', 'apply_retention', 'erase_agency', 'client_last_activity')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if n <> 0 then raise exception '6: % internal functions reachable from the API', n; end if;
  if has_function_privilege('anon', 'erase_client(uuid)', 'execute') or has_function_privilege('anon', 'export_client(uuid)', 'execute') then
    raise exception '6: the public key can export or erase'; end if;
end $$;

select '0051 checks passed' as result;
rollback;
