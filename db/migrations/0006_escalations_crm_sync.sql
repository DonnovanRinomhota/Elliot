-- 0006_escalations_crm_sync.sql

-- ─────────────────────────────────────────────────────────────
-- escalations: handoffs to a human, with enough context to avoid a cold start
-- ─────────────────────────────────────────────────────────────
create table escalations (
    id                  uuid primary key default uuid_generate_v4(),
    tenant_id           uuid not null references tenants(id) on delete cascade,
    conversation_id     uuid not null references conversations(id) on delete cascade,
    reason              text not null check (reason in (
                            'low_confidence', 'customer_requested_human', 'angry_customer',
                            'legal_issue', 'refund_requested', 'sensitive_info',
                            'no_trusted_source', 'action_exceeds_permissions', 'other'
                        )),
    priority            text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
    context_summary     text not null,                          -- AI-generated summary of the conversation so far, handed to the human
    assigned_to         uuid references tenant_users(id),
    status              text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
    resolved_at         timestamptz,
    created_at          timestamptz not null default now()
);

create index idx_escalations_tenant on escalations(tenant_id);
create index idx_escalations_tenant_status on escalations(tenant_id, status);

comment on table escalations is 'context_summary is required — the whole point of this table is that a human never has to reconstruct context from raw message history under time pressure.';

-- ─────────────────────────────────────────────────────────────
-- crm_sync_log: outbound writes to the tenant's external CRM
-- ─────────────────────────────────────────────────────────────
create table crm_sync_log (
    id              uuid primary key default uuid_generate_v4(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    entity_type     text not null check (entity_type in ('contact', 'lead', 'appointment')),
    entity_id       uuid not null,
    crm_provider    text not null,                              -- 'hubspot', etc.
    crm_record_id   text,                                        -- external ID once synced
    status          text not null default 'pending' check (status in ('pending', 'synced', 'failed')),
    retry_count     int not null default 0,
    last_error      text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index idx_crm_sync_log_tenant on crm_sync_log(tenant_id);
create index idx_crm_sync_log_pending on crm_sync_log(status) where status = 'pending';

create trigger trg_crm_sync_log_updated_at before update on crm_sync_log
    for each row execute function set_updated_at();
