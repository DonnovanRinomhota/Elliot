-- 0038_viewing_changes_and_reminders.sql
--
-- Clients can confirm, move or cancel a viewing by message, Elliot sends a
-- reminder the day before, and slots respect a minimum notice and a buffer
-- between viewings. See docs/workflow-specs/37-38-viewing-changes-reminders.md.
--
--   * workflow 01: new tool change_viewing (confirm / reschedule / cancel),
--     always for the client's own viewings only.
--   * workflow 37: does the change (calendar, dashboard, emails, agent alert).
--   * workflow 38: reminders at 17:00 for the next day's viewings
--     (WhatsApp template or email), logged into the conversation so a reply
--     like "yes" or "can we move it?" has context.
--   * workflow 11: notice and buffer from Settings.
--
-- For n8n's service-role connection (functions), and the agency's Settings
-- page (ai_config columns, under the existing RLS policy). One transaction;
-- safe to run again.

begin;

-- ── 1. Settings ──
alter table ai_config add column if not exists reminders_enabled boolean not null default true;
alter table ai_config add column if not exists booking_notice_minutes integer not null default 120;
alter table ai_config add column if not exists booking_buffer_minutes integer not null default 30;
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'ai_config_booking_notice_check') then
        alter table ai_config add constraint ai_config_booking_notice_check check (booking_notice_minutes between 0 and 10080);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ai_config_booking_buffer_check') then
        alter table ai_config add constraint ai_config_booking_buffer_check check (booking_buffer_minutes between 0 and 240);
    end if;
end $$;
comment on column ai_config.booking_notice_minutes is 'The earliest a client can book: this many minutes from now (default 2 hours).';
comment on column ai_config.booking_buffer_minutes is 'Kept free before and after every calendar event, e.g. travel between viewings (default 30).';

-- Elliot's own 15/30-minute calls don't need travel time.
update ai_config set booking_buffer_minutes = 15
 where booking_buffer_minutes = 30
   and tenant_id in (select id from tenants where assistant_mode = 'sales');

-- ── 2. What happened to each viewing ──
alter table appointments add column if not exists reminder_sent_at timestamptz;
alter table appointments add column if not exists reminder_channel text;
alter table appointments add column if not exists client_confirmed_at timestamptz;
alter table appointments add column if not exists cancelled_by text;
alter table appointments add column if not exists previous_starts_at timestamptz;
comment on column appointments.cancelled_by is 'client (by message, through Elliot) or team (dashboard).';
comment on column appointments.previous_starts_at is 'Set when the client moved the viewing: the time it was before.';

