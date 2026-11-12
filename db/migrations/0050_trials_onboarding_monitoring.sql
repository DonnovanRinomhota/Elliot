-- 0050: Trials that pause, a go-live checklist, and failures per agency.
--
--   1. Trials. "Start 7-day trial" in the control panel sets trial_started_at
--      and trial_ends_at. When it ends, Elliot pauses for that agency: each
--      client gets one short holding reply a day (workflow 01, paused_reply())
--      and their messages stay in the dashboard; follow-ups, auto-enrol and
--      viewing reminders stop. Nothing is deleted. Trials only pause if they
--      were started this way: agencies created before 0050 are not affected,
--      whatever their old trial_ends_at says.
--   2. onboarding_checklist(tenant): what is set up and what isn't, read from
--      the agency's own data. Shown on the agency's page in the control panel.
--   3. platform_tenant_overview() also returns each agency's failures in the
--      last 7 days, calendar problems, trial state and WhatsApp connection.
--
-- Undo: drop function paused_reply, start_trial, onboarding_checklist,
-- tenant_service_state; re-run the definitions of claim_due_follow_up_runs
-- (0048), due_viewing_reminders (0043), enrol_quiet_leads (0045) and
-- platform_tenant_overview (0027) without the 0050 lines; alter table tenants
-- drop column trial_started_at, alter column trial_ends_at set default
-- now() + interval '14 days'.

begin;
select begin_migration('0050', 'trials_onboarding_monitoring', '0049');

-- ─────────────────────────────────────────────────────────────
-- 1. Trials
-- ─────────────────────────────────────────────────────────────
alter table tenants add column if not exists trial_started_at timestamptz;
comment on column tenants.trial_started_at is
    'When the trial was started from the control panel (0050). Only such trials pause Elliot when trial_ends_at passes.';
-- A new agency has no trial running until you start one at go-live.
alter table tenants alter column trial_ends_at drop default;

