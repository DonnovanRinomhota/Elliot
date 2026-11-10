-- Scenario test for 0043 (valuation requests). Scratch database only; rolls
-- back. Ends with "0043 checks passed".
begin;

insert into tenants (id, name, slug, timezone, assistant_mode) values
  ('99999999-0000-0000-0000-000000000431', 'Agency A', 'a-431', 'Europe/Warsaw', 'agency'),
  ('99999999-0000-0000-0000-000000000432', 'Agency B', 'b-432', 'Europe/Warsaw', 'agency');
insert into ai_config (tenant_id) values ('99999999-0000-0000-0000-000000000431') on conflict (tenant_id) do nothing;
insert into contacts (id, tenant_id, name, email) values
  ('99999999-1111-0000-0000-000000000431', '99999999-0000-0000-0000-000000000431', 'Ewa', 'ewa@x.pl'),
  ('99999999-1111-0000-0000-000000000432', '99999999-0000-0000-0000-000000000431', 'Marek', 'marek@x.pl'),
  ('99999999-1111-0000-0000-000000000433', '99999999-0000-0000-0000-000000000432', 'Other', 'o@x.pl');

do $$
declare j jsonb; r record; n int;
begin
  -- 1. A seller who wants to act soon: HOT, intent sell, details kept.
  j := record_valuation_request('99999999-0000-0000-0000-000000000431', '99999999-1111-0000-0000-000000000431',
    '{"address": "ul. Puławska 10/5", "city": "Warszawa", "area_m2": 54, "rooms": 3, "within_3_months": true, "expected_price": null}');
  if j->>'status' <> 'HOT' or j->>'intent' <> 'sell' then raise exception '1: %', j; end if;
  select * into r from leads where id = (j->>'lead_id')::uuid;
  if r.qualification_answers->'valuation'->>'address' <> 'ul. Puławska 10/5' or (r.qualification_answers->'valuation'->>'area_m2')::int <> 54
     or r.qualification_answers->'valuation' ? 'expected_price' or r.qualification_answers->'valuation'->>'requested_at' is null then
    raise exception '1: details %', r.qualification_answers; end if;

  -- 2. A landlord, no hurry: WARM, intent let; more details later merge in, status never drops.
  j := record_valuation_request('99999999-0000-0000-0000-000000000431', '99999999-1111-0000-0000-000000000432', '{"intent": "rent", "address": "ul. X 1"}');
  if j->>'status' <> 'WARM' or j->>'intent' <> 'let' then raise exception '2: %', j; end if;
  j := record_valuation_request('99999999-0000-0000-0000-000000000431', '99999999-1111-0000-0000-000000000431', '{"floor": 4}');
  select * into r from leads where id = (j->>'lead_id')::uuid;
  if r.status <> 'HOT' or r.qualification_answers->'valuation'->>'address' <> 'ul. Puławska 10/5' or (r.qualification_answers->'valuation'->>'floor')::int <> 4 then
    raise exception '2: merge %', row_to_json(r); end if;
  select count(*) into n from leads where contact_id = '99999999-1111-0000-0000-000000000431';
  if n <> 1 then raise exception '2: duplicate lead'; end if;

  -- 3. Only the agency's own contacts.
  begin
    perform record_valuation_request('99999999-0000-0000-0000-000000000431', '99999999-1111-0000-0000-000000000433', '{}');
    raise exception '3: other agency''s contact accepted';
  exception when raise_exception then if sqlerrm like '3:%' then raise; end if;
  end;

  -- 4. Appointment kinds; changes and reminders see them.
  insert into appointments (tenant_id, contact_id, starts_at, ends_at, timezone, status, kind, location) values
    ('99999999-0000-0000-0000-000000000431', '99999999-1111-0000-0000-000000000431',
     ((now() at time zone 'Europe/Warsaw')::date + 1 + time '10:00') at time zone 'Europe/Warsaw',
     ((now() at time zone 'Europe/Warsaw')::date + 1 + time '11:00') at time zone 'Europe/Warsaw', 'Europe/Warsaw', 'confirmed', 'valuation', 'ul. Puławska 10/5, Warszawa');
  select * into r from due_viewing_reminders() where contact_name = 'Ewa';
  if r.kind <> 'valuation' or r.location <> 'ul. Puławska 10/5, Warszawa' then raise exception '4: reminders %', row_to_json(r); end if;
  select * into r from client_appointment('99999999-0000-0000-0000-000000000431', '99999999-1111-0000-0000-000000000431',
    (select id from appointments where contact_id = '99999999-1111-0000-0000-000000000431'));
  if r.kind <> 'valuation' or r.location is null then raise exception '4: change %', row_to_json(r); end if;
  begin
    insert into appointments (tenant_id, contact_id, starts_at, ends_at, timezone, kind) values
      ('99999999-0000-0000-0000-000000000431', '99999999-1111-0000-0000-000000000432', now() + interval '5 days', now() + interval '5 days 1 hour', 'Europe/Warsaw', 'party');
    raise exception '4: odd kind accepted';
  exception when check_violation then null;
  end;

  if has_function_privilege('authenticated', 'record_valuation_request(uuid, uuid, jsonb)', 'execute') then raise exception '5: open to agencies'; end if;
  raise notice '0043 checks passed';
end $$;
rollback;
