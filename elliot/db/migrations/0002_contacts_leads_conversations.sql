-- 0002_contacts_leads_conversations.sql
-- Contacts, leads, conversations, messages — the core CRM/chat data.

-- ─────────────────────────────────────────────────────────────
-- contacts: a person, tenant-scoped. Both leads and existing customers live here.
-- ─────────────────────────────────────────────────────────────
create table contacts (
    id              uuid primary key default uuid_generate_v4(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    name            text,
    email           text,
    phone           text,
    company         text,
    source          text,                                  -- 'chat_widget', 'email', 'manual', etc.
    metadata        jsonb not null default '{}'::jsonb,     -- free-form, industry-specific fields
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index idx_contacts_tenant on contacts(tenant_id);
create unique index idx_contacts_tenant_email on contacts(tenant_id, email) where email is not null;

comment on table contacts is 'One row per known person for a tenant. A contact may or may not have an associated lead.';

-- ─────────────────────────────────────────────────────────────
-- leads: qualification state for a contact
-- ─────────────────────────────────────────────────────────────
create table leads (
    id                      uuid primary key default uuid_generate_v4(),
    tenant_id               uuid not null references tenants(id) on delete cascade,
    contact_id              uuid not null references contacts(id) on delete cascade,
    status                  text not null default 'NEW'
                                check (status in ('NEW', 'QUALIFYING', 'HOT', 'WARM', 'COLD', 'CONVERTED', 'LOST')),
    qualification_answers   jsonb not null default '{}'::jsonb,   -- budget, timeline, requirement, etc. — schema is tenant-defined
    score                   numeric,                                -- raw score before bucketing into HOT/WARM/COLD, if tenant uses numeric scoring
    assigned_to             uuid references tenant_users(id),
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);

create index idx_leads_tenant on leads(tenant_id);
create index idx_leads_tenant_status on leads(tenant_id, status);

comment on table leads is 'Qualification state for a contact. qualification_answers shape is driven by the tenant''s configured qualification form, not hardcoded.';

-- ─────────────────────────────────────────────────────────────
-- conversations: a chat/email thread with a contact
-- ─────────────────────────────────────────────────────────────
create table conversations (
    id              uuid primary key default uuid_generate_v4(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    contact_id      uuid references contacts(id) on delete set null,
    channel         text not null check (channel in ('chat_widget', 'email', 'sms')),
    status          text not null default 'open' check (status in ('open', 'escalated', 'closed')),
    assigned_human  uuid references tenant_users(id),        -- set when a human has taken over
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index idx_conversations_tenant on conversations(tenant_id);
create index idx_conversations_tenant_status on conversations(tenant_id, status);

-- ─────────────────────────────────────────────────────────────
-- messages: individual turns within a conversation
-- ─────────────────────────────────────────────────────────────
create table messages (
    id              uuid primary key default uuid_generate_v4(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    conversation_id uuid not null references conversations(id) on delete cascade,
    role            text not null check (role in ('user', 'assistant', 'system', 'human_agent')),
    content         text not null,
    tool_calls      jsonb,                                    -- if role='assistant' and Claude requested tool use, recorded here too (see tool_call_log for execution results)
    created_at      timestamptz not null default now()
);

create index idx_messages_conversation on messages(conversation_id, created_at);
create index idx_messages_tenant on messages(tenant_id);

create trigger trg_contacts_updated_at before update on contacts
    for each row execute function set_updated_at();
create trigger trg_leads_updated_at before update on leads
    for each row execute function set_updated_at();
create trigger trg_conversations_updated_at before update on conversations
    for each row execute function set_updated_at();
