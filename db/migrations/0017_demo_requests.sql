-- 0017_demo_requests.sql
--
-- Marketing-site "Book a Demo" form submissions. These are sales leads for
-- Elliot itself (someone wants to become a tenant) -- not a tenant's own
-- customer leads, so this deliberately does NOT have a tenant_id and does
-- NOT go in the contacts/leads tables (see 0002). Mixing the two would let
-- a prospective-client's sales inquiry masquerade as a real tenant's
-- customer data, which is exactly the kind of confusion RLS elsewhere is
-- built to prevent.
--
-- No tenant scoping needed here, so this is a flat platform-level table,
-- same treatment as audit_log's tenant_id IS NULL rows: RLS enabled, no
-- policies added, so only the service-role connection (n8n) can read or
-- write it. Fail closed by default, same reasoning as 0008.

create table demo_requests (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    company text not null,
    email text not null,
    website text,
    industry text not null,
    employees text not null,
    automate text,
    status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
    created_at timestamptz not null default now()
);

create index demo_requests_created_at_idx on demo_requests (created_at desc);
create index demo_requests_email_idx on demo_requests (email);

alter table demo_requests enable row level security;

comment on table demo_requests is
    'Marketing-site demo request submissions. Platform-level (no tenant_id) -- service-role access only, same pattern as audit_log tenant_id IS NULL rows.';
