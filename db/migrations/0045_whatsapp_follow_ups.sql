-- 0045_whatsapp_follow_ups.sql
--
-- Follow-up sequences can send a step by WhatsApp (workflow 20 → 27).
--
--   * A WhatsApp step goes only to a client who has written to the agency on
--     WhatsApp (their opt-in). Inside 24 hours of their last message it is
--     sent as plain text; after that, inside the approved "elliot_follow_up"
--     template, because WhatsApp allows nothing else. A client without
--     WhatsApp gets the step by email, and an email step for a client without
--     an email address goes by WhatsApp.
--   * whatsapp_drafts.sent_via (text | template) and send_error (why WhatsApp
--     refused it; the draft is then 'blocked_needs_template').
--   * enrol_quiet_leads(): leads reachable on WhatsApp are enrolled too, not
--     only leads with an email address.
-- Sequence steps are jsonb ({day_offset, channel: "email" | "whatsapp",
-- subject, body}); nothing to change there.
-- One transaction; safe to run again.

begin;

alter table whatsapp_drafts add column if not exists sent_via text;
alter table whatsapp_drafts drop constraint if exists whatsapp_drafts_sent_via_check;
alter table whatsapp_drafts add constraint whatsapp_drafts_sent_via_check check (sent_via is null or sent_via in ('text', 'template'));
alter table whatsapp_drafts add column if not exists send_error text;
comment on column whatsapp_drafts.sent_via is 'text: within 24 hours of the client''s last WhatsApp message; template: the approved elliot_follow_up template (0045).';
comment on column whatsapp_drafts.send_error is 'Why WhatsApp refused the message (for example the template isn''t approved yet). Shown in Approvals.';

create or replace function public.enrol_quiet_leads(p_limit int default 100)
returns table (run_id uuid, tenant_id uuid, lead_id uuid, sequence_id uuid, next_run_at timestamptz)
language plpgsql
security definer
set search_path = public
as $function$
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

commit;
