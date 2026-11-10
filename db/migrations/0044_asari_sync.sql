-- 0044_asari_sync.sql
--
-- Listings from ASARI CRM. An agency pastes its ASARI API user ID and token
-- (ASARI → Ustawienia → API / apiSite) in Settings; workflow 42 then copies
-- its exported listings into Elliot every hour (one agency per run), updates
-- the ones that changed, and marks listings no longer exported as withdrawn.
--
--   * asari_connections: the credentials (never readable by the dashboard's
--     users; only n8n and the dashboard server use them) and the last result.
--   * listings.source / external_id / external_version / external_raw.
--   * asari_next_sync(), upsert_external_listings(), asari_finish_sync() for
--     workflow 42; asari_status() for the Settings page.
-- One transaction; safe to run again.

begin;

-- ── 1. Where a listing comes from ──
alter table listings add column if not exists source text not null default 'manual';
alter table listings add column if not exists external_id text;
alter table listings add column if not exists external_version text;
alter table listings add column if not exists external_raw jsonb;
comment on column listings.source is 'manual (typed or imported from a file in the dashboard) or asari (kept in step with ASARI CRM by workflow 42; edits in Elliot are overwritten on the next change in ASARI).';
create unique index if not exists idx_listings_external on listings(tenant_id, source, external_id) where external_id is not null;

-- ── 2. Credentials and status ──
create table if not exists asari_connections (
    tenant_id        uuid primary key references tenants(id) on delete cascade,
    api_user_id      text not null,
    api_token        text not null,
    enabled          boolean not null default true,
    last_sync_at     timestamptz,
    last_sync_ok     boolean,
    last_sync_error  text,
    last_sync_counts jsonb,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);
comment on table asari_connections is 'An agency''s ASARI apiSite credentials (SiteAuth userId:token) and the last sync result. Service role only.';
alter table asari_connections enable row level security;
revoke all on asari_connections from anon, authenticated;
drop trigger if exists trg_asari_connections_updated_at on asari_connections;
create trigger trg_asari_connections_updated_at before update on asari_connections
    for each row execute function set_updated_at();

-- What the Settings page may see: never the token.
create or replace function asari_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select case when c.tenant_id is null then jsonb_build_object('connected', false)
           else jsonb_build_object(
               'connected', true,
               'enabled', c.enabled,
               'api_user_id', c.api_user_id,
               'last_sync_at', c.last_sync_at,
               'last_sync_ok', c.last_sync_ok,
               'last_sync_error', c.last_sync_error,
               'last_sync_counts', c.last_sync_counts,
               'listings', (select count(*) from listings l where l.tenant_id = c.tenant_id and l.source = 'asari' and l.status = 'available'))
           end
    from (select current_tenant_id() as t) x
    left join asari_connections c on c.tenant_id = x.t;
$$;
revoke all on function asari_status() from public, anon;
grant execute on function asari_status() to authenticated;

-- ── 3. Workflow 42 ──
-- The agency to sync: the one asked for, else the enabled one synced longest ago.
-- known: { external_id: external_version } of its ASARI listings in Elliot.
create or replace function asari_next_sync(p_tenant_id uuid default null)
returns table (tenant_id uuid, api_user_id text, api_token text, known jsonb)
language sql
security definer
set search_path = public
as $$
    select c.tenant_id, c.api_user_id, c.api_token,
           coalesce((select jsonb_object_agg(l.external_id, coalesce(l.external_version, ''))
                       from listings l where l.tenant_id = c.tenant_id and l.source = 'asari' and l.external_id is not null), '{}'::jsonb)
    from asari_connections c
    join tenants t on t.id = c.tenant_id and t.status = 'active'
    where c.enabled and (p_tenant_id is null or c.tenant_id = p_tenant_id)
    order by c.last_sync_at nulls first
    limit 1;
$$;
revoke all on function asari_next_sync(uuid) from public, anon, authenticated;

