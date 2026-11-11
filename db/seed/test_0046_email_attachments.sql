-- Scenario test for 0046 (email attachments). Scratch database only; rolls
-- back. Ends with "0046 checks passed".
begin;
insert into tenants (id, name, slug, timezone, assistant_mode) values
  ('99999999-0000-0000-0000-000000000461', 'Agency A', 'a-461', 'Europe/Warsaw', 'agency'),
  ('99999999-0000-0000-0000-000000000462', 'Agency B', 'b-462', 'Europe/Warsaw', 'agency');
insert into tenant_users (tenant_id, auth_user_id, email, role) values
  ('99999999-0000-0000-0000-000000000461', 'aaaaaaaa-0000-0000-0000-000000000461', 'agent@a.pl', 'agent'),
  ('99999999-0000-0000-0000-000000000462', 'bbbbbbbb-0000-0000-0000-000000000462', 'agent@b.pl', 'agent');
insert into contacts (id, tenant_id, name, email) values
  ('99999999-1111-0000-0000-000000000461', '99999999-0000-0000-0000-000000000461', 'Anna', 'anna@x.pl');
insert into conversations (id, tenant_id, contact_id, channel) values
  ('99999999-2222-0000-0000-000000000461', '99999999-0000-0000-0000-000000000461', '99999999-1111-0000-0000-000000000461', 'email');

create or replace function pg_temp.as_user(p_uid text, p_email text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid, true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'email', p_email, 'aal', 'aal1')::text, true);
$$;

-- 1. Workflow 16/40's Record Attachment (its real query), twice: the second
--    run (Gmail handing the email over again) updates, never duplicates.
-- 0046: the file, for the conversation page (uploaded = Storage accepted it).
insert into message_attachments (tenant_id, conversation_id, email_message_id, filename, content_type, size_bytes, storage_path, uploaded, read_by_elliot)
values ('99999999-0000-0000-0000-000000000461'::uuid, '99999999-2222-0000-0000-000000000461'::uuid, nullif('<m1@x>', ''), 'plan.pdf', 'application/pdf', 123456::bigint, '99999999-0000-0000-0000-000000000461/c/1-plan.pdf', true::boolean, true::boolean)
on conflict (storage_path) do update set uploaded = excluded.uploaded
returning id;
-- 0046: the file, for the conversation page (uploaded = Storage accepted it).
insert into message_attachments (tenant_id, conversation_id, email_message_id, filename, content_type, size_bytes, storage_path, uploaded, read_by_elliot)
values ('99999999-0000-0000-0000-000000000461'::uuid, '99999999-2222-0000-0000-000000000461'::uuid, nullif('<m1@x>', ''), 'plan.pdf', 'application/pdf', 123456::bigint, '99999999-0000-0000-0000-000000000461/c/1-plan.pdf', false::boolean, false::boolean)
on conflict (storage_path) do update set uploaded = excluded.uploaded
returning id;

do $$
declare r message_attachments; n int;
begin
  select count(*) into n from message_attachments where tenant_id = '99999999-0000-0000-0000-000000000461';
  if n <> 1 then raise exception '1: % rows', n; end if;
  select * into r from message_attachments where tenant_id = '99999999-0000-0000-0000-000000000461';
  if r.filename <> 'plan.pdf' or r.size_bytes <> 123456 or r.uploaded or not r.read_by_elliot or r.email_message_id <> '<m1@x>' then
    raise exception '1: %', row_to_json(r); end if;
  if (select public from storage.buckets where id = 'email-attachments') then raise exception '1: bucket is public'; end if;
end $$;

-- 2. Agencies see only their own files and can't write any.
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000461', 'agent@a.pl');
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from message_attachments;
  if n <> 1 then raise exception '2: agency A sees % files', n; end if;
  begin
    insert into message_attachments (tenant_id, filename, storage_path) values ('99999999-0000-0000-0000-000000000461', 'x', 'x');
    raise exception '2: wrote a row directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000462', 'agent@b.pl');
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from message_attachments;
  if n <> 0 then raise exception '2b: agency B sees agency A''s files'; end if;
  raise notice '0046 checks passed';
end $$;
reset role;
rollback;
