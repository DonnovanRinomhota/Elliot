-- Security test for 0047: two agencies using Elliot at the same time, and
-- every attack from the November 2026 audit. Scratch database only (all
-- migrations applied, with Supabase's default grants); rolls back. Ends with
-- "0047 checks passed". Run it after every new migration: part 1 fails when
-- a new function or table is left open to anonymous visitors.
begin;

-- ── Two agencies, each with an admin; A also has an agent, a viewer and a removed member ──
insert into tenants (id, name, slug, timezone, assistant_mode) values
  ('aaaaaaaa-0000-0000-0000-000000000047', 'Agency A', 'a-047', 'Europe/Warsaw', 'agency'),
  ('bbbbbbbb-0000-0000-0000-000000000047', 'Agency B', 'b-047', 'Europe/Warsaw', 'agency');
insert into ai_config (tenant_id, system_prompt_override, crm_webhook_url) values
  ('aaaaaaaa-0000-0000-0000-000000000047', 'A prompt', 'https://a.example/hook'),
  ('bbbbbbbb-0000-0000-0000-000000000047', 'B SECRET PROMPT', 'https://b.example/hook')
  on conflict (tenant_id) do update set system_prompt_override = excluded.system_prompt_override, crm_webhook_url = excluded.crm_webhook_url;
insert into tenant_users (id, tenant_id, auth_user_id, email, role, removed_at) values
  ('a0470000-0000-0000-0000-000000000a01', 'aaaaaaaa-0000-0000-0000-000000000047', 'a1a1a1a1-0000-0000-0000-000000000047', 'admin@a.pl', 'admin', null),
  ('a0470000-0000-0000-0000-000000000a02', 'aaaaaaaa-0000-0000-0000-000000000047', 'a2a2a2a2-0000-0000-0000-000000000047', 'agent@a.pl', 'agent', null),
  ('a0470000-0000-0000-0000-000000000a03', 'aaaaaaaa-0000-0000-0000-000000000047', 'a3a3a3a3-0000-0000-0000-000000000047', 'viewer@a.pl', 'viewer', null),
  ('a0470000-0000-0000-0000-000000000a04', 'aaaaaaaa-0000-0000-0000-000000000047', 'a4a4a4a4-0000-0000-0000-000000000047', 'gone@a.pl', 'agent', now()),
  ('b0470000-0000-0000-0000-000000000b01', 'bbbbbbbb-0000-0000-0000-000000000047', 'b1b1b1b1-0000-0000-0000-000000000047', 'admin@b.pl', 'admin', null);

-- The same kinds of records in both agencies (suffix 1 = A, 2 = B).
insert into contacts (id, tenant_id, name, email, phone) values
  ('c0470000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000047', 'Anna A', 'anna@a-client.pl', '+48600000001'),
  ('c0470000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000047', 'Bartek B', 'bartek@b-client.pl', '+48600000002');
insert into conversations (id, tenant_id, contact_id, channel) values
  ('d0470000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000047', 'c0470000-0000-0000-0000-000000000001', 'email'),
  ('d0470000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000047', 'c0470000-0000-0000-0000-000000000002', 'email');
insert into messages (tenant_id, conversation_id, role, content) values
  ('aaaaaaaa-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000001', 'user', 'A message'),
  ('bbbbbbbb-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000002', 'user', 'B PRIVATE MESSAGE');
insert into leads (id, tenant_id, contact_id, status) values
  ('e0470000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000047', 'c0470000-0000-0000-0000-000000000001', 'WARM'),
  ('e0470000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000047', 'c0470000-0000-0000-0000-000000000002', 'HOT');
insert into listings (id, tenant_id, title) values
  ('f0470000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000047', 'A flat'),
  ('f0470000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000047', 'B flat');
insert into appointments (id, tenant_id, contact_id, conversation_id, starts_at, ends_at, timezone, status) values
  ('10470000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000047', 'c0470000-0000-0000-0000-000000000001', 'd0470000-0000-0000-0000-000000000001', now() + interval '2 days', now() + interval '2 days 30 minutes', 'Europe/Warsaw', 'confirmed'),
  ('10470000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000047', 'c0470000-0000-0000-0000-000000000002', 'd0470000-0000-0000-0000-000000000002', now() + interval '3 days', now() + interval '3 days 30 minutes', 'Europe/Warsaw', 'confirmed');
insert into email_drafts (id, tenant_id, conversation_id, contact_id, to_email, body, category, status) values
  ('20470000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000001', 'c0470000-0000-0000-0000-000000000001', 'anna@a-client.pl', 'A draft', 'follow_up', 'pending'),
  ('20470000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000002', 'c0470000-0000-0000-0000-000000000002', 'bartek@b-client.pl', 'B draft', 'follow_up', 'pending');
insert into documents (id, tenant_id, title, source_type) values
  ('30470000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000047', 'A fees', 'manual_text'),
  ('30470000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000047', 'B fees', 'manual_text');
insert into message_attachments (tenant_id, conversation_id, filename, storage_path, uploaded) values
  ('aaaaaaaa-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000001', 'a.pdf', 'a-047/a.pdf', true),
  ('bbbbbbbb-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000002', 'b-id-scan.pdf', 'b-047/b.pdf', true);
insert into ai_usage_daily (tenant_id, day, input_tokens) values
  ('aaaaaaaa-0000-0000-0000-000000000047', current_date, 100),
  ('bbbbbbbb-0000-0000-0000-000000000047', current_date, 200);
insert into audit_log (tenant_id, actor_type, event_type) values
  ('aaaaaaaa-0000-0000-0000-000000000047', 'system', 'test.a'),
  ('bbbbbbbb-0000-0000-0000-000000000047', 'system', 'test.b');
insert into asari_connections (tenant_id, api_user_id, api_token) values
  ('bbbbbbbb-0000-0000-0000-000000000047', '777', 'B-ASARI-TOKEN');

-- Helpers. rows(): how many rows a statement returned or changed, -1 when the
-- database refused it. as_user(): a dashboard request by that login.
create or replace function pg_temp.rows(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  begin
    execute p_sql;
    get diagnostics n = row_count;
    return n;
  exception when others then
    return -1;
  end;
end $$;
create or replace function pg_temp.one(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    return v;
  exception when others then
    return 'REFUSED';
  end;
end $$;
create or replace function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid, true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'aal', 'aal1', 'role', 'authenticated')::text, true);
$$;
-- hit(): did an attack do anything? For "select some_function(...)": 1 when it
-- returned something, 0 when it returned nothing, -1 when refused. Otherwise rows().
create or replace function pg_temp.hit(p_sql text) returns bigint language plpgsql as $$
declare v text;
begin
  if p_sql !~* '^\s*select' then return pg_temp.rows(p_sql); end if;
  begin
    execute p_sql into v;
    -- An empty record "(,,,)" is what a function returns when it matched nothing.
    return case when v is null or v ~ '^\(,*\)$' then 0 else 1 end;
  exception when others then
    return -1;
  end;
end $$;
grant execute on function pg_temp.rows(text), pg_temp.one(text), pg_temp.hit(text) to anon, authenticated;

-- ════════ 1. What is open at all (the guard for future migrations) ════════
do $$
declare v text;
begin
  -- Row-level security on every table.
  select string_agg(c.relname, ', ') into v from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity;
  if v is not null then raise exception '1a: tables without row-level security: %', v; end if;

  -- Anonymous visitors: no table or sequence privileges.
  select string_agg(distinct table_name, ', ') into v from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon';
  if v is not null then raise exception '1b: anon has privileges on: %', v; end if;

  -- Anonymous visitors (directly or through PUBLIC) may call exactly one function.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'execute');
  if v is distinct from 'public_listing(uuid)' then
    raise exception '1c: functions anonymous visitors can call: % (expected only public_listing). A new function needs: revoke all on function ... from public, anon;', v;
  end if;

  -- Signed-in users: no function that takes an agency ID as a parameter.
  select string_agg(p.oid::regprocedure::text, ', ') into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and 'p_tenant_id' = any (coalesce(p.proargnames, '{}'));
  if v is not null then raise exception '1d: signed-in users can call functions that take an agency ID: %', v; end if;

  -- Credentials and platform tables: not readable by signed-in users at all.
  if has_table_privilege('authenticated', 'asari_connections', 'select')
     or has_table_privilege('authenticated', 'platform_settings', 'select')
     or has_table_privilege('authenticated', 'platform_admin_views', 'select') then
    raise exception '1e: a credentials or platform table is readable by signed-in users';
  end if;
  if has_table_privilege('authenticated', 'tenants', 'truncate') or has_table_privilege('authenticated', 'messages', 'truncate') then
    raise exception '1f: TRUNCATE is granted to signed-in users';
  end if;
