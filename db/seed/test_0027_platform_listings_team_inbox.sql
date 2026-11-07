-- Scenario test for 0027. Run on a SCRATCH database only (it inserts data),
-- after all migrations. Every check raises an exception if it fails, so a
-- clean run ending in "0027 checks passed" means everything worked.
--
-- Needs Supabase's auth.uid() and the "authenticated" role (any Supabase
-- project has both; a plain Postgres needs the small stub described in
-- db/migrations/README.md).

begin;

-- Two agencies, A and B.
insert into tenants (id, name, slug, plan, timezone) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Agency A', 'agency-a-test', 'trial', 'Europe/Warsaw'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Agency B', 'agency-b-test', 'starter', 'Europe/Warsaw');
insert into ai_config (tenant_id, escalation_notify_email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'office@agency-a.test'),
  ('bbbbbbbb-0000-0000-0000-000000000001', null);

-- Agency A: an admin and two agents; agent 2 wants no alerts.
insert into tenant_users (id, tenant_id, auth_user_id, email, role, notify_escalations, created_at) values
  ('aaaaaaaa-1000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'boss@agency-a.test', 'admin', true, now() - interval '3 days'),
  ('aaaaaaaa-1000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'ola@agency-a.test', 'agent', true, now() - interval '2 days'),
  ('aaaaaaaa-1000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000003', 'jan@agency-a.test', 'agent', false, now() - interval '1 day');
-- Agency B: one admin.
insert into tenant_users (id, tenant_id, auth_user_id, email, role) values
  ('bbbbbbbb-1000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'boss@agency-b.test', 'admin');

do $$
begin
  if (select trial_ends_at from tenants where slug = 'agency-a-test') is null then
    raise exception 'new tenants should get a trial end date by default';
  end if;
end $$;

-- ── Round-robin assignment ──
insert into contacts (id, tenant_id, name, email, phone) values
  ('aaaaaaaa-2000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Buyer One', 'one@x.test', '+48 600 000 001'),
  ('aaaaaaaa-2000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Buyer Two', 'two@x.test', null),
  ('aaaaaaaa-2000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Buyer Three', 'three@x.test', null),
  ('aaaaaaaa-2000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'Buyer Four', 'four@x.test', null);
insert into leads (tenant_id, contact_id, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-2000-0000-0000-000000000001', 'HOT');
insert into leads (tenant_id, contact_id, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-2000-0000-0000-000000000002', 'WARM');
insert into leads (tenant_id, contact_id, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-2000-0000-0000-000000000003', 'NEW');
insert into leads (tenant_id, contact_id, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-2000-0000-0000-000000000004', 'NEW');

do $$
declare
  owners uuid[];
begin
  select array_agg(assigned_to order by c.email) into owners
  from leads l join contacts c on c.id = l.contact_id
  where l.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  -- four.x, one.x, three.x, two.x (alphabetical): one->boss, two->ola, three->jan, four->boss again
  if owners <> array[
      'aaaaaaaa-1000-0000-0000-000000000001'::uuid,  -- four
      'aaaaaaaa-1000-0000-0000-000000000001'::uuid,  -- one
      'aaaaaaaa-1000-0000-0000-000000000003'::uuid,  -- three
      'aaaaaaaa-1000-0000-0000-000000000002'::uuid]  -- two
  then
    raise exception 'round-robin assigned %', owners;
  end if;
end $$;

-- Re-saving an existing lead (workflow 10's upsert) must not use up a turn.
do $$
declare before timestamptz[];
begin
  select array_agg(last_assigned_at order by id) into before from tenant_users where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  insert into leads (tenant_id, contact_id, status) values
    ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-2000-0000-0000-000000000002', 'HOT')
  on conflict (tenant_id, contact_id) do update set status = excluded.status;
  if before is distinct from (select array_agg(last_assigned_at order by id) from tenant_users where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'upsert of an existing lead moved the rotation';
  end if;
  if (select assigned_to from leads where contact_id = 'aaaaaaaa-2000-0000-0000-000000000002') <> 'aaaaaaaa-1000-0000-0000-000000000002' then
    raise exception 'upsert changed the lead owner';
  end if;
  update leads set status = 'WARM' where contact_id = 'aaaaaaaa-2000-0000-0000-000000000002';
end $$;

-- ── Escalation recipients ──
insert into conversations (id, tenant_id, contact_id, channel) values
  ('aaaaaaaa-3000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-2000-0000-0000-000000000002', 'chat_widget'),
  ('aaaaaaaa-3000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-2000-0000-0000-000000000003', 'chat_widget'),
  ('aaaaaaaa-3000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', null, 'chat_widget');

do $$
declare r text;
begin
  -- Owner (ola) wants alerts: ola + agency address.
  r := escalation_recipients('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-3000-0000-0000-000000000001');
  if r <> 'office@agency-a.test, ola@agency-a.test' then raise exception 'owner case: %', r; end if;
  -- Owner (jan) opted out: only the agency address.
  r := escalation_recipients('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-3000-0000-0000-000000000002');
  if r <> 'office@agency-a.test' then raise exception 'opted-out owner case: %', r; end if;
  -- No lead owner: everyone who wants alerts + agency address.
  r := escalation_recipients('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-3000-0000-0000-000000000003');
  if r <> 'boss@agency-a.test, office@agency-a.test, ola@agency-a.test' then raise exception 'no-owner case: %', r; end if;
end $$;

-- A removed team member gets no leads and no alerts.
update tenant_users set removed_at = now() where id = 'aaaaaaaa-1000-0000-0000-000000000002';
insert into contacts (id, tenant_id, name, email) values
  ('aaaaaaaa-2000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000001', 'Buyer Nine', 'nine@x.test');
insert into leads (tenant_id, contact_id, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-2000-0000-0000-000000000009', 'NEW');
do $$
declare r text;
begin
  if (select assigned_to from leads where contact_id = 'aaaaaaaa-2000-0000-0000-000000000009') = 'aaaaaaaa-1000-0000-0000-000000000002' then
    raise exception 'removed member got a lead';
  end if;
  r := escalation_recipients('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-3000-0000-0000-000000000003');
  if r like '%ola@%' then raise exception 'removed member still alerted: %', r; end if;
end $$;
update tenant_users set removed_at = null where id = 'aaaaaaaa-1000-0000-0000-000000000002';
delete from leads where contact_id = 'aaaaaaaa-2000-0000-0000-000000000009';

-- ── Listings search ──
insert into listings (tenant_id, reference, title, transaction_type, property_type, price, city, district, rooms, area_m2, features, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A-1', '2-room flat with balcony', 'sale', 'apartment', 820000, 'Warszawa', 'Mokotów', 2, 48, '{balcony,lift}', 'available'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A-2', '3-room flat near metro', 'sale', 'apartment', 1150000, 'Warszawa', 'Mokotów', 3, 64, '{metro}', 'available'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A-3', 'Sold flat', 'sale', 'apartment', 700000, 'Warszawa', 'Mokotów', 2, 45, '{}', 'sold'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A-4', 'Studio to rent', 'rent', 'apartment', 3200, 'Kraków', 'Kazimierz', 1, 28, '{}', 'available'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'B-1', 'Agency B flat in Mokotów', 'sale', 'apartment', 600000, 'Warszawa', 'Mokotów', 2, 40, '{}', 'available');

do $$
declare r jsonb;
begin
  r := search_listings('aaaaaaaa-0000-0000-0000-000000000001', '{"location":"mokot","max_price":1000000,"transaction_type":"sale"}');
  if (r->>'count')::int <> 1 or r->'listings'->0->>'reference' <> 'A-1' then
    raise exception 'search returned %', r;
  end if;
  r := search_listings('aaaaaaaa-0000-0000-0000-000000000001', '{"location":"Mokotów"}');
  if (r->>'count')::int <> 2 then raise exception 'sold or other agency listings leaked: %', r; end if;
  r := search_listings('aaaaaaaa-0000-0000-0000-000000000001', '{"keywords":"balcony"}');
  if (r->>'count')::int <> 1 then raise exception 'feature keyword search: %', r; end if;
  r := search_listings('aaaaaaaa-0000-0000-0000-000000000001', '{"location":"Gdańsk"}');
  if (r->>'found')::boolean then raise exception 'expected no results: %', r; end if;
  if (select times_suggested from listings where reference = 'A-1') <> 3 then
    raise exception 'times_suggested not counted';
  end if;
end $$;

-- ── Takeover, as seen by workflow 01 ──
do $$
declare r jsonb;
begin
  r := log_user_message('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-3000-0000-0000-000000000001', 'Hello?');
  if (r->>'human_takeover')::boolean then raise exception 'should not be taken over yet'; end if;
end $$;

-- ── Dashboard user (ola, agency A) through RLS ──
-- n8n-style functions set app.current_tenant for the rest of the
-- transaction; a real dashboard request starts clean, so clear it here.
select set_config('app.current_tenant', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000002', true);

do $$
declare n int;
begin
  select count(*) into n from listings;
  if n <> 4 then raise exception 'agency A user sees % listings (expected 4)', n; end if;

  perform take_over_conversation('aaaaaaaa-3000-0000-0000-000000000001');
  perform send_human_chat_message('aaaaaaaa-3000-0000-0000-000000000001', 'Hi, Ola here.');

  begin
    perform send_human_chat_message('aaaaaaaa-3000-0000-0000-000000000002', 'not taken over');
    raise exception 'reply without takeover should fail';
  exception when others then
    if sqlerrm not like 'Take over%' then raise; end if;
  end;

  begin
    perform platform_tenant_overview(30);
    raise exception 'authenticated users must not run platform_tenant_overview';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from get_daily_digests();
    raise exception 'authenticated users must not run get_daily_digests';
  exception when insufficient_privilege then null;
  end;
  begin
    perform search_listings('bbbbbbbb-0000-0000-0000-000000000001', '{}');
    raise exception 'authenticated users must not call search_listings (it sets the tenant itself)';
  exception when insufficient_privilege then null;
  end;
  begin
    perform log_user_message('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-3000-0000-0000-000000000001', 'x');
    raise exception 'authenticated users must not call log_user_message';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from platform_admin_views;
    raise exception 'authenticated users must not read platform_admin_views';
  exception when insufficient_privilege then null;
  end;
end $$;

-- CSV import as ola (agency A): one update by reference, one new listing.
do $$
declare r jsonb;
begin
  r := import_listings('[{"reference":"A-1","title":"2-room flat, renovated","price":830000,"city":"Warszawa","district":"Mokotów","rooms":2,"features":["balcony","lift"]},
                         {"title":"New house","property_type":"house","price":1900000,"city":"Piaseczno"}]');
  -- (0028 added a "withdrawn" count to the result, so compare the fields.)
  if (r->>'inserted')::int <> 1 or (r->>'updated')::int <> 1 then raise exception 'import result %', r; end if;
  if (select price from listings where reference = 'A-1') <> 830000 then raise exception 'import did not update A-1'; end if;
  if (select count(*) from listings where title = 'New house' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001') <> 1 then
    raise exception 'import did not insert into own agency';
  end if;
end $$;

-- Team rules as ola (an agent).
do $$
begin
  perform update_team_member('aaaaaaaa-1000-0000-0000-000000000002', '{"full_name":"Ola Nowak","notify_digest":true}');
  begin
    perform update_team_member('aaaaaaaa-1000-0000-0000-000000000002', '{"role":"admin"}');
    raise exception 'agent promoted herself';
  exception when others then
    if sqlerrm <> 'Only an admin can change roles' then raise; end if;
  end;
  begin
    perform update_team_member('aaaaaaaa-1000-0000-0000-000000000003', '{"receives_leads":false}');
    raise exception 'agent changed a colleague';
  exception when others then
    if sqlerrm <> 'Only an admin can change other team members' then raise; end if;
  end;
end $$;

reset role;

do $$
declare r jsonb;
begin
  r := log_user_message('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-3000-0000-0000-000000000001', 'Thanks!');
  if not (r->>'human_takeover')::boolean then raise exception 'takeover not visible to workflow 01'; end if;
  if (select count(*) from messages where conversation_id = 'aaaaaaaa-3000-0000-0000-000000000001' and role = 'human_agent') <> 1 then
    raise exception 'human reply not stored';
  end if;
end $$;

-- The only admin cannot be demoted.
select set_config('app.current_tenant', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000001', true);
do $$
begin
  perform update_team_member('aaaaaaaa-1000-0000-0000-000000000003', '{"receives_leads":false}');
  begin
    perform update_team_member('aaaaaaaa-1000-0000-0000-000000000001', '{"role":"agent"}');
    raise exception 'last admin demoted';
  exception when others then
    if sqlerrm <> 'An agency needs at least one admin' then raise; end if;
  end;
end $$;
reset role;

-- ── Agency B admin cannot touch agency A ──
-- n8n-style functions set app.current_tenant for the rest of the
-- transaction; a real dashboard request starts clean, so clear it here.
select set_config('app.current_tenant', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-0000-0000-0000-000000000001', true);
do $$
declare n int;
begin
  select count(*) into n from listings;
  if n <> 1 then raise exception 'agency B user sees % listings', n; end if;
  begin
    perform hand_back_conversation('aaaaaaaa-3000-0000-0000-000000000001');
    raise exception 'agency B handed back agency A conversation';
  exception when others then
    if sqlerrm <> 'Conversation not found' then raise; end if;
  end;
end $$;
reset role;

-- ── Platform admin "view as" (row written by the dashboard server) ──
insert into platform_admin_views (auth_user_id, tenant_id)
values ('22222222-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001');
-- n8n-style functions set app.current_tenant for the rest of the
-- transaction; a real dashboard request starts clean, so clear it here.
select set_config('app.current_tenant', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-0000-0000-0000-000000000001', true);
do $$
declare n int;
begin
  select count(*) into n from listings;
  if n <> 5 then raise exception 'view-as should show agency A (got % listings)', n; end if;
  if current_admin_view() <> 'aaaaaaaa-0000-0000-0000-000000000001' then raise exception 'current_admin_view wrong'; end if;
end $$;
reset role;
update platform_admin_views set expires_at = now() - interval '1 minute';
-- n8n-style functions set app.current_tenant for the rest of the
-- transaction; a real dashboard request starts clean, so clear it here.
select set_config('app.current_tenant', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-0000-0000-0000-000000000001', true);
do $$
begin
  if (select count(*) from listings) <> 1 then raise exception 'expired view-as still active'; end if;
end $$;
reset role;

-- ── AI usage, overview and digest (service role) ──
select log_ai_usage('aaaaaaaa-0000-0000-0000-000000000001', 1200, 300);
select log_ai_usage('aaaaaaaa-0000-0000-0000-000000000001', 800, 200);
do $$
declare o record; d record;
begin
  select * into o from platform_tenant_overview(30) where slug = 'agency-a-test';
  if o.input_tokens <> 2000 or o.output_tokens <> 500 or o.ai_replies <> 2 then raise exception 'usage %', o; end if;
  if o.listings_count <> 4 or o.users_count <> 3 or o.hot_leads_count <> 1 then raise exception 'overview %', o; end if;

  select * into d from get_daily_digests() where recipient_email = 'boss@agency-a.test';
  if d is null then raise exception 'admin should receive the digest'; end if;
  if d.new_leads_count <> 4 or d.hot_leads_count <> 1 or jsonb_array_length(d.hot_leads) <> 1 then
    raise exception 'digest %', d;
  end if;
  if exists (select 1 from get_daily_digests() where recipient_email = 'jan@agency-a.test') then
    raise exception 'agents should not get the digest unless they opt in';
  end if;
  if not exists (select 1 from get_daily_digests() where recipient_email = 'ola@agency-a.test') then
    raise exception 'ola opted in and should get the digest';
  end if;
end $$;

select '0027 checks passed' as result;

rollback;
