-- Scenario test for 0031 (chat contacts). Scratch database only; rolls back.
-- Ends with "0031 checks passed".
begin;

insert into tenants (id, name, slug) values
  ('ffffffff-0000-0000-0000-000000000001', 'Contact Agency A', 'contact-a-test'),
  ('ffffffff-0000-0000-0000-000000000002', 'Contact Agency B', 'contact-b-test');
insert into conversations (id, tenant_id, channel) values
  ('ffffffff-1111-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 'chat_widget'),
  ('ffffffff-1111-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001', 'chat_widget'),
  ('ffffffff-1111-0000-0000-000000000003', 'ffffffff-0000-0000-0000-000000000001', 'chat_widget');
insert into contacts (id, tenant_id, name, email, phone) values
  ('ffffffff-2222-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 'Anna', 'Anna@Example.com', null),
  ('ffffffff-2222-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001', null, null, '48601234567'),
  ('ffffffff-2222-0000-0000-000000000009', 'ffffffff-0000-0000-0000-000000000002', 'Other', 'piotr@example.com', null);

do $$
declare r jsonb; id1 uuid; n int;
begin
  -- Nothing given and nobody on the chat: not ready, nothing created.
  r := identify_chat_visitor('ffffffff-0000-0000-0000-000000000001', 'ffffffff-1111-0000-0000-000000000001', '', '', '');
  if (r->>'ready')::boolean or r->>'contact_id' is not null then raise exception 'empty visitor should not be ready: %', r; end if;

  -- Name only: saved, but not ready (no way to reach them).
  r := identify_chat_visitor('ffffffff-0000-0000-0000-000000000001', 'ffffffff-1111-0000-0000-000000000001', 'Piotr', '', '');
  if (r->>'ready')::boolean then raise exception 'name alone should not be ready'; end if;
  id1 := (r->>'contact_id')::uuid;

  -- Then a new email: same contact, now ready, chat linked. Another agency's
  -- contact with that email is not touched.
  r := identify_chat_visitor('ffffffff-0000-0000-0000-000000000001', 'ffffffff-1111-0000-0000-000000000001', 'Piotr Nowak', ' Piotr@Example.com ', 'abc');
  if not (r->>'ready')::boolean then raise exception 'name + email should be ready: %', r; end if;
  if (r->>'contact_id')::uuid <> id1 then raise exception 'made a second contact instead of completing the first'; end if;
  if r->>'email' <> 'piotr@example.com' or r->>'name' <> 'Piotr Nowak' or r->>'phone' is not null then raise exception 'wrong details: %', r; end if;
  if (select contact_id from conversations where id = 'ffffffff-1111-0000-0000-000000000001') <> id1 then raise exception 'chat not linked'; end if;
  if (select name from contacts where id = 'ffffffff-2222-0000-0000-000000000009') <> 'Other' then raise exception 'touched another agency'; end if;

  -- Later messages send nothing new: still ready from the linked contact.
  r := identify_chat_visitor('ffffffff-0000-0000-0000-000000000001', 'ffffffff-1111-0000-0000-000000000001', null, null, null);
  if not (r->>'ready')::boolean then raise exception 'linked contact should stay ready'; end if;

  -- Existing contact found by email (any case) and by phone (any format).
  r := identify_chat_visitor('ffffffff-0000-0000-0000-000000000001', 'ffffffff-1111-0000-0000-000000000002', 'Anna K', 'anna@example.com', '');
  if (r->>'contact_id')::uuid <> 'ffffffff-2222-0000-0000-000000000001' then raise exception 'email match failed'; end if;
  r := identify_chat_visitor('ffffffff-0000-0000-0000-000000000001', 'ffffffff-1111-0000-0000-000000000003', 'Marta', '', '+48 601 234 567');
  if (r->>'contact_id')::uuid <> 'ffffffff-2222-0000-0000-000000000002' then raise exception 'phone match failed: %', r; end if;
  if r->>'name' <> 'Marta' or not (r->>'ready')::boolean then raise exception 'phone contact not completed: %', r; end if;

  -- An email that belongs to someone else in the agency isn't copied onto this contact.
  perform upsert_conversation_contact('ffffffff-0000-0000-0000-000000000001', 'ffffffff-1111-0000-0000-000000000003', null, null, '48601234567');
  update contacts set email = null where id = 'ffffffff-2222-0000-0000-000000000002';
  perform upsert_conversation_contact('ffffffff-0000-0000-0000-000000000001', null, null, 'nobody-new@example.com', '48 601 234 567');
  if (select email from contacts where id = 'ffffffff-2222-0000-0000-000000000002') <> 'nobody-new@example.com' then
    raise exception 'phone contact should get a free email';
  end if;

  -- WhatsApp / email names only fill a blank.
  perform upsert_conversation_contact('ffffffff-0000-0000-0000-000000000001', null, 'Nick from WhatsApp', null, '+48601234567', null, 'whatsapp');
  if (select name from contacts where id = 'ffffffff-2222-0000-0000-000000000002') <> 'Marta' then raise exception 'WhatsApp name overwrote a real one'; end if;
  perform upsert_conversation_contact('ffffffff-0000-0000-0000-000000000001', null, 'Jan Kowalski', 'jan@example.com', null, null, 'email');
  if (select name from contacts where tenant_id = 'ffffffff-0000-0000-0000-000000000001' and email = 'jan@example.com') <> 'Jan Kowalski' then
    raise exception 'email sender not saved with their name';
  end if;

  -- The row version returns a brand-new contact on the very first call.
  if (select name from upsert_conversation_contact_row('ffffffff-0000-0000-0000-000000000001', null, 'Ewa', 'ewa@example.com', null, null, 'email')) <> 'Ewa' then
    raise exception 'row version must return a just-created contact';
  end if;

  -- No duplicates were created along the way (3 + two new email senders).
  select count(*) into n from contacts where tenant_id = 'ffffffff-0000-0000-0000-000000000001';
  if n <> 5 then raise exception 'expected 5 contacts, got %', n; end if;
end $$;

-- Not callable through the public API.
do $$
begin
  if has_function_privilege('authenticated', 'identify_chat_visitor(uuid, uuid, text, text, text, boolean)', 'execute')
     or has_function_privilege('anon', 'upsert_conversation_contact(uuid, uuid, text, text, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'upsert_conversation_contact_row(uuid, uuid, text, text, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'remove_duplicate_visitor_messages()', 'execute') then
    raise exception 'contact functions are callable through the public API';
  end if;
end $$;

-- Duplicate clean-up: copies within 10 seconds go, the first and real repeats stay.
insert into messages (tenant_id, conversation_id, role, content, created_at) values
  ('ffffffff-0000-0000-0000-000000000001', 'ffffffff-1111-0000-0000-000000000002', 'user', 'hello', '2026-10-10 15:55:00.100+02'),
  ('ffffffff-0000-0000-0000-000000000001', 'ffffffff-1111-0000-0000-000000000002', 'user', 'hello', '2026-10-10 15:55:00.200+02'),
  ('ffffffff-0000-0000-0000-000000000001', 'ffffffff-1111-0000-0000-000000000002', 'user', 'hello', '2026-10-10 15:55:00.300+02'),
  ('ffffffff-0000-0000-0000-000000000001', 'ffffffff-1111-0000-0000-000000000002', 'assistant', 'hi', '2026-10-10 15:55:02+02'),
  ('ffffffff-0000-0000-0000-000000000001', 'ffffffff-1111-0000-0000-000000000002', 'assistant', 'hi', '2026-10-10 15:55:03+02'),
  ('ffffffff-0000-0000-0000-000000000001', 'ffffffff-1111-0000-0000-000000000002', 'user', 'hello', '2026-10-10 16:30:00+02');
do $$
declare n_user int; n_asst int;
begin
  if remove_duplicate_visitor_messages() <> 2 then raise exception 'expected 2 copies removed'; end if;
  select count(*) filter (where role = 'user'), count(*) filter (where role = 'assistant') into n_user, n_asst
  from messages where conversation_id = 'ffffffff-1111-0000-0000-000000000002';
  if n_user <> 2 then raise exception 'expected 2 visitor messages left (first copy + later repeat), got %', n_user; end if;
  if n_asst <> 2 then raise exception 'Elliot''s messages must not be touched'; end if;
end $$;

select '0031 checks passed' as result;
rollback;
