-- Scenario test for 0044 (ASARI sync). Scratch database only; rolls back.
-- Ends with "0044 checks passed".
begin;
insert into tenants (id, name, slug, timezone, assistant_mode) values
  ('99999999-0000-0000-0000-000000000441', 'Agency A', 'a-441', 'Europe/Warsaw', 'agency'),
  ('99999999-0000-0000-0000-000000000442', 'Agency B', 'b-442', 'Europe/Warsaw', 'agency');
insert into asari_connections (tenant_id, api_user_id, api_token, last_sync_at) values
  ('99999999-0000-0000-0000-000000000441', '123', 'tok-a', now() - interval '2 hours'),
  ('99999999-0000-0000-0000-000000000442', '456', 'tok-b', null);
insert into listings (tenant_id, reference, title) values ('99999999-0000-0000-0000-000000000441', 'WM-1', 'Typed by hand');

do $$
declare r record; j jsonb; n int;
begin
  -- 1. The agency never synced goes first; a named one on request.
  select * into r from asari_next_sync();
  if r.tenant_id <> '99999999-0000-0000-0000-000000000442' then raise exception '1: %', r.tenant_id; end if;
  select * into r from asari_next_sync('99999999-0000-0000-0000-000000000441');
  if r.api_token <> 'tok-a' or r.known <> '{}'::jsonb then raise exception '1b: %', row_to_json(r); end if;

  -- 2. Upsert: a listing typed with the same reference is taken over; new ones added; bad rows skipped.
  j := upsert_external_listings('99999999-0000-0000-0000-000000000441', 'asari', jsonb_build_array(
    jsonb_build_object('external_id', '9001', 'external_version', '2026-11-01 10:00:00', 'reference', 'WM-1', 'title', '2 pokoje, Mokotów',
      'transaction_type', 'sale', 'property_type', 'apartment', 'price', 850000, 'currency', 'PLN', 'city', 'Warszawa', 'district', 'Mokotów',
      'area_m2', 48.5, 'rooms', 2, 'floor', 3, 'photos', jsonb_build_array('https://img.asariweb.pl/normal/1'), 'raw', jsonb_build_object('id', 9001)),
    jsonb_build_object('external_id', '9002', 'external_version', 'v1', 'title', 'Dom, Józefosław', 'transaction_type', 'sale', 'property_type', 'house', 'status', 'under_offer'),
    jsonb_build_object('external_id', '', 'title', 'no id'),
    jsonb_build_object('external_id', '9003', 'title', '')));
  if j <> '{"new": 1, "updated": 1, "skipped": 2}'::jsonb then raise exception '2: %', j; end if;
  select count(*) into n from listings where tenant_id = '99999999-0000-0000-0000-000000000441';
  if n <> 2 then raise exception '2: % listings', n; end if;
  select * into r from listings where reference = 'WM-1' and tenant_id = '99999999-0000-0000-0000-000000000441';
  if r.source <> 'asari' or r.external_id <> '9001' or r.title <> '2 pokoje, Mokotów' or r.area_m2 <> 48.5 or r.photos[1] is null then
    raise exception '2: taken over %', row_to_json(r); end if;

  -- 3. Known versions come back for the next sync.
  select * into r from asari_next_sync('99999999-0000-0000-0000-000000000441');
  if r.known->>'9001' <> '2026-11-01 10:00:00' or r.known->>'9002' <> 'v1' then raise exception '3: %', r.known; end if;

  -- 4. Update keeps photos when ASARI sends none; finish withdraws what's no longer exported.
  j := upsert_external_listings('99999999-0000-0000-0000-000000000441', 'asari',
    '[{"external_id": "9001", "external_version": "v2", "title": "2 pokoje, Mokotów (nowa cena)", "price": 820000}]');
  select * into r from listings where external_id = '9001';
  if r.price <> 820000 or r.photos[1] is null or r.external_version <> 'v2' then raise exception '4: %', row_to_json(r); end if;
  j := asari_finish_sync('99999999-0000-0000-0000-000000000441', '["9001"]', null, '{"fetched": 1}');
  select count(*) into n from listings where external_id = '9002' and status = 'under_offer';
  if n <> 1 then raise exception '4: only available ones are withdrawn'; end if;
  update listings set status = 'available' where external_id = '9002';
  j := asari_finish_sync('99999999-0000-0000-0000-000000000441', '["9001"]', null, '{"fetched": 1}');
  if (j->>'withdrawn')::int <> 1 then raise exception '4b: %', j; end if;
  select * into r from asari_connections where tenant_id = '99999999-0000-0000-0000-000000000441';
  if not r.last_sync_ok or r.last_sync_counts->>'withdrawn' <> '1' or r.last_sync_at < now() - interval '1 minute' then raise exception '4c'; end if;

  -- 5. An error or an empty list withdraws nothing; the error is shown.
  update listings set status = 'available' where external_id = '9002';
  j := asari_finish_sync('99999999-0000-0000-0000-000000000441', '[]', null, '{}');
  j := asari_finish_sync('99999999-0000-0000-0000-000000000441', null, 'Wrong token', '{}');
  select count(*) into n from listings where external_id = '9002' and status = 'available';
  if n <> 1 then raise exception '5: withdrawn on error/empty'; end if;
  select * into r from asari_connections where tenant_id = '99999999-0000-0000-0000-000000000441';
  if r.last_sync_ok or r.last_sync_error <> 'Wrong token' then raise exception '5b'; end if;

  if has_table_privilege('authenticated', 'asari_connections', 'select') then raise exception '6: token readable'; end if;
  raise notice '0044 checks passed';
end $$;
rollback;
