-- 0001_extensions_and_tenants.sql
-- Extensions + core tenant tables. Everything else in the schema hangs off `tenants`.

create extension if not exists "uuid-ossp";
create extension if not exists "vector";
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- tenants: one row per business using Elliot
-- ─────────────────────────────────────────────────────────────
create table tenants (
    id              uuid primary key default uuid_generate_v4(),
    name            text not null,
    slug            text not null unique,               -- used in widget embed URLs, subdomains, etc.
    industry        text,                                 -- e.g. 'real_estate' — drives which prompt/tooling profile applies
    plan            text not null default 'trial' check (plan in ('trial', 'starter', 'pro', 'enterprise')),
    status          text not null default 'active' check (status in ('active', 'suspended', 'cancelled')),
    timezone        text not null default 'UTC',
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

comment on table tenants is 'One row per business customer. Every other tenant-scoped table has a tenant_id FK to this.';

-- ─────────────────────────────────────────────────────────────
-- tenant_users: staff who log into the Elliot dashboard for a tenant
-- ─────────────────────────────────────────────────────────────
create table tenant_users (
    id              uuid primary key default uuid_generate_v4(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    auth_user_id    uuid not null,                        -- FK to Supabase auth.users, not enforced cross-schema here
    email           text not null,
    role            text not null default 'agent' check (role in ('admin', 'agent', 'viewer')),
    created_at      timestamptz not null default now(),
    unique (tenant_id, auth_user_id)
);

comment on table tenant_users is 'Dashboard users for a tenant. role governs what the dashboard UI allows, not what the AI is allowed to do (see ai_config).';

-- ─────────────────────────────────────────────────────────────
-- ai_config: per-tenant AI behavior — autonomy rules, escalation thresholds, lead scoring weights
-- ─────────────────────────────────────────────────────────────
create table ai_config (
    tenant_id               uuid primary key references tenants(id) on delete cascade,
    system_prompt_override  text,                          -- appended to the base system prompt, tenant-specific voice/rules
    autonomy_rules          jsonb not null default '{}'::jsonb,
        -- shape example:
        -- {
        --   "send_email": {"mode": "approval_required"},
        --   "book_appointment": {"mode": "autonomous"},
        --   "cancel_appointment": {"mode": "approval_required"}
        -- }
    escalation_thresholds   jsonb not null default '{}'::jsonb,
        -- e.g. {"min_confidence": 0.6, "escalate_on_sentiment": "angry"}
    lead_scoring_rubric     jsonb not null default '{}'::jsonb,
        -- tenant-defined weights per qualification field -> HOT/WARM/COLD cutoffs
    updated_at              timestamptz not null default now()
);

comment on table ai_config is 'Single row per tenant. This is the config n8n reads before letting Claude act — the actual enforcement point, not just prompt text.';

-- keep updated_at fresh
create or replace function set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger trg_tenants_updated_at before update on tenants
    for each row execute function set_updated_at();

create trigger trg_ai_config_updated_at before update on ai_config
    for each row execute function set_updated_at();
