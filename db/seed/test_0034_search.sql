-- Scenario test for 0034 (search that finds what's there, closest options,
-- upcoming viewings). Scratch database only; rolls back.
-- Ends with "0034 checks passed".
begin;

insert into tenants (id, name, slug, timezone) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Search Agency', 'search-test', 'Europe/Warsaw');
insert into listings (id, tenant_id, reference, title, status, transaction_type, property_type, price, city, district, address, rooms, bedrooms, photos) values
  ('bbbbbbbb-3333-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'S-1', 'Studio flat', 'available', 'rent', 'apartment', 2200, 'Warszawa', 'Białołęka', 'Płochocińska 16A/72', 1, null, array['a.jpg']),
  ('bbbbbbbb-3333-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'S-2', '2-room flat', 'available', 'rent', 'apartment', 5800, 'Warszawa', 'Mokotów', 'Bukowińska 24D m. 21', 2, null, '{}'),
  ('bbbbbbbb-3333-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'S-3', 'Flat in the centre', 'available', 'rent', 'apartment', 3900, 'Warszawa', 'Śródmieście', 'Marszałkowska 10', 2, 1, '{}'),
  ('bbbbbbbb-3333-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001', 'S-4', 'House for sale', 'available', 'sale', 'house', 2500000, 'Piaseczno', null, null, 5, 4, '{}');
insert into contacts (id, tenant_id, name, phone) values
  ('bbbbbbbb-2222-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Don', '+48601000222');
insert into conversations (id, tenant_id, contact_id, channel) values
  ('bbbbbbbb-1111-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-2222-0000-0000-000000000001', 'whatsapp');
insert into appointments (tenant_id, contact_id, listing_id, starts_at, ends_at, timezone, status) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-2222-0000-0000-000000000001', 'bbbbbbbb-3333-0000-0000-000000000001',
   ((current_date + 2)::timestamp at time zone 'Europe/Warsaw') + interval '14 hours', ((current_date + 2)::timestamp at time zone 'Europe/Warsaw') + interval '15 hours', 'Europe/Warsaw', 'confirmed'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-2222-0000-0000-000000000001', 'bbbbbbbb-3333-0000-0000-000000000002',
   now() + interval '3 days', now() + interval '3 days 1 hour', 'Europe/Warsaw', 'cancelled'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-2222-0000-0000-000000000001', 'bbbbbbbb-3333-0000-0000-000000000003',
   now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'Europe/Warsaw', 'confirmed');

do $$
declare r jsonb; refs text;
begin
  -- "mokotow" without the Polish letter finds Mokotów.
  r := search_listings('bbbbbbbb-0000-0000-0000-000000000001', '{"transaction_type":"rent","location":"mokotow"}');
  if (r->>'count')::int <> 1 or r->'listings'->0->>'reference' <> 'S-2' then raise exception 'mokotow: %', r; end if;

  -- "close to the center" / "centrum" mean Śródmieście.
  r := search_listings('bbbbbbbb-0000-0000-0000-000000000001', '{"transaction_type":"rent","location":"close to the center"}');
  if r->'listings'->0->>'reference' <> 'S-3' then raise exception 'centre: %', r; end if;
  r := search_listings('bbbbbbbb-0000-0000-0000-000000000001', '{"location":"Centrum"}');
  if r->'listings'->0->>'reference' <> 'S-3' then raise exception 'centrum: %', r; end if;

  -- 1-bedroom: a 2-room flat without bedrooms filled in counts; a studio doesn't.
  r := search_listings('bbbbbbbb-0000-0000-0000-000000000001', '{"transaction_type":"rent","min_bedrooms":1}');
  select string_agg(x->>'reference', ',' order by x->>'reference') into refs from jsonb_array_elements(r->'listings') x;
  if refs <> 'S-2,S-3' then raise exception '1-bedroom: %', refs; end if;

  -- "3000 PLN" as a price doesn't break anything.
  r := search_listings('bbbbbbbb-0000-0000-0000-000000000001', '{"transaction_type":"rent","max_price":"3 000 PLN"}');
  if r->'listings'->0->>'reference' <> 'S-1' then raise exception 'price text: %', r; end if;

  -- Nothing exact (1-bedroom in Mokotów up to 3000): closest real options,
  -- same area first, rentals only, never the house for sale.
  r := search_listings('bbbbbbbb-0000-0000-0000-000000000001', '{"transaction_type":"rent","location":"Mokotow","max_price":3000,"min_bedrooms":1}');
  if (r->>'found')::boolean or (r->>'count')::int <> 0 then raise exception 'should be no exact match: %', r; end if;
  if jsonb_array_length(r->'alternatives') <> 3 then raise exception 'expected 3 alternatives: %', r->'alternatives'; end if;
  if r->'alternatives'->0->>'reference' <> 'S-2' then raise exception 'same area first: %', r->'alternatives'; end if;
  if exists (select 1 from jsonb_array_elements(r->'alternatives') x where x->>'transaction_type' <> 'rent') then raise exception 'alternatives mixed buy and rent'; end if;
  -- Exact matches: no alternatives.
  r := search_listings('bbbbbbbb-0000-0000-0000-000000000001', '{"transaction_type":"rent"}');
  if jsonb_array_length(r->'alternatives') <> 0 then raise exception 'alternatives with exact matches: %', r; end if;
  -- A quoted reference that doesn't exist: no guessing.
  r := search_listings('bbbbbbbb-0000-0000-0000-000000000001', '{"reference":"NOPE"}');
  if jsonb_array_length(r->'alternatives') <> 0 then raise exception 'reference search should not suggest others'; end if;

  -- Upcoming viewings: only confirmed and not over, with the property.
  r := identify_chat_visitor('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-1111-0000-0000-000000000001', null, null, null, true); -- 0047: verified channel
  if jsonb_array_length(r->'upcoming_viewings') <> 1 then raise exception 'viewings: %', r->'upcoming_viewings'; end if;
  if r->'upcoming_viewings'->0->>'title' <> 'Studio flat'
     or r->'upcoming_viewings'->0->>'listing_id' <> 'bbbbbbbb-3333-0000-0000-000000000001'
     or r->'upcoming_viewings'->0->>'address' <> 'Płochocińska 16A/72, Białołęka, Warszawa'
     or r->'upcoming_viewings'->0->>'when' !~ ', 14:00$' then
    raise exception 'viewing details: %', r->'upcoming_viewings'->0;
  end if;
  if not (r->>'ready')::boolean then raise exception 'still ready'; end if;

  raise notice '0034 checks passed';
end $$;

rollback;
