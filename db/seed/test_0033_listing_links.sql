-- Scenario test for 0033 (property links, booking details, hand-over
-- context). Scratch database only; rolls back. Ends with "0033 checks passed".
begin;

insert into tenants (id, name, slug, timezone) values
  ('cccccccc-0000-0000-0000-000000000001', 'Links Agency A', 'links-a-test', 'Europe/Warsaw'),
  ('cccccccc-0000-0000-0000-000000000002', 'Links Agency B', 'links-b-test', 'Europe/Warsaw');
insert into contacts (id, tenant_id, name, email, phone) values
  ('cccccccc-2222-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Don', null, '+48601000111');
insert into conversations (id, tenant_id, contact_id, channel) values
  ('cccccccc-1111-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'cccccccc-2222-0000-0000-000000000001', 'whatsapp'),
  ('cccccccc-1111-0000-0000-000000000009', 'cccccccc-0000-0000-0000-000000000002', null, 'chat_widget');
insert into messages (tenant_id, conversation_id, role, content, created_at) values
  ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-1111-0000-0000-000000000001', 'user', 'Studio to rent up to 3000', now() - interval '10 minutes'),
  ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-1111-0000-0000-000000000001', 'assistant', 'Here are two studios', now() - interval '9 minutes'),
  ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-1111-0000-0000-000000000001', 'system', 'Simon joined the conversation.', now() - interval '8 minutes'),
  ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-1111-0000-0000-000000000001', 'human_agent', 'Photos coming', now() - interval '7 minutes');
insert into listings (id, tenant_id, reference, title, status, transaction_type, property_type, price, city, district, address, photos, image_url, url) values
  ('cccccccc-3333-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'LA-1', 'Studio Płochocińska', 'available', 'rent', 'apartment', 2200, 'Warszawa', 'Białołęka', 'Płochocińska 16A/72',
   array['cccccccc-0000-0000-0000-000000000001/cccccccc-3333-0000-0000-000000000001/a.jpg', 'https://example.com/b.jpg'], null, null),
  ('cccccccc-3333-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 'LA-2', 'Room Krochmalna', 'available', 'rent', 'room', 1800, 'Warszawa', 'Wola', 'Krochmalna 3',
   '{}', 'https://example.com/old.jpg', 'https://agency.example/krochmalna'),
  ('cccccccc-3333-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001', 'LA-3', 'Sold flat', 'sold', 'sale', 'apartment', 900000, 'Warszawa', 'Wola', 'Wolska 1',
   '{}', null, null);

do $$
declare r jsonb; l jsonb; n int; appt uuid;
begin
  -- 1. search_listings returns the address and the photo count.
  r := search_listings('cccccccc-0000-0000-0000-000000000001', '{"transaction_type":"rent","max_price":3000}');
  if (r->>'count')::int <> 2 then raise exception 'expected 2 rentals: %', r; end if;
  select x into l from jsonb_array_elements(r->'listings') x where x->>'reference' = 'LA-1';
  if (l->>'photo_count')::int <> 2 or l->>'address' <> 'Płochocińska 16A/72' then raise exception 'LA-1 wrong: %', l; end if;
  select x into l from jsonb_array_elements(r->'listings') x where x->>'reference' = 'LA-2';
  if (l->>'photo_count')::int <> 1 or l->>'url' <> 'https://agency.example/krochmalna' then raise exception 'LA-2 wrong (old image_url counts): %', l; end if;

  -- 2. The public page: available listings only, no internal fields.
  r := public_listing('cccccccc-3333-0000-0000-000000000001');
  if r->>'title' <> 'Studio Płochocińska' or r->>'agency' <> 'Links Agency A' or jsonb_array_length(r->'photos') <> 2 then
    raise exception 'public listing wrong: %', r;
  end if;
  if r ? 'times_suggested' or r ? 'tenant_id' then raise exception 'public listing leaks internal fields: %', r; end if;
  if public_listing('cccccccc-3333-0000-0000-000000000003') is not null then raise exception 'sold listing should not be public'; end if;
  if public_listing('cccccccc-9999-0000-0000-000000000000') is not null then raise exception 'unknown id should be null'; end if;
  update tenants set status = 'suspended' where id = 'cccccccc-0000-0000-0000-000000000001';
  if public_listing('cccccccc-3333-0000-0000-000000000001') is not null then raise exception 'suspended agency should not be public'; end if;
  update tenants set status = 'active' where id = 'cccccccc-0000-0000-0000-000000000001';

  -- 3. Appointments keep the conversation they were booked in; another
  --    agency's conversation is dropped, not stored.
  insert into appointments (tenant_id, contact_id, starts_at, ends_at, timezone, status, conversation_id)
  values ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-2222-0000-0000-000000000001',
          now() + interval '2 days', now() + interval '2 days 1 hour', 'Europe/Warsaw', 'confirmed',
          'cccccccc-1111-0000-0000-000000000001')
  returning id into appt;
  if (select conversation_id from appointments where id = appt) <> 'cccccccc-1111-0000-0000-000000000001' then raise exception 'conversation not stored'; end if;
  update appointments set conversation_id = 'cccccccc-1111-0000-0000-000000000009' where id = appt;
  if (select conversation_id from appointments where id = appt) is not null then raise exception 'kept another agency''s conversation'; end if;

  -- 4. Hand-over context: client details and the transcript, oldest first.
  r := escalation_context('cccccccc-0000-0000-0000-000000000001', 'cccccccc-1111-0000-0000-000000000001');
  if r->>'channel' <> 'whatsapp' or r->>'contact_name' <> 'Don' or r->>'contact_phone' <> '+48601000111' then raise exception 'context wrong: %', r; end if;
  if position('Don: Studio to rent up to 3000' in r->>'transcript') = 0
     or position('Elliot: Here are two studios' in r->>'transcript') = 0
     or position('Team: Photos coming' in r->>'transcript') = 0
     or position('Note: Simon joined' in r->>'transcript') = 0 then
    raise exception 'transcript wrong: %', r->>'transcript';
  end if;
  if position('Studio to rent' in r->>'transcript') > position('Photos coming' in r->>'transcript') then raise exception 'transcript not oldest first'; end if;
  r := escalation_context('cccccccc-0000-0000-0000-000000000001', 'cccccccc-1111-0000-0000-000000000001', 2);
  if position('Studio to rent' in r->>'transcript') > 0 then raise exception 'limit should keep only the latest messages'; end if;
  if escalation_context('cccccccc-0000-0000-0000-000000000002', 'cccccccc-1111-0000-0000-000000000001') is not null then
    raise exception 'other agency must not read this conversation';
  end if;

  raise notice '0033 checks passed';
end $$;

rollback;
