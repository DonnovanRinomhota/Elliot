-- Scenario test for 0035 (email instant replies). Scratch database only;
-- rolls back. Ends with "0035 checks passed".
begin;

insert into tenants (id, name, slug) values
  ('99999999-0000-0000-0000-000000000001', 'Email Agency', 'email-test'),
  ('99999999-0000-0000-0000-000000000002', 'Other Agency', 'email-other-test');
insert into conversations (id, tenant_id, channel) values
  ('99999999-1111-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', 'email');

do $$
declare n int; note text;
begin
  perform log_reply_send_failure('99999999-0000-0000-0000-000000000001', '99999999-1111-0000-0000-000000000001',
                                 'email', 'Invalid Credentials', jsonb_build_object('status', 401));
  select count(*) into n from audit_log
   where tenant_id = '99999999-0000-0000-0000-000000000001' and event_type = 'email_send_failed'
     and details->>'error' = 'Invalid Credentials' and (details->>'status')::int = 401;
  if n <> 1 then raise exception 'audit row missing'; end if;
  select content into note from messages where conversation_id = '99999999-1111-0000-0000-000000000001' and role = 'system';
  if note <> 'Elliot''s last reply wasn''t delivered by email: Invalid Credentials' then raise exception 'note: %', note; end if;

  -- Another agency's conversation: audit row, no note.
  perform log_reply_send_failure('99999999-0000-0000-0000-000000000002', '99999999-1111-0000-0000-000000000001', null, '', null);
  select count(*) into n from messages where conversation_id = '99999999-1111-0000-0000-000000000001';
  if n <> 1 then raise exception 'wrote into another agency''s conversation'; end if;
  if not exists (select 1 from audit_log where tenant_id = '99999999-0000-0000-0000-000000000002' and event_type = 'chat_send_failed' and details->>'error' = 'unknown error') then
    raise exception 'defaults not applied';
  end if;

  -- Gmail ids are claimed once, like WhatsApp ids.
  if not claim_whatsapp_message('99999999-0000-0000-0000-000000000001', 'gmail:18f0a') then raise exception 'first should be new'; end if;
  if claim_whatsapp_message('99999999-0000-0000-0000-000000000001', 'gmail:18f0a') then raise exception 'repeat should be ignored'; end if;

  raise notice '0035 checks passed';
end $$;

rollback;
