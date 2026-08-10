-- 0008_row_level_security.sql
--
-- Tenant isolation, enforced at the database, not just in application/n8n code.
--
-- How this is meant to be used:
--   Every request into n8n resolves a tenant_id (from an API key or auth token)
--   BEFORE touching the database, then sets it for the session:
--
--     select set_config('app.current_tenant', '<tenant-uuid>', true);
--
--   All queries in that session are then automatically scoped by these policies.
--   If app.current_tenant is never set, current_setting(...) below returns NULL
--   and every policy check fails closed (no rows visible) — this is intentional.
--   A bug that forgets to set the tenant should produce "no data", not "wrong tenant's data".

create or replace function current_tenant_id()
returns uuid
language sql stable
as $$
    select nullif(current_setting('app.current_tenant', true), '')::uuid;
$$;

-- Service-role connections (used by n8n's own maintenance jobs, migrations, etc.)
-- bypass RLS by default in Supabase — that's expected and fine, since n8n's
-- tenant-scoping happens at the workflow level for those. Everything below
-- protects the path where a request is scoped to a specific tenant's data.

do $$
declare
    t text;
begin
    for t in
        select unnest(array[
            'tenants', 'tenant_users', 'ai_config',
            'contacts', 'leads', 'conversations', 'messages',
            'documents', 'document_chunks',
            'appointments',
            'follow_up_sequences', 'follow_up_runs',
            'escalations', 'crm_sync_log',
            'tool_call_log', 'audit_log'
        ])
    loop
        execute format('alter table %I enable row level security', t);
    end loop;
end $$;

-- tenants: a tenant row is visible only to itself (there's no "list all tenants" for a scoped session)
create policy tenant_isolation_tenants on tenants
    using (id = current_tenant_id());

-- everything else: standard tenant_id = current_tenant_id() pattern
create policy tenant_isolation_tenant_users on tenant_users
    using (tenant_id = current_tenant_id());

create policy tenant_isolation_ai_config on ai_config
    using (tenant_id = current_tenant_id());

create policy tenant_isolation_contacts on contacts
    using (tenant_id = current_tenant_id());

create policy tenant_isolation_leads on leads
    using (tenant_id = current_tenant_id());

create policy tenant_isolation_conversations on conversations
    using (tenant_id = current_tenant_id());

create policy tenant_isolation_messages on messages
    using (tenant_id = current_tenant_id());

create policy tenant_isolation_documents on documents
    using (tenant_id = current_tenant_id());

create policy tenant_isolation_document_chunks on document_chunks
    using (tenant_id = current_tenant_id());

create policy tenant_isolation_appointments on appointments
    using (tenant_id = current_tenant_id());

create policy tenant_isolation_follow_up_sequences on follow_up_sequences
    using (tenant_id = current_tenant_id());

create policy tenant_isolation_follow_up_runs on follow_up_runs
    using (tenant_id = current_tenant_id());

create policy tenant_isolation_escalations on escalations
    using (tenant_id = current_tenant_id());

create policy tenant_isolation_crm_sync_log on crm_sync_log
    using (tenant_id = current_tenant_id());

create policy tenant_isolation_tool_call_log on tool_call_log
    using (tenant_id = current_tenant_id());

-- audit_log allows tenant_id IS NULL rows (platform-level events) to remain invisible
-- to any tenant-scoped session too — only service-role (RLS-bypassing) connections see those.
create policy tenant_isolation_audit_log on audit_log
    using (tenant_id = current_tenant_id());

comment on function current_tenant_id is
    'Reads app.current_tenant from the session. Must be set via set_config() by the connection layer (n8n) before any tenant-scoped query runs. Unset => NULL => every RLS policy denies => fail closed, not fail open.';
