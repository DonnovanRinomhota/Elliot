-- Scenario test for 0039 (agency email addresses). Scratch database only;
-- rolls back. Ends with "0039 checks passed".
begin;

insert into tenants (id, name, slug, timezone, assistant_mode) values
  ('99999999-0000-0000-0000-000000000391', 'Simon Real Estate', 'simon-391', 'Europe/Warsaw', 'agency'),
  ('99999999-0000-0000-0000-000000000392', 'Agency B', 'b-392', 'Europe/Warsaw', 'agency'),
  ('99999999-0000-0000-0000-000000000393', 'Elliot', 'sales-393', 'Europe/Warsaw', 'sales'),
  ('99999999-0000-0000-0000-000000000394', 'Gone', 'gone-394', 'Europe/Warsaw', 'agency');
update tenants set status = 'cancelled' where id = '99999999-0000-0000-0000-000000000394';
insert into ai_config (tenant_id, connected_gmail_address) values
  ('99999999-0000-0000-0000-000000000391', ' Biuro@Simon.pl '),
  ('99999999-0000-0000-0000-000000000392', null),
  ('99999999-0000-0000-0000-000000000393', null),
  ('99999999-0000-0000-0000-000000000394', 'gone@x.pl')
on conflict (tenant_id) do update set connected_gmail_address = excluded.connected_gmail_address;

do $$
declare j jsonb; r record; n int;
begin
  -- 1. Client emails: the agency's name, Elliot's sending domain, Reply-To the agency.
  j := email_sender('99999999-0000-0000-0000-000000000391', 'client');
  if j->>'name' <> 'Simon Real Estate' or j->>'address' <> 'simon-391@mail.getelliot.eu'
     or j->>'reply_to' <> 'biuro@simon.pl' or j->>'inbound_address' <> 'simon-391@in.getelliot.eu' or (j->>'own_domain')::boolean then
    raise exception '1: %', j; end if;

  -- 2. No agency address: replies come straight to Elliot. Own sender name used.
  update ai_config set email_from_name = ' Biuro B ' where tenant_id = '99999999-0000-0000-0000-000000000392';
  j := email_sender('99999999-0000-0000-0000-000000000392', 'client');
  if j->>'reply_to' <> 'b-392@in.getelliot.eu' or j->>'name' <> 'Biuro B' then raise exception '2: %', j; end if;

  -- 3. Team emails: from Elliot, no Reply-To; the sales account is just "Elliot".
  j := email_sender('99999999-0000-0000-0000-000000000391', 'team');
  if j->>'name' <> 'Elliot · Simon Real Estate' or j ? 'reply_to' and j->>'reply_to' is not null then raise exception '3: %', j; end if;
  j := email_sender('99999999-0000-0000-0000-000000000393', 'team');
  if j->>'name' <> 'Elliot' then raise exception '3b: %', j; end if;
  j := email_sender(null, 'team');
  if j->>'address' <> 'notifications@mail.getelliot.eu' then raise exception '3c: %', j; end if;

  -- 4. The agency's own domain, once set by the administrator.
  insert into email_sending_identities (tenant_id, from_address) values ('99999999-0000-0000-0000-000000000391', 'elliot@simon.pl');
  j := email_sender('99999999-0000-0000-0000-000000000391', 'client');
  if j->>'address' <> 'elliot@simon.pl' or not (j->>'own_domain')::boolean then raise exception '4: %', j; end if;
  begin
    insert into email_sending_identities (tenant_id, from_address) values ('99999999-0000-0000-0000-000000000392', 'not an address');
    raise exception '4b: bad address accepted';
  exception when check_violation then null;
  end;

  -- 5. Which agency: Elliot address first, then the agency's own (any case), never a cancelled one.
  select * into r from email_inbound_tenant(array['someone@else.pl', 'SIMON-391@in.getelliot.eu']);
  if r.tenant_id <> '99999999-0000-0000-0000-000000000391' or r.matched_by <> 'elliot_address' or r.agency_email <> 'biuro@simon.pl' then
    raise exception '5: %', row_to_json(r); end if;
  select * into r from email_inbound_tenant(array['biuro@simon.pl']);
  if r.tenant_id <> '99999999-0000-0000-0000-000000000391' or r.matched_by <> 'agency_address' then raise exception '5b: %', row_to_json(r); end if;
  select * into r from email_inbound_tenant(array['biuro@simon.pl', 'b-392@in.getelliot.eu']);
  if r.tenant_id <> '99999999-0000-0000-0000-000000000392' then raise exception '5c: elliot address should win'; end if;
  select count(*) into n from email_inbound_tenant(array['gone-394@in.getelliot.eu', 'gone@x.pl']);
  if n <> 0 then raise exception '5d: cancelled agency matched'; end if;
  select count(*) into n from email_inbound_tenant(null);
  if n <> 0 then raise exception '5e'; end if;

  -- 6. Each email once; last-received recorded only for new ones.
  if not email_inbound_claim('99999999-0000-0000-0000-000000000391', '<ABC@mail.com>', 'Client@X.pl') then raise exception '6: first'; end if;
  if email_inbound_claim('99999999-0000-0000-0000-000000000391', ' <abc@mail.com>', 'client@x.pl') then raise exception '6: repeat'; end if;
  select count(*) into n from ai_config where tenant_id = '99999999-0000-0000-0000-000000000391'
    and email_inbound_last_from = 'client@x.pl' and email_inbound_last_at > now() - interval '1 minute';
  if n <> 1 then raise exception '6: last received'; end if;
  if not email_inbound_claim('99999999-0000-0000-0000-000000000391', null, 'x@y.pl') then raise exception '6: no id lets through'; end if;

  -- 7. Gmail's forwarding code; only Google links kept.
  perform record_email_forwarding_code('99999999-0000-0000-0000-000000000392', '123456789', 'https://mail-settings.google.com/mail/vf-abc');
  select count(*) into n from ai_config where tenant_id = '99999999-0000-0000-0000-000000000392'
    and email_forwarding_code = '123456789' and email_forwarding_url like 'https://mail-settings.google.com/%';
  if n <> 1 then raise exception '7'; end if;
  perform record_email_forwarding_code('99999999-0000-0000-0000-000000000392', '1', 'https://evil.example/google.com/');
  select count(*) into n from ai_config where tenant_id = '99999999-0000-0000-0000-000000000392' and email_forwarding_url is null;
  if n <> 1 then raise exception '7b: non-Google link kept'; end if;

  -- 8. Agencies can't call the service functions.
  if has_function_privilege('authenticated', 'email_sender(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'email_inbound_tenant(text[])', 'execute') then
    raise exception '8: functions open to agencies'; end if;
  if has_table_privilege('authenticated', 'email_sending_identities', 'insert') then raise exception '8b'; end if;

  raise notice '0039 checks passed';
end $$;

rollback;
