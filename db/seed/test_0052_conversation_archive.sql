-- Scenario test for 0052 (archived conversations).
-- Scratch database only; rolls back. Ends with "0052 checks passed".
begin;
insert into tenants (id, name, slug, timezone, status) values
  ('99999999-0000-0000-0000-000000000521', 'Agency A', 'a-521', 'Europe/Warsaw', 'active'),
  ('99999999-0000-0000-0000-000000000522', 'Agency B', 'b-522', 'Europe/Warsaw', 'active');
insert into auth.users (id, email) values
  ('99999999-aaaa-0000-0000-000000000521', 'agent@a.test'), ('99999999-aaaa-0000-0000-000000000522', 'agent@b.test');
insert into tenant_users (id, tenant_id, auth_user_id, email, role) values
  ('99999999-bbbb-0000-0000-000000000521', '99999999-0000-0000-0000-000000000521', '99999999-aaaa-0000-0000-000000000521', 'agent@a.test', 'agent'),
  ('99999999-bbbb-0000-0000-000000000522', '99999999-0000-0000-0000-000000000522', '99999999-aaaa-0000-0000-000000000522', 'agent@b.test', 'agent');
insert into conversations (id, tenant_id, channel, status) values
  ('99999999-dddd-0000-0000-000000000521', '99999999-0000-0000-0000-000000000521', 'whatsapp', 'open');

do $$
declare c uuid := '99999999-dddd-0000-0000-000000000521'; t uuid := '99999999-0000-0000-0000-000000000521';
        a timestamptz;
begin
  -- 1. Closing archives it.
  update conversations set status = 'closed' where id = c;
  if (select archived_at from conversations where id = c) is null then raise exception '1: closing did not archive'; end if;

  -- 2. Elliot's own reply doesn't bring it back; the client writing does.
  insert into messages (tenant_id, conversation_id, role, content) values (t, c, 'assistant', 'Anything else?');
  if (select archived_at from conversations where id = c) is null then raise exception '2a: Elliot''s message brought it back'; end if;
  insert into messages (tenant_id, conversation_id, role, content) values (t, c, 'user', 'One more question');
  if (select archived_at from conversations where id = c) is not null then raise exception '2b: the client writing did not bring it back'; end if;

  -- 3. A person from the agency replying brings it back too.
  update conversations set archived_at = now() where id = c;
  insert into messages (tenant_id, conversation_id, role, content) values (t, c, 'human_agent', 'Hi, Ola here');
  if (select archived_at from conversations where id = c) is not null then raise exception '3: the agency replying did not bring it back'; end if;

  -- 4. Reopening (status no longer closed) brings it back.
  update conversations set status = 'open' where id = c;
  update conversations set status = 'closed' where id = c;
  if (select archived_at from conversations where id = c) is null then raise exception '4a: closing again did not archive'; end if;
  update conversations set status = 'open' where id = c;
  if (select archived_at from conversations where id = c) is not null then raise exception '4b: reopening did not bring it back'; end if;
end $$;

-- 5. Archiving from the dashboard keeps updated_at; another agency can't.
alter table conversations disable trigger trg_conversations_updated_at;
update conversations set updated_at = '2026-01-01T10:00:00Z' where id = '99999999-dddd-0000-0000-000000000521';
alter table conversations enable trigger trg_conversations_updated_at;

select set_config('request.jwt.claim.sub', '99999999-aaaa-0000-0000-000000000521', true);
set local role authenticated;
select archive_conversation('99999999-dddd-0000-0000-000000000521', true);
do $$ begin
  if (select archived_at from conversations where id = '99999999-dddd-0000-0000-000000000521') is null then raise exception '5a: Archive did nothing'; end if;
  if (select updated_at from conversations where id = '99999999-dddd-0000-0000-000000000521') <> '2026-01-01T10:00:00Z' then raise exception '5b: archiving changed updated_at'; end if;
end $$;
select archive_conversation('99999999-dddd-0000-0000-000000000521', false);
do $$ begin
  if (select archived_at from conversations where id = '99999999-dddd-0000-0000-000000000521') is not null then raise exception '5c: Move back did nothing'; end if;
  if (select updated_at from conversations where id = '99999999-dddd-0000-0000-000000000521') <> '2026-01-01T10:00:00Z' then raise exception '5d: moving back changed updated_at'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '99999999-aaaa-0000-0000-000000000522', true);
set local role authenticated;
do $$ begin
  perform archive_conversation('99999999-dddd-0000-0000-000000000521', true);
  raise exception '5e: another agency archived it';
exception when others then
  if sqlerrm like '5e:%' then raise; end if;
end $$;
reset role;
do $$ begin
  if (select archived_at from conversations where id = '99999999-dddd-0000-0000-000000000521') is not null then raise exception '5f: the other agency''s call changed it'; end if;
  -- 6. Anonymous visitors can't call it.
  if has_function_privilege('anon', 'archive_conversation(uuid, boolean)', 'execute') then raise exception '6: anon can archive'; end if;
end $$;

select '0052 checks passed' as result;
rollback;
