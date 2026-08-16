-- 0011_ai_config_calendar_and_leads_unique.sql
--
-- Captures two schema changes that were made directly against the live
-- Supabase database during Phase 4/5 build-out and were never turned into a
-- migration file. This migration exists so `db/migrations` actually matches
-- what's running, and so a fresh environment (staging, a second tenant's
-- database, a teammate's local setup) doesn't silently diverge.

-- Required by "11 - Check Availability" and "12 - Book Appointment": the
-- tenant's Google Calendar id (usually 'primary', but must be settable per
-- tenant since a real tenant's calendar won't always be the connected
-- account's own primary calendar).
alter table ai_config
    add column if not exists google_calendar_id text not null default 'primary';

-- Required by "10 - Lead Capture"'s Upsert Lead query, which does
-- `on conflict (tenant_id, contact_id) do update ...` -- that clause requires
-- exactly this constraint to exist, or the query fails outright.
create unique index if not exists leads_tenant_contact_unique
    on leads(tenant_id, contact_id);

comment on column ai_config.google_calendar_id is
    'Google Calendar id to check/book against for this tenant. Defaults to primary; set explicitly once a tenant connects a non-primary calendar.';
