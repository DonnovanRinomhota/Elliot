-- Scenario test for 0032 (WhatsApp instant replies). Scratch database only;
-- rolls back. Ends with "0032 checks passed".
begin;

insert into tenants (id, name, slug) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'WhatsApp Agency A', 'wa-a-test'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'WhatsApp Agency B', 'wa-b-test');
insert into conversations (id, tenant_id, channel) values
  ('eeeeeeee-1111-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'whatsapp');

do $$
declare
  i int;
  r record;
  n int;
  first_role text;
  last_content text;
begin
  -- 1. The first delivery of a message id is new; Meta's repeat isn't.
  if not claim_whatsapp_message('eeeeeeee-0000-0000-0000-000000000001', 'wamid.ABC') then raise exception 'first delivery should be new'; end if;
  if claim_whatsapp_message('eeeeeeee-0000-0000-0000-000000000001', 'wamid.ABC') then raise exception 'repeat should be ignored'; end if;
  if claim_whatsapp_message('eeeeeeee-0000-0000-0000-000000000001', ' wamid.ABC ') then raise exception 'spaces made a repeat look new'; end if;
  if not claim_whatsapp_message('eeeeeeee-0000-0000-0000-000000000001', 'wamid.DEF') then raise exception 'another message should be new'; end if;
  if not claim_whatsapp_message('eeeeeeee-0000-0000-0000-000000000001', '') then raise exception 'no id should pass through'; end if;
  if (select count(*) from whatsapp_inbound_messages where tenant_id = 'eeeeeeee-0000-0000-0000-000000000001') <> 2 then
    raise exception 'expected two claimed ids';
  end if;

  -- 2. History: the latest 20, oldest first.
  for i in 1..30 loop
    insert into messages (tenant_id, conversation_id, role, content, created_at)
    values ('eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-1111-0000-0000-000000000001',
            case when i % 2 = 1 then 'user' else 'assistant' end, 'message ' || i,
            now() - make_interval(mins => 31 - i));
  end loop;
  select count(*) into n from get_conversation_history('eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-1111-0000-0000-000000000001');
  if n <> 20 then raise exception 'expected 20 messages, got %', n; end if;
  select h.content into r from get_conversation_history('eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-1111-0000-0000-000000000001') h limit 1;
  if r.content <> 'message 11' then raise exception 'history should start at message 11, got %', r.content; end if;
  select h.content into last_content from get_conversation_history('eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-1111-0000-0000-000000000001') h offset 19;
  if last_content <> 'message 30' then raise exception 'history should end at the newest message, got %', last_content; end if;
  select count(*) into n from get_conversation_history('eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-1111-0000-0000-000000000001', 5);
  if n <> 5 then raise exception 'limit not respected'; end if;

  -- 3. A refused reply: audit row + a note the team sees in the chat.
  perform log_whatsapp_send_failure('eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-1111-0000-0000-000000000001',
                                    '(#131047) Re-engagement message', jsonb_build_object('status', 400));
  select count(*) into n from audit_log
   where tenant_id = 'eeeeeeee-0000-0000-0000-000000000001' and event_type = 'whatsapp_send_failed'
     and details->>'error' = '(#131047) Re-engagement message' and (details->>'status')::int = 400;
  if n <> 1 then raise exception 'audit row missing'; end if;
  select role into first_role from messages
   where conversation_id = 'eeeeeeee-1111-0000-0000-000000000001' and content like 'Elliot''s last reply wasn''t delivered%';
  if first_role is distinct from 'system' then raise exception 'no system note in the conversation'; end if;

  -- Another agency's conversation id gets the audit row but no note.
  perform log_whatsapp_send_failure('eeeeeeee-0000-0000-0000-000000000002', 'eeeeeeee-1111-0000-0000-000000000001', '', null);
  select count(*) into n from messages
   where conversation_id = 'eeeeeeee-1111-0000-0000-000000000001' and role = 'system';
  if n <> 1 then raise exception 'wrote a note into another agency''s conversation'; end if;
  if not exists (select 1 from audit_log where tenant_id = 'eeeeeeee-0000-0000-0000-000000000002' and details->>'error' = 'unknown error') then
    raise exception 'empty error should be recorded as unknown error';
  end if;

  raise notice '0032 checks passed';
end $$;

rollback;
