-- 0035_email_instant_replies.sql
--
-- Email now answers instantly through Elliot, like WhatsApp (workflow 16
-- hands each email to workflow 01 and sends Elliot's reply in the same
-- Gmail thread). This adds the one database piece it needs:
--
-- log_reply_send_failure(): when an automatic reply can't be sent (Gmail
-- refused it, the connection expired...), an audit_log row and a note the
-- team sees in the conversation, for any channel. The WhatsApp-only
-- log_whatsapp_send_failure() from 0032 stays for workflow 25.
--
-- Repeated emails are ignored with claim_whatsapp_message() from 0032 (it
-- takes any message id; workflow 16 prefixes Gmail ids with "gmail:").
--
-- For n8n's service-role connection only. One transaction; safe to run again.

begin;

create or replace function log_reply_send_failure(
    p_tenant_id uuid,
    p_conversation_id uuid,
    p_channel text,
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
    v_channel text := coalesce(nullif(btrim(p_channel), ''), 'chat');
    v_label text := case v_channel when 'email' then 'by email' when 'whatsapp' then 'on WhatsApp' else 'in the chat' end;
begin
    insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
    values (p_tenant_id, 'system', 'auto_reply', v_channel || '_send_failed',
            coalesce(p_details, '{}'::jsonb) || jsonb_build_object('conversation_id', p_conversation_id, 'error', v_error));

    if p_conversation_id is not null
       and exists (select 1 from conversations where id = p_conversation_id and tenant_id = p_tenant_id) then
        insert into messages (tenant_id, conversation_id, role, content)
        values (p_tenant_id, p_conversation_id, 'system',
                'Elliot''s last reply wasn''t delivered ' || v_label || ': ' || v_error);
        update conversations set updated_at = now() where id = p_conversation_id;
    end if;
end;
$$;

revoke all on function log_reply_send_failure(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

commit;
