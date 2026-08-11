-- test_rls_isolation.sql
-- Sanity check for the RLS policies in 0008. Run after dev_seed.sql, against a
-- NON-service-role connection (a role that actually has RLS applied to it).
--
-- Expected output annotated inline. If any "expected 0" query returns rows,
-- the isolation model is broken and nothing else in this project should be
-- trusted until it's fixed.

-- Scope the session to tenant 1 (Zebra Real Estate dev tenant)
select set_config('app.current_tenant', '11111111-1111-1111-1111-111111111111', false);

-- expected: 1 row (Jan Kowalski)
select count(*) as expected_1 from contacts;

-- expected: 0 rows — tenant 1's session must not see tenant 2's contact
select count(*) as expected_0 from contacts where tenant_id = '22222222-2222-2222-2222-222222222222';

-- Switch to tenant 2
select set_config('app.current_tenant', '22222222-2222-2222-2222-222222222222', false);

-- expected: 1 row (Sarah Miller)
select count(*) as expected_1 from contacts;

-- expected: 0 rows — tenant 2's session must not see tenant 1's lead
select count(*) as expected_0 from leads where tenant_id = '11111111-1111-1111-1111-111111111111';

-- Fail-closed check: no tenant set at all
select set_config('app.current_tenant', '', false);

-- expected: 0 rows for everyone — unset tenant must see nothing, not everything
select count(*) as expected_0 from contacts;
select count(*) as expected_0 from leads;
select count(*) as expected_0 from tenants;
