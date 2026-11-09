-- 0033_listing_links_booking_details.sql
--
-- Clients see the properties Elliot suggests, get a booking confirmation by
-- email, and the team knows when and where each viewing was booked.
--
-- 1. search_listings(): also returns the address and how many photos a
--    listing has, so Elliot can send a link to every property it suggests
--    (the agency's website page, or Elliot's own property page with the
--    photos: /p/<listing id> on the dashboard).
-- 2. public_listing(): what that property page shows. Only listings that are
--    available or under offer; no internal fields. Callable without signing in.
-- 3. appointments.conversation_id: the conversation the viewing was booked
--    in (WhatsApp, website chat or email), so the appointment shows when and
--    where it was booked and links to the chat. Existing appointments are
--    linked to the client's conversation from around the time of booking.
-- 4. escalation_context(): the client's details and the conversation so far,
--    for the alert email the team gets when Elliot hands over (workflow 24).
--
-- One transaction; safe to run again.

begin;

-- ── 1. search_listings: + address, + photo_count ──
create or replace function search_listings(p_tenant_id uuid, p_filters jsonb)
returns jsonb
language plpgsql
as $$
declare
    f        jsonb := coalesce(p_filters, '{}'::jsonb);
    v_result jsonb;
    v_ids    uuid[];
    v_limit  int := least(greatest(coalesce((f->>'limit')::int, 5), 1), 10);
    v_by     date;
begin
    perform set_config('app.current_tenant', p_tenant_id::text, true);

    begin
        v_by := nullif(f->>'move_in_by', '')::date;
    exception when others then
        v_by := null;  -- a malformed date from the model must not break the search
    end;
    v_by := coalesce(v_by, current_date + 60);

    with matches as (
        select l.*
        from listings l
        where l.tenant_id = p_tenant_id
          and l.status = 'available'
          and (l.available_from is null or l.available_from <= v_by)
          and (f->>'transaction_type' is null or l.transaction_type = f->>'transaction_type')
          and (f->>'property_type' is null or l.property_type = f->>'property_type')
          and (f->>'location' is null
               or l.city ilike '%' || (f->>'location') || '%'
               or l.district ilike '%' || (f->>'location') || '%'
               or l.address ilike '%' || (f->>'location') || '%'
               or l.description ilike '%' || (f->>'location') || '%')
          and (f->>'max_price' is null or l.price <= (f->>'max_price')::numeric)
          and (f->>'min_price' is null or l.price >= (f->>'min_price')::numeric)
          and (f->>'min_rooms' is null or l.rooms >= (f->>'min_rooms')::int)
          and (f->>'min_bedrooms' is null or l.bedrooms >= (f->>'min_bedrooms')::int)
          and (f->>'min_area_m2' is null or l.area_m2 >= (f->>'min_area_m2')::numeric)
          and (f->>'keywords' is null
               or l.title ilike '%' || (f->>'keywords') || '%'
               or l.description ilike '%' || (f->>'keywords') || '%'
               or array_to_string(l.features, ' ') ilike '%' || (f->>'keywords') || '%')
          and (f->>'reference' is null or l.reference = f->>'reference')
        -- Free soonest first, then cheapest.
        order by coalesce(l.available_from, current_date), l.price nulls last, l.created_at desc
        limit v_limit
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'listing_id', m.id,
               'reference', m.reference,
               'title', m.title,
               'transaction_type', m.transaction_type,
               'property_type', m.property_type,
               'price', m.price,
               'currency', m.currency,
               'city', m.city,
               'district', m.district,
               'area_m2', m.area_m2,
               'rooms', m.rooms,
               'bedrooms', m.bedrooms,
               'bathrooms', m.bathrooms,
               'floor', m.floor,
               'features', m.features,
               'description', left(m.description, 400),
               'url', m.url,
               'address', m.address,
               'photo_count', cardinality(m.photos) + case when cardinality(m.photos) = 0 and m.image_url is not null then 1 else 0 end,
               'available_from', case when m.available_from > current_date then m.available_from end
           )), '[]'::jsonb),
           array_agg(m.id)
      into v_result, v_ids
      from matches m;

    if v_ids is not null then
        update listings set times_suggested = times_suggested + 1, last_suggested_at = now()
        where id = any(v_ids);
    end if;

    return jsonb_build_object(
        'found', jsonb_array_length(v_result) > 0,
        'count', jsonb_array_length(v_result),
        'listings', v_result
    );
