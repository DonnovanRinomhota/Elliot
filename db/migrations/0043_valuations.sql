-- 0043_valuations.sql
--
-- Sellers: "what's my flat worth?" / "I want to sell (or let) my flat".
-- Elliot never quotes a price. It asks for the property's details, records
-- the person as a seller lead (workflow 01's new tool record_valuation_request),
-- alerts the team, and offers a free valuation visit by an agent at the
-- property, booked like a viewing but marked as a valuation, at the client's
-- address.
--
--   * appointments.kind: viewing | valuation | call; appointments.location:
--     the address for a valuation visit.
--   * leads.intent: buy | rent | sell | let.
--   * record_valuation_request(): saves the property details on the lead.
--   * client_appointment() and due_viewing_reminders() also return kind and
--     location, so changes (37) and reminders (38) use the right words.
-- One transaction; safe to run again.

begin;

-- ── 1. What a booking is ──
alter table appointments add column if not exists kind text not null default 'viewing';
alter table appointments add column if not exists location text;
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'appointments_kind_check') then
        alter table appointments add constraint appointments_kind_check check (kind in ('viewing', 'valuation', 'call'));
    end if;
end $$;
comment on column appointments.kind is 'viewing (a listing), valuation (an agent values the client''s property) or call (Elliot''s own intro calls and demos).';
comment on column appointments.location is 'Where it happens when it isn''t a listing: the client''s property for a valuation visit.';
update appointments a set kind = 'call'
  from tenants t
 where t.id = a.tenant_id and t.assistant_mode = 'sales' and a.kind = 'viewing';

-- ── 2. What the lead wants ──
alter table leads add column if not exists intent text;
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'leads_intent_check') then
        alter table leads add constraint leads_intent_check check (intent in ('buy', 'rent', 'sell', 'let'));
    end if;
end $$;
comment on column leads.intent is 'What the client wants to do: buy, rent, sell or let. Sellers and landlords come from valuation requests (0043).';

-- ── 3. A valuation request ──
-- p_details: address, city, district, property_type, area_m2, rooms, floor,
-- year_built, condition, extras, intent (sell | let), timeline,
-- within_3_months (boolean), expected_price, notes. Unknown keys are kept.
-- The lead becomes HOT when they want to act within 3 months, else WARM
-- (never lowered; a closed lead stays closed).
create or replace function record_valuation_request(p_tenant_id uuid, p_contact_id uuid, p_details jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_details jsonb := jsonb_strip_nulls(coalesce(p_details, '{}'::jsonb));
    v_intent text := case when lower(coalesce(p_details->>'intent', '')) in ('let', 'rent', 'rent_out') then 'let' else 'sell' end;
    v_soon boolean := coalesce((p_details->>'within_3_months')::boolean, false);
    v_lead leads%rowtype;
begin
    if not exists (select 1 from contacts where id = p_contact_id and tenant_id = p_tenant_id) then
        raise exception 'contact not found';
    end if;
    v_details := v_details - 'intent' - 'within_3_months'
        || jsonb_build_object('intent', v_intent, 'within_3_months', v_soon, 'requested_at', now());

    insert into leads (tenant_id, contact_id, status, intent, qualification_answers)
    values (p_tenant_id, p_contact_id, case when v_soon then 'HOT' else 'WARM' end, v_intent,
            jsonb_build_object('valuation', v_details, 'intent_signal', 'wants a valuation of their property'))
    on conflict (tenant_id, contact_id) do update
       set intent = v_intent,
           qualification_answers = leads.qualification_answers
               || jsonb_build_object('valuation', coalesce(leads.qualification_answers->'valuation', '{}'::jsonb) || v_details,
                                     'intent_signal', 'wants a valuation of their property'),
           status = case
               when leads.status in ('CONVERTED', 'LOST', 'HOT') then leads.status
               when v_soon then 'HOT'
               else 'WARM' end,
           updated_at = now()
    returning * into v_lead;

    return jsonb_build_object('lead_id', v_lead.id, 'status', v_lead.status, 'intent', v_lead.intent,
                              'assigned_to', v_lead.assigned_to);
end;
$$;
revoke all on function record_valuation_request(uuid, uuid, jsonb) from public, anon, authenticated;

-- ── 4. Changes and reminders know what kind of visit it is ──
drop function if exists client_appointment(uuid, uuid, uuid);
create function client_appointment(p_tenant_id uuid, p_contact_id uuid, p_appointment_id uuid)
returns table (
    appointment_id uuid, status text, starts_at timestamptz, ends_at timestamptz, timezone text,
    external_calendar_id text, google_calendar_id text, notes text,
    tenant_name text, assistant_mode text,
    contact_name text, contact_email text, contact_phone text,
    listing_title text, listing_address text,
    agent_name text, agent_email text, notify_email text,
    booking_notice_minutes int,
    kind text, location text
)
language sql stable security definer set search_path = public as $$
    select a.id, a.status, a.starts_at, a.ends_at, coalesce(a.timezone, t.timezone, 'Europe/Warsaw'),
           a.external_calendar_id, coalesce(nullif(a.booked_calendar_id, ''), ac.google_calendar_id), a.notes,
           t.name, t.assistant_mode,
           c.name, c.email, c.phone,
           l.title, nullif(concat_ws(', ', l.address, l.district, l.city), ''),
           coalesce(ag.full_name, ag.email), ag.email, ac.escalation_notify_email,
           coalesce(ac.booking_notice_minutes, 0),
           a.kind, a.location
    from appointments a
    join tenants t on t.id = a.tenant_id
    join contacts c on c.id = a.contact_id
    left join ai_config ac on ac.tenant_id = a.tenant_id
    left join listings l on l.id = a.listing_id
    left join tenant_users ag on ag.id = a.agent_id and ag.removed_at is null
    where a.id = p_appointment_id and a.tenant_id = p_tenant_id and a.contact_id = p_contact_id;
$$;
revoke all on function client_appointment(uuid, uuid, uuid) from public, anon, authenticated;

drop function if exists due_viewing_reminders(timestamptz);
create function due_viewing_reminders(p_now timestamptz default now())
returns table (
    appointment_id uuid, tenant_id uuid, tenant_name text, assistant_mode text, timezone text,
    starts_at timestamptz, ends_at timestamptz, notes text,
    contact_name text, contact_email text, contact_phone text,
    conversation_id uuid, conversation_channel text, whatsapp_phone_number_id text,
    listing_title text, listing_address text, agent_name text,
    last_client_message text,
    kind text, location text
)
language sql stable security definer set search_path = public as $$
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
      and a.reminder_sent_at is null
      and a.starts_at > p_now
      and (a.starts_at at time zone coalesce(a.timezone, t.timezone, 'Europe/Warsaw'))::date
          = ((p_now at time zone coalesce(a.timezone, t.timezone, 'Europe/Warsaw'))::date + 1);
$$;
revoke all on function due_viewing_reminders(timestamptz) from public, anon, authenticated;

commit;
