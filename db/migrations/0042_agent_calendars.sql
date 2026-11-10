-- 0042_agent_calendars.sql
--
-- Each agent can have their own Google Calendar, shared with Elliot's Google
-- account. Elliot then offers a time when at least one agent is free, books
-- the viewing into that agent's calendar (the lead's owner first), and two
-- agents can have viewings at the same time.
--
--   * tenant_users.google_calendar_id (+ status from workflow 41's check).
--   * appointments.booked_calendar_id: the calendar the viewing was put in.
--     The no-double-booking rule is now per calendar, not per agency.
--   * Without any agent calendar, nothing changes: the agency calendar
--     (Settings) is used as before.
--   * booking_candidates() / availability_calendars(): what 11 and 12 ask.
--   * client_appointment() and demo_cleanup_events() use the calendar the
--     viewing is actually in.
-- One transaction; safe to run again.

begin;

-- ── 1. Agent calendars ──
alter table tenant_users add column if not exists google_calendar_id  text;
alter table tenant_users add column if not exists calendar_status     text;
alter table tenant_users add column if not exists calendar_role       text;
alter table tenant_users add column if not exists calendar_error      text;
alter table tenant_users add column if not exists calendar_checked_at timestamptz;
comment on column tenant_users.google_calendar_id is 'The agent''s Google Calendar (usually their email), shared with Elliot''s Google account with "Make changes to events". Empty = none.';
comment on column tenant_users.calendar_status is 'Workflow 41''s last check: ok, read_only, not_shared or error.';

alter table ai_config add column if not exists calendar_status     text;
alter table ai_config add column if not exists calendar_error      text;
alter table ai_config add column if not exists calendar_checked_at timestamptz;

alter table platform_settings add column if not exists calendar_account_email text;
comment on column platform_settings.calendar_account_email is 'The Google account Elliot books with (n8n''s "Elliot Google Calendar" credential): what agents share their calendars with. Filled in by workflow 41.';

-- Anyone signed in may see the address to share with.
create or replace function elliot_calendar_account()
returns text language sql stable security definer set search_path = public as $$
    select calendar_account_email from platform_settings where id;
$$;
revoke all on function elliot_calendar_account() from public, anon;
grant execute on function elliot_calendar_account() to authenticated;

-- ── 2. Which calendar each viewing is in; no double booking per calendar ──
alter table appointments add column if not exists booked_calendar_id text;
comment on column appointments.booked_calendar_id is 'The Google Calendar the event was created in (an agent''s, or the agency''s).';
update appointments a set booked_calendar_id = ac.google_calendar_id
  from ai_config ac
 where ac.tenant_id = a.tenant_id and a.booked_calendar_id is null and nullif(a.external_calendar_id, '') is not null;

alter table appointments drop constraint if exists excl_no_overlapping_appointments;
alter table appointments add constraint excl_no_overlapping_appointments
    exclude using gist (
        tenant_id with =,
        (coalesce(booked_calendar_id, '')) with =,
        tstzrange(starts_at, ends_at) with &&
    )
    where (status = 'confirmed');
comment on constraint excl_no_overlapping_appointments on appointments is
    '0042: two confirmed appointments in the same calendar can''t overlap. Different agents'' calendars can; with no agent calendars everything is in the agency calendar, so nothing overlaps (as before).';

-- ── 3. Calendars Elliot looks at ──
-- Agents who get leads and have a calendar Elliot can use (not found to be
-- unshared or read-only). None: the agency calendar.
create or replace function availability_calendars(p_tenant_id uuid)
returns table (calendar_id text, agent_id uuid, mode text)
language sql stable security definer set search_path = public as $$
    with agents as (
        select btrim(u.google_calendar_id) as calendar_id, u.id as agent_id
        from tenant_users u
        where u.tenant_id = p_tenant_id and u.removed_at is null and u.receives_leads and u.role <> 'viewer'
          and nullif(btrim(u.google_calendar_id), '') is not null
          and coalesce(u.calendar_status, '') not in ('not_shared', 'read_only')
    )
    select calendar_id, agent_id, 'agents' from agents
    union all
    select coalesce(nullif(btrim(ac.google_calendar_id), ''), 'primary'), null::uuid, 'agency'
    from ai_config ac
    where ac.tenant_id = p_tenant_id and not exists (select 1 from agents);
$$;
revoke all on function availability_calendars(uuid) from public, anon, authenticated;

-- Who could take a viewing at this time: each calendar with its agent,
-- whether it's the client's own agent (lead owner), whether the dashboard
-- already has a viewing there, and how many upcoming viewings they have.
create or replace function booking_candidates(p_tenant_id uuid, p_contact_id uuid, p_starts timestamptz, p_ends timestamptz)
returns table (calendar_id text, agent_id uuid, agent_email text, agent_name text, mode text,
               is_owner boolean, db_busy boolean, upcoming int)
language sql stable security definer set search_path = public as $$
    with owner as (
        select ld.assigned_to as id from leads ld
        where ld.tenant_id = p_tenant_id and ld.contact_id = p_contact_id
        order by ld.updated_at desc limit 1
    )
    select c.calendar_id,
           coalesce(c.agent_id, (select id from owner)),
           u.email, coalesce(u.full_name, u.email), c.mode,
           c.agent_id is not null and c.agent_id = (select id from owner),
           exists (select 1 from appointments a
                   where a.tenant_id = p_tenant_id and a.status = 'confirmed'
                     and coalesce(a.booked_calendar_id, '') = c.calendar_id
                     and tstzrange(a.starts_at, a.ends_at) && tstzrange(p_starts, p_ends)),
           (select count(*)::int from appointments a
             where a.tenant_id = p_tenant_id and a.status = 'confirmed' and a.starts_at > now()
               and coalesce(a.booked_calendar_id, '') = c.calendar_id)
    from availability_calendars(p_tenant_id) c
    left join tenant_users u on u.id = coalesce(c.agent_id, (select id from owner)) and u.removed_at is null;
$$;
revoke all on function booking_candidates(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ── 4. Workflow 41's check ──
create or replace function calendars_to_check(p_tenant_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
    select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select 'agent' as kind, u.id as member_id, btrim(u.google_calendar_id) as calendar_id
        from tenant_users u
        where u.tenant_id = p_tenant_id and u.removed_at is null and nullif(btrim(u.google_calendar_id), '') is not null
        union all
        select 'agency', null, btrim(ac.google_calendar_id)
        from ai_config ac
        where ac.tenant_id = p_tenant_id and nullif(btrim(ac.google_calendar_id), '') is not null and btrim(ac.google_calendar_id) <> 'primary'
    ) x;
$$;
revoke all on function calendars_to_check(uuid) from public, anon, authenticated;

-- p_results: [{kind, member_id, calendar_id, status, role, error}]
create or replace function record_calendar_checks(p_tenant_id uuid, p_results jsonb, p_account_email text)
returns void language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
    if nullif(btrim(coalesce(p_account_email, '')), '') is not null then
        update platform_settings set calendar_account_email = lower(btrim(p_account_email)) where id;
    end if;
    for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
        if r->>'kind' = 'agent' then
            update tenant_users set calendar_status = r->>'status', calendar_role = nullif(r->>'role', ''),
                   calendar_error = nullif(r->>'error', ''), calendar_checked_at = now()
             where id = (r->>'member_id')::uuid and tenant_id = p_tenant_id
               and btrim(google_calendar_id) = r->>'calendar_id';
        elsif r->>'kind' = 'agency' then
            update ai_config set calendar_status = r->>'status', calendar_error = nullif(r->>'error', ''), calendar_checked_at = now()
             where tenant_id = p_tenant_id and btrim(google_calendar_id) = r->>'calendar_id';
        end if;
    end loop;
end;
$$;
revoke all on function record_calendar_checks(uuid, jsonb, text) from public, anon, authenticated;

-- A changed calendar hasn't been checked yet.
create or replace function reset_calendar_status()
returns trigger language plpgsql as $$
begin
    if btrim(coalesce(new.google_calendar_id, '')) is distinct from btrim(coalesce(old.google_calendar_id, '')) then
        new.calendar_status := null;
        new.calendar_checked_at := null;
        if tg_table_name = 'tenant_users' then new.calendar_role := null; end if;
        new.calendar_error := null;
    end if;
    return new;
end;
$$;
drop trigger if exists trg_tenant_users_calendar_reset on tenant_users;
create trigger trg_tenant_users_calendar_reset before update of google_calendar_id on tenant_users
    for each row execute function reset_calendar_status();
drop trigger if exists trg_ai_config_calendar_reset on ai_config;
create trigger trg_ai_config_calendar_reset before update of google_calendar_id on ai_config
    for each row execute function reset_calendar_status();

-- ── 5. Agents set their own calendar (or an admin does) ──
create or replace function update_team_member(p_member_id uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := current_tenant_id();
    v_me tenant_users%rowtype;
    v_is_admin boolean;
    v_admin_view boolean := current_admin_view() is not null;
begin
    select * into v_me from tenant_users where auth_user_id = auth.uid() and tenant_id = v_tenant;
    v_is_admin := v_admin_view or coalesce(v_me.role = 'admin', false);

    if not v_is_admin and (v_me.id is null or v_me.id <> p_member_id) then
        raise exception 'Only an admin can change other team members';
    end if;
    if p_changes ? 'role' and not v_is_admin then
        raise exception 'Only an admin can change roles';
    end if;
    if p_changes ? 'role' and p_changes->>'role' not in ('admin', 'agent', 'viewer') then
        raise exception 'Unknown role';
    end if;
    if p_changes ? 'role' and p_changes->>'role' <> 'admin'
       and (select role from tenant_users where id = p_member_id) = 'admin'
       and (select count(*) from tenant_users where tenant_id = v_tenant and role = 'admin' and removed_at is null) = 1 then
        raise exception 'An agency needs at least one admin';
    end if;
    if p_changes ? 'google_calendar_id' and nullif(btrim(p_changes->>'google_calendar_id'), '') is not null
       and btrim(p_changes->>'google_calendar_id') !~ '^[^\s<>"]+@[^\s<>"]+$' then
        raise exception 'A Google Calendar ID looks like an email address (name@gmail.com, or ...@group.calendar.google.com)';
    end if;

    update tenant_users set
        full_name          = case when p_changes ? 'full_name' then nullif(trim(p_changes->>'full_name'), '') else full_name end,
        role               = case when p_changes ? 'role' then p_changes->>'role' else role end,
        receives_leads     = case when p_changes ? 'receives_leads' then (p_changes->>'receives_leads')::boolean else receives_leads end,
        notify_escalations = case when p_changes ? 'notify_escalations' then (p_changes->>'notify_escalations')::boolean else notify_escalations end,
        notify_digest      = case when p_changes ? 'notify_digest' then (p_changes->>'notify_digest')::boolean else notify_digest end,
        google_calendar_id = case when p_changes ? 'google_calendar_id' then nullif(lower(btrim(p_changes->>'google_calendar_id')), '') else google_calendar_id end
    where id = p_member_id and tenant_id = v_tenant;
    if not found then
        raise exception 'Team member not found';
    end if;
end;
$$;

-- ── 6. Changes and clean-up use the calendar the viewing is in ──
create or replace function client_appointment(p_tenant_id uuid, p_contact_id uuid, p_appointment_id uuid)
returns table (
    appointment_id uuid, status text, starts_at timestamptz, ends_at timestamptz, timezone text,
    external_calendar_id text, google_calendar_id text, notes text,
    tenant_name text, assistant_mode text,
    contact_name text, contact_email text, contact_phone text,
    listing_title text, listing_address text,
    agent_name text, agent_email text, notify_email text,
    booking_notice_minutes int
)
language sql stable security definer set search_path = public as $$
    select a.id, a.status, a.starts_at, a.ends_at, coalesce(a.timezone, t.timezone, 'Europe/Warsaw'),
           a.external_calendar_id, coalesce(nullif(a.booked_calendar_id, ''), ac.google_calendar_id), a.notes,
           t.name, t.assistant_mode,
           c.name, c.email, c.phone,
           l.title, nullif(concat_ws(', ', l.address, l.district, l.city), ''),
           coalesce(ag.full_name, ag.email), ag.email, ac.escalation_notify_email,
           coalesce(ac.booking_notice_minutes, 0)
    from appointments a
    join tenants t on t.id = a.tenant_id
    join contacts c on c.id = a.contact_id
    left join ai_config ac on ac.tenant_id = a.tenant_id
    left join listings l on l.id = a.listing_id
    left join tenant_users ag on ag.id = a.agent_id and ag.removed_at is null
    where a.id = p_appointment_id and a.tenant_id = p_tenant_id and a.contact_id = p_contact_id;
$$;

create or replace function demo_cleanup_events(p_older_than interval default interval '3 days')
returns table (appointment_id uuid, calendar_id text, event_id text)
language sql stable security definer set search_path = public as $$
    select a.id, coalesce(nullif(a.booked_calendar_id, ''), ac.google_calendar_id), a.external_calendar_id
    from appointments a
    join tenants t on t.id = a.tenant_id and t.assistant_mode = 'demo'
    join ai_config ac on ac.tenant_id = a.tenant_id
    where a.created_at < now() - p_older_than
      and nullif(a.external_calendar_id, '') is not null;
$$;

commit;