-- p_rows: [{external_id, external_version, reference, title, status, transaction_type,
--   property_type, price, currency, city, district, address, area_m2, rooms, bedrooms,
--   bathrooms, floor, description, features[], photos[], image_url, available_from, raw}]
-- A listing typed in Elliot with the same reference is taken over (not duplicated).
create or replace function upsert_external_listings(p_tenant_id uuid, p_source text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r jsonb;
    v_id uuid;
    v_new int := 0;
    v_updated int := 0;
    v_skipped int := 0;
begin
    for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
        if nullif(r->>'external_id', '') is null or nullif(btrim(r->>'title'), '') is null then
            v_skipped := v_skipped + 1;
            continue;
        end if;
        select id into v_id from listings
         where tenant_id = p_tenant_id and source = p_source and external_id = r->>'external_id';
        if v_id is null and nullif(r->>'reference', '') is not null then
            select id into v_id from listings
             where tenant_id = p_tenant_id and reference = r->>'reference' and external_id is null;
        end if;
        if v_id is null then
            insert into listings (tenant_id, source, external_id, external_version, external_raw, reference, title, status,
                                  transaction_type, property_type, price, currency, city, district, address, area_m2,
                                  rooms, bedrooms, bathrooms, floor, description, features, photos, image_url, available_from)
            values (p_tenant_id, p_source, r->>'external_id', r->>'external_version', r->'raw',
                    nullif(r->>'reference', ''), left(r->>'title', 300),
                    coalesce(nullif(r->>'status', ''), 'available'),
                    coalesce(nullif(r->>'transaction_type', ''), 'sale'),
                    coalesce(nullif(r->>'property_type', ''), 'other'),
                    nullif(r->>'price', '')::numeric, coalesce(nullif(r->>'currency', ''), 'PLN'),
                    nullif(r->>'city', ''), nullif(r->>'district', ''), nullif(r->>'address', ''),
                    nullif(r->>'area_m2', '')::numeric, nullif(r->>'rooms', '')::int, nullif(r->>'bedrooms', '')::int,
                    nullif(r->>'bathrooms', '')::int, nullif(r->>'floor', '')::int, nullif(r->>'description', ''),
                    coalesce(array(select jsonb_array_elements_text(coalesce(r->'features', '[]'::jsonb))), '{}'),
                    array(select jsonb_array_elements_text(coalesce(r->'photos', '[]'::jsonb))),
                    nullif(r->>'image_url', ''), nullif(r->>'available_from', '')::date);
            v_new := v_new + 1;
        else
            update listings set
                source = p_source, external_id = r->>'external_id', external_version = r->>'external_version', external_raw = r->'raw',
                reference = coalesce(nullif(r->>'reference', ''), reference),
                title = left(r->>'title', 300),
                status = coalesce(nullif(r->>'status', ''), 'available'),
                transaction_type = coalesce(nullif(r->>'transaction_type', ''), transaction_type),
                property_type = coalesce(nullif(r->>'property_type', ''), property_type),
                price = nullif(r->>'price', '')::numeric,
                currency = coalesce(nullif(r->>'currency', ''), currency),
                city = nullif(r->>'city', ''), district = nullif(r->>'district', ''), address = nullif(r->>'address', ''),
                area_m2 = nullif(r->>'area_m2', '')::numeric, rooms = nullif(r->>'rooms', '')::int,
                bedrooms = nullif(r->>'bedrooms', '')::int, bathrooms = nullif(r->>'bathrooms', '')::int,
                floor = nullif(r->>'floor', '')::int, description = nullif(r->>'description', ''),
                features = coalesce(array(select jsonb_array_elements_text(coalesce(r->'features', '[]'::jsonb))), '{}'),
                photos = case when jsonb_array_length(coalesce(r->'photos', '[]'::jsonb)) > 0
                              then array(select jsonb_array_elements_text(r->'photos')) else photos end,
                image_url = coalesce(nullif(r->>'image_url', ''), image_url),
                available_from = nullif(r->>'available_from', '')::date
            where id = v_id;
            v_updated := v_updated + 1;
        end if;
        v_id := null;
    end loop;
    return jsonb_build_object('new', v_new, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;
revoke all on function upsert_external_listings(uuid, text, jsonb) from public, anon, authenticated;

-- After a sync: ASARI listings no longer exported are withdrawn (Elliot stops
-- offering them); the result is saved for Settings.
create or replace function asari_finish_sync(p_tenant_id uuid, p_exported jsonb, p_error text, p_counts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_withdrawn int := 0;
begin
    -- An empty list is treated as a glitch, not as "everything sold".
    if nullif(p_error, '') is null and jsonb_typeof(p_exported) = 'array' and jsonb_array_length(p_exported) > 0 then
        update listings set status = 'withdrawn'
         where tenant_id = p_tenant_id and source = 'asari' and status = 'available'
           and not (external_id = any (array(select jsonb_array_elements_text(p_exported))));
        get diagnostics v_withdrawn = row_count;
    end if;
    update asari_connections set
        last_sync_at = now(),
        last_sync_ok = nullif(p_error, '') is null,
        last_sync_error = nullif(left(p_error, 500), ''),
        last_sync_counts = coalesce(p_counts, '{}'::jsonb) || jsonb_build_object('withdrawn', v_withdrawn)
    where tenant_id = p_tenant_id;
    return jsonb_build_object('withdrawn', v_withdrawn);
end;
$$;
revoke all on function asari_finish_sync(uuid, jsonb, text, jsonb) from public, anon, authenticated;

commit;