-- ── 3. The client's upcoming viewings for Elliot, now with their ids ──
-- Same as 0034, plus ends_at, whether the client confirmed, and the
-- appointment id Elliot needs for change_viewing.
create or replace function identify_chat_visitor(
    p_tenant_id uuid,
    p_conversation_id uuid,
    p_name text,
    p_email text,
    p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
    c record;
    v_viewings jsonb;
begin
    if nullif(btrim(coalesce(p_name, '')), '') is not null
       or nullif(btrim(coalesce(p_email, '')), '') is not null
       or nullif(btrim(coalesce(p_phone, '')), '') is not null then
        v_id := upsert_conversation_contact(p_tenant_id, p_conversation_id, p_name, p_email, p_phone, null, 'chat_widget');
    else
        select contact_id into v_id from conversations where id = p_conversation_id and tenant_id = p_tenant_id;
    end if;

    select id, name, email, phone into c from contacts where id = v_id;

    select coalesce(jsonb_agg(jsonb_build_object(
               'appointment_id', a.id,
               'when', to_char(a.starts_at at time zone coalesce(a.timezone, t.timezone, 'UTC'), 'Dy DD Mon YYYY, HH24:MI'),
               'starts_at', a.starts_at,
               'ends_at', a.ends_at,
               'client_confirmed', a.client_confirmed_at is not null,
               'listing_id', l.id,
               'title', l.title,
               'address', nullif(concat_ws(', ', l.address, l.district, l.city), ''),
               'url', l.url,
               'photo_count', coalesce(cardinality(l.photos), 0)
           ) order by a.starts_at), '[]'::jsonb)
      into v_viewings
      from appointments a
      join tenants t on t.id = a.tenant_id
      left join listings l on l.id = a.listing_id
     where a.tenant_id = p_tenant_id
       and c.id is not null and a.contact_id = c.id
       and a.status = 'confirmed'
       and a.ends_at > now();

    return jsonb_build_object(
        'contact_id', c.id,
        'name', c.name,
        'email', c.email,
        'phone', c.phone,
        'ready', c.id is not null and c.name is not null and (c.email is not null or c.phone is not null),
        'upcoming_viewings', v_viewings
    );
end;
$$;
revoke all on function identify_chat_visitor(uuid, uuid, text, text, text) from public, anon, authenticated;

-- ── 4. One of the client's own viewings (workflow 37) ──
-- Nothing comes back unless the appointment belongs to this client in this
-- agency: Elliot can never touch someone else's booking.
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
           a.external_calendar_id, ac.google_calendar_id, a.notes,
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

create or replace function client_confirm_appointment(p_tenant_id uuid, p_contact_id uuid, p_appointment_id uuid)
returns boolean language sql security definer set search_path = public as $$
    with u as (
        update appointments set client_confirmed_at = coalesce(client_confirmed_at, now()), updated_at = now()
         where id = p_appointment_id and tenant_id = p_tenant_id and contact_id = p_contact_id and status = 'confirmed'
        returning 1
    ) select exists (select 1 from u);
$$;

create or replace function client_cancel_appointment(p_tenant_id uuid, p_contact_id uuid, p_appointment_id uuid)
returns boolean language sql security definer set search_path = public as $$
    with u as (
        update appointments set status = 'cancelled', cancelled_by = 'client', updated_at = now()
         where id = p_appointment_id and tenant_id = p_tenant_id and contact_id = p_contact_id and status = 'confirmed'
        returning 1
    ) select exists (select 1 from u);
$$;

-- Moves the viewing. The no-overlap rule (0004) still applies: a clash comes
-- back as { ok: false, error: 'slot_unavailable' } instead of an error.
create or replace function client_reschedule_appointment(
    p_tenant_id uuid, p_contact_id uuid, p_appointment_id uuid, p_starts_at timestamptz, p_ends_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_old timestamptz;
begin
    if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
        return jsonb_build_object('ok', false, 'error', 'invalid_time');
    end if;
    if p_starts_at < now() then
        return jsonb_build_object('ok', false, 'error', 'in_the_past');
    end if;
    select starts_at into v_old from appointments
     where id = p_appointment_id and tenant_id = p_tenant_id and contact_id = p_contact_id and status = 'confirmed'
     for update;
    if v_old is null then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    begin
        update appointments
           set starts_at = p_starts_at, ends_at = p_ends_at, previous_starts_at = v_old,
               reminder_sent_at = null, reminder_channel = null, client_confirmed_at = null, updated_at = now()
         where id = p_appointment_id;
    exception when exclusion_violation then
        return jsonb_build_object('ok', false, 'error', 'slot_unavailable');
    end;
    return jsonb_build_object('ok', true, 'previous_starts_at', v_old);
end;
$$;

revoke all on function client_appointment(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function client_confirm_appointment(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function client_cancel_appointment(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function client_reschedule_appointment(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ── 5. Reminders (workflow 38) ──
-- Viewings tomorrow (in each agency's time zone) that haven't had a reminder,
-- for agencies with reminders on. Not for the demo agency.
create or replace function due_viewing_reminders(p_now timestamptz default now())
returns table (
    appointment_id uuid, tenant_id uuid, tenant_name text, assistant_mode text, timezone text,
    starts_at timestamptz, ends_at timestamptz, notes text,
    contact_name text, contact_email text, contact_phone text,
    conversation_id uuid, conversation_channel text, whatsapp_phone_number_id text,
    listing_title text, listing_address text, agent_name text,
    last_client_message text
)
language sql stable security definer set search_path = public as $$
    select a.id, t.id, t.name, t.assistant_mode, coalesce(a.timezone, t.timezone, 'Europe/Warsaw'),
           a.starts_at, a.ends_at, a.notes,
           c.name, c.email, c.phone,
           cv.id, cv.channel, nullif(btrim(ac.whatsapp_phone_number_id), ''),
           l.title, nullif(concat_ws(', ', l.address, l.district, l.city), ''),
           coalesce(ag.full_name, ag.email),
           (select m.content from messages m where m.conversation_id = cv.id and m.role = 'user'
             order by m.created_at desc limit 1)
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
      and a.reminder_sent_at is null
      and a.starts_at > p_now
      and (a.starts_at at time zone coalesce(a.timezone, t.timezone, 'Europe/Warsaw'))::date
          = ((p_now at time zone coalesce(a.timezone, t.timezone, 'Europe/Warsaw'))::date + 1);
$$;

-- Marks the reminder as sent and puts its text in the conversation, so the
-- client's reply ("yes", "can we make it 18:00?") reaches Elliot with context.
create or replace function record_viewing_reminder(
    p_appointment_id uuid, p_channel text, p_sent boolean, p_text text, p_conversation_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid;
begin
    select tenant_id into v_tenant from appointments where id = p_appointment_id;
    if v_tenant is null then return; end if;
    if p_sent then
        update appointments set reminder_sent_at = now(), reminder_channel = p_channel where id = p_appointment_id;
        if p_conversation_id is not null and nullif(btrim(p_text), '') is not null
           and exists (select 1 from conversations where id = p_conversation_id and tenant_id = v_tenant) then
            insert into messages (tenant_id, conversation_id, role, content)
            values (v_tenant, p_conversation_id, 'assistant', p_text);
            update conversations set updated_at = now() where id = p_conversation_id;
        end if;
    else
        -- Tried and failed: don't retry every run; it shows up in the health alerts.
        update appointments set reminder_sent_at = now(), reminder_channel = 'failed:' || coalesce(p_channel, '?') where id = p_appointment_id;
        insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
        values (v_tenant, 'system', 'workflow_38', 'reminder_failed',
                jsonb_build_object('appointment_id', p_appointment_id, 'channel', p_channel, 'error', left(coalesce(p_text, ''), 300)));
    end if;
end;
$$;

revoke all on function due_viewing_reminders(timestamptz) from public, anon, authenticated;
revoke all on function record_viewing_reminder(uuid, text, boolean, text, uuid) from public, anon, authenticated;

commit;
