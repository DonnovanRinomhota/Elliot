-- 0005_follow_up_engine.sql
-- Configurable per-tenant follow-up sequences and their running instances.

-- ─────────────────────────────────────────────────────────────
-- follow_up_sequences: tenant-defined templates (e.g. Day 0 / Day 1 / Day 3 / Day 7)
-- ─────────────────────────────────────────────────────────────
create table follow_up_sequences (
    id              uuid primary key default uuid_generate_v4(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    name            text not null,
    is_active       boolean not null default true,
    steps           jsonb not null,
        -- ordered array, e.g.:
        -- [
        --   {"day_offset": 0, "channel": "email", "template": "initial_response"},
        --   {"day_offset": 1, "channel": "email", "template": "follow_up_1"},
        --   {"day_offset": 3, "channel": "email", "template": "follow_up_2"},
        --   {"day_offset": 7, "channel": "email", "template": "final_follow_up"}
        -- ]
    stop_conditions jsonb not null default '["contact_replied"]'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index idx_follow_up_sequences_tenant on follow_up_sequences(tenant_id);

-- ─────────────────────────────────────────────────────────────
-- follow_up_runs: one active instance of a sequence against a specific lead
-- ─────────────────────────────────────────────────────────────
create table follow_up_runs (
    id                  uuid primary key default uuid_generate_v4(),
    tenant_id           uuid not null references tenants(id) on delete cascade,
    lead_id             uuid not null references leads(id) on delete cascade,
    sequence_id         uuid not null references follow_up_sequences(id) on delete cascade,
    current_step_index  int not null default 0,
    status              text not null default 'running' check (status in ('running', 'stopped', 'completed')),
    stop_reason         text,                                   -- e.g. 'contact_replied', 'manually_stopped'
    next_run_at         timestamptz,                             -- null once completed/stopped
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index idx_follow_up_runs_tenant on follow_up_runs(tenant_id);
create index idx_follow_up_runs_due on follow_up_runs(status, next_run_at) where status = 'running';

comment on table follow_up_runs is 'The Follow-Up Engine workflow polls for status=running AND next_run_at <= now(), sends the current step, advances current_step_index, and sets status=stopped if a stop condition (e.g. contact replied) fires first.';

create trigger trg_follow_up_sequences_updated_at before update on follow_up_sequences
    for each row execute function set_updated_at();
create trigger trg_follow_up_runs_updated_at before update on follow_up_runs
    for each row execute function set_updated_at();
