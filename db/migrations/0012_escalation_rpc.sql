-- 0012_escalation_rpc.sql
--
-- Fixes a previously-parked bug: "Insert Escalation" (hot-lead path in
-- "10 - Lead Capture") intermittently failed with
--   "conflicting key value violates ... escalations_conversation_id_fkey"
-- even when the referenced conversations row demonstrably existed and was
-- independently queryable.
--
-- Root cause: this table is RLS-protected (see 0008_row_level_security.sql),
-- and 0009_tenant_scoped_rpcs.sql already documents why a bare
-- `set_config('app.current_tenant', ...)` in one n8n Postgres node execution
-- does not reliably carry over into a separate node's query -- each node is
-- its own connection/session. The escalations insert was still being done as
-- raw SQL in n8n rather than through a tenant-scoped RPC, so it inherited
-- exactly the RLS-visibility race 0009 was written to solve for every other
-- table -- it just hadn't been extended to escalations yet.
--
-- Fix: same pattern as get_or_create_conversation / log_message / log_tool_call
-- in 0009 -- set the RLS session context and do the insert in one guaranteed-
-- order PL/pgSQL block.

create or replace function insert_escalation(
    p_tenant_id uuid,
    p_conversation_id uuid,
    p_reason text,
    p_priority text,
    p_context_summary text
)
returns uuid
language plpgsql
as $$
declare
    v_id uuid;
begin
    perform set_config('app.current_tenant', p_tenant_id::text, true);
    insert into escalations (tenant_id, conversation_id, reason, priority, context_summary, status)
    values (p_tenant_id, p_conversation_id, p_reason, p_priority, p_context_summary, 'open')
    returning id into v_id;
    return v_id;
end;
$$;

comment on function insert_escalation is
    'Tenant-scoped escalation insert. Sets RLS session context internally in guaranteed order before the insert -- do not replace with raw multi-statement SQL relying on a separately-set session variable, see 0009 for why that was already tried and confirmed broken for other tables.';
