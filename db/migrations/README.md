# Database Migrations

Run in order — each file is numbered and depends on the ones before it.

```
0001_extensions_and_tenants.sql
0002_contacts_leads_conversations.sql
0003_knowledge_rag.sql
0004_appointments.sql
0005_follow_up_engine.sql
0006_escalations_crm_sync.sql
0007_audit_and_tool_log.sql
0008_row_level_security.sql
```

## How to apply

Via the Supabase SQL editor (simplest for now — a proper migration tool like `sqlx` or Supabase CLI migrations comes later once there's a team, not a solo dev):

1. Open your Supabase project → SQL Editor.
2. Paste and run each file in order, 0001 through 0008.
3. Then, for local dev only, run `db/seed/dev_seed.sql`.
4. Verify isolation by running `db/seed/test_rls_isolation.sql` against a **non-service-role** connection — every `expected_0` query must return 0. If one doesn't, stop and fix it before building anything on top.

## Important architectural note on RLS enforcement

These policies check `current_setting('app.current_tenant')`, which must be set explicitly per session via `set_config('app.current_tenant', '<uuid>', false)` **before** any tenant-scoped query runs.

This works cleanly when **n8n connects directly via the Postgres node** (a real session, so `set_config` persists for the query). It does **not** automatically work if you instead call the data through Supabase's PostgREST/client-library API using end-user JWTs — that path expects RLS policies written against `auth.uid()` / JWT claims instead.

**Decision for this project:** n8n uses direct Postgres connections and sets `app.current_tenant` itself after resolving the tenant from the inbound request (API key / widget token). The dashboard app (`apps/dashboard`), when it exists, will likely need the JWT-claim style of policy instead, since it's calling through Supabase Auth. That means dashboard-facing tables may eventually need a **second set of policies** (or a rewrite of these) once that app is built. Flagging this now so it isn't a surprise later — not fixing it yet, since the dashboard isn't in scope for this phase.

## Verifying the double-booking constraint

After running 0004, this should fail with a constraint violation:

```sql
select set_config('app.current_tenant', '11111111-1111-1111-1111-111111111111', false);

insert into appointments (tenant_id, contact_id, starts_at, ends_at, timezone)
values ('11111111-1111-1111-1111-111111111111', 'a1a1a1a1-0000-0000-0000-000000000001',
        '2026-09-01 10:00:00+00', '2026-09-01 10:30:00+00', 'Europe/Warsaw');

-- this second insert, overlapping the first, must be rejected:
insert into appointments (tenant_id, contact_id, starts_at, ends_at, timezone)
values ('11111111-1111-1111-1111-111111111111', 'a1a1a1a1-0000-0000-0000-000000000001',
        '2026-09-01 10:15:00+00', '2026-09-01 10:45:00+00', 'Europe/Warsaw');
```

## Known gap to close before this is production-ready

The exclusion constraint on `appointments` prevents overlap **tenant-wide**. If a tenant has multiple agents/resources that should be independently bookable in parallel (e.g. Zebra Real Estate has several agents), this constraint needs a `resource_id` column added to the exclusion clause, or it will incorrectly block legitimate concurrent bookings. Not fixed in this migration because the MVP assumes single-resource scheduling per tenant — revisit before onboarding a multi-agent tenant.
