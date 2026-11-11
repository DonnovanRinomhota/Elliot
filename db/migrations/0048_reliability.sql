-- 0048: Reliability. Nothing is sent twice, and nothing fails silently.
--
--   1. Follow-ups: a due step is claimed and the run moved on in ONE
--      transaction (claim_due_follow_up_runs), so a sweep that crashes or
--      overlaps the next one can never send the same step twice. Runs also stop
--      when the lead is closed or the client asked for no more messages.
--   2. Clients can stop follow-ups: "STOP" / "unsubscribe" / "wypisz" on
--      WhatsApp or email is remembered on the contact.
--   3. When Elliot can't answer (Claude down, a crash), the team gets an
--      escalation and the failure is logged (record_elliot_failure).
--   4. A tool that fails is logged (record_tool_failure) and alerts.
--   5. WhatsApp messages Meta later reports as undelivered are logged and
--      shown in the conversation (record_whatsapp_delivery_failure).
--   6. CRM sync retries wait longer each time (15 min, 45 min, 2 h, 7 h)
--      instead of giving up after 25 minutes (due_crm_syncs).
--
-- Safe to run twice. Changes no existing data.

-- ─────────────────────────────────────────────────────────────
-- 2. Opting out of follow-ups (defined first: 1 uses it)
-- ─────────────────────────────────────────────────────────────
alter table contacts add column if not exists follow_up_opt_out_at timestamptz;
comment on column contacts.follow_up_opt_out_at is
    'Set when the client asked for no more follow-up messages (STOP / unsubscribe / wypisz). Follow-up runs for this contact stop and no new step is sent. Cleared when they write START, or by the team.';

-- The words that count, compared with the first line of a short message.
create or replace function follow_up_opt_word(p_text text)
returns text
language sql
immutable
as $$
    with first_line as (
        select btrim(regexp_replace(lower(split_part(btrim(coalesce(p_text, '')), E'\n', 1)), '[[:punct:]]+', ' ', 'g')) as t
    ), norm as (
        select regexp_replace(t, '\s+', ' ', 'g') as t from first_line
    )
    select case
        when t in ('stop', 'stop all', 'stopall', 'unsubscribe', 'unsubscribe me', 'opt out', 'optout',
                   'no more messages', 'stop messages', 'stop messaging me',
                   'wypisz', 'wypisz mnie', 'rezygnuję', 'rezygnuje', 'rezygnacja',
                   'nie pisz', 'nie piszcie', 'proszę nie pisać', 'prosze nie pisac',
                   'stop wiadomości', 'stop wiadomosci') then 'stop'
        when t in ('start', 'subscribe', 'unstop', 'wznów', 'wznow') then 'start'
        else null end
    from norm;
$$;

create or replace function trg_follow_up_opt_out()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_word text;
    v_contact uuid;
    v_channel text;
begin
    if new.role <> 'user' then return new; end if;
    v_word := follow_up_opt_word(new.content);
    if v_word is null then return new; end if;

    select c.contact_id, c.channel into v_contact, v_channel
    from conversations c where c.id = new.conversation_id and c.tenant_id = new.tenant_id;
    -- Only where follow-ups are sent, and only for a known person.
    if v_contact is null or v_channel not in ('whatsapp', 'email') then return new; end if;

    if v_word = 'stop' then
        update contacts set follow_up_opt_out_at = now()
        where id = v_contact and tenant_id = new.tenant_id and follow_up_opt_out_at is null;
        if found then
            update follow_up_runs r
            set status = 'stopped', stop_reason = 'opted_out', next_run_at = null, updated_at = now()
            from leads l
            where l.id = r.lead_id and l.contact_id = v_contact
              and r.tenant_id = new.tenant_id and r.status = 'running';
            insert into messages (tenant_id, conversation_id, role, content)
            values (new.tenant_id, new.conversation_id, 'system',
                    'The client asked for no more follow-up messages. Elliot has stopped their follow-ups and won''t start new ones. Elliot still answers when they write.');
            insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
            values (new.tenant_id, 'system', 'client', 'follow_up_opt_out',
                    jsonb_build_object('conversation_id', new.conversation_id, 'contact_id', v_contact, 'channel', v_channel));
        end if;
    else
        update contacts set follow_up_opt_out_at = null
        where id = v_contact and tenant_id = new.tenant_id and follow_up_opt_out_at is not null;
        if found then
            insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
            values (new.tenant_id, 'system', 'client', 'follow_up_opt_in',
                    jsonb_build_object('conversation_id', new.conversation_id, 'contact_id', v_contact, 'channel', v_channel));
        end if;
    end if;
    return new;
