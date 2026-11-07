-- Scenario test for 0030 (listing + agent on appointments). Scratch database
-- only; rolls back. Ends with "0030 checks passed".
begin;

insert into tenants (id, name, slug) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'Viewing Agency A', 'viewing-a-test'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'Viewing Agency B', 'viewing-b-test');
insert into tenant_users (id, tenant_id, auth_user_id, email, role, receives_leads) values
  ('eeeeeeee-1111-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'ola@a.test', 'agent', true),
  ('eeeeeeee-1111-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002', 'jan@a.test', 'agent', true),
  ('eeeeeeee-1111-0000-0000-000000000009', 'eeeeeeee-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000009', 'b@b.test', 'admin', true);
insert into contacts (id, tenant_id, name, email) values
  ('eeeeeeee-2222-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'Anna', 'anna@x.test'),
  ('eeeeeeee-2222-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', 'Piotr', 'piotr@x.test');
-- Anna's lead belongs to Jan; Piotr has no lead.
insert into leads (tenant_id, contact_id, assigned_to) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-2222-0000-0000-000000000001', 'eeeeeeee-1111-0000-0000-000000000002');
insert into listings (id, tenant_id, reference, title) values
  ('eeeeeeee-3333-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'W-101', 'Flat in Mokotów'),
  ('eeeeeeee-3333-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', 'W-1010', 'Flat in Wola'),
  ('eeeeeeee-3333-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000001', '7', 'Short ref'),
  ('eeeeeeee-3333-0000-0000-000000000009', 'eeeeeeee-0000-0000-0000-000000000002', 'B-1', 'Other agency flat');

do $$
declare a uuid; r record;
begin
  -- Agent from the lead owner, listing from the reference in the notes.
  -- "W-101" must not match "W-1010".
  insert into appointments (tenant_id, contact_id, starts_at, ends_at, timezone, notes)
  values ('eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-2222-0000-0000-000000000001',
          '2026-12-01 10:00+01', '2026-12-01 11:00+01', 'Europe/Warsaw', 'Viewing of w-101, bring keys')
  returning id into a;
  select * into r from appointments where id = a;
  if r.agent_id is distinct from 'eeeeeeee-1111-0000-0000-000000000002' then raise exception 'agent not taken from lead owner: %', r.agent_id; end if;
  if r.listing_id is distinct from 'eeeeeeee-3333-0000-0000-000000000001' then raise exception 'listing not found from notes: %', r.listing_id; end if;

  -- No lead, short reference "7" in notes, two references: nothing guessed.
  insert into appointments (tenant_id, contact_id, starts_at, ends_at, timezone, notes)
  values ('eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-2222-0000-0000-000000000002',
          '2026-12-01 12:00+01', '2026-12-01 13:00+01', 'Europe/Warsaw', 'Flat 7, or W-101 or W-1010')
  returning id into a;
  select * into r from appointments where id = a;
  if r.agent_id is not null then raise exception 'agent invented without a lead'; end if;
  if r.listing_id is not null then raise exception 'listing guessed from an ambiguous note'; end if;

  -- Set explicitly (as workflow 12 and the dashboard do): kept.
  update appointments set listing_id = 'eeeeeeee-3333-0000-0000-000000000002', agent_id = 'eeeeeeee-1111-0000-0000-000000000001' where id = a;
  select * into r from appointments where id = a;
  if r.listing_id <> 'eeeeeeee-3333-0000-0000-000000000002' or r.agent_id <> 'eeeeeeee-1111-0000-0000-000000000001' then raise exception 'explicit values not kept'; end if;

  -- Another agency's listing or agent: refused.
  begin
    update appointments set listing_id = 'eeeeeeee-3333-0000-0000-000000000009' where id = a;
    raise exception 'accepted another agency''s listing';
  exception when foreign_key_violation then null;
  end;
  begin
    update appointments set agent_id = 'eeeeeeee-1111-0000-0000-000000000009' where id = a;
    raise exception 'accepted another agency''s agent';
  exception when foreign_key_violation then null;
  end;

  -- Deleting the listing keeps the appointment.
  delete from listings where id = 'eeeeeeee-3333-0000-0000-000000000002';
  select * into r from appointments where id = a;
  if r.id is null or r.listing_id is not null then raise exception 'appointment lost with its listing'; end if;
end $$;

-- listing_from_text is internal: not callable through the public API.
do $$
begin
  if has_function_privilege('authenticated', 'listing_from_text(uuid, text)', 'execute') then
    raise exception 'listing_from_text is callable by signed-in users';
  end if;
end $$;

select '0030 checks passed' as result;
rollback;
