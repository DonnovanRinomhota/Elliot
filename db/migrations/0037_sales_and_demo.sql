-- 0037_sales_and_demo.sql
--
-- getelliot.eu split into three (see docs/website-sales-and-demo.md):
--   * 'sales' account: Elliot selling Elliot. The website chat answers
--     questions about the product and books 15-min intro calls / 30-min live
--     demos into the owner's calendar with a Google Meet link.
--   * 'demo' account: a made-up agency with sample listings that visitors can
--     try after leaving their details. Bookings go to a separate demo calendar,
--     confirmations are marked DEMO, and everything is deleted after 3 days.
--   * every other account: an agency, unchanged.
--
-- Also makes ai_config.business_hours official: workflow 11 has always read
-- it, but no migration created it (it was added by hand in production).
--
-- One transaction; safe to run again.

begin;

-- ── 1. Which kind of account ──
alter table tenants add column if not exists assistant_mode text not null default 'agency';
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'tenants_assistant_mode_check') then
        alter table tenants add constraint tenants_assistant_mode_check
            check (assistant_mode in ('agency', 'sales', 'demo'));
    end if;
end $$;
comment on column tenants.assistant_mode is
  'agency (default): an estate agency. sales: Elliot''s own website assistant (product questions, consultation booking). demo: the public demo agency (sample data, cleaned up after 3 days).';

-- ── 2. Opening hours read by workflow 11 ──
-- { "monday": { "open": "09:00", "close": "21:00" }, ... }; a missing day = closed.
alter table ai_config add column if not exists business_hours jsonb not null default '{}'::jsonb;

-- ── 3. The sales and demo accounts ──
create or replace function sales_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
    select id from tenants where assistant_mode = 'sales' and status = 'active' order by created_at limit 1;
$$;

create or replace function demo_tenant()
returns table (tenant_id uuid, slug text, name text)
language sql stable security definer set search_path = public as $$
    select id, slug, name from tenants where assistant_mode = 'demo' and status = 'active' order by created_at limit 1;
$$;

