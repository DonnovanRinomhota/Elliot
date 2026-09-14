-- 0021_dashboard_overview_stats.sql
--
-- Real aggregated stats for the dashboard's Overview page, replacing
-- placeholder numbers with actual queries. SECURITY DEFINER + explicit
-- current_tenant_id() filtering in every subquery (same fail-closed pattern
-- as 0015) -- this function bypasses caller-level RLS, so it must scope
-- itself correctly rather than relying on policies to do it.

create or replace function public.get_dashboard_overview_stats(p_days int default 7)
returns table (
    conversations_count        bigint,
    new_leads_count             bigint,
    appointments_booked_count   bigint,
    auto_resolved_count         bigint,
    escalations_count           bigint,
    avg_response_seconds        numeric,
    escalation_rate             numeric,
    auto_resolve_rate           numeric
)
language sql
stable
security definer
set search_path = public
as $$
    with tid as (
        select current_tenant_id() as id
    ),
    since as (
        select now() - (p_days || ' days')::interval as ts
    ),
    -- Response time: for each user message, look at the message immediately
    -- following it in the same conversation (via a window function, not a
    -- join -- a plain join would pair a user message with every later
    -- assistant message in the thread, not just the actual reply, and wildly
    -- inflate the average). Only counts as a real response pair when that
    -- next message is actually from the assistant.
    msg_pairs as (
        select
            m.role,
            m.created_at,
            lead(m.role) over (partition by m.conversation_id order by m.created_at) as next_role,
            lead(m.created_at) over (partition by m.conversation_id order by m.created_at) as next_created_at
        from messages m
        join conversations c on c.id = m.conversation_id
        where c.tenant_id = (select id from tid) and m.created_at >= (select ts from since)
    )
    select
        (select count(*) from conversations, tid, since
            where conversations.tenant_id = tid.id and conversations.created_at >= since.ts) as conversations_count,
        (select count(*) from leads, tid, since
            where leads.tenant_id = tid.id and leads.created_at >= since.ts) as new_leads_count,
        (select count(*) from appointments, tid, since
            where appointments.tenant_id = tid.id and appointments.created_at >= since.ts) as appointments_booked_count,
        (select count(*) from email_drafts, tid, since
            where email_drafts.tenant_id = tid.id and email_drafts.status = 'auto_sent'
              and email_drafts.created_at >= since.ts) as auto_resolved_count,
        (select count(*) from escalations, tid, since
            where escalations.tenant_id = tid.id and escalations.created_at >= since.ts) as escalations_count,
        (select avg(extract(epoch from (next_created_at - created_at)))
            from msg_pairs where role = 'user' and next_role = 'assistant') as avg_response_seconds,
        -- Rates are a rough health signal, not a precisely-defined metric --
        -- "escalations per conversation" and "auto-sent drafts per
        -- conversation" are different units being compared for a quick
        -- percentage, not a rigorous funnel. Good enough for an at-a-glance
        -- overview card; don't treat these as exact.
        (select case when (select count(*) from conversations, tid, since where conversations.tenant_id = tid.id and conversations.created_at >= since.ts) > 0
            then round(100.0 * (select count(*) from escalations, tid, since where escalations.tenant_id = tid.id and escalations.created_at >= since.ts)
                / (select count(*) from conversations, tid, since where conversations.tenant_id = tid.id and conversations.created_at >= since.ts), 1)
            else 0 end) as escalation_rate,
        (select case when (select count(*) from conversations, tid, since where conversations.tenant_id = tid.id and conversations.created_at >= since.ts) > 0
            then round(100.0 * (select count(*) from email_drafts, tid, since where email_drafts.tenant_id = tid.id and email_drafts.status = 'auto_sent' and email_drafts.created_at >= since.ts)
                / (select count(*) from conversations, tid, since where conversations.tenant_id = tid.id and conversations.created_at >= since.ts), 1)
            else 0 end) as auto_resolve_rate;
$$;

comment on function public.get_dashboard_overview_stats(int) is
    'Real aggregated stats for the dashboard Overview page. Tenant-scoped via current_tenant_id() (fails closed to zero rows if unresolvable, same as RLS elsewhere) -- SECURITY DEFINER because it needs to read across several tables in one call, not because it should see other tenants'' data.';
