-- Scenario test for 0028. Scratch database only; rolls back at the end.
-- Ends with "0028 checks passed".
begin;

insert into tenants (id, name, slug, plan) values
  ('cccccccc-0000-0000-0000-000000000001', 'Rooms Agency', 'rooms-agency-test', 'trial');
insert into tenant_users (id, tenant_id, auth_user_id, email, role) values
  ('cccccccc-1000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 'boss@rooms.test', 'admin');

-- Import as the agency admin.
select set_config('app.current_tenant', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-0000-0000-0000-000000000001', true);

do $$
declare r jsonb;
begin
  r := import_listings(format('[
    {"reference":"Batorego 29 / 1","title":"Single room, Batorego 29","transaction_type":"rent","property_type":"room","price":1700,"district":"Mokotów","city":"Warszawa"},
    {"reference":"Batorego 29 / 2","title":"Single room with balcony, Batorego 29","transaction_type":"rent","property_type":"room","price":2100,"district":"Mokotów","city":"Warszawa","features":["balcony"],"available_from":"%s"},
    {"reference":"Bruna 28 / 1","title":"Single room, Bruna 28","transaction_type":"rent","property_type":"room","price":1550,"district":"Mokotów","city":"Warszawa","available_from":"%s"},
    {"reference":"Andersa 16 / 1","title":"2-room flat, Andersa 16","transaction_type":"rent","property_type":"apartment","price":4700,"rooms":2,"district":"Centrum","city":"Warszawa","description":"Near metro Arsenał"}
  ]', current_date + 20, current_date + 300)::jsonb);
  if r <> '{"inserted": 4, "updated": 0, "withdrawn": 0}'::jsonb then raise exception 'first import %', r; end if;

  -- A hand-added listing without a reference must survive "withdraw missing".
  insert into listings (tenant_id, title, transaction_type, property_type, price)
  values ('cccccccc-0000-0000-0000-000000000001', 'Hand-added flat', 'rent', 'apartment', 3000);

  -- Weekly re-upload: Bruna is gone, Batorego 1 changed price.
  r := import_listings('[
    {"reference":"Batorego 29 / 1","title":"Single room, Batorego 29","transaction_type":"rent","property_type":"room","price":1750,"district":"Mokotów","city":"Warszawa"},
    {"reference":"Batorego 29 / 2","title":"Single room with balcony, Batorego 29","transaction_type":"rent","property_type":"room","price":2100,"district":"Mokotów","city":"Warszawa"},
    {"reference":"Andersa 16 / 1","title":"2-room flat, Andersa 16","transaction_type":"rent","property_type":"apartment","price":4700,"rooms":2,"district":"Centrum","city":"Warszawa","description":"Near metro Arsenał"}
  ]'::jsonb, true);
  if r <> '{"inserted": 0, "updated": 3, "withdrawn": 1}'::jsonb then raise exception 're-import %', r; end if;
  if (select status from listings where reference = 'Bruna 28 / 1') <> 'withdrawn' then raise exception 'Bruna not withdrawn'; end if;
  if (select status from listings where title = 'Hand-added flat') <> 'available' then raise exception 'hand-added listing touched'; end if;
  if (select price from listings where reference = 'Batorego 29 / 1') <> 1750 then raise exception 'price not updated'; end if;
  if (select available_from from listings where reference = 'Batorego 29 / 2') is not null then raise exception 'available_from not cleared'; end if;
end $$;

reset role;
select set_config('app.current_tenant', '', true);

-- Put an availability date back for the search checks.
update listings set available_from = current_date + 20 where reference = 'Batorego 29 / 2';
update listings set status = 'available', available_from = current_date + 300 where reference = 'Bruna 28 / 1';

do $$
declare r jsonb;
begin
  -- Default: free within 60 days. Bruna (300 days away) is left out.
  r := search_listings('cccccccc-0000-0000-0000-000000000001', '{"location":"Mokotów"}');
  if (r->>'count')::int <> 2 then raise exception 'default window %', r; end if;
  -- Free-now listing first, and only future dates are reported.
  if r->'listings'->0->>'reference' <> 'Batorego 29 / 1' or r->'listings'->0->'available_from' <> 'null'::jsonb then
    raise exception 'order or available_from wrong %', r;
  end if;
  if (r->'listings'->1->>'available_from')::date <> current_date + 20 then raise exception 'future date missing %', r; end if;

  -- A visitor moving in next year sees Bruna too.
  r := search_listings('cccccccc-0000-0000-0000-000000000001', format('{"location":"Mokotów","move_in_by":"%s"}', current_date + 365)::jsonb);
  if (r->>'count')::int <> 3 then raise exception 'move_in_by %', r; end if;

  -- A visitor who must move in within a week only gets the free-now room.
  r := search_listings('cccccccc-0000-0000-0000-000000000001', format('{"location":"Mokotów","move_in_by":"%s"}', current_date + 7)::jsonb);
  if (r->>'count')::int <> 1 then raise exception 'move in soon %', r; end if;

  -- A garbled date from the model falls back to the default window.
  r := search_listings('cccccccc-0000-0000-0000-000000000001', '{"location":"Mokotów","move_in_by":"next spring"}');
  if (r->>'count')::int <> 2 then raise exception 'bad date %', r; end if;

  -- Location also matches the description ("near metro Arsenał").
  r := search_listings('cccccccc-0000-0000-0000-000000000001', '{"location":"Arsenał"}');
  if (r->>'count')::int <> 1 then raise exception 'description location %', r; end if;
end $$;

-- Still not callable from the public API.
set local role authenticated;
do $$
begin
  perform search_listings('cccccccc-0000-0000-0000-000000000001', '{}');
  raise exception 'search_listings must not be callable by authenticated';
exception when insufficient_privilege then null;
end $$;
reset role;

select '0028 checks passed' as result;
rollback;
