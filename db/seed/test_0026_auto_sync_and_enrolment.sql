-- test_0026_auto_sync_and_enrolment.sql
--
-- Scenario test for migration 0026 (automatic CRM sync queueing + follow-up
-- auto-enrolment). Run against a THROWAWAY database that has all migrations
-- applied -- it creates and leaves test data behind. Every check raises an
-- exception on failure, so a clean run that ends with "ALL 0026 CHECKS PASSED"
-- is the pass condition:
--
--   psql -v ON_ERROR_STOP=1 -d <scratch_db> -f db/seed/test_0026_auto_sync_and_enrolment.sql
--
-- The RLS section switches to the `authenticated` role, so it needs that role
-- to exist (it does on Supabase; create it locally if testing elsewhere).

\set ON_ERROR_STOP 1

create or replace function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin
    if not coalesce(cond, false) then
        raise exception 'FAILED: %', label;
    end if;
    raise notice 'ok: %', label;
end $$;

-- Fixed ids so the checks below read plainly.
--   T1 = tenant WITH a CRM webhook, T2 = tenant WITHOUT one.
insert into tenants (id, name, slug) values
    ('a0000000-0000-0000-0000-000000000001', 'Test CRM Realty', 'test-crm-realty'),
    ('a0000000-0000-0000-0000-000000000002', 'Test No-CRM Realty', 'test-no-crm-realty');
insert into ai_config (tenant_id, crm_webhook_url) values
    ('a0000000-0000-0000-0000-000000000001', 'https://hooks.example.com/crm'),
    ('a0000000-0000-0000-0000-000000000002', null);

-- ───────────── 1. CRM sync queueing ─────────────

insert into contacts (id, tenant_id, name, email, phone, source)
values ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Jan', 'jan@example.com', null, 'chat_widget');

select pg_temp.expect(
    (select count(*) from crm_sync_log where entity_type = 'contact' and entity_id = 'c0000000-0000-0000-0000-000000000001' and status = 'pending') = 1,
    'new contact queues one pending sync');

-- Same values re-written (what lead capture's upsert does on every call).
update contacts set name = 'Jan', phone = null where id = 'c0000000-0000-0000-0000-000000000001';
update crm_sync_log set status = 'synced' where entity_id = 'c0000000-0000-0000-0000-000000000001';
update contacts set name = 'Jan', phone = null where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.expect(
    (select count(*) from crm_sync_log where entity_id = 'c0000000-0000-0000-0000-000000000001') = 1,
    'identical contact rewrite queues nothing');

update contacts set phone = '+48 600 000 000' where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.expect(
    (select count(*) from crm_sync_log where entity_id = 'c0000000-0000-0000-0000-000000000001' and status = 'pending') = 1,
    'real contact change queues a new sync');

insert into leads (id, tenant_id, contact_id, status, score)
values ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'WARM', 50);
update leads set status = 'HOT', score = 80 where id = 'd0000000-0000-0000-0000-000000000001';
select pg_temp.expect(
    (select count(*) from crm_sync_log where entity_type = 'lead' and entity_id = 'd0000000-0000-0000-0000-000000000001') = 1,
    'lead insert + change before the sweep collapses into one pending row');

update crm_sync_log set status = 'synced' where entity_id = 'd0000000-0000-0000-0000-000000000001';
update leads set updated_at = now() where id = 'd0000000-0000-0000-0000-000000000001';
select pg_temp.expect(
    (select count(*) from crm_sync_log where entity_id = 'd0000000-0000-0000-0000-000000000001') = 1,
    'lead touch without stage/score/answers change queues nothing');

update leads set status = 'CONVERTED' where id = 'd0000000-0000-0000-0000-000000000001';
select pg_temp.expect(
    (select count(*) from crm_sync_log where entity_id = 'd0000000-0000-0000-0000-000000000001' and status = 'pending') = 1,
    'stage change after a sync queues a new sync');

insert into appointments (id, tenant_id, contact_id, starts_at, ends_at, timezone, status)
values ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
        now() + interval '2 days', now() + interval '2 days 1 hour', 'Europe/Warsaw', 'confirmed');