end;
$$;

revoke all on function follow_up_opt_word(text) from public, anon, authenticated;
revoke all on function trg_follow_up_opt_out() from public, anon, authenticated;

drop trigger if exists trg_follow_up_opt_out on messages;
create trigger trg_follow_up_opt_out after insert on messages
    for each row execute function trg_follow_up_opt_out();

-- ─────────────────────────────────────────────────────────────
-- 1. Follow-ups: claim a due step and move the run on, atomically
-- ─────────────────────────────────────────────────────────────
-- Returns one row per step to send now. By the time workflow 20 sees a row,
-- the run already points at the next step, so the same step can't be picked
-- up again by a later or overlapping sweep. (Before: the run moved on only at
-- the end of the sweep, so a crash in between sent the step again 15 minutes
-- later.) Runs with nothing to send are closed here and not returned.
create or replace function claim_due_follow_up_runs(p_limit integer default 25)
returns table (
    run_id uuid,
    tenant_id uuid,
    lead_id uuid,
    sequence_id uuid,
    current_step_index integer,
    run_created_at timestamptz,
    steps jsonb,
    contact_id uuid,
    contact_name text,
    contact_email text,
    contact_phone text,
    autonomy_rules jsonb,
    connected_gmail_address text,
    whatsapp_phone_number_id text,
    wa_conversation_id uuid,
    wa_last_inbound_at timestamptz,
    contact_replied boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
    r record;
    v_steps jsonb;
    v_count int;
    v_contact contacts%rowtype;
    v_lead_status text;
    v_replied boolean;
    v_final boolean;
    v_stop text;
begin
    for r in
        select fr.* from follow_up_runs fr
        where fr.status = 'running' and fr.next_run_at <= now()
        order by fr.next_run_at asc
        limit greatest(coalesce(p_limit, 25), 1)
        for update skip locked
    loop
        select s.steps into v_steps from follow_up_sequences s where s.id = r.sequence_id;
        v_count := case when jsonb_typeof(v_steps) = 'array' then jsonb_array_length(v_steps) else 0 end;
        select l.status into v_lead_status from leads l where l.id = r.lead_id;
        select c.* into v_contact from contacts c
        join leads l on l.contact_id = c.id where l.id = r.lead_id;

        v_replied := exists (
            select 1 from messages m
            join conversations conv on conv.id = m.conversation_id
            where conv.contact_id = v_contact.id and conv.tenant_id = r.tenant_id
              and m.role = 'user' and m.created_at > r.created_at);

        v_stop := case
            when v_contact.id is null then 'contact_missing'
            when v_contact.follow_up_opt_out_at is not null then 'opted_out'
            when v_replied then 'contact_replied'
            when v_lead_status in ('CONVERTED', 'LOST') then 'lead_closed'
            else null end;

        if v_stop is not null then
            update follow_up_runs set status = 'stopped', stop_reason = v_stop, next_run_at = null, updated_at = now()
            where id = r.id;
            continue;
        end if;

        if r.current_step_index >= v_count then
            update follow_up_runs set status = 'completed', next_run_at = null, updated_at = now() where id = r.id;
            continue;
        end if;

        -- Move on first; then hand the step to the workflow.
        v_final := r.current_step_index = v_count - 1;
        update follow_up_runs
        set current_step_index = r.current_step_index + 1,
            status = case when v_final then 'completed' else 'running' end,
            next_run_at = case when v_final then null
                               else r.created_at + make_interval(days => coalesce((v_steps -> (r.current_step_index + 1) ->> 'day_offset')::int, 0)) end,
            updated_at = now()
        where id = r.id;

        return query
        select r.id, r.tenant_id, r.lead_id, r.sequence_id, r.current_step_index, r.created_at, v_steps,
               v_contact.id, v_contact.name, v_contact.email, v_contact.phone,
               ac.autonomy_rules, ac.connected_gmail_address::text, ac.whatsapp_phone_number_id::text,
               wa.conversation_id, wa.last_inbound_at, false
        from ai_config ac
        left join lateral (
            select conv.id as conversation_id,
                   (select max(m.created_at) from messages m where m.conversation_id = conv.id and m.role = 'user') as last_inbound_at
            from conversations conv
            where conv.tenant_id = r.tenant_id and conv.contact_id = v_contact.id and conv.channel = 'whatsapp'
            order by conv.created_at desc
            limit 1
        ) wa on true
        where ac.tenant_id = r.tenant_id;
    end loop;
end;
$$;
revoke all on function claim_due_follow_up_runs(integer) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. Elliot couldn't answer: tell the team, log it, keep the reply
-- ─────────────────────────────────────────────────────────────
-- Called by workflow 01 when Claude can't be reached after retries. The
-- client has been told someone will get back to them, so someone must: this
-- opens an escalation (one per conversation per hour, not one per message).
create or replace function record_elliot_failure(
    p_tenant_id uuid,
    p_conversation_id uuid,
    p_channel text,
    p_error text,
    p_reply text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_error text := left(coalesce(nullif(btrim(p_error), ''), 'unknown error'), 500);
    v_event text := case p_channel when 'email' then 'email_elliot_failed'
                                   when 'whatsapp' then 'whatsapp_elliot_failed'
                                   else 'chat_elliot_failed' end;
    v_id uuid;
begin
    if p_tenant_id is null then return null; end if;

    insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
    values (p_tenant_id, 'system', 'workflow_01', v_event,
            jsonb_build_object('conversation_id', p_conversation_id, 'error', v_error));

    if p_conversation_id is null
       or not exists (select 1 from conversations where id = p_conversation_id and tenant_id = p_tenant_id) then
        return null;
    end if;

    if nullif(btrim(coalesce(p_reply, '')), '') is not null then
        insert into messages (tenant_id, conversation_id, role, content)
        values (p_tenant_id, p_conversation_id, 'assistant', p_reply);
    end if;
    update conversations set updated_at = now() where id = p_conversation_id;

    select e.id into v_id from escalations e
    where e.tenant_id = p_tenant_id and e.conversation_id = p_conversation_id
      and e.status <> 'resolved' and e.context_summary like 'Elliot could not answer%'
      and e.created_at > now() - interval '1 hour'
    order by e.created_at desc limit 1;
    if v_id is null then
        insert into escalations (tenant_id, conversation_id, reason, priority, context_summary, status)
        values (p_tenant_id, p_conversation_id, 'other', 'high',
                'Elliot could not answer this client because of a technical problem. The client was told someone from the team will get back to them. Please reply to them.',
                'open')
        returning id into v_id;
    end if;
    return v_id;
end;
$$;
revoke all on function record_elliot_failure(uuid, uuid, text, text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. A tool failed (booking, hand-over, search, …)
-- ─────────────────────────────────────────────────────────────
create or replace function record_tool_failure(
    p_tenant_id uuid,
    p_conversation_id uuid,
    p_tool text,
    p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tool text := left(coalesce(nullif(btrim(p_tool), ''), 'unknown'), 80);
    v_error text := left(coalesce(nullif(btrim(p_error), ''), 'unknown error'), 500);
begin
    if p_tenant_id is null then return; end if;
    insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
    values (p_tenant_id, 'system', 'workflow_01',
            case when v_tool = 'book_appointment' then 'booking_failed' else 'tool_failed' end,
            jsonb_build_object('conversation_id', p_conversation_id, 'tool', v_tool, 'error', v_error));

    -- A hand-over that failed must still reach the team.
    if v_tool = 'escalate_to_human' and p_conversation_id is not null
       and exists (select 1 from conversations where id = p_conversation_id and tenant_id = p_tenant_id) then
        insert into escalations (tenant_id, conversation_id, reason, priority, context_summary, status)
        values (p_tenant_id, p_conversation_id, 'other', 'high',
                'Elliot tried to hand this conversation to the team, but the hand-over failed for a technical reason (no email alert was sent). Please read the conversation and reply to the client.',
                'open');
    end if;
end;
$$;
revoke all on function record_tool_failure(uuid, uuid, text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. WhatsApp: accepted by Meta, then not delivered
-- ─────────────────────────────────────────────────────────────
create table if not exists whatsapp_delivery_failures (
    wa_message_id text primary key,
    tenant_id uuid not null references tenants(id) on delete cascade,
    recorded_at timestamptz not null default now()
);
alter table whatsapp_delivery_failures enable row level security;
revoke all on whatsapp_delivery_failures from anon, authenticated;

-- Meta repeats status updates; each failed message is recorded once.
-- Returns true when it was new.
create or replace function record_whatsapp_delivery_failure(
    p_phone_number_id text,
    p_recipient_wa_id text,
    p_wa_message_id text,
    p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid;
    v_conversation uuid;
    v_digits text := regexp_replace(coalesce(p_recipient_wa_id, ''), '\D', '', 'g');
    v_error text := left(coalesce(nullif(btrim(p_error), ''), 'not delivered'), 500);
begin
    select ac.tenant_id into v_tenant from ai_config ac
    where ac.whatsapp_phone_number_id = nullif(btrim(coalesce(p_phone_number_id, '')), '') limit 1;
    if v_tenant is null or nullif(btrim(coalesce(p_wa_message_id, '')), '') is null then return false; end if;

    insert into whatsapp_delivery_failures (wa_message_id, tenant_id)
    values (btrim(p_wa_message_id), v_tenant)
    on conflict (wa_message_id) do nothing;
    if not found then return false; end if;

    if length(v_digits) >= 8 then
        select conv.id into v_conversation
        from conversations conv
        join contacts c on c.id = conv.contact_id
        where conv.tenant_id = v_tenant and conv.channel = 'whatsapp'
          and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_digits
        order by conv.updated_at desc limit 1;
    end if;

    insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
    values (v_tenant, 'system', 'workflow_25', 'whatsapp_delivery_failed',
            jsonb_build_object('conversation_id', v_conversation, 'wa_message_id', btrim(p_wa_message_id), 'error', v_error));

    if v_conversation is not null then
        insert into messages (tenant_id, conversation_id, role, content)
        values (v_tenant, v_conversation, 'system',
                'A WhatsApp message to this client was not delivered: ' || v_error);
        update conversations set updated_at = now() where id = v_conversation;
    end if;
    return true;
end;
$$;
revoke all on function record_whatsapp_delivery_failure(text, text, text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 6. CRM sync: wait longer between retries
-- ─────────────────────────────────────────────────────────────
-- Which pending rows are due now. The first try is immediate; after a failure
-- the row waits 15 min, 45 min, 2 h 15, 6 h 45 (5 min x 3^retries) before the
-- next try, so a CRM that is down for an afternoon doesn't lose the sync.
-- (Before: 5 tries 5 minutes apart, then "failed" for good.)
create or replace function due_crm_syncs(p_limit integer default 25)
returns table (sync_id uuid)
language sql
security definer
set search_path = public
as $$
    select l.id from crm_sync_log l
    where l.status = 'pending'
      and (l.retry_count = 0
           or l.updated_at <= now() - (interval '5 minutes' * power(3, least(l.retry_count, 6))))
    order by l.created_at asc
    limit greatest(coalesce(p_limit, 25), 1);
$$;
revoke all on function due_crm_syncs(integer) from public, anon, authenticated;