end $$;

-- ════════ 2. Anonymous visitor (the public key, no login) ════════
set local role anon;
do $$
begin
  if pg_temp.one($q$select system_prompt_override from get_ai_config('bbbbbbbb-0000-0000-0000-000000000047')$q$) <> 'REFUSED' then
    raise exception '2a: anon read an agency''s prompt'; end if;
  if pg_temp.one($q$select string_agg(content, '|') from get_conversation_history('bbbbbbbb-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000002', 10)$q$) <> 'REFUSED' then
    raise exception '2b: anon read a conversation'; end if;
  if pg_temp.rows($q$select log_message('bbbbbbbb-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000002', 'assistant', 'INJECTED')$q$) <> -1 then
    raise exception '2c: anon wrote a message'; end if;
  if pg_temp.rows($q$select insert_escalation('bbbbbbbb-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000002', 'x', 'urgent', 'x')$q$) <> -1 then
    raise exception '2d: anon created an escalation'; end if;
  if pg_temp.rows($q$select get_or_create_conversation('bbbbbbbb-0000-0000-0000-000000000047', null)$q$) <> -1 then
    raise exception '2e: anon created a conversation'; end if;
  if pg_temp.rows('select 1 from tenants') <> -1 or pg_temp.rows('select 1 from messages') <> -1
     or pg_temp.rows('select 1 from listings') <> -1 or pg_temp.rows('select 1 from contacts') <> -1 then
    raise exception '2f: anon can query a table'; end if;
  if pg_temp.rows($q$insert into demo_requests (name, email) values ('x', 'x@x.pl')$q$) <> -1 then
    raise exception '2g: anon wrote a row'; end if;
  -- The one thing a visitor may do: open a public listing page.
  if pg_temp.one($q$select (public_listing('f0470000-0000-0000-0000-000000000002'))->>'title'$q$) = 'REFUSED' then
    raise exception '2h: the public listing page stopped working'; end if;
