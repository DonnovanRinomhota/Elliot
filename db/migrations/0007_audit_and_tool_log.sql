-- 0007_audit_and_tool_log.sql
-- The tables that make "why did the AI do that" answerable.

-- ─────────────────────────────────────────────────────────────
-- tool_call_log: every tool Claude requested, whether it was approved/executed, and its result
-- ─────────────────────────────────────────────────────────────
create table tool_call_log (
    id                  uuid primary key default uuid_generate_v4(),
    tenant_id           uuid not null references tenants(id) on delete cascade,
    conversation_id     uuid references conversations(id) on delete set null,
    tool_name           text not null,
    tool_input           jsonb not null,
    decision            text not null default 'pending'
                            check (decision in ('pending', 'auto_approved', 'human_approved', 'human_rejected', 'denied_by_policy')),
    approved_by          uuid references tenant_users(id),       -- null if auto-approved or not yet decided
    result               jsonb,                                  -- output of the tool execution, once run
    error                text,                                    -- populated if execution failed
    requested_at          timestamptz not null default now(),
    resolved_at            timestamptz                             -- when decision moved off 'pending'
);

create index idx_tool_call_log_tenant on tool_call_log(tenant_id);
create index idx_tool_call_log_tenant_pending on tool_call_log(tenant_id, decision) where decision = 'pending';
create index idx_tool_call_log_conversation on tool_call_log(conversation_id);

comment on table tool_call_log is
    'This table is written BEFORE a tool executes (decision starts pending or auto_approved) and updated with the result after. It is the audit trail for every privileged action the AI ever attempted, approved or not — this is what you point to when a customer asks "why did the AI cancel my appointment."';

-- ─────────────────────────────────────────────────────────────
-- audit_log: auth events, permission denials, config changes — platform-level, not tool-specific
-- ─────────────────────────────────────────────────────────────
create table audit_log (
    id              uuid primary key default uuid_generate_v4(),
    tenant_id       uuid references tenants(id) on delete cascade,   -- nullable for platform-level events not tied to a tenant
    actor_type      text not null check (actor_type in ('tenant_user', 'system', 'ai_agent')),
    actor_id        text,                                            -- tenant_users.id or a system identifier
    event_type      text not null,                                    -- 'permission_denied', 'config_changed', 'login', etc.
    details         jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now()
);

create index idx_audit_log_tenant on audit_log(tenant_id);
create index idx_audit_log_event_type on audit_log(event_type);
