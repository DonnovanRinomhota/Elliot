-- 0004_appointments.sql
-- Appointments, with a constraint-level guard against double-booking.

create table appointments (
    id                  uuid primary key default uuid_generate_v4(),
    tenant_id           uuid not null references tenants(id) on delete cascade,
    contact_id          uuid not null references contacts(id) on delete cascade,
    starts_at           timestamptz not null,
    ends_at             timestamptz not null,
    timezone            text not null,                          -- IANA tz name the appointment was booked in, for display
    status              text not null default 'confirmed'
                            check (status in ('confirmed', 'rescheduled', 'cancelled', 'completed', 'no_show')),
    external_calendar_id text,                                    -- Google/Microsoft event ID, for sync-back on reschedule/cancel
    notes               text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    constraint chk_appointment_times check (ends_at > starts_at)
);

create index idx_appointments_tenant on appointments(tenant_id);
create index idx_appointments_tenant_time on appointments(tenant_id, starts_at);

-- ─────────────────────────────────────────────────────────────
-- Double-booking prevention.
-- Requires btree_gist for the exclusion constraint to work on a uuid + range combo.
-- ─────────────────────────────────────────────────────────────
create extension if not exists btree_gist;

alter table appointments
    add constraint excl_no_overlapping_appointments
    exclude using gist (
        tenant_id with =,
        tstzrange(starts_at, ends_at) with &&
    )
    where (status = 'confirmed');

comment on constraint excl_no_overlapping_appointments on appointments is
    'DB-level guarantee: two confirmed appointments for the same tenant cannot overlap. This is the actual double-booking prevention — the n8n availability check is a courtesy, not the enforcement point. Note: this prevents overlap tenant-wide; if a tenant has multiple staff/resources who can be booked in parallel, add a resource_id column and include it in the exclusion constraint before this goes live for that tenant type.';

create trigger trg_appointments_updated_at before update on appointments
    for each row execute function set_updated_at();
