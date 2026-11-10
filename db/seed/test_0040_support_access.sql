-- Scenario test for 0040 (support access). Scratch database only; rolls
-- back. Ends with "0040 checks passed".
begin;

insert into tenants (id, name, slug, timezone, assistant_mode) values
  ('99999999-0000-0000-0000-000000000401', 'Agency A', 'a-401', 'Europe/Warsaw', 'agency'),
  ('99999999-0000-0000-0000-000000000402', 'Elliot sales', 'sales-402', 'Europe/Warsaw', 'sales');
insert into tenant_users (tenant_id, auth_user_id, email, role) values
  ('99999999-0000-0000-0000-000000000401', 'aaaaaaaa-0000-0000-0000-000000000401', 'boss@a.pl', 'admin'),
  ('99999999-0000-0000-0000-000000000401', 'aaaaaaaa-0000-0000-0000-000000000402', 'agent@a.pl', 'agent'),
  ('99999999-0000-0000-0000-000000000402', 'dddddddd-0000-0000-0000-000000000401', 'don@getelliot.eu', 'admin');
insert into contacts (id, tenant_id, name, email) values
  ('99999999-1111-0000-0000-000000000401', '99999999-0000-0000-0000-000000000401', 'Anna', 'anna@x.pl');

-- Who is asking: sets what auth.uid() / auth.jwt() return.
create or replace function pg_temp.as_user(p_uid text, p_email text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid, true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'email', p_email, 'aal', p_aal)::text, true);
$$;

delete from support_access_grants where tenant_id = '99999999-0000-0000-0000-000000000401';