-- serving | trial_ended | suspended | cancelled | unknown
create or replace function tenant_service_state(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select case
        when t.id is null then 'unknown'
        when t.status <> 'active' then t.status
        when t.plan = 'trial' and t.trial_started_at is not null
             and t.trial_ends_at is not null and t.trial_ends_at <= now() then 'trial_ended'
        else 'serving' end
    from (select 1) one
    left join tenants t on t.id = p_tenant_id;
$$;
revoke all on function tenant_service_state(uuid) from public, anon, authenticated;

-- Called by the control panel (server, service role) at go-live.
create or replace function start_trial(p_tenant_id uuid, p_days integer default 7, p_actor text default null)
returns tenants
language plpgsql
security definer
set search_path = public
as $$
declare
    v_days int := greatest(1, least(coalesce(p_days, 7), 60));
    r tenants;
begin
    update tenants
       set plan = 'trial', status = 'active',
           trial_started_at = now(), trial_ends_at = now() + make_interval(days => v_days),
           updated_at = now()
     where id = p_tenant_id
    returning * into r;
    if not found then raise exception 'Agency not found'; end if;
    insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
    values (p_tenant_id, 'system', coalesce(p_actor, 'platform'), 'platform.trial_started',
            jsonb_build_object('days', v_days, 'ends_at', r.trial_ends_at));
    return r;
end;
$$;
revoke all on function start_trial(uuid, integer, text) from public, anon, authenticated;

-- Workflow 01 calls this instead of Claude while an agency's trial has ended.
-- Saves the client's message (and who they are, if they said) so the team
-- sees it in the dashboard, and answers with p_reply at most once a day per
-- conversation, and not at all if a team member has taken the conversation
-- over. Returns { conversation_id, reply } (reply null: send nothing).
create or replace function paused_reply(
    p_tenant_id uuid,
    p_conversation_id uuid,
    p_message text,
    p_reply text,
    p_name text default null,
    p_email text default null,
    p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_conv uuid;
    v_logged jsonb;
    v_recent boolean;
begin
    v_conv := get_or_create_conversation(p_tenant_id, p_conversation_id);
    if nullif(btrim(coalesce(p_name, '')), '') is not null
       and (nullif(btrim(coalesce(p_email, '')), '') is not null or nullif(btrim(coalesce(p_phone, '')), '') is not null) then
        perform upsert_conversation_contact(p_tenant_id, v_conv, p_name, coalesce(p_email, ''), coalesce(p_phone, ''), '', 'chat_widget');
    end if;
    v_logged := log_user_message(p_tenant_id, v_conv, left(coalesce(p_message, ''), 20000));
    if coalesce((v_logged ->> 'human_takeover')::boolean, false) then
        return jsonb_build_object('conversation_id', v_conv, 'reply', null, 'human', true);
    end if;

    v_recent := exists (
        select 1 from audit_log a
        where a.tenant_id = p_tenant_id and a.event_type = 'trial_ended_reply'
          and a.details ->> 'conversation_id' = v_conv::text
          and a.created_at > now() - interval '24 hours');
    if v_recent or nullif(btrim(coalesce(p_reply, '')), '') is null then
        return jsonb_build_object('conversation_id', v_conv, 'reply', null, 'human', true);
    end if;

    perform log_message(p_tenant_id, v_conv, 'assistant', p_reply);
    insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
    values (p_tenant_id, 'system', 'workflow_01', 'trial_ended_reply', jsonb_build_object('conversation_id', v_conv));
    return jsonb_build_object('conversation_id', v_conv, 'reply', p_reply, 'human', false);
end;
$$;
revoke all on function paused_reply(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

-- Nothing goes out on Elliot's own initiative while an agency is paused.
-- claim_due_follow_up_runs (0048) + 0050 gate
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
          -- 0050: nothing goes out for an agency whose trial has ended (or that is
          -- suspended). The run waits, untouched, and carries on if they continue.
          and tenant_service_state(fr.tenant_id) = 'serving'
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

-- due_viewing_reminders + 0050 gate
CREATE OR REPLACE FUNCTION public.due_viewing_reminders(p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(appointment_id uuid, tenant_id uuid, tenant_name text, assistant_mode text, timezone text, starts_at timestamp with time zone, ends_at timestamp with time zone, notes text, contact_name text, contact_email text, contact_phone text, conversation_id uuid, conversation_channel text, whatsapp_phone_number_id text, listing_title text, listing_address text, agent_name text, last_client_message text, kind text, location text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select a.id, t.id, t.name, t.assistant_mode, coalesce(a.timezone, t.timezone, 'Europe/Warsaw'),
           a.starts_at, a.ends_at, a.notes,
           c.name, c.email, c.phone,
           cv.id, cv.channel, nullif(btrim(ac.whatsapp_phone_number_id), ''),
           l.title, nullif(concat_ws(', ', l.address, l.district, l.city), ''),
           coalesce(ag.full_name, ag.email),
           (select m.content from messages m where m.conversation_id = cv.id and m.role = 'user'
             order by m.created_at desc limit 1),
           a.kind, a.location
    from appointments a
    join tenants t on t.id = a.tenant_id and t.status = 'active' and t.assistant_mode in ('agency', 'sales')
    join ai_config ac on ac.tenant_id = a.tenant_id and ac.reminders_enabled
    join contacts c on c.id = a.contact_id
    left join lateral (
        select x.id, x.channel from conversations x
         where x.id = a.conversation_id
            or (a.conversation_id is null and x.contact_id = a.contact_id and x.tenant_id = a.tenant_id)
         order by (x.id = a.conversation_id) desc, x.updated_at desc limit 1
    ) cv on true
    left join listings l on l.id = a.listing_id
    left join tenant_users ag on ag.id = a.agent_id
    where a.status = 'confirmed'
      and tenant_service_state(t.id) = 'serving' -- 0050
      and a.reminder_sent_at is null
      and a.starts_at > p_now
      and (a.starts_at at time zone coalesce(a.timezone, t.timezone, 'Europe/Warsaw'))::date
          = ((p_now at time zone coalesce(a.timezone, t.timezone, 'Europe/Warsaw'))::date + 1);
$function$;

-- enrol_quiet_leads + 0050 gate
CREATE OR REPLACE FUNCTION public.enrol_quiet_leads(p_limit integer DEFAULT 100)
 RETURNS TABLE(run_id uuid, tenant_id uuid, lead_id uuid, sequence_id uuid, next_run_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
    return query
    with candidates as (
        select
            l.id as c_lead_id,
            l.tenant_id as c_tenant_id,
            s.id as c_sequence_id,
            coalesce((s.steps -> 0 ->> 'day_offset')::int, 0) as c_first_offset
        from follow_up_sequences s
        join leads l on l.tenant_id = s.tenant_id
        join contacts c on c.id = l.contact_id
        where s.auto_enrol
          and tenant_service_state(s.tenant_id) = 'serving' -- 0050
          and s.is_active
          and jsonb_typeof(s.steps) = 'array'
          and jsonb_array_length(s.steps) > 0
          and s.auto_enrol_since is not null
          and l.created_at >= s.auto_enrol_since
          and l.status not in ('CONVERTED', 'LOST')
          -- 0045: reachable by email, or on WhatsApp (they wrote to the agency there).
          and (nullif(trim(c.email), '') is not null
               or exists (select 1 from conversations wc
                          join messages wm on wm.conversation_id = wc.id and wm.role = 'user'
                          where wc.contact_id = l.contact_id and wc.channel = 'whatsapp'))
          and not exists (
              select 1 from follow_up_runs r
              where r.lead_id = l.id and r.sequence_id = s.id
          )
          and not exists (
              select 1 from appointments a
              where a.contact_id = l.contact_id
                and a.status = 'confirmed'
                and a.ends_at > now()
          )
          and greatest(
                l.created_at,
                coalesce((
                    select max(m.created_at)
                    from messages m
                    join conversations conv on conv.id = m.conversation_id
                    where conv.contact_id = l.contact_id
                      and m.role = 'user'
                ), l.created_at)
              ) <= now() - make_interval(hours => s.auto_enrol_after_hours)
        order by l.created_at
        limit greatest(p_limit, 0)
    )
    insert into follow_up_runs (tenant_id, lead_id, sequence_id, current_step_index, status, next_run_at)
    select c_tenant_id, c_lead_id, c_sequence_id, 0, 'running', now() + make_interval(days => c_first_offset)
    from candidates
    returning follow_up_runs.id, follow_up_runs.tenant_id, follow_up_runs.lead_id,
              follow_up_runs.sequence_id, follow_up_runs.next_run_at;
end;
$function$;

-- platform_tenant_overview + 0050 columns (return type changes, so drop first)
drop function if exists platform_tenant_overview(integer);
CREATE OR REPLACE FUNCTION public.platform_tenant_overview(p_days integer DEFAULT 30)
 RETURNS TABLE(tenant_id uuid, name text, slug text, industry text, plan text, status text, created_at timestamp with time zone, trial_ends_at timestamp with time zone, paid_until timestamp with time zone, monthly_price numeric, contact_email text, users_count bigint, listings_count bigint, conversations_count bigint, leads_count bigint, hot_leads_count bigint, appointments_count bigint, open_escalations bigint, pending_approvals bigint, failed_crm_syncs bigint, tool_errors bigint, input_tokens bigint, output_tokens bigint, ai_replies bigint, last_activity_at timestamp with time zone, trial_started_at timestamp with time zone, service_state text, failures_7d bigint, failure_kinds text, calendar_problems bigint, whatsapp_connected boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with since as (select now() - (p_days || ' days')::interval as ts)
    select
        t.id, t.name, t.slug, t.industry, t.plan, t.status, t.created_at,
        t.trial_ends_at, t.paid_until, t.monthly_price, t.contact_email,
        (select count(*) from tenant_users u where u.tenant_id = t.id and u.removed_at is null),
        (select count(*) from listings l where l.tenant_id = t.id and l.status = 'available'),
        (select count(*) from conversations c where c.tenant_id = t.id and c.created_at >= (select ts from since)),
        (select count(*) from leads l where l.tenant_id = t.id and l.created_at >= (select ts from since)),
        (select count(*) from leads l where l.tenant_id = t.id and l.status = 'HOT'),
        (select count(*) from appointments a where a.tenant_id = t.id and a.created_at >= (select ts from since)),
        (select count(*) from escalations e where e.tenant_id = t.id and e.status <> 'resolved'),
        (select count(*) from email_drafts d where d.tenant_id = t.id and d.status = 'pending')
          + (select count(*) from whatsapp_drafts d where d.tenant_id = t.id and d.status = 'pending'),
        (select count(*) from crm_sync_log s where s.tenant_id = t.id and s.status = 'failed'),
        (select count(*) from tool_call_log g where g.tenant_id = t.id and g.error is not null
            and g.requested_at >= (select ts from since)),
        (select coalesce(sum(u.input_tokens), 0)::bigint from ai_usage_daily u
            where u.tenant_id = t.id and u.day >= (select ts from since)::date),
        (select coalesce(sum(u.output_tokens), 0)::bigint from ai_usage_daily u
            where u.tenant_id = t.id and u.day >= (select ts from since)::date),
        (select coalesce(sum(u.replies), 0)::bigint from ai_usage_daily u
            where u.tenant_id = t.id and u.day >= (select ts from since)::date),
        (select max(m.created_at) from messages m where m.tenant_id = t.id),
        -- 0050
        t.trial_started_at,
        tenant_service_state(t.id),
        (select count(*) from audit_log a where a.tenant_id = t.id and a.created_at >= now() - interval '7 days'
            and (a.event_type like '%\_failed' escape '\' or a.event_type = 'workflow_error')),
        (select string_agg(x.event_type || ' x' || x.n, ', ' order by x.n desc) from (
            select a.event_type, count(*) as n from audit_log a where a.tenant_id = t.id and a.created_at >= now() - interval '7 days'
               and (a.event_type like '%\_failed' escape '\' or a.event_type = 'workflow_error')
             group by a.event_type) x),
        (select count(*) from tenant_users u where u.tenant_id = t.id and u.removed_at is null and u.receives_leads
            and u.calendar_status in ('not_shared', 'read_only', 'error'))
          + (select count(*) from ai_config c where c.tenant_id = t.id and c.calendar_status = 'error'),
        exists (select 1 from ai_config c where c.tenant_id = t.id and nullif(btrim(c.whatsapp_phone_number_id), '') is not null)
    from tenants t
    order by t.created_at desc;
$function$;
revoke all on function claim_due_follow_up_runs(integer) from public, anon, authenticated;
revoke all on function due_viewing_reminders(timestamptz) from public, anon, authenticated;
revoke all on function enrol_quiet_leads(integer) from public, anon, authenticated;
revoke all on function platform_tenant_overview(integer) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Go-live checklist
-- ─────────────────────────────────────────────────────────────
-- Read from the agency's own data, so it can't drift from reality. required:
-- needed before Elliot talks to clients; the others depend on the agency.
create or replace function onboarding_checklist(p_tenant_id uuid)
returns table (step int, item text, required boolean, done boolean, detail text, where_to text)
language sql
stable
security definer
set search_path = public
as $$
    with t as (select * from tenants where id = p_tenant_id),
         ac as (select * from ai_config where tenant_id = p_tenant_id),
         team as (select * from tenant_users where tenant_id = p_tenant_id and removed_at is null)
    select * from (values
      (1, 'An admin can sign in', true,
          exists (select 1 from team where role = 'admin'),
          (select coalesce(string_agg(email, ', '), 'No admin yet') from team where role = 'admin'),
          'Control panel → New agency, or the agency''s Team page'),
      (2, 'Agents added', true,
          (select count(*) from team where role = 'agent') > 0 or (select count(*) from team) > 1,
          (select count(*)::text || ' team member(s)' from team),
          'Team page → Invite'),
      (3, 'Calendars Elliot can book into', true,
          exists (select 1 from team where receives_leads and calendar_status = 'ok')
          or exists (select 1 from ac where nullif(google_calendar_id, '') is not null and coalesce(calendar_status, 'ok') = 'ok'),
          coalesce((select string_agg(coalesce(full_name, email) || ': ' || coalesce(calendar_status, 'not checked'), ', ') from team where receives_leads), 'No agents'),
          'Team page → each agent''s calendar → Check access (workflow 41)'),
      (4, 'Listings loaded', true,
          exists (select 1 from listings where tenant_id = p_tenant_id and status = 'available'),
          (select count(*)::text || ' available' from listings where tenant_id = p_tenant_id and status = 'available')
            || case when exists (select 1 from asari_connections where tenant_id = p_tenant_id and enabled) then ', ASARI on' else '' end,
          'Listings page → Import, or Settings → ASARI'),
      (5, 'Fees, areas and FAQs in the knowledge base', true,
          exists (select 1 from documents where tenant_id = p_tenant_id),
          (select count(*)::text || ' document(s)' from documents where tenant_id = p_tenant_id),
          'Knowledge base page'),
      (6, 'Approval rules chosen', true,
          exists (select 1 from ac where autonomy_rules ? 'book_appointment'),
          (select case when autonomy_rules ? 'book_appointment' then 'Bookings: ' || (autonomy_rules -> 'book_appointment' ->> 'mode') else 'Not saved yet (Elliot books by itself)' end from ac),
          'Settings → What Elliot may do on its own'),
      (7, 'Someone gets hand-overs', true,
          exists (select 1 from team where notify_escalations) or exists (select 1 from ac where nullif(escalation_notify_email, '') is not null),
          coalesce((select string_agg(email, ', ') from team where notify_escalations), (select escalation_notify_email from ac), 'Nobody'),
          'Team page → Gets escalations'),
      (8, 'Email reaches Elliot', true,
          exists (select 1 from ac where email_inbound_last_at is not null or nullif(connected_gmail_address, '') is not null),
          (select case when nullif(connected_gmail_address, '') is not null then 'Gmail: ' || connected_gmail_address
                       when email_inbound_last_at is not null then 'Last forwarded email ' || to_char(email_inbound_last_at at time zone 'Europe/Warsaw', 'DD Mon HH24:MI')
                       else 'No email received yet' end from ac),
          'Settings → Email (forwarding address), then send a test email'),
      (9, 'Website chat on the agency''s site', false,
          exists (select 1 from conversations c join messages m on m.conversation_id = c.id and m.role = 'user'
                  where c.tenant_id = p_tenant_id and c.channel = 'chat_widget'),
          'Seen when the first website chat arrives',
          'One line on their website (docs/onboarding.md, step 6)'),
      (10, 'WhatsApp number', false,
          exists (select 1 from ac where nullif(btrim(whatsapp_phone_number_id), '') is not null),
          (select coalesce(nullif(btrim(whatsapp_phone_number_id), ''), 'Not connected') from ac),
          'docs/whatsapp-setup.md (needs Meta verification)'),
      (11, 'CRM connection', false,
          exists (select 1 from ac where nullif(crm_webhook_url, '') is not null),
          (select case when nullif(crm_webhook_url, '') is not null then 'Webhook set' else 'Not connected' end from ac),
          'Settings → Connected services'),
      (12, 'A test conversation answered', true,
          exists (select 1 from messages where tenant_id = p_tenant_id and role = 'assistant'),
          (select count(*)::text || ' answer(s) so far' from messages where tenant_id = p_tenant_id and role = 'assistant'),
          'Ask Elliot a few questions a client would ask (Dashboard → Ask Elliot, or the website chat)'),
      (13, 'Trial started', false,
          exists (select 1 from t where trial_started_at is not null or plan not in ('trial')),
          (select case when plan <> 'trial' then 'Plan: ' || plan
                       when trial_started_at is null then 'Not started'
                       else 'Ends ' || to_char(trial_ends_at at time zone 'Europe/Warsaw', 'DD Mon YYYY') end from t),
          'Control panel → this agency → Start 7-day trial')
    ) as v(step, item, required, done, detail, where_to)
    where exists (select 1 from t)
    order by step;
$$;
revoke all on function onboarding_checklist(uuid) from public, anon, authenticated;

commit;
