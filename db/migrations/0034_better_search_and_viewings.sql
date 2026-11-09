-- 0034_better_search_and_viewings.sql
--
-- Fixes from the first real test chats (9 Nov 2026):
--
-- 1. search_listings() found nothing for things that were there:
--    - "Mokotow" didn't match "Mokotów" (Polish letters). Matching now
--      ignores Polish accents and case.
--    - "close to the centre" / "centrum" / "city center" now means
--      Śródmieście.
--    - "1-bedroom" excluded every listing whose bedrooms weren't filled in.
--      A listing without bedrooms counts as rooms - 1 (a 2-room flat is a
--      1-bedroom flat).
--    - A number like "3000 PLN" from Elliot no longer breaks the search.
--    And when nothing matches exactly, it now also returns the closest
--    available options (same buy/rent, nearest area and price) as
--    "alternatives", so Elliot always has something real to show with a
--    link instead of "the team will be in touch".
-- 2. identify_chat_visitor() also returns the client's upcoming viewings
--    (with the property), so Elliot knows what's already booked and can
--    send the property link when asked for photos.
--
-- One transaction; safe to run again.

begin;

-- Lower case, Polish letters to plain ones: "Mokotów" -> "mokotow".
create or replace function search_norm(p text)
returns text
language sql
immutable
as $$
    select translate(lower(coalesce(p, '')), 'ąćęłńóśźżäöüéè', 'acelnoszzaouee');
$$;

-- A number from the model, or null: "3 000 PLN", "3000", "3,5" -> 3000, 3000, 3.5.
create or replace function search_number(p text)
returns numeric
language plpgsql
immutable
as $$
declare
    v text := regexp_replace(replace(coalesce(p, ''), ',', '.'), '[^0-9.]', '', 'g');
begin
    if v = '' or v = '.' then
        return null;
    end if;
    return v::numeric;
exception when others then
    return null;
end;
$$;

create or replace function search_listings(p_tenant_id uuid, p_filters jsonb)
returns jsonb
language plpgsql
as $$
declare
    f          jsonb := coalesce(p_filters, '{}'::jsonb);
    v_result   jsonb;
    v_alt      jsonb := '[]'::jsonb;
    v_ids      uuid[];
    v_alt_ids  uuid[];
    v_limit    int := least(greatest(coalesce(search_number(f->>'limit')::int, 5), 1), 10);
    v_by       date;
    v_loc      text := nullif(btrim(search_norm(f->>'location')), '');
    v_kw       text := nullif(btrim(search_norm(f->>'keywords')), '');
    v_max      numeric := search_number(f->>'max_price');
    v_min      numeric := search_number(f->>'min_price');
    v_rooms    int := search_number(f->>'min_rooms')::int;
    v_beds     int := search_number(f->>'min_bedrooms')::int;
    v_area     numeric := search_number(f->>'min_area_m2');
    v_tx       text := nullif(f->>'transaction_type', '');
    v_type     text := nullif(f->>'property_type', '');
    v_ref      text := nullif(btrim(f->>'reference'), '');
begin
    perform set_config('app.current_tenant', p_tenant_id::text, true);

    begin
        v_by := nullif(f->>'move_in_by', '')::date;
    exception when others then
        v_by := null;  -- a malformed date from the model must not break the search
    end;
    v_by := coalesce(v_by, current_date + 60);

    -- "the centre", "city center", "centrum", "downtown" -> Śródmieście.
    if v_loc ~ '^(the )?(city )?(cent(er|re)|centrum|downtown)( of warsaw| warszawy)?$'
       or v_loc in ('close to the center', 'close to the centre', 'near the center', 'near the centre') then
        v_loc := 'srodmiescie';
    end if;

    with matches as (
        select l.*
        from listings l
        where l.tenant_id = p_tenant_id
          and l.status = 'available'
          and (l.available_from is null or l.available_from <= v_by)
          and (v_tx is null or l.transaction_type = v_tx)
          and (v_type is null or l.property_type = v_type)
          and (v_loc is null
               or search_norm(l.city) like '%' || v_loc || '%'
               or search_norm(l.district) like '%' || v_loc || '%'
               or search_norm(l.address) like '%' || v_loc || '%'
               or search_norm(l.description) like '%' || v_loc || '%')
          and (v_max is null or l.price <= v_max)
          and (v_min is null or l.price >= v_min)
          and (v_rooms is null or l.rooms >= v_rooms)
          -- No bedrooms filled in: a 2-room flat is a 1-bedroom flat.
          and (v_beds is null or coalesce(l.bedrooms, greatest(l.rooms - 1, 0)) >= v_beds)
          and (v_area is null or l.area_m2 >= v_area)
          and (v_kw is null
               or search_norm(l.title) like '%' || v_kw || '%'
               or search_norm(l.description) like '%' || v_kw || '%'
               or search_norm(array_to_string(l.features, ' ')) like '%' || v_kw || '%')
          and (v_ref is null or lower(l.reference) = lower(v_ref))
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

    -- Nothing exact: the closest real options, so the client always has
    -- something to look at. Same buy/rent; then nearest area, nearest price.
    if v_ids is null and v_ref is null then
        with near as (
            select l.*,
                   (v_loc is not null and (search_norm(l.district) like '%' || v_loc || '%'
                                           or search_norm(l.address) like '%' || v_loc || '%'
                                           or search_norm(l.city) like '%' || v_loc || '%')) as same_area
            from listings l
            where l.tenant_id = p_tenant_id
              and l.status = 'available'
              and (l.available_from is null or l.available_from <= v_by + 60)
              and (v_tx is null or l.transaction_type = v_tx)
            order by
              same_area desc,
              abs(coalesce(l.price, 0) - coalesce(v_max, v_min, l.price, 0)),
              coalesce(l.available_from, current_date),
              l.created_at desc
            limit 3
        )
        select coalesce(jsonb_agg(jsonb_build_object(
                   'listing_id', n.id,
                   'reference', n.reference,
                   'title', n.title,
                   'transaction_type', n.transaction_type,
                   'property_type', n.property_type,
                   'price', n.price,
                   'currency', n.currency,
                   'city', n.city,
                   'district', n.district,
                   'area_m2', n.area_m2,
                   'rooms', n.rooms,
                   'bedrooms', n.bedrooms,
                   'floor', n.floor,
                   'features', n.features,
                   'description', left(n.description, 300),
                   'url', n.url,
                   'address', n.address,
                   'photo_count', cardinality(n.photos) + case when cardinality(n.photos) = 0 and n.image_url is not null then 1 else 0 end,
                   'available_from', case when n.available_from > current_date then n.available_from end
               )), '[]'::jsonb),
               array_agg(n.id)
          into v_alt, v_alt_ids
          from near n;
    end if;

    if v_ids is not null or v_alt_ids is not null then
        update listings set times_suggested = times_suggested + 1, last_suggested_at = now()
        where id = any(coalesce(v_ids, '{}') || coalesce(v_alt_ids, '{}'));
    end if;

    return jsonb_build_object(
        'found', jsonb_array_length(v_result) > 0,
        'count', jsonb_array_length(v_result),
        'listings', v_result,
        'alternatives', v_alt
    );
end;
$$;

-- ── 2. The client's upcoming viewings, for Elliot ──
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

commit;
