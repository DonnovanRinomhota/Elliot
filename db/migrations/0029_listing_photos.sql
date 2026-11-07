-- 0029_listing_photos.sql
--
-- Photos for listings, stored in Supabase Storage.
--   - Bucket "listing-photos": public to read (photo links work anywhere,
--     including in the chat later), 5 MB per file, images only. The
--     dashboard shrinks photos before upload, so real files are ~300 KB.
--   - Files live under <tenant_id>/<listing_id>/<file>. Signed-in users can
--     only add, replace or delete files in their own agency's folder.
--   - listings.photos: ordered list of storage paths (or full https links
--     for photos hosted elsewhere). The first one is the cover.
--
-- One transaction; safe to run again.

begin;

alter table listings add column if not exists photos text[] not null default '{}';

comment on column listings.photos is
    'Ordered photo list: storage paths in the listing-photos bucket (<tenant_id>/<listing_id>/<file>) or full https links. First = cover. image_url is the older single-photo field, still shown when photos is empty.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "listing photos: agency uploads" on storage.objects;
drop policy if exists "listing photos: agency updates" on storage.objects;
drop policy if exists "listing photos: agency deletes" on storage.objects;
drop policy if exists "listing photos: agency reads" on storage.objects;

-- The first folder of the path must be the user's agency (or the agency a
-- platform admin is viewing): current_tenant_id() from 0015/0027.
create policy "listing photos: agency uploads" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = public.current_tenant_id()::text);

create policy "listing photos: agency updates" on storage.objects
    for update to authenticated
    using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = public.current_tenant_id()::text);

create policy "listing photos: agency deletes" on storage.objects
    for delete to authenticated
    using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = public.current_tenant_id()::text);

-- Listing files in the bucket (not needed to view photos, which are public).
create policy "listing photos: agency reads" on storage.objects
    for select to authenticated
    using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = public.current_tenant_id()::text);

commit;
