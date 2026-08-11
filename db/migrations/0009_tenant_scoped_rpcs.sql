-- 0009_tenant_scoped_rpcs.sql
--
-- Why this migration exists: the original approach (session-level set_config in
-- one query, relied upon by later queries) silently broke because separate n8n
-- Postgres node executions don't reliably share one DB session/connection.
-- The next attempted fix — cross-joining a `set_config` side-effecting subquery
-- into the same SQL statement — was ALSO wrong: plain SQL gives the query
-- planner no guaranteed left-to-right evaluation order, so it could (and did,
-- confirmed by direct testing) scan the RLS-protected table before the
-- set_config subquery ran, meaning RLS filtered everything out anyway.
--
-- PL/pgSQL functions execute statements in guaranteed procedural order, so
-- `perform set_config(...)` is guaranteed to run before the query that needs
-- it. This is the reliable fix. Every tenant-scoped operation the Main Agent
-- workflow needs is wrapped as a function here; n8n calls these instead of
-- hand-rolling multi-statement SQL with fragile ordering assumptions.

create or replace function get_ai_config(p_tenant_id uuid)
returns table (
    system_prompt_override text,
    autonomy_rules jsonb,
    escalation_thresholds jsonb
)
language plpgsql
as $$
begin
    perform set_config('app.current_tenant', p_tenant_id::text, true);
    return query
        select ac.system_prompt_override, ac.autonomy_rules, ac.escalation_thresholds
        from ai_config ac
        where ac.tenant_id = p_tenant_id;
end;
$$;

create or replace function get_or_create_conversation(p_tenant_id uuid, p_conversation_id uuid)
returns uuid
language plpgsql
as $$
declare
    v_id uuid;
begin
    perform set_config('app.current_tenant', p_tenant_id::text, true);
    insert into conversations (id, tenant_id, channel, status)
    values (coalesce(p_conversation_id, uuid_generate_v4()), p_tenant_id, 'chat_widget', 'open')
    on conflict (id) do update set tenant_id = excluded.tenant_id
    returning id into v_id;
    return v_id;
end;
$$;

create or replace function get_conversation_history(p_tenant_id uuid, p_conversation_id uuid, p_limit int default 20)
returns table (role text, content text)
language plpgsql
as $$
begin
    perform set_config('app.current_tenant', p_tenant_id::text, true);
    return query
        select m.role, m.content
        from messages m
        where m.conversation_id = p_conversation_id
        order by m.created_at asc
        limit p_limit;
end;
$$;

create or replace function log_message(p_tenant_id uuid, p_conversation_id uuid, p_role text, p_content text)
returns uuid
language plpgsql
as $$
declare
    v_id uuid;
begin
    perform set_config('app.current_tenant', p_tenant_id::text, true);
    insert into messages (tenant_id, conversation_id, role, content)
    values (p_tenant_id, p_conversation_id, p_role, p_content)
    returning id into v_id;
    return v_id;
end;
$$;

create or replace function log_tool_call(
    p_tenant_id uuid, p_conversation_id uuid, p_tool_name text, p_tool_input jsonb, p_decision text
)
returns uuid
language plpgsql
as $$
declare
    v_id uuid;
begin
    perform set_config('app.current_tenant', p_tenant_id::text, true);
    insert into tool_call_log (tenant_id, conversation_id, tool_name, tool_input, decision)
    values (p_tenant_id, p_conversation_id, p_tool_name, p_tool_input, p_decision)
    returning id into v_id;
    return v_id;
end;
$$;

comment on function get_ai_config is 'Tenant-scoped read. Sets RLS session context internally in guaranteed order before querying — do not replace with raw SQL that relies on a separately-set session variable, that approach was tried and confirmed broken.';
comment on function get_or_create_conversation is 'Tenant-scoped get-or-create. Always returns a conversation id, whether newly created or pre-existing.';
comment on function log_message is 'Tenant-scoped insert into messages, returns the new row id.';
comment on function log_tool_call is 'Tenant-scoped insert into tool_call_log, returns the new row id.';
