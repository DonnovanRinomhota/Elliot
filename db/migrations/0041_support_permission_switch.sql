-- 0041_support_permission_switch.sql
--
-- A switch for 0040's "support access only with the agency's permission":
-- off during testing (the platform admin opens any agency's dashboard, still
-- with two-step sign-in, and visits are still recorded), on once real
-- clients are live. Flipped in the control panel (Agencies page); no deploy.
-- One transaction; safe to run again.

begin;

create table if not exists platform_settings (
    id                          boolean primary key default true check (id),
    support_permission_required boolean not null default false,
    updated_at                  timestamptz not null default now(),
    updated_by                  text
);
comment on table platform_settings is 'Platform-wide switches (one row). support_permission_required: agencies must allow support access before a platform admin can open their dashboard (0040).';
insert into platform_settings (id) values (true) on conflict (id) do nothing;
alter table platform_settings enable row level security;
revoke all on platform_settings from anon, authenticated;

-- Readable by any signed-in user (Settings shows whether permission is needed).
create or replace function support_permission_required()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((select support_permission_required from platform_settings where id), true);
$$;
revoke all on function support_permission_required() from public, anon;
grant execute on function support_permission_required() to authenticated;

-- Permission only counts when the switch is on.
create or replace function support_access_active(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select not support_permission_required()
        or exists (select 1 from tenants t where t.id = p_tenant_id and t.assistant_mode <> 'agency')
        or exists (select 1 from support_access_grants g where g.tenant_id = p_tenant_id and g.expires_at > now());
$$;

commit;
