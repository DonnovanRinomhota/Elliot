-- A stand-in for a fresh Supabase project, so every migration and test can run
-- on a plain Postgres (with pgvector) in GitHub Actions or on your machine.
--
-- It copies what matters for security from Supabase: the anon /
-- authenticated / service_role roles, the auth and storage schemas the
-- migrations refer to, and Supabase's DEFAULT PRIVILEGES (new tables, sequences
-- and functions in public are granted to anon, authenticated and service_role).
-- That default is why 0047 exists; test_0047 fails if a migration forgets it.
--
-- Not for production. Never run this on Supabase.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists btree_gist;

create schema if not exists auth;
create schema if not exists storage;
create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb$$;
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
create table if not exists auth.users (id uuid primary key, email text);
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated;
grant all on storage.objects to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