-- ── 4. A lead for the sales account (consultation booking, demo access, contact form) ──
-- Finds the contact by email (or creates it), fills in anything new, and
-- creates or updates their lead. Returns the contact id, or null when there is
-- no sales account yet.
create or replace function upsert_sales_lead(
    p_name     text,
    p_email    text,
    p_phone    text,
    p_company  text,
    p_details  jsonb default '{}'::jsonb,
    p_source   text default 'website'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant  uuid := sales_tenant_id();
    v_email   text := lower(nullif(btrim(p_email), ''));
    v_name    text := nullif(btrim(p_name), '');
    v_phone   text := nullif(btrim(p_phone), '');
    v_company text := nullif(btrim(p_company), '');
    v_contact uuid;
    v_details jsonb := coalesce(p_details, '{}'::jsonb)
                       || jsonb_build_object('source', coalesce(nullif(btrim(p_source), ''), 'website'))
                       || case when v_company is not null then jsonb_build_object('agency', v_company) else '{}'::jsonb end;
begin
    if v_tenant is null then
        return null;
    end if;
    if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'a valid email is required';
    end if;

    select id into v_contact from contacts
     where tenant_id = v_tenant and lower(email) = v_email
     order by created_at limit 1
     for update;

    if v_contact is null then
        insert into contacts (tenant_id, name, email, phone, company, source)
        values (v_tenant, v_name, v_email, v_phone, v_company, coalesce(nullif(btrim(p_source), ''), 'website'))
        returning id into v_contact;
    else
        update contacts
           set name = coalesce(v_name, name),
               phone = coalesce(v_phone, phone),
               company = coalesce(v_company, company),
               updated_at = now()
         where id = v_contact;
    end if;

    insert into leads (tenant_id, contact_id, status, qualification_answers)
    values (v_tenant, v_contact, 'HOT', v_details)
    on conflict (tenant_id, contact_id) do update
        set qualification_answers = leads.qualification_answers || excluded.qualification_answers,
            status = case when leads.status in ('CONVERTED', 'LOST') then leads.status else 'HOT' end,
            updated_at = now();

    return v_contact;
end;
$$;

revoke all on function upsert_sales_lead(text, text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function sales_tenant_id() from public, anon, authenticated;
revoke all on function demo_tenant() from public, anon, authenticated;

-- ── 5. Who to tell about a new website lead ──
-- The platform alert email (0036); null when not set.
create or replace function sales_notify_email()
returns text language sql stable security definer set search_path = public as $$
    select nullif(btrim(email_to), '') from platform_alert_settings where id;
$$;
revoke all on function sales_notify_email() from public, anon, authenticated;

-- ── 6. Demo clean-up (workflow 36) ──
-- Everything visitors created in the demo account more than p_older_than ago:
-- their contacts (with appointments, leads, conversations and messages) and
-- escalations. Listings and settings stay. Returns the Google Calendar events
-- to delete first, so the demo calendar doesn't fill up.
create or replace function demo_cleanup_events(p_older_than interval default interval '3 days')
returns table (appointment_id uuid, calendar_id text, event_id text)
language sql stable security definer set search_path = public as $$
    select a.id, ac.google_calendar_id, a.external_calendar_id
    from appointments a
    join tenants t on t.id = a.tenant_id and t.assistant_mode = 'demo'
    join ai_config ac on ac.tenant_id = a.tenant_id
    where a.created_at < now() - p_older_than
      and nullif(a.external_calendar_id, '') is not null;
$$;

create or replace function demo_cleanup(p_older_than interval default interval '3 days')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid;
    v_contacts int;
    v_conversations int;
begin
    select tenant_id into v_tenant from demo_tenant();
    if v_tenant is null then
        return jsonb_build_object('demo_account', false);
    end if;

    -- conversations first (messages, escalations, tool calls hang off them)
    with gone as (
        delete from conversations
         where tenant_id = v_tenant and updated_at < now() - p_older_than
        returning 1
    ) select count(*) into v_conversations from gone;

    with gone as (
        delete from contacts c
         where c.tenant_id = v_tenant and c.created_at < now() - p_older_than
           and not exists (select 1 from conversations cv where cv.contact_id = c.id)
        returning 1
    ) select count(*) into v_contacts from gone;

    return jsonb_build_object('demo_account', true, 'conversations_deleted', v_conversations, 'contacts_deleted', v_contacts);
end;
$$;

revoke all on function demo_cleanup_events(interval) from public, anon, authenticated;
revoke all on function demo_cleanup(interval) from public, anon, authenticated;

-- ── 7. Health status follows workflow 33's own schedule (0036) ──
-- "stale" used to mean "no check for 45 minutes", which is wrong when 33 runs
-- every few hours to save n8n executions. Each check now remembers the one
-- before, and a check is stale when it's more than 2.5 gaps (min 45 min) old.
alter table health_check_state add column if not exists prev_checked_at timestamptz;

create or replace function trg_health_check_prev()
returns trigger language plpgsql as $$
begin
    if new.checked_at is distinct from old.checked_at
       and new.prev_checked_at is not distinct from old.prev_checked_at then  -- unless set explicitly
        new.prev_checked_at := old.checked_at;
    end if;
    return new;
end;
$$;
drop trigger if exists trg_health_check_prev on health_check_state;
create trigger trg_health_check_prev before update on health_check_state
    for each row execute function trg_health_check_prev();

create or replace function health_status()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
    with s as (
        select max(checked_at) as last_at,
               max(checked_at - prev_checked_at) filter (where prev_checked_at is not null) as gap
        from health_check_state
    )
    select jsonb_build_object(
        'status', case
            when not exists (select 1 from health_check_state) then 'unknown'
            when exists (select 1 from health_check_state where not ok) then 'degraded'
            when s.last_at < now() - greatest(interval '45 minutes', coalesce(s.gap, interval '0') * 2.5) then 'stale'
            else 'all_ok' end,
        'checked_at', s.last_at,
        'expected_every_minutes', round(extract(epoch from s.gap) / 60),
        'checks', coalesce((select jsonb_agg(jsonb_build_object('key', check_key, 'label', label, 'ok', ok,
                                 'detail', detail, 'failing_since', failing_since, 'checked_at', checked_at)
                             order by check_key) from health_check_state), '[]'::jsonb)
    )
    from s;
$$;
revoke all on function health_status() from public, anon, authenticated;

commit;
