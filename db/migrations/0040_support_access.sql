-- 0040_support_access.sql
--
-- The Elliot team (platform admins) can open an agency's dashboard only while
-- that agency allows it, and the agency sees every visit.
--
--   * support_access_grants: an agency admin turns support access on in
--     Settings for 24 hours, 7 days or 30 days (set-up), and off at any time.
--   * current_tenant_id() / current_admin_view(): a platform admin's "view as"
--     only counts while the agency's grant is active AND the admin signed in
--     with two-step verification (aal2). Otherwise the admin sees only their
--     own agency, as everyone else does. Elliot's own accounts (the sales and
--     demo agencies) need no grant.
--   * new agencies start with a 30-day set-up window (nobody there to click
--     "Allow" yet); existing agencies start with access off.
--   * support_access_log: which parts of the dashboard support opened, and
--     when (written on each page visit, at most once per part per 30 minutes),
--     shown to the agency in Settings.
--
-- The control panel itself shows business figures only (accounts, plans,
-- usage counts, health); it never needed the agency's client data.
-- One transaction; safe to run again.

begin;

-- Supabase provides auth.jwt(); defined here only where it's missing (local
-- test databases), reading the same setting Supabase does.
do $$
begin
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'auth' and p.proname = 'jwt') then
        execute $f$create function auth.jwt() returns jsonb language sql stable as
            'select coalesce(nullif(current_setting(''request.jwt.claims'', true), ''''), ''{}'')::jsonb'$f$;
    end if;
end $$;

-- ── 1. Grants ──
create table if not exists support_access_grants (
    tenant_id        uuid primary key references tenants(id) on delete cascade,
    granted_by       uuid,
    granted_by_email text,
    granted_at       timestamptz not null default now(),
    expires_at       timestamptz not null
);
comment on table support_access_grants is 'An agency allowing Elliot support into its dashboard until expires_at (Settings → Elliot support access).';
alter table support_access_grants enable row level security;
revoke all on support_access_grants from anon, authenticated;
grant select on support_access_grants to authenticated;
drop policy if exists tenant_read_support_access_grants on support_access_grants;
create policy tenant_read_support_access_grants on support_access_grants
    for select using (tenant_id = current_tenant_id());

-- ── 2. Visits ──
create table if not exists support_access_log (
    id          bigserial primary key,
    tenant_id   uuid not null references tenants(id) on delete cascade,
    admin_email text not null,
    section     text not null,
    path        text not null,
    viewed_at   timestamptz not null default now()
);
create index if not exists idx_support_access_log_tenant on support_access_log(tenant_id, viewed_at desc);
comment on table support_access_log is 'Each part of an agency''s dashboard Elliot support opened (at most once per part per 30 minutes).';
alter table support_access_log enable row level security;
revoke all on support_access_log from anon, authenticated;
grant select on support_access_log to authenticated;
drop policy if exists tenant_read_support_access_log on support_access_log;
create policy tenant_read_support_access_log on support_access_log
    for select using (tenant_id = current_tenant_id());

-- ── 3. Is support allowed in right now? ──
create or replace function support_access_active(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from tenants t where t.id = p_tenant_id and t.assistant_mode <> 'agency')
        or exists (select 1 from support_access_grants g where g.tenant_id = p_tenant_id and g.expires_at > now());
$$;
revoke all on function support_access_active(uuid) from public, anon;
grant execute on function support_access_active(uuid) to authenticated;

-- ── 4. "View as" needs the agency's permission and a two-step sign-in ──
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(
    nullif(current_setting('app.current_tenant', true), '')::uuid,
    (select v.tenant_id from platform_admin_views v
      where v.auth_user_id = auth.uid() and v.expires_at > now()
        and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
        and support_access_active(v.tenant_id)),
    (select tenant_id from tenant_users where auth_user_id = auth.uid() limit 1)
  );
$function$;

create or replace function public.current_admin_view()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select v.tenant_id from platform_admin_views v
    where v.auth_user_id = auth.uid() and v.expires_at > now()
      and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      and support_access_active(v.tenant_id);
$$;

-- ── 5. The agency turns it on and off (its own admins only) ──
create or replace function grant_support_access(p_hours integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := current_tenant_id();
    v_email text;
    v_until timestamptz;
begin
    if current_admin_view() is not null then
        raise exception 'Only the agency can allow support access';
    end if;
    select email into v_email from tenant_users
     where auth_user_id = auth.uid() and tenant_id = v_tenant and role = 'admin' and removed_at is null;
    if not found then
        raise exception 'Only an agency admin can allow support access';
    end if;
    if p_hours not in (24, 168, 720) then
        raise exception 'Choose 24 hours, 7 days or 30 days';
    end if;
    v_until := now() + make_interval(hours => p_hours);
    insert into support_access_grants (tenant_id, granted_by, granted_by_email, granted_at, expires_at)
    values (v_tenant, auth.uid(), v_email, now(), v_until)
    on conflict (tenant_id) do update
       set granted_by = excluded.granted_by, granted_by_email = excluded.granted_by_email,
           granted_at = excluded.granted_at, expires_at = excluded.expires_at;
    insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
    values (v_tenant, 'tenant_user', v_email, 'support.access_granted', jsonb_build_object('hours', p_hours, 'until', v_until));
    return v_until;
end;
$$;
revoke all on function grant_support_access(integer) from public, anon;
grant execute on function grant_support_access(integer) to authenticated;

create or replace function revoke_support_access()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := current_tenant_id();
    v_email text;
begin
    if current_admin_view() is not null then
        raise exception 'Only the agency can turn support access off';
    end if;
    select email into v_email from tenant_users
     where auth_user_id = auth.uid() and tenant_id = v_tenant and role = 'admin' and removed_at is null;
    if not found then
        raise exception 'Only an agency admin can turn support access off';
    end if;
    delete from support_access_grants where tenant_id = v_tenant;
    delete from platform_admin_views where tenant_id = v_tenant; -- anyone inside leaves now
    insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
    values (v_tenant, 'tenant_user', v_email, 'support.access_revoked', '{}'::jsonb);
end;
$$;
revoke all on function revoke_support_access() from public, anon;
grant execute on function revoke_support_access() to authenticated;

-- ── 5b. Set-up window for new agencies ──
-- A new agency has nobody to click "Allow" yet, while Elliot is being set up
-- for it (listings, knowledge, settings). It starts with 30 days of support
-- access, shown in its Settings as "Elliot set-up"; it can turn it off at once.
create or replace function grant_setup_support_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.assistant_mode = 'agency' then
        insert into support_access_grants (tenant_id, granted_by_email, expires_at)
        values (new.id, 'Elliot set-up', now() + interval '30 days')
        on conflict (tenant_id) do nothing;
    end if;
    return new;
end;
$$;
drop trigger if exists trg_tenants_setup_support_access on tenants;
create trigger trg_tenants_setup_support_access after insert on tenants
    for each row execute function grant_setup_support_access();

-- ── 6. Record a visit (called by the dashboard on every page a platform admin opens) ──
create or replace function log_support_visit(p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := current_admin_view();
    v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
    v_path text := left(coalesce(nullif(btrim(p_path), ''), '/'), 200);
    v_section text;
begin
    if v_tenant is null or v_email = '' then
        return; -- not looking at another agency: nothing to record
    end if;
    v_section := case
        when v_path = '/' then 'Overview'
        when v_path like '/dashboard/%' then
            coalesce(nullif(initcap(replace(split_part(v_path, '/', 3), '-', ' ')), ''), 'Overview')
        else 'Dashboard' end;
    if exists (select 1 from support_access_log
               where tenant_id = v_tenant and admin_email = v_email and section = v_section
                 and viewed_at > now() - interval '30 minutes') then
        return;
    end if;
    insert into support_access_log (tenant_id, admin_email, section, path) values (v_tenant, v_email, v_section, v_path);
end;
$$;
revoke all on function log_support_visit(text) from public, anon;
grant execute on function log_support_visit(text) to authenticated;

commit;
