-- Scenario test for 0041 (the support-permission switch). Scratch database
-- only; rolls back. Ends with "0041 checks passed".
begin;
insert into tenants (id, name, slug, timezone, assistant_mode) values
  ('99999999-0000-0000-0000-000000000411', 'Agency A', 'a-411', 'Europe/Warsaw', 'agency'),
  ('99999999-0000-0000-0000-000000000412', 'Elliot sales', 'sales-412', 'Europe/Warsaw', 'sales');
insert into tenant_users (tenant_id, auth_user_id, email, role) values
  ('99999999-0000-0000-0000-000000000412', 'dddddddd-0000-0000-0000-000000000411', 'don@getelliot.eu', 'admin');
delete from support_access_grants where tenant_id = '99999999-0000-0000-0000-000000000411';
insert into platform_admin_views (auth_user_id, tenant_id) values ('dddddddd-0000-0000-0000-000000000411', '99999999-0000-0000-0000-000000000411');
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000411', true),
       set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000411","email":"don@getelliot.eu","aal":"aal2"}', true);
do $$
begin
  -- Off (testing): in without a grant.
  update platform_settings set support_permission_required = false;
  if support_permission_required() or current_tenant_id() <> '99999999-0000-0000-0000-000000000411' then raise exception '1: switch off should let in'; end if;
  -- On: out again.
  update platform_settings set support_permission_required = true;
  if not support_permission_required() or current_tenant_id() <> '99999999-0000-0000-0000-000000000412' then raise exception '2: switch on should keep out'; end if;
  -- Two-step is needed either way.
  update platform_settings set support_permission_required = false;
  perform set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000411","aal":"aal1"}', true);
  if current_tenant_id() <> '99999999-0000-0000-0000-000000000412' then raise exception '3: aal1 got in'; end if;
  -- No row at all counts as "required" (safe default).
  delete from platform_settings;
  if not support_permission_required() then raise exception '4'; end if;
  raise notice '0041 checks passed';
end $$;
rollback;
