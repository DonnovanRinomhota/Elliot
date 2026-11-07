-- 0028_listings_available_from.sql
--
-- Rentals (rooms, flats) are usually advertised before they're free:
-- "available from 1 October". This adds that date to listings, lets the
-- chat agent filter by the visitor's move-in date, and extends the import
-- so a weekly re-upload of the agency's spreadsheet can also withdraw
-- listings that are no longer in it.
--
-- One transaction; safe to run again.

begin;

alter table listings add column if not exists available_from date;

comment on column listings.available_from is
    'First day the property can be moved into / handed over. NULL = available now. Elliot mentions it and, without a move-in date from the visitor, only offers listings free within the next 60 days.';

create index if not exists idx_listings_tenant_available_from on listings(tenant_id, available_from);

-- ── search_listings: + move_in_by filter, + available_from in the output ──
-- Filters (all optional): transaction_type, property_type, location,
-- max_price, min_price, min_rooms, min_bedrooms, min_area_m2, keywords,
-- reference, move_in_by (YYYY-MM-DD), limit.
-- Without move_in_by, listings that only free up more than 60 days from now
-- are left out: offering a room that's let until next autumn helps nobody.
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

-- ── import_listings v2: + available_from, + "withdraw listings not in this file" ──
drop function if exists import_listings(jsonb);

create or replace function import_listings(p_rows jsonb, p_withdraw_missing boolean default false)
returns jsonb
language plpgsql
as $$
declare
    v_tenant uuid := current_tenant_id();
    r jsonb;
    v_inserted int := 0;
    v_updated int := 0;
    v_withdrawn int := 0;
    v_existing uuid;
    v_refs text[] := '{}';
    v_ref text;
begin
    if v_tenant is null then
        raise exception 'No agency for this account';
    end if;
    for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
    loop
        v_existing := null;
        v_ref := nullif(trim(r->>'reference'), '');
        if v_ref is not null then
            v_refs := v_refs || v_ref;
            select id into v_existing from listings where tenant_id = v_tenant and reference = v_ref;
        end if;

        if v_existing is null then
            insert into listings (tenant_id, reference, title, status, transaction_type, property_type,
                                  price, currency, city, district, address, area_m2, rooms, bedrooms,
                                  bathrooms, floor, description, features, url, image_url, available_from)
            values (v_tenant, v_ref, r->>'title',
                    coalesce(r->>'status', 'available'), coalesce(r->>'transaction_type', 'sale'),
                    coalesce(r->>'property_type', 'apartment'),
                    (r->>'price')::numeric, coalesce(r->>'currency', 'PLN'), r->>'city', r->>'district',
                    r->>'address', (r->>'area_m2')::numeric, (r->>'rooms')::int, (r->>'bedrooms')::int,
                    (r->>'bathrooms')::int, (r->>'floor')::int, r->>'description',
                    coalesce((select array_agg(x) from jsonb_array_elements_text(r->'features') x), '{}'),
                    r->>'url', r->>'image_url', nullif(r->>'available_from', '')::date);
            v_inserted := v_inserted + 1;
        else
            update listings set
                title = r->>'title',
                status = coalesce(r->>'status', status),
                transaction_type = coalesce(r->>'transaction_type', transaction_type),
                property_type = coalesce(r->>'property_type', property_type),
                price = (r->>'price')::numeric,
                currency = coalesce(r->>'currency', currency),
                city = r->>'city', district = r->>'district', address = r->>'address',
                area_m2 = (r->>'area_m2')::numeric, rooms = (r->>'rooms')::int,
                bedrooms = (r->>'bedrooms')::int, bathrooms = (r->>'bathrooms')::int,
                floor = (r->>'floor')::int, description = r->>'description',
                features = coalesce((select array_agg(x) from jsonb_array_elements_text(r->'features') x), '{}'),
                url = r->>'url', image_url = r->>'image_url',
                available_from = nullif(r->>'available_from', '')::date
            where id = v_existing;
            v_updated := v_updated + 1;
        end if;
    end loop;

    -- Listings that have a reference but weren't in this file: no longer on
    -- the agency's list, so Elliot stops offering them. Listings without a
    -- reference (added by hand) are never touched.
    if p_withdraw_missing and array_length(v_refs, 1) > 0 then
        update listings set status = 'withdrawn'
        where tenant_id = v_tenant
          and reference is not null
          and status in ('available', 'under_offer')
          and not (reference = any(v_refs));
        get diagnostics v_withdrawn = row_count;
    end if;

    return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'withdrawn', v_withdrawn);
end;
$$;

-- create or replace keeps grants, but be explicit: never callable through the
-- public API (it sets the tenant itself; n8n uses the service role).
revoke all on function public.search_listings(uuid, jsonb) from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        execute 'revoke all on function public.search_listings(uuid, jsonb) from anon, authenticated';
    end if;
end $$;

commit;