do $$
declare n int; t uuid; until timestamptz;
begin
  -- Don (platform admin, member of the sales account) starts "view as" on Agency A.
  insert into platform_admin_views (auth_user_id, tenant_id) values ('dddddddd-0000-0000-0000-000000000401', '99999999-0000-0000-0000-000000000401');

  -- 1. No grant: Don stays in his own account, even with two-step sign-in.
  perform pg_temp.as_user('dddddddd-0000-0000-0000-000000000401', 'don@getelliot.eu', 'aal2');
  if current_tenant_id() <> '99999999-0000-0000-0000-000000000402' or current_admin_view() is not null then
    raise exception '1: view without permission (%)', current_tenant_id(); end if;

  -- 2. Only the agency's own admin can allow it.
  perform pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000402', 'agent@a.pl', 'aal1');
  begin perform grant_support_access(24); raise exception '2: agent granted';
  exception when raise_exception then if sqlerrm like '2:%' then raise; end if; end;
  perform pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000401', 'boss@a.pl', 'aal1');
  begin perform grant_support_access(5); raise exception '2: odd duration accepted';
  exception when raise_exception then if sqlerrm like '2:%' then raise; end if; end;
  until := grant_support_access(168);
  if until < now() + interval '6 days 23 hours' then raise exception '2: until %', until; end if;
  select count(*) into n from support_access_grants where tenant_id = '99999999-0000-0000-0000-000000000401' and granted_by_email = 'boss@a.pl';
  if n <> 1 then raise exception '2: grant row'; end if;
  select count(*) into n from audit_log where tenant_id = '99999999-0000-0000-0000-000000000401' and event_type = 'support.access_granted';
  if n <> 1 then raise exception '2: audit'; end if;

  -- 3. With the grant, but signed in with a password only: still no access.
  perform pg_temp.as_user('dddddddd-0000-0000-0000-000000000401', 'don@getelliot.eu', 'aal1');
  if current_tenant_id() <> '99999999-0000-0000-0000-000000000402' then raise exception '3: aal1 got in'; end if;

  -- 4. Grant + two-step: in. Visits are logged once per part per 30 minutes.
  perform pg_temp.as_user('dddddddd-0000-0000-0000-000000000401', 'don@getelliot.eu', 'aal2');
  if current_tenant_id() <> '99999999-0000-0000-0000-000000000401' or current_admin_view() <> '99999999-0000-0000-0000-000000000401' then
    raise exception '4: not in'; end if;
  perform log_support_visit('/dashboard/conversations/abc');
  perform log_support_visit('/dashboard/conversations');
  perform log_support_visit('/dashboard/follow-ups');
  perform log_support_visit('/');
  select count(*) into n from support_access_log where tenant_id = '99999999-0000-0000-0000-000000000401';
  if n <> 3 then raise exception '4: % visits', n; end if;
  select count(*) into n from support_access_log where section in ('Conversations', 'Follow Ups', 'Overview') and admin_email = 'don@getelliot.eu';
  if n <> 3 then raise exception '4: sections'; end if;

  -- 5. An admin inside can't grant or revoke on the agency's behalf.
  begin perform grant_support_access(720); raise exception '5: admin extended';
  exception when raise_exception then if sqlerrm like '5:%' then raise; end if; end;

  -- 6. Not viewing anyone: nothing logged.
  perform pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000401', 'boss@a.pl', 'aal1');
  perform log_support_visit('/dashboard/leads');
  select count(*) into n from support_access_log where section = 'Leads';
  if n <> 0 then raise exception '6: logged a normal user'; end if;

  -- 7. The agency turns it off: Don is out at once, view row removed.
  perform revoke_support_access();
  select count(*) into n from platform_admin_views where tenant_id = '99999999-0000-0000-0000-000000000401';
  if n <> 0 then raise exception '7: view left'; end if;
  perform pg_temp.as_user('dddddddd-0000-0000-0000-000000000401', 'don@getelliot.eu', 'aal2');
  if current_tenant_id() <> '99999999-0000-0000-0000-000000000402' then raise exception '7: still in'; end if;

  -- 8. An expired grant doesn't count.
  insert into support_access_grants (tenant_id, expires_at) values ('99999999-0000-0000-0000-000000000401', now() - interval '1 minute');
  insert into platform_admin_views (auth_user_id, tenant_id) values ('dddddddd-0000-0000-0000-000000000401', '99999999-0000-0000-0000-000000000401');
  if current_admin_view() is not null then raise exception '8: expired grant used'; end if;

  -- 9a. A new agency starts with a 30-day set-up window; Elliot's own accounts get none (need none).
  select count(*) into n from support_access_grants where tenant_id = '99999999-0000-0000-0000-000000000402';
  if n <> 0 then raise exception '9a: sales account got a grant'; end if;
  insert into tenants (id, name, slug, timezone, assistant_mode) values ('99999999-0000-0000-0000-000000000403', 'New', 'new-403', 'Europe/Warsaw', 'agency');
  select count(*) into n from support_access_grants where tenant_id = '99999999-0000-0000-0000-000000000403'
    and granted_by_email = 'Elliot set-up' and expires_at between now() + interval '29 days' and now() + interval '31 days';
  if n <> 1 then raise exception '9a: no set-up window'; end if;

  -- 9. Elliot's own accounts need no grant (two-step still required).
  if not support_access_active('99999999-0000-0000-0000-000000000402') then raise exception '9'; end if;
  if support_access_active('99999999-0000-0000-0000-000000000401') then raise exception '9b'; end if;
end $$;

-- 10. The agency reads its own grant and visits; nobody else's; can't write them.
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000402', 'agent@a.pl', 'aal1');
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from support_access_log;
  if n <> 3 then raise exception '10: agent sees % visits', n; end if;
  begin
    insert into support_access_grants (tenant_id, expires_at) values ('99999999-0000-0000-0000-000000000401', now() + interval '1 year');
    raise exception '10: wrote a grant directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000401', 'don@getelliot.eu', 'aal2');
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from support_access_log;
  if n <> 0 then raise exception '10b: other agency''s visits visible'; end if;
  raise notice '0040 checks passed';
end $$;

rollback;