end;
$$;

-- ── 2. The public property page ──
create or replace function public_listing(p_listing_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'id', l.id,
        'reference', l.reference,
        'title', l.title,
        'status', l.status,
        'transaction_type', l.transaction_type,
        'property_type', l.property_type,
        'price', l.price,
        'currency', l.currency,
        'city', l.city,
        'district', l.district,
        'address', l.address,
        'area_m2', l.area_m2,
        'rooms', l.rooms,
        'bedrooms', l.bedrooms,
        'bathrooms', l.bathrooms,
        'floor', l.floor,
        'description', l.description,
        'features', l.features,
        'url', l.url,
        'image_url', l.image_url,
        'photos', l.photos,
        'available_from', l.available_from,
        'agency', t.name
    )
    from listings l
    join tenants t on t.id = l.tenant_id and t.status = 'active'
    where l.id = p_listing_id
      and l.status in ('available', 'under_offer');
$$;

revoke all on function public_listing(uuid) from public;
grant execute on function public_listing(uuid) to anon, authenticated;

-- ── 3. Which conversation a viewing was booked in ──
alter table appointments
    add column if not exists conversation_id uuid references conversations(id) on delete set null;
create index if not exists idx_appointments_conversation on appointments(conversation_id);

comment on column appointments.conversation_id is
    'The conversation (WhatsApp, website chat or email) the viewing was booked in. Set by workflow 12 from Elliot''s booking.';

-- A conversation from another agency is never accepted.
create or replace function check_appointment_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.conversation_id is not null
       and not exists (select 1 from conversations where id = new.conversation_id and tenant_id = new.tenant_id) then
        new.conversation_id := null;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_appointments_check_conversation on appointments;
create trigger trg_appointments_check_conversation
    before insert or update of conversation_id on appointments
    for each row execute function check_appointment_conversation();

-- Existing viewings: the client's conversation that was active when the
-- viewing was booked (the latest message at or before the booking).
update appointments a
set conversation_id = (
        select m.conversation_id
        from messages m
        join conversations c on c.id = m.conversation_id
        where c.tenant_id = a.tenant_id and c.contact_id = a.contact_id
          and m.created_at <= a.created_at + interval '5 minutes'
        order by m.created_at desc
        limit 1
    )
where a.conversation_id is null and a.contact_id is not null;

-- ── 4. Context for the hand-over email ──
create or replace function escalation_context(p_tenant_id uuid, p_conversation_id uuid, p_limit int default 40)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'channel', c.channel,
        'contact_name', ct.name,
        'contact_email', ct.email,
        'contact_phone', ct.phone,
        'transcript', coalesce((
            select string_agg(
                to_char(h.created_at at time zone coalesce(t.timezone, 'UTC'), 'DD Mon HH24:MI') || '  ' ||
                case h.role when 'user' then coalesce(nullif(ct.name, ''), 'Client')
                            when 'assistant' then 'Elliot'
                            when 'human_agent' then 'Team'
                            else 'Note' end ||
                ': ' || h.content,
                E'\n' order by h.created_at)
            from (
                select m.role, m.content, m.created_at
                from messages m
                where m.conversation_id = c.id
                order by m.created_at desc
                limit greatest(coalesce(p_limit, 40), 1)
            ) h
        ), '')
    )
    from conversations c
    join tenants t on t.id = c.tenant_id
    left join contacts ct on ct.id = c.contact_id
    where c.id = p_conversation_id and c.tenant_id = p_tenant_id;
$$;

revoke all on function escalation_context(uuid, uuid, int) from public, anon, authenticated;

commit;
