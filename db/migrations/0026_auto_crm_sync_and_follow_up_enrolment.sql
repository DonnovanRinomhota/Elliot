-- 0026_auto_crm_sync_and_follow_up_enrolment.sql
--
-- Two things that were built but never started on their own:
--
--   1. CRM sync (workflows 22/23) only ran when someone called workflow 22's
--      webhook by hand. Triggers below now queue a crm_sync_log row whenever a
--      contact, lead, or appointment is created or meaningfully changes --
--      from any source: the AI agent (10/12), the dashboard, or SQL.
--
--   2. Follow-up sequences (workflow 20) only ran for leads someone enrolled
--      by hand through workflow 21. A sequence can now be marked "auto-enrol":
--      leads that go quiet for N hours (no inbound message, no upcoming
--      viewing) are enrolled automatically by enrol_quiet_leads(), which
--      workflow 29 calls on a schedule.
--
-- Everything here is additive and idempotent (safe to re-run).

-- ─────────────────────────────────────────────────────────────
-- 1. Automatic CRM sync queueing
-- ─────────────────────────────────────────────────────────────

-- SECURITY DEFINER: the agent's booking insert runs on the RLS-scoped
-- connection and the dashboard runs as the logged-in user. Both must be able
-- to queue a sync for their own tenant's row without being granted direct
-- access to crm_sync_log. The function only ever writes a row for the tenant
-- of the row that fired the trigger.
create or replace function public.queue_crm_sync(p_tenant_id uuid, p_entity_type text, p_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
    -- Tenants without a CRM endpoint get nothing queued. (Workflow 23 would
    -- otherwise mark every one of these 'failed', burying real failures.)
    if not exists (
        select 1 from ai_config
        where tenant_id = p_tenant_id
          and nullif(trim(crm_webhook_url), '') is not null
    ) then
        return;
    end if;

    -- The sweep reads the entity's CURRENT state when it sends, so one
    -- pending row per entity is enough. Collapses bursts (e.g. lead capture
    -- re-scoring a lead several times in one chat) into a single send.
    if exists (
        select 1 from crm_sync_log
        where tenant_id = p_tenant_id
          and entity_type = p_entity_type
          and entity_id = p_entity_id
          and status = 'pending'
    ) then
        return;
    end if;

    insert into crm_sync_log (tenant_id, entity_type, entity_id, crm_provider, status)
    values (p_tenant_id, p_entity_type, p_entity_id, 'generic_webhook', 'pending');
end;
$function$;

comment on function public.queue_crm_sync(uuid, text, uuid) is
    'Queues a pending crm_sync_log row for workflow 23 to send. No-op when the tenant has no ai_config.crm_webhook_url, or when a pending row already exists for the same entity.';

create or replace function public.trg_queue_crm_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
    -- tg_argv[0] is the crm_sync_log.entity_type for the table this is attached to.
    perform public.queue_crm_sync(new.tenant_id, tg_argv[0], new.id);
    return new;
end;
$function$;

-- Contacts: on create, and when contact details actually change. (Lead
-- capture's upsert rewrites name/phone/company on every call even when the
-- values are identical -- the WHEN clause keeps that from queueing a sync.)
drop trigger if exists trg_contacts_crm_sync_insert on contacts;
create trigger trg_contacts_crm_sync_insert
    after insert on contacts
    for each row execute function public.trg_queue_crm_sync('contact');

drop trigger if exists trg_contacts_crm_sync_update on contacts;
create trigger trg_contacts_crm_sync_update
    after update on contacts
    for each row
    when (old.name is distinct from new.name
       or old.email is distinct from new.email
       or old.phone is distinct from new.phone
       or old.company is distinct from new.company)
    execute function public.trg_queue_crm_sync('contact');

-- Leads: on create, and when stage / score / answers change -- this is what
-- carries dashboard stage changes (e.g. "Mark CONVERTED") into the CRM.
drop trigger if exists trg_leads_crm_sync_insert on leads;
create trigger trg_leads_crm_sync_insert
    after insert on leads
    for each row execute function public.trg_queue_crm_sync('lead');

drop trigger if exists trg_leads_crm_sync_update on leads;
create trigger trg_leads_crm_sync_update
    after update on leads
    for each row
    when (old.status is distinct from new.status
       or old.score is distinct from new.score
       or old.qualification_answers is distinct from new.qualification_answers)
    execute function public.trg_queue_crm_sync('lead');

-- Appointments: on booking, and on cancel / complete / no-show / time change.
drop trigger if exists trg_appointments_crm_sync_insert on appointments;
create trigger trg_appointments_crm_sync_insert
    after insert on appointments
    for each row execute function public.trg_queue_crm_sync('appointment');

drop trigger if exists trg_appointments_crm_sync_update on appointments;
create trigger trg_appointments_crm_sync_update
    after update on appointments
    for each row
    when (old.status is distinct from new.status
       or old.starts_at is distinct from new.starts_at
       or old.ends_at is distinct from new.ends_at)
    execute function public.trg_queue_crm_sync('appointment');

-- ─────────────────────────────────────────────────────────────
-- 2. Automatic follow-up enrolment
-- ─────────────────────────────────────────────────────────────

alter table follow_up_sequences
    add column if not exists auto_enrol boolean not null default false,
    add column if not exists auto_enrol_after_hours int not null default 24,
    add column if not exists auto_enrol_since timestamptz;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'chk_follow_up_sequences_auto_enrol_after_hours'
    ) then
        alter table follow_up_sequences
            add constraint chk_follow_up_sequences_auto_enrol_after_hours
            check (auto_enrol_after_hours between 1 and 720);
    end if;