end $$;
reset role;

-- ════════ 3. Agency A's agent against agency B ════════
select pg_temp.as_user('a2a2a2a2-0000-0000-0000-000000000047');
-- An attacker's best trick before 0047: the session value n8n's functions use.
select set_config('app.current_tenant', 'bbbbbbbb-0000-0000-0000-000000000047', true);
set local role authenticated;
do $$
declare t record; n bigint; v text;
begin
  if current_tenant_id() <> 'aaaaaaaa-0000-0000-0000-000000000047' then
    raise exception '3a: app.current_tenant changed a signed-in user''s agency to %', current_tenant_id(); end if;

  -- Every table that holds agency data: nothing of B's is visible.
  for t in
    select c.relname from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  loop
    n := pg_temp.rows(format('select 1 from %I where tenant_id = %L', t.relname, 'bbbbbbbb-0000-0000-0000-000000000047'));
    if n > 0 then raise exception '3b: agency A''s agent sees % row(s) of agency B in %', n, t.relname; end if;
  end loop;
  if pg_temp.rows($q$select 1 from tenants where id = 'bbbbbbbb-0000-0000-0000-000000000047'$q$) > 0 then raise exception '3c: sees agency B''s account'; end if;
  if pg_temp.rows('select 1 from tenants') <> 1 then raise exception '3c: should see exactly its own agency'; end if;

  -- The records the brief names, one by one, by ID.
  foreach v in array array[
    $q$select 1 from leads where id = 'e0470000-0000-0000-0000-000000000002'$q$,
    $q$select 1 from conversations where id = 'd0470000-0000-0000-0000-000000000002'$q$,
    $q$select 1 from messages where conversation_id = 'd0470000-0000-0000-0000-000000000002'$q$,
    $q$select 1 from contacts where id = 'c0470000-0000-0000-0000-000000000002'$q$,
    $q$select 1 from listings where id = 'f0470000-0000-0000-0000-000000000002'$q$,
    $q$select 1 from appointments where id = '10470000-0000-0000-0000-000000000002'$q$,
    $q$select 1 from email_drafts where id = '20470000-0000-0000-0000-000000000002'$q$,
    $q$select 1 from documents where id = '30470000-0000-0000-0000-000000000002'$q$,
    $q$select 1 from message_attachments where filename = 'b-id-scan.pdf'$q$,
    $q$select 1 from tenant_users where email = 'admin@b.pl'$q$,
    $q$select 1 from ai_usage_daily where input_tokens = 200$q$,
    $q$select 1 from ai_config where system_prompt_override = 'B SECRET PROMPT'$q$,
    $q$select 1 from asari_connections$q$
  ] loop
    if pg_temp.rows(v) > 0 then raise exception '3d: cross-agency read: %', v; end if;
  end loop;

  -- Writes into B, or links to B's records from A.
  foreach v in array array[
    $q$update leads set status = 'LOST' where id = 'e0470000-0000-0000-0000-000000000002'$q$,
    $q$delete from messages where conversation_id = 'd0470000-0000-0000-0000-000000000002'$q$,
    $q$update listings set title = 'hacked' where id = 'f0470000-0000-0000-0000-000000000002'$q$,
    $q$update appointments set status = 'cancelled' where id = '10470000-0000-0000-0000-000000000002'$q$,
    $q$insert into contacts (tenant_id, name) values ('bbbbbbbb-0000-0000-0000-000000000047', 'planted')$q$,
    $q$insert into messages (tenant_id, conversation_id, role, content) values ('aaaaaaaa-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000002', 'assistant', 'planted')$q$,
    $q$insert into leads (tenant_id, contact_id, status) values ('aaaaaaaa-0000-0000-0000-000000000047', 'c0470000-0000-0000-0000-000000000002', 'HOT')$q$,
    $q$update conversations set contact_id = 'c0470000-0000-0000-0000-000000000002' where id = 'd0470000-0000-0000-0000-000000000001'$q$,
    $q$select create_manual_email_draft('d0470000-0000-0000-0000-000000000002', 'c0470000-0000-0000-0000-000000000002', 'x@x.pl', 's', 'b', null)$q$,
    $q$select take_over_conversation('d0470000-0000-0000-0000-000000000002')$q$,
    $q$select send_human_chat_message('d0470000-0000-0000-0000-000000000002', 'hello')$q$,
    $q$select approve_email_draft('20470000-0000-0000-0000-000000000002', null, null)$q$,
    $q$select get_ai_config('bbbbbbbb-0000-0000-0000-000000000047')$q$,
    $q$select match_document_chunks('bbbbbbbb-0000-0000-0000-000000000047', null, 5)$q$
  ] loop
    if pg_temp.hit(v) > 0 then raise exception '3e: cross-agency write went through: %', v; end if;
  end loop;

  -- ════════ 4. The same agent, inside its own agency ════════
  foreach v in array array[
    $q$update tenant_users set role = 'admin' where id = 'a0470000-0000-0000-0000-000000000a02'$q$,
    $q$delete from tenant_users where id = 'a0470000-0000-0000-0000-000000000a01'$q$,
    $q$insert into tenant_users (tenant_id, auth_user_id, email, role) values ('aaaaaaaa-0000-0000-0000-000000000047', gen_random_uuid(), 'evil@x.pl', 'admin')$q$,
    $q$update tenant_users set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000047' where id = 'a0470000-0000-0000-0000-000000000a02'$q$,
    $q$select update_team_member('a0470000-0000-0000-0000-000000000a02', '{"role":"admin"}')$q$,
    $q$update tenants set status = 'active', slug = 'hijacked' where id = 'aaaaaaaa-0000-0000-0000-000000000047'$q$,
    $q$update tenants set name = 'Renamed by an agent' where id = 'aaaaaaaa-0000-0000-0000-000000000047'$q$,
    $q$update ai_config set crm_webhook_url = 'https://evil.example' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000047'$q$,
    $q$update ai_config set whatsapp_phone_number_id = 'STOLEN' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000047'$q$,
    $q$delete from audit_log$q$,
    $q$update ai_usage_daily set input_tokens = 0$q$,
    $q$insert into audit_log (tenant_id, actor_type, event_type) values ('aaaaaaaa-0000-0000-0000-000000000047', 'system', 'forged')$q$,
    $q$select grant_support_access(24)$q$
  ] loop
    if pg_temp.hit(v) > 0 then raise exception '4a: an agent did an admin-only thing: %', v; end if;
  end loop;
  -- ...and can still do an agent's work.
  if pg_temp.rows($q$update leads set status = 'HOT' where id = 'e0470000-0000-0000-0000-000000000001'$q$) <> 1 then raise exception '4b: an agent can no longer update its own lead'; end if;
  if pg_temp.rows($q$insert into listings (tenant_id, title) values ('aaaaaaaa-0000-0000-0000-000000000047', 'New flat')$q$) <> 1 then raise exception '4b: an agent can no longer add a listing'; end if;
  if pg_temp.rows($q$select take_over_conversation('d0470000-0000-0000-0000-000000000001')$q$) <> 1 then raise exception '4b: an agent can no longer take over a chat'; end if;
  if pg_temp.rows('select 1 from ai_config') <> 1 or pg_temp.rows('select 1 from tenant_users') <> 4 then raise exception '4b: an agent can no longer read settings or the team'; end if;
