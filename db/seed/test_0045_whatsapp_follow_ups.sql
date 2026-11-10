-- Scenario test for 0045 (WhatsApp follow-ups). Scratch database only; rolls back.
-- Ends with "0045 checks passed".
begin;
insert into tenants (id, name, slug, timezone, assistant_mode) values
  ('99999999-0000-0000-0000-000000000451', 'Agency W', 'w-451', 'Europe/Warsaw', 'agency');
insert into ai_config (tenant_id, whatsapp_phone_number_id) values ('99999999-0000-0000-0000-000000000451', 'PNID-1')
  on conflict (tenant_id) do update set whatsapp_phone_number_id = excluded.whatsapp_phone_number_id;
insert into contacts (id, tenant_id, name, email, phone) values
  ('99999999-0000-0000-0000-0000000004c1', '99999999-0000-0000-0000-000000000451', 'Email only', 'a@example.com', null),
  ('99999999-0000-0000-0000-0000000004c2', '99999999-0000-0000-0000-000000000451', 'WhatsApp only', null, '+48 600 100 200'),
  ('99999999-0000-0000-0000-0000000004c3', '99999999-0000-0000-0000-000000000451', 'Nothing', null, '+48 600 100 300'),
  ('99999999-0000-0000-0000-0000000004c4', '99999999-0000-0000-0000-000000000451', 'WhatsApp, never wrote', null, '+48 600 100 400');
insert into conversations (id, tenant_id, contact_id, channel) values
  ('99999999-0000-0000-0000-0000000004d2', '99999999-0000-0000-0000-000000000451', '99999999-0000-0000-0000-0000000004c2', 'whatsapp'),
  ('99999999-0000-0000-0000-0000000004d4', '99999999-0000-0000-0000-000000000451', '99999999-0000-0000-0000-0000000004c4', 'whatsapp');
insert into messages (tenant_id, conversation_id, role, content, created_at) values
  ('99999999-0000-0000-0000-000000000451', '99999999-0000-0000-0000-0000000004d2', 'user', 'Is the flat still available?', now() - interval '3 days'),
  ('99999999-0000-0000-0000-000000000451', '99999999-0000-0000-0000-0000000004d4', 'assistant', 'Hello from the agency', now() - interval '3 days');
insert into leads (id, tenant_id, contact_id, status, created_at)
  select gen_random_uuid(), '99999999-0000-0000-0000-000000000451', c, 'WARM', now() - interval '3 days'
  from unnest(array['99999999-0000-0000-0000-0000000004c1', '99999999-0000-0000-0000-0000000004c2',
                    '99999999-0000-0000-0000-0000000004c3', '99999999-0000-0000-0000-0000000004c4']::uuid[]) c;
insert into follow_up_sequences (id, tenant_id, name, steps, is_active, auto_enrol, auto_enrol_since, auto_enrol_after_hours) values
  ('99999999-0000-0000-0000-0000000004e1', '99999999-0000-0000-0000-000000000451', 'Mixed',
   '[{"day_offset": 0, "channel": "whatsapp", "subject": "", "body": "Hi {{contact_name}}"}, {"day_offset": 3, "channel": "email", "subject": "S", "body": "B"}]',
   true, true, now() - interval '10 days', 24);

do $$
declare n int; enrolled uuid[]; d whatsapp_drafts;
begin
  -- 1. Enrolled: the client with an email and the one who wrote on WhatsApp;
  --    not the one with only a phone, nor the one who never wrote on WhatsApp.
  select array_agg(l.contact_id order by c.name) into enrolled
    from enrol_quiet_leads(100) e join leads l on l.id = e.lead_id join contacts c on c.id = l.contact_id
   where e.tenant_id = '99999999-0000-0000-0000-000000000451';
  if enrolled <> array['99999999-0000-0000-0000-0000000004c1', '99999999-0000-0000-0000-0000000004c2']::uuid[] then
    raise exception '1: enrolled %', enrolled; end if;

  -- 2. Follow-up WhatsApp drafts record how they were sent and why WhatsApp refused one.
  insert into whatsapp_drafts (tenant_id, conversation_id, contact_id, to_wa_id, phone_number_id, last_inbound_at, body, category, status)
  values ('99999999-0000-0000-0000-000000000451', '99999999-0000-0000-0000-0000000004d2', '99999999-0000-0000-0000-0000000004c2',
          '48600100200', 'PNID-1', now() - interval '3 days', 'Hi', 'follow_up', 'approved') returning * into d;
  update whatsapp_drafts set status = 'sent', sent_via = 'template' where id = d.id;
  update whatsapp_drafts set status = 'blocked_needs_template', send_error = 'Template not approved' where id = d.id;
  begin
    update whatsapp_drafts set sent_via = 'sms' where id = d.id;
    raise exception '2: sent_via accepted sms';
  exception when check_violation then null;
  end;
end $$;

select '0045 checks passed' as result;
rollback;