end $$;

-- One auto-enrol sequence per tenant, so "which sequence does a quiet lead
-- get?" never has two answers.
create unique index if not exists uq_follow_up_sequences_one_auto_per_tenant
    on follow_up_sequences (tenant_id) where auto_enrol;

comment on column follow_up_sequences.auto_enrol is
    'When true (and is_active), enrol_quiet_leads() enrols leads that have gone quiet into this sequence. At most one per tenant.';
comment on column follow_up_sequences.auto_enrol_after_hours is
    'How long a lead must go without an inbound message before it is auto-enrolled.';
comment on column follow_up_sequences.auto_enrol_since is
    'Set automatically when auto_enrol is switched on. Only leads created after this are auto-enrolled, so switching it on never mass-emails the existing lead backlog.';

create or replace function public.trg_follow_up_auto_enrol_since()
returns trigger
language plpgsql
as $function$
begin
    if new.auto_enrol and (tg_op = 'INSERT' or not old.auto_enrol) then
        new.auto_enrol_since := now();
    elsif not new.auto_enrol then
        new.auto_enrol_since := null;
    end if;
    return new;
end;
$function$;

drop trigger if exists trg_follow_up_sequences_auto_enrol_since on follow_up_sequences;
create trigger trg_follow_up_sequences_auto_enrol_since
    before insert or update of auto_enrol on follow_up_sequences
    for each row execute function public.trg_follow_up_auto_enrol_since();

-- Called by workflow 29 (service-role connection) on a schedule. Returns the
-- runs it created. A lead is enrolled when ALL of these hold:
--   - its tenant has an active auto-enrol sequence with at least one step
--   - the lead was created after auto-enrol was switched on
--   - the lead isn't CONVERTED or LOST
--   - the contact has an email address (the sweep sends email)
--   - the lead has never been in this sequence before (no re-enrolment loops)
--   - the contact has no upcoming confirmed appointment (they already booked)
--   - nothing inbound from the contact for auto_enrol_after_hours
--
-- The run's created_at is "now", which is what workflow 20's "contact
-- replied" check is anchored to -- so the chat that produced the lead
-- doesn't immediately stop the run, but any reply after enrolment does.
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
          and nullif(trim(c.email), '') is not null
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

comment on function public.enrol_quiet_leads(int) is
    'Auto-enrols quiet leads into their tenant''s auto-enrol follow-up sequence. Called by workflow 29. See docs/workflow-specs/29-auto-enrol-follow-ups.md.';

-- Only the service role (n8n) should run the enrolment sweep. Revoke both
-- PUBLIC and Supabase's API roles explicitly -- Supabase grants EXECUTE on new
-- public functions to anon/authenticated by default.
revoke all on function public.enrol_quiet_leads(int) from public;
revoke all on function public.queue_crm_sync(uuid, text, uuid) from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        execute 'revoke all on function public.enrol_quiet_leads(int) from anon, authenticated';
        execute 'revoke all on function public.queue_crm_sync(uuid, text, uuid) from anon, authenticated';
    end if;
end $$;