end $$;
reset role;
select set_config('app.current_tenant', '', true);
do $$
begin
  if (select status from email_drafts where id = '20470000-0000-0000-0000-000000000002') <> 'pending'
     or (select assigned_human from conversations where id = 'd0470000-0000-0000-0000-000000000002') is not null
     or (select count(*) from messages where conversation_id = 'd0470000-0000-0000-0000-000000000002') <> 1
     or (select status from leads where id = 'e0470000-0000-0000-0000-000000000002') <> 'HOT'
     or (select role from tenant_users where id = 'a0470000-0000-0000-0000-000000000a02') <> 'agent'
     or (select crm_webhook_url from ai_config where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000047') <> 'https://a.example/hook' then
    raise exception '3f/4c: something changed that should not have';
  end if;
end $$;

-- ════════ 5. Agency admin: allowed changes only ════════
select pg_temp.as_user('a1a1a1a1-0000-0000-0000-000000000047');
set local role authenticated;
do $$
begin
  if pg_temp.rows($q$update tenants set name = 'Agency A Renamed', timezone = 'Europe/Warsaw', avg_deal_value = 20000 where id = 'aaaaaaaa-0000-0000-0000-000000000047'$q$) <> 1 then raise exception '5a: an admin can no longer edit the agency profile'; end if;
  if pg_temp.rows($q$update ai_config set crm_webhook_url = 'https://a.example/new', autonomy_rules = '{}' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000047'$q$) <> 1 then raise exception '5a: an admin can no longer edit settings'; end if;
  if pg_temp.rows($q$select update_team_member('a0470000-0000-0000-0000-000000000a02', '{"role":"viewer"}')$q$) <> 1 then raise exception '5a: an admin can no longer change a role'; end if;
  if pg_temp.rows($q$select update_team_member('a0470000-0000-0000-0000-000000000a02', '{"role":"agent"}')$q$) <> 1 then raise exception '5a: role change back'; end if;
  -- Still not the control panel's business: account state, plan, slug, prices.
  if pg_temp.rows($q$update tenants set status = 'active' where id = 'aaaaaaaa-0000-0000-0000-000000000047'$q$) <> -1
     or pg_temp.rows($q$update tenants set slug = 'b-047' where id = 'aaaaaaaa-0000-0000-0000-000000000047'$q$) <> -1
     or pg_temp.rows($q$update tenants set plan = 'enterprise', paid_until = now() + interval '10 years' where id = 'aaaaaaaa-0000-0000-0000-000000000047'$q$) <> -1 then
    raise exception '5b: an agency admin changed its own account state, plan or slug'; end if;
  if pg_temp.rows($q$update ai_config set crm_webhook_url = 'x' where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000047'$q$) > 0
     or pg_temp.rows($q$delete from tenants$q$) > 0 or pg_temp.rows($q$delete from ai_config$q$) > 0 then
    raise exception '5c: an agency admin reached another agency or deleted its account rows'; end if;
end $$;
reset role;

-- ════════ 6. Viewer: looks, changes nothing ════════
select pg_temp.as_user('a3a3a3a3-0000-0000-0000-000000000047');
set local role authenticated;
do $$
declare v text;
begin
  if pg_temp.rows('select 1 from leads') <> 1 or pg_temp.rows('select 1 from listings') < 1 then raise exception '6a: a viewer can no longer look'; end if;
  foreach v in array array[
    $q$update leads set status = 'LOST'$q$,
    $q$delete from listings$q$,
    $q$insert into listings (tenant_id, title) values ('aaaaaaaa-0000-0000-0000-000000000047', 'by a viewer')$q$,
    $q$delete from messages$q$,
    $q$select take_over_conversation('d0470000-0000-0000-0000-000000000001')$q$,
    $q$select send_human_chat_message('d0470000-0000-0000-0000-000000000001', 'hi')$q$,
    $q$select approve_email_draft('20470000-0000-0000-0000-000000000001', null, null)$q$,
    $q$select reject_email_draft('20470000-0000-0000-0000-000000000001', null)$q$,
    $q$select create_manual_email_draft('d0470000-0000-0000-0000-000000000001', 'c0470000-0000-0000-0000-000000000001', 'x@x.pl', 's', 'b', null)$q$,
    $q$select import_listings('[{"title":"x","reference":"V-1"}]', false)$q$
  ] loop
    if pg_temp.hit(v) > 0 then raise exception '6b: a viewer changed something: %', v; end if;
  end loop;
end $$;
reset role;

-- ════════ 7. Removed team member with a session that hasn't expired yet ════════
select pg_temp.as_user('a4a4a4a4-0000-0000-0000-000000000047');
set local role authenticated;
do $$
begin
  if current_tenant_id() is not null then raise exception '7a: a removed member still has an agency'; end if;
  if pg_temp.rows('select 1 from leads') > 0 or pg_temp.rows('select 1 from contacts') > 0 or pg_temp.rows('select 1 from tenants') > 0 then
    raise exception '7b: a removed member still sees data'; end if;
end $$;
reset role;

-- ════════ 8. n8n (service role): the public chat can't cross agencies ════════
do $$
declare v uuid; j jsonb; n int;
begin
  -- A chat request for agency A carrying agency B's conversation ID.
  v := get_or_create_conversation('aaaaaaaa-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000002');
  if v = 'd0470000-0000-0000-0000-000000000002' then raise exception '8a: agency B''s conversation was handed to agency A'; end if;
  if (select tenant_id from conversations where id = 'd0470000-0000-0000-0000-000000000002') <> 'bbbbbbbb-0000-0000-0000-000000000047' then
    raise exception '8a: agency B''s conversation was moved'; end if;
  if (select tenant_id from conversations where id = v) <> 'aaaaaaaa-0000-0000-0000-000000000047' then raise exception '8a: new conversation in the wrong agency'; end if;
  select count(*) into n from get_conversation_history('aaaaaaaa-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000002', 20);
  if n <> 0 then raise exception '8b: agency B''s history was read as agency A'; end if;
  -- Its own conversations still work, including an ID the widget made up.
  if get_or_create_conversation('aaaaaaaa-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000001') <> 'd0470000-0000-0000-0000-000000000001' then raise exception '8c: own conversation not reused'; end if;
  if get_or_create_conversation('aaaaaaaa-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-0000000000ff') <> 'd0470000-0000-0000-0000-0000000000ff' then raise exception '8c: new conversation ID not kept'; end if;
  select count(*) into n from get_conversation_history('aaaaaaaa-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000001', 20);
  if n < 1 then raise exception '8c: own history: %', n; end if;
  -- Even the service role can't file a row under another agency's record.
  begin
    perform log_user_message('aaaaaaaa-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000002', 'cross');
    raise exception '8d: a message was filed into another agency''s conversation';
  exception when check_violation then null;
  end;

  -- ════════ 9. Identity on the website chat ════════
  -- A visitor opens agency A's chat (a new conversation) and types Anna's email.
  v := get_or_create_conversation('aaaaaaaa-0000-0000-0000-000000000047', null);
  j := identify_chat_visitor('aaaaaaaa-0000-0000-0000-000000000047', v, 'Mallory', 'anna@a-client.pl', '');
  if jsonb_array_length(j->'upcoming_viewings') <> 0 then raise exception '9a: a chat visitor who typed a client''s email sees her viewings: %', j->'upcoming_viewings'; end if;
  if (select name from contacts where id = 'c0470000-0000-0000-0000-000000000001') <> 'Anna A' then raise exception '9b: a chat visitor renamed an existing client'; end if;
  if (select count(*) from client_appointment('aaaaaaaa-0000-0000-0000-000000000047', 'c0470000-0000-0000-0000-000000000001', '10470000-0000-0000-0000-000000000001', v)) <> 0 then
    raise exception '9c: a chat visitor can change a viewing booked elsewhere'; end if;
  -- Anna herself, in the conversation she booked in, or on a verified channel (email, WhatsApp).
  j := identify_chat_visitor('aaaaaaaa-0000-0000-0000-000000000047', 'd0470000-0000-0000-0000-000000000001', null, null, null);
  if jsonb_array_length(j->'upcoming_viewings') <> 1 then raise exception '9d: the viewing booked in this conversation is missing'; end if;
  j := identify_chat_visitor('aaaaaaaa-0000-0000-0000-000000000047', v, null, 'anna@a-client.pl', '', true);
  if jsonb_array_length(j->'upcoming_viewings') <> 1 or not (j->>'verified')::boolean then raise exception '9e: a verified channel should see the client''s viewings'; end if;
  if (select count(*) from client_appointment('aaaaaaaa-0000-0000-0000-000000000047', 'c0470000-0000-0000-0000-000000000001', '10470000-0000-0000-0000-000000000001')) <> 1
     or (select count(*) from client_appointment('aaaaaaaa-0000-0000-0000-000000000047', 'c0470000-0000-0000-0000-000000000001', '10470000-0000-0000-0000-000000000001', 'd0470000-0000-0000-0000-000000000001')) <> 1 then
    raise exception '9f: the client''s own booking is not found'; end if;
  -- A visitor's own chat contact can still be corrected by the visitor.
  v := get_or_create_conversation('aaaaaaaa-0000-0000-0000-000000000047', null);
  perform identify_chat_visitor('aaaaaaaa-0000-0000-0000-000000000047', v, 'Piotr', 'piotr@new.pl', '');
  j := identify_chat_visitor('aaaaaaaa-0000-0000-0000-000000000047', v, 'Piotr Nowak', 'piotr@new.pl', '');
  if j->>'name' <> 'Piotr Nowak' then raise exception '9g: a visitor can no longer correct their own name: %', j; end if;
end $$;

select '0047 checks passed' as result;
rollback;
