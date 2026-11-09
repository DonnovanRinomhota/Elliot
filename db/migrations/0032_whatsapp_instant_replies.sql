-- 0032_whatsapp_instant_replies.sql
--
-- WhatsApp now works like the website chat: workflow 25 hands each message
-- to Elliot (workflow 01), which answers straight away, searches listings and
-- books viewings, and 25 sends the answer back on WhatsApp. Team members can
-- take over a WhatsApp chat and reply from the dashboard (workflow 32).
--
-- 1. claim_whatsapp_message(): Meta delivers the same message again when it
--    doesn't get a fast enough answer, or after an outage. Workflow 25 claims
--    each message id first; a repeat is ignored, so the client never gets two
--    answers to one message.
-- 2. get_conversation_history(): returned the OLDEST 20 messages of a
--    conversation. A WhatsApp chat is one conversation per person for good,
--    so after 20 messages Elliot would have lost track of what was said
--    recently. Now returns the latest 20, oldest first. Same for the website.
-- 3. log_whatsapp_send_failure(): when Meta refuses a reply (expired token,
--    number not verified, 24-hour window closed), the team sees a note in the
--    conversation and an audit_log row, instead of nothing.
--
-- Functions 1 and 3 are for n8n's service-role connection only.
-- One transaction; safe to run again.

begin;

-- ── 1. Meta's repeated deliveries ──
create table if not exists whatsapp_inbound_messages (
    wa_message_id text primary key,
    tenant_id     uuid not null references tenants(id) on delete cascade,
    received_at   timestamptz not null default now()
);
create index if not exists idx_whatsapp_inbound_messages_received on whatsapp_inbound_messages(received_at);

alter table whatsapp_inbound_messages enable row level security;
-- No policies: only the service role (n8n) reads or writes this table.

-- True the first time a message id is seen, false for every repeat.
-- Ids older than 30 days are cleared on the way (Meta stops retrying long before).
create or replace function claim_whatsapp_message(p_tenant_id uuid, p_wa_message_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_new boolean;
begin
    if nullif(btrim(coalesce(p_wa_message_id, '')), '') is null then
        return true; -- nothing to compare; let it through
    end if;

    insert into whatsapp_inbound_messages (wa_message_id, tenant_id)
    values (btrim(p_wa_message_id), p_tenant_id)
    on conflict (wa_message_id) do nothing;
    v_new := found;

    if v_new and random() < 0.01 then
        delete from whatsapp_inbound_messages where received_at < now() - interval '30 days';
    end if;
    return v_new;
end;
$$;

revoke all on function claim_whatsapp_message(uuid, text) from public, anon, authenticated;

-- ── 2. Latest history, not the first ──
create or replace function get_conversation_history(p_tenant_id uuid, p_conversation_id uuid, p_limit int default 20)
returns table (role text, content text)
language plpgsql
as $$
begin
    perform set_config('app.current_tenant', p_tenant_id::text, true);
    return query
        select h.role, h.content
        from (
            select m.role, m.content, m.created_at
            from messages m
            where m.conversation_id = p_conversation_id
            order by m.created_at desc
            limit p_limit
        ) h
        order by h.created_at asc;
end;
$$;

-- ── 3. A reply Meta refused ──
create or replace function log_whatsapp_send_failure(
    p_tenant_id uuid,
    p_conversation_id uuid,
    p_error text,
    p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_error text := left(coalesce(nullif(btrim(p_error), ''), 'unknown error'), 500);
begin
    insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
    values (p_tenant_id, 'system', 'workflow_25', 'whatsapp_send_failed',
            coalesce(p_details, '{}'::jsonb) || jsonb_build_object('conversation_id', p_conversation_id, 'error', v_error));

    if p_conversation_id is not null
       and exists (select 1 from conversations where id = p_conversation_id and tenant_id = p_tenant_id) then
        insert into messages (tenant_id, conversation_id, role, content)
        values (p_tenant_id, p_conversation_id, 'system',
                'Elliot''s last reply wasn''t delivered on WhatsApp: ' || v_error);
        update conversations set updated_at = now() where id = p_conversation_id;
    end if;
end;
$$;

revoke all on function log_whatsapp_send_failure(uuid, uuid, text, jsonb) from public, anon, authenticated;

commit;