select pg_temp.expect(
    (select count(*) from crm_sync_log where entity_type = 'appointment' and entity_id = 'e0000000-0000-0000-0000-000000000001') = 1,
    'booking queues an appointment sync');

-- Tenant without a CRM endpoint: nothing is queued at all.
insert into contacts (id, tenant_id, name, email) values
    ('c0000000-0000-0000-0000-000000000099', 'a0000000-0000-0000-0000-000000000002', 'Ola', 'ola@example.com');
insert into leads (tenant_id, contact_id, status) values
    ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000099', 'NEW');
select pg_temp.expect(
    (select count(*) from crm_sync_log where tenant_id = 'a0000000-0000-0000-0000-000000000002') = 0,
    'tenant with no crm_webhook_url gets nothing queued');

-- Dashboard path: a logged-in user (RLS, no access granted to crm_sync_log
-- beyond their own tenant) changes an appointment status.
insert into auth.users (id, email) values ('f0000000-0000-0000-0000-000000000001', 'agent@test-crm-realty.example');
insert into tenant_users (tenant_id, auth_user_id, email, role)
values ('a0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'agent@test-crm-realty.example', 'admin');
update crm_sync_log set status = 'synced' where entity_id = 'e0000000-0000-0000-0000-000000000001';

set role authenticated;
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000001', false);
update appointments set status = 'cancelled' where id = 'e0000000-0000-0000-0000-000000000001';
reset role;
select set_config('request.jwt.claim.sub', '', false);

select pg_temp.expect(
    (select count(*) from crm_sync_log where entity_id = 'e0000000-0000-0000-0000-000000000001' and status = 'pending') = 1,
    'dashboard (RLS role) status change queues a sync via the SECURITY DEFINER trigger');

-- ───────────── 2. Follow-up auto-enrolment ─────────────

-- A lead created BEFORE auto-enrol is switched on must never be picked up.
insert into contacts (id, tenant_id, name, email) values
    ('c0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'Old Lead', 'old@example.com');
insert into leads (id, tenant_id, contact_id, status, created_at) values
    ('d0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000010', 'WARM', now() - interval '10 days');

insert into follow_up_sequences (id, tenant_id, name, is_active, steps, auto_enrol, auto_enrol_after_hours)
values ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Quiet lead nudge', true,
        '[{"day_offset": 1, "channel": "email", "subject": "Still looking?", "body": "Hi {{contact_name}}"}]', true, 24);

select pg_temp.expect(
    (select auto_enrol_since is not null from follow_up_sequences where id = 'b0000000-0000-0000-0000-000000000001'),
    'switching auto-enrol on stamps auto_enrol_since');

-- Pretend auto-enrol was switched on 5 days ago so "quiet for 24h" leads exist.
update follow_up_sequences set auto_enrol_since = now() - interval '5 days' where id = 'b0000000-0000-0000-0000-000000000001';

-- Q = quiet 3 days, has email -> should enrol.
-- R = replied 2 hours ago      -> should NOT enrol.
-- A = has an upcoming viewing  -> should NOT enrol.
-- N = no email address         -> should NOT enrol.
-- L = LOST                     -> should NOT enrol.
insert into contacts (id, tenant_id, name, email) values
    ('c0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'Quiet Q', 'q@example.com'),
    ('c0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'Replied R', 'r@example.com'),
    ('c0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', 'Booked A', 'a@example.com'),
    ('c0000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000001', 'No Email N', null),
    ('c0000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', 'Lost L', 'l@example.com');
insert into leads (id, tenant_id, contact_id, status, created_at) values
    ('d0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000011', 'WARM', now() - interval '3 days'),
    ('d0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000012', 'HOT',  now() - interval '3 days'),
    ('d0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000013', 'HOT',  now() - interval '3 days'),
    ('d0000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000014', 'WARM', now() - interval '3 days'),
    ('d0000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000015', 'LOST', now() - interval '3 days');

insert into conversations (id, tenant_id, contact_id, channel) values
    ('99000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000011', 'chat_widget'),
    ('99000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000012', 'chat_widget');
insert into messages (tenant_id, conversation_id, role, content, created_at) values
    ('a0000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000011', 'user', 'hi', now() - interval '3 days'),
    ('a0000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000012', 'user', 'hi', now() - interval '3 days'),
    ('a0000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000012', 'user', 'any update?', now() - interval '2 hours');

insert into appointments (tenant_id, contact_id, starts_at, ends_at, timezone, status) values
    ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000013',
     now() + interval '3 days', now() + interval '3 days 1 hour', 'Europe/Warsaw', 'confirmed');

create temp table enrolled as select * from enrol_quiet_leads(100);

select pg_temp.expect(
    (select count(*) from enrolled) = 1
    and (select lead_id from enrolled) = 'd0000000-0000-0000-0000-000000000011',
    'only the quiet, emailable, unbooked, open lead created after switch-on is enrolled');

select pg_temp.expect(
    (select next_run_at between now() + interval '23 hours' and now() + interval '25 hours' from enrolled),
    'first step is scheduled from enrolment time using its day_offset');

select pg_temp.expect(
    (select count(*) from enrol_quiet_leads(100)) = 0,
    'second sweep does not enrol the same lead again');

-- Finished runs must not be re-enrolled either (no loops).
update follow_up_runs set status = 'completed', next_run_at = null where lead_id = 'd0000000-0000-0000-0000-000000000011';
select pg_temp.expect(
    (select count(*) from enrol_quiet_leads(100)) = 0,
    'a lead whose run completed is not re-enrolled');

-- Inactive sequence: nothing enrolled even if a new quiet lead appears.
insert into contacts (id, tenant_id, name, email) values
    ('c0000000-0000-0000-0000-000000000016', 'a0000000-0000-0000-0000-000000000001', 'Quiet 2', 'q2@example.com');
insert into leads (tenant_id, contact_id, status, created_at) values
    ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000016', 'QUALIFYING', now() - interval '2 days');
update follow_up_sequences set is_active = false where id = 'b0000000-0000-0000-0000-000000000001';
select pg_temp.expect(
    (select count(*) from enrol_quiet_leads(100)) = 0,
    'inactive auto-enrol sequence enrols nobody');
update follow_up_sequences set is_active = true where id = 'b0000000-0000-0000-0000-000000000001';
select pg_temp.expect(
    (select count(*) from enrol_quiet_leads(100)) = 1,
    're-activated sequence picks the waiting quiet lead up');

-- Only one auto-enrol sequence per tenant.
do $$
begin
    insert into follow_up_sequences (tenant_id, name, steps, auto_enrol)
    values ('a0000000-0000-0000-0000-000000000001', 'Second auto', '[]', true);
    raise exception 'FAILED: a second auto-enrol sequence was allowed';
exception when unique_violation then
    raise notice 'ok: a second auto-enrol sequence per tenant is rejected';
end $$;

update follow_up_sequences set auto_enrol = false where id = 'b0000000-0000-0000-0000-000000000001';
select pg_temp.expect(
    (select auto_enrol_since is null from follow_up_sequences where id = 'b0000000-0000-0000-0000-000000000001'),
    'switching auto-enrol off clears auto_enrol_since');

-- ───────────── 3. Permissions ─────────────

set role authenticated;
do $$
begin
    perform enrol_quiet_leads(1);
    raise exception 'FAILED: authenticated role could run enrol_quiet_leads()';
exception when insufficient_privilege then
    raise notice 'ok: dashboard users cannot run the enrolment sweep';
end $$;
do $$
begin
    perform queue_crm_sync('a0000000-0000-0000-0000-000000000001', 'lead', 'd0000000-0000-0000-0000-000000000001');
    raise exception 'FAILED: authenticated role could call queue_crm_sync() directly';
exception when insufficient_privilege then
    raise notice 'ok: dashboard users cannot queue arbitrary syncs directly';
end $$;
reset role;

do $$ begin raise notice 'ALL 0026 CHECKS PASSED'; end $$;
