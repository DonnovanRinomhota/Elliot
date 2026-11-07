-- Scenario test for 0029 (listing photos). Scratch database only; rolls back.
-- Ends with "0029 checks passed".
begin;

insert into tenants (id, name, slug) values
  ('dddddddd-0000-0000-0000-000000000001', 'Photo Agency A', 'photo-a-test'),
  ('dddddddd-0000-0000-0000-000000000002', 'Photo Agency B', 'photo-b-test');
insert into tenant_users (tenant_id, auth_user_id, email, role) values
  ('dddddddd-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'a@photos.test', 'admin'),
  ('dddddddd-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000002', 'b@photos.test', 'admin');

do $$
begin
  if not (select public from storage.buckets where id = 'listing-photos') then raise exception 'bucket must be public'; end if;
  if (select file_size_limit from storage.buckets where id = 'listing-photos') <> 5242880 then raise exception 'size limit'; end if;
end $$;

select set_config('app.current_tenant', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-0000-0000-0000-000000000001', true);

do $$
declare n int;
begin
  -- Own folder: allowed.
  insert into storage.objects (bucket_id, name) values ('listing-photos', 'dddddddd-0000-0000-0000-000000000001/l1/a.jpg');
  -- Another agency's folder: refused.
  begin
    insert into storage.objects (bucket_id, name) values ('listing-photos', 'dddddddd-0000-0000-0000-000000000002/l9/x.jpg');
    raise exception 'uploaded into another agency''s folder';
  exception when insufficient_privilege then null;
  end;
  -- Top level, no agency folder: refused.
  begin
    insert into storage.objects (bucket_id, name) values ('listing-photos', 'loose.jpg');
    raise exception 'uploaded outside any agency folder';
  exception when insufficient_privilege then null;
  end;

  -- Listing photos column.
  insert into listings (tenant_id, title, photos) values
    ('dddddddd-0000-0000-0000-000000000001', 'With photos', array['dddddddd-0000-0000-0000-000000000001/l1/a.jpg', 'https://example.com/b.jpg']);
  if (select photos[1] from listings where title = 'With photos') <> 'dddddddd-0000-0000-0000-000000000001/l1/a.jpg' then
    raise exception 'photos not stored in order';
  end if;
end $$;

-- Agency B can't see or delete A's files.
select set_config('request.jwt.claim.sub', '44444444-0000-0000-0000-000000000002', true);
do $$
declare n int;
begin
  select count(*) into n from storage.objects where bucket_id = 'listing-photos';
  if n <> 0 then raise exception 'agency B sees % of A''s files', n; end if;
  delete from storage.objects where name like 'dddddddd-0000-0000-0000-000000000001/%';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'agency B deleted A''s files'; end if;
end $$;
reset role;

-- Re-importing a listing keeps its photos (import_listings doesn't touch them).
select set_config('app.current_tenant', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-0000-0000-0000-000000000001', true);
do $$
begin
  update listings set reference = 'P-1' where title = 'With photos';
  perform import_listings('[{"reference":"P-1","title":"With photos, renamed","price":100}]'::jsonb);
  if (select cardinality(photos) from listings where reference = 'P-1') <> 2 then raise exception 'import wiped photos'; end if;
end $$;
reset role;

select '0029 checks passed' as result;
rollback;
