-- 0027_platform_listings_team_inbox.sql
--
-- Four features in one migration, because they share helpers:
--
--   A. Platform control panel: billing/lifecycle fields on tenants, an
--      "admin views a tenant's dashboard" mechanism, AI token usage, and one
--      overview function for the control panel.
--   B. Listings: the agency's properties, and a search function the chat
--      agent (workflow 01) calls instead of guessing.
--   C. Team, inbox and alerts: per-person settings, automatic lead
--      assignment, who gets escalation emails, and live chat takeover.
--   D. Daily summary email: one function workflow 31 reads each morning.
--
-- Runs as one transaction: if anything fails, nothing is changed. Safe to
-- run again ("if not exists" / "create or replace" throughout).

begin;

-- ═════════════════════════════════════════════════════════════
-- A. Platform control panel
-- ═════════════════════════════════════════════════════════════

-- Billing and lifecycle. Dates, not a payment integration: you update them
-- by hand from the control panel when an agency pays.
alter table tenants add column if not exists trial_ends_at  timestamptz;
alter table tenants add column if not exists paid_until     timestamptz;
alter table tenants add column if not exists monthly_price  numeric(10, 2);
alter table tenants add column if not exists contact_email  text;
alter table tenants add column if not exists notes          text;

-- New tenants get a 14-day trial by default; existing trial tenants get
-- 14 days from when they were created.
alter table tenants alter column trial_ends_at set default (now() + interval '14 days');
update tenants set trial_ends_at = created_at + interval '14 days'
where plan = 'trial' and trial_ends_at is null;

-- Add a "complimentary" plan (your own demo tenant, friends, pilots you
-- don't charge for). The original check constraint is unnamed, so find it.
do $$
declare
    c text;
begin
    for c in
        select conname from pg_constraint
        where conrelid = 'public.tenants'::regclass and contype = 'c'
          and pg_get_constraintdef(oid) ilike '%plan%'
    loop
        execute format('alter table tenants drop constraint %I', c);
    end loop;
end $$;
alter table tenants add constraint tenants_plan_check
    check (plan in ('trial', 'starter', 'pro', 'enterprise', 'complimentary'));

comment on column tenants.paid_until is
    'Paid up to this date. Past this date and not on trial/complimentary => shown as "Past due" in the control panel. Updated by hand.';

-- ── "View as this agency" for platform admins ──
-- Written only by the dashboard server (service role) after it has checked
-- ADMIN_EMAILS. No policies => no anon/authenticated access at all.
create table if not exists platform_admin_views (
    auth_user_id  uuid primary key,
    tenant_id     uuid not null references tenants(id) on delete cascade,
    expires_at    timestamptz not null default (now() + interval '8 hours'),
    created_at    timestamptz not null default now()
);
alter table platform_admin_views enable row level security;
revoke all on platform_admin_views from anon, authenticated;

comment on table platform_admin_views is
    'Active "view as" sessions: while a row exists and has not expired, current_tenant_id() returns this tenant for that admin. Rows are created and deleted only by the dashboard server (service role) after checking ADMIN_EMAILS.';

-- current_tenant_id(): n8n's explicit setting first, then an active admin
-- view, then the user's own membership (unchanged behaviour otherwise).
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
      where v.auth_user_id = auth.uid() and v.expires_at > now()),
    (select tenant_id from tenant_users where auth_user_id = auth.uid() limit 1)
  );
$function$;

-- The dashboard asks this to show the "You are viewing X" banner.
create or replace function public.current_admin_view()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select v.tenant_id from platform_admin_views v
    where v.auth_user_id = auth.uid() and v.expires_at > now();
$$;

-- ── AI usage (real token counts from the Claude responses) ──
create table if not exists ai_usage_daily (
    tenant_id      uuid not null references tenants(id) on delete cascade,
    day            date not null,
    input_tokens   bigint not null default 0,
    output_tokens  bigint not null default 0,
    replies        int not null default 0,
    primary key (tenant_id, day)
);
alter table ai_usage_daily enable row level security;
drop policy if exists tenant_isolation_ai_usage_daily on ai_usage_daily;
create policy tenant_isolation_ai_usage_daily on ai_usage_daily
    using (tenant_id = current_tenant_id());

-- Called by workflow 01 once per reply, with the tokens summed over every
-- Claude call that reply took (tool loop included).
create or replace function log_ai_usage(p_tenant_id uuid, p_input_tokens bigint, p_output_tokens bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into ai_usage_daily (tenant_id, day, input_tokens, output_tokens, replies)
    values (p_tenant_id, (now() at time zone 'utc')::date,
            greatest(coalesce(p_input_tokens, 0), 0), greatest(coalesce(p_output_tokens, 0), 0), 1)
    on conflict (tenant_id, day) do update
        set input_tokens  = ai_usage_daily.input_tokens + excluded.input_tokens,
            output_tokens = ai_usage_daily.output_tokens + excluded.output_tokens,
            replies       = ai_usage_daily.replies + 1;
end;
$$;

-- ═════════════════════════════════════════════════════════════
-- B. Listings
-- ═════════════════════════════════════════════════════════════

create table if not exists listings (
    id                uuid primary key default uuid_generate_v4(),
    tenant_id         uuid not null references tenants(id) on delete cascade,
    reference         text,                       -- the agency's own reference number
    title             text not null,
    status            text not null default 'available'
                          check (status in ('available', 'under_offer', 'sold', 'let', 'withdrawn')),
    transaction_type  text not null default 'sale' check (transaction_type in ('sale', 'rent')),
    property_type     text not null default 'apartment'
                          check (property_type in ('apartment', 'house', 'plot', 'commercial', 'room', 'other')),
    price             numeric(14, 2),
    currency          text not null default 'PLN',
    city              text,
    district          text,
    address           text,
    area_m2           numeric(10, 2),
    rooms             int,
    bedrooms          int,
    bathrooms         int,
    floor             int,
    description       text,
    features          text[] not null default '{}',
    url               text,
    image_url         text,
    times_suggested   int not null default 0,     -- how often Elliot has shown it to someone
    last_suggested_at timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index if not exists idx_listings_tenant on listings(tenant_id);
create index if not exists idx_listings_tenant_status on listings(tenant_id, status);
create unique index if not exists idx_listings_tenant_reference
    on listings(tenant_id, reference) where reference is not null;

drop trigger if exists trg_listings_updated_at on listings;
create trigger trg_listings_updated_at before update on listings
    for each row execute function set_updated_at();

alter table listings enable row level security;
drop policy if exists tenant_isolation_listings on listings;
create policy tenant_isolation_listings on listings
    using (tenant_id = current_tenant_id());

comment on table listings is
    'The agency''s properties. Elliot only ever offers listings with status = available, found through search_listings().';

-- Called by workflow 01's search_listings tool. Every filter is optional.
-- Returns {found, count, listings:[...]} and counts each returned listing as
-- "suggested" so the dashboard can show which properties get interest.
create or replace function search_listings(p_tenant_id uuid, p_filters jsonb)
returns jsonb
language plpgsql
as $$
declare
    f        jsonb := coalesce(p_filters, '{}'::jsonb);
    v_result jsonb;
    v_ids    uuid[];
    v_limit  int := least(greatest(coalesce((f->>'limit')::int, 5), 1), 10);
begin
    perform set_config('app.current_tenant', p_tenant_id::text, true);

    with matches as (
        select l.*
        from listings l
        where l.tenant_id = p_tenant_id
          and l.status = 'available'
          and (f->>'transaction_type' is null or l.transaction_type = f->>'transaction_type')
          and (f->>'property_type' is null or l.property_type = f->>'property_type')
          and (f->>'location' is null
               or l.city ilike '%' || (f->>'location') || '%'
               or l.district ilike '%' || (f->>'location') || '%'
               or l.address ilike '%' || (f->>'location') || '%')
          and (f->>'max_price' is null or l.price <= (f->>'max_price')::numeric)
          and (f->>'min_price' is null or l.price >= (f->>'min_price')::numeric)
          and (f->>'min_rooms' is null or l.rooms >= (f->>'min_rooms')::int)
          and (f->>'min_bedrooms' is null or l.bedrooms >= (f->>'min_bedrooms')::int)
          and (f->>'min_area_m2' is null or l.area_m2 >= (f->>'min_area_m2')::numeric)
          and (f->>'keywords' is null
               or l.title ilike '%' || (f->>'keywords') || '%'
               or l.description ilike '%' || (f->>'keywords') || '%'
               or array_to_string(l.features, ' ') ilike '%' || (f->>'keywords') || '%')
          and (f->>'reference' is null or l.reference = f->>'reference')
        order by l.price nulls last, l.created_at desc
        limit v_limit
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'listing_id', m.id,
               'reference', m.reference,
               'title', m.title,
               'transaction_type', m.transaction_type,
               'property_type', m.property_type,
               'price', m.price,
               'currency', m.currency,
               'city', m.city,
               'district', m.district,
               'area_m2', m.area_m2,
               'rooms', m.rooms,
               'bedrooms', m.bedrooms,
               'bathrooms', m.bathrooms,
               'floor', m.floor,
               'features', m.features,
               'description', left(m.description, 400),
               'url', m.url
           )), '[]'::jsonb),
           array_agg(m.id)
      into v_result, v_ids
      from matches m;

    if v_ids is not null then
        update listings set times_suggested = times_suggested + 1, last_suggested_at = now()
        where id = any(v_ids);
    end if;

    return jsonb_build_object(
        'found', jsonb_array_length(v_result) > 0,
        'count', jsonb_array_length(v_result),
        'listings', v_result
    );
end;
$$;

-- Dashboard CSV import. Rows with a reference that already exists update
-- that listing; everything else is inserted. Runs as the caller, so RLS
-- keeps it inside their own agency.
create or replace function import_listings(p_rows jsonb)
returns jsonb
language plpgsql
as $$
declare
    v_tenant uuid := current_tenant_id();
    r jsonb;
    v_inserted int := 0;
    v_updated int := 0;
    v_existing uuid;
begin
    if v_tenant is null then
        raise exception 'No agency for this account';
    end if;
    for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
    loop
        v_existing := null;
        if nullif(trim(r->>'reference'), '') is not null then
            select id into v_existing from listings
            where tenant_id = v_tenant and reference = trim(r->>'reference');
        end if;

        if v_existing is null then
            insert into listings (tenant_id, reference, title, status, transaction_type, property_type,
                                  price, currency, city, district, address, area_m2, rooms, bedrooms,
                                  bathrooms, floor, description, features, url, image_url)
            values (v_tenant, nullif(trim(r->>'reference'), ''), r->>'title',
                    coalesce(r->>'status', 'available'), coalesce(r->>'transaction_type', 'sale'),
                    coalesce(r->>'property_type', 'apartment'),
                    (r->>'price')::numeric, coalesce(r->>'currency', 'PLN'), r->>'city', r->>'district',
                    r->>'address', (r->>'area_m2')::numeric, (r->>'rooms')::int, (r->>'bedrooms')::int,
                    (r->>'bathrooms')::int, (r->>'floor')::int, r->>'description',
                    coalesce((select array_agg(x) from jsonb_array_elements_text(r->'features') x), '{}'),
                    r->>'url', r->>'image_url');
            v_inserted := v_inserted + 1;
        else
            update listings set
                title = r->>'title',
                status = coalesce(r->>'status', status),
                transaction_type = coalesce(r->>'transaction_type', transaction_type),
                property_type = coalesce(r->>'property_type', property_type),
                price = (r->>'price')::numeric,
                currency = coalesce(r->>'currency', currency),
                city = r->>'city', district = r->>'district', address = r->>'address',
                area_m2 = (r->>'area_m2')::numeric, rooms = (r->>'rooms')::int,
                bedrooms = (r->>'bedrooms')::int, bathrooms = (r->>'bathrooms')::int,
                floor = (r->>'floor')::int, description = r->>'description',
                features = coalesce((select array_agg(x) from jsonb_array_elements_text(r->'features') x), '{}'),
                url = r->>'url', image_url = r->>'image_url'
            where id = v_existing;
            v_updated := v_updated + 1;
        end if;
    end loop;
    return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$$;

-- ═════════════════════════════════════════════════════════════
-- C. Team, lead assignment, alerts and live chat takeover
-- ═════════════════════════════════════════════════════════════

alter table tenant_users add column if not exists full_name          text;
alter table tenant_users add column if not exists receives_leads     boolean not null default true;
alter table tenant_users add column if not exists notify_escalations boolean not null default true;
alter table tenant_users add column if not exists notify_digest      boolean;  -- null = role default (admins yes)
alter table tenant_users add column if not exists last_assigned_at   timestamptz;
alter table tenant_users add column if not exists removed_at         timestamptz;  -- left the agency: login deleted, row kept for history


comment on column tenant_users.receives_leads is 'Included in automatic round-robin lead assignment.';
comment on column tenant_users.notify_escalations is 'Gets an email when a conversation is handed to a person (hot lead, human requested, upset customer...).';
comment on column tenant_users.notify_digest is 'Gets the daily summary email (workflow 31). NULL means the default for the role: admins get it, agents and viewers do not.';

-- ── Round-robin: a new lead without an owner goes to whoever in the team
-- has waited longest for one. Viewers never receive leads.
create or replace function assign_lead_round_robin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid;
begin
    if new.assigned_to is not null then
        return new;
    end if;
    -- Workflow 10 saves leads with INSERT ... ON CONFLICT DO UPDATE, which
    -- fires this trigger even when the visitor already has a lead. Only a
    -- genuinely new lead should take a turn in the rotation.
    if exists (select 1 from leads where tenant_id = new.tenant_id and contact_id = new.contact_id) then
        return new;
    end if;

    select u.id into v_user
    from tenant_users u
    where u.tenant_id = new.tenant_id
      and u.receives_leads
      and u.removed_at is null
      and u.role in ('admin', 'agent')
    order by u.last_assigned_at nulls first, u.created_at
    limit 1
    for update skip locked;

    if v_user is not null then
        new.assigned_to := v_user;
        update tenant_users set last_assigned_at = now() where id = v_user;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_leads_assign_round_robin on leads;
create trigger trg_leads_assign_round_robin before insert on leads
    for each row execute function assign_lead_round_robin();

-- Team page: admins can change anyone in their agency; everyone can change
-- their own name and notification settings, but not their own role.
create or replace function update_team_member(p_member_id uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := current_tenant_id();
    v_me tenant_users%rowtype;
    v_is_admin boolean;
    v_admin_view boolean := current_admin_view() is not null;
begin
    select * into v_me from tenant_users where auth_user_id = auth.uid() and tenant_id = v_tenant;
    v_is_admin := v_admin_view or coalesce(v_me.role = 'admin', false);

    if not v_is_admin and (v_me.id is null or v_me.id <> p_member_id) then
        raise exception 'Only an admin can change other team members';
    end if;
    if p_changes ? 'role' and not v_is_admin then
        raise exception 'Only an admin can change roles';
    end if;
    if p_changes ? 'role' and p_changes->>'role' not in ('admin', 'agent', 'viewer') then
        raise exception 'Unknown role';
    end if;
    if p_changes ? 'role' and p_changes->>'role' <> 'admin'
       and (select role from tenant_users where id = p_member_id) = 'admin'
       and (select count(*) from tenant_users where tenant_id = v_tenant and role = 'admin' and removed_at is null) = 1 then
        raise exception 'An agency needs at least one admin';
    end if;

    update tenant_users set
        full_name          = case when p_changes ? 'full_name' then nullif(trim(p_changes->>'full_name'), '') else full_name end,
        role               = case when p_changes ? 'role' then p_changes->>'role' else role end,
        receives_leads     = case when p_changes ? 'receives_leads' then (p_changes->>'receives_leads')::boolean else receives_leads end,
        notify_escalations = case when p_changes ? 'notify_escalations' then (p_changes->>'notify_escalations')::boolean else notify_escalations end,
        notify_digest      = case when p_changes ? 'notify_digest' then (p_changes->>'notify_digest')::boolean else notify_digest end
    where id = p_member_id and tenant_id = v_tenant;
    if not found then
        raise exception 'Team member not found';
    end if;
end;
$$;

-- ── Who gets the escalation email (workflow 24) ──
-- The agent who owns this visitor's lead, if they want alerts; if nobody
-- owns it, everyone in the team who wants alerts. Plus the agency-wide
-- address from Settings. Comma-separated, or null for "send nothing".
create or replace function escalation_recipients(p_tenant_id uuid, p_conversation_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    with owner as (
        select u.email, u.notify_escalations
        from conversations c
        join leads l on l.contact_id = c.contact_id and l.tenant_id = c.tenant_id
        join tenant_users u on u.id = l.assigned_to and u.removed_at is null
        where c.id = p_conversation_id and c.tenant_id = p_tenant_id
        limit 1
    ),
    team as (
        select u.email from tenant_users u
        where u.tenant_id = p_tenant_id and u.notify_escalations and u.removed_at is null
          and u.role in ('admin', 'agent')
          and not exists (select 1 from owner)
    ),
    everyone as (
        select email from owner where notify_escalations
        union select email from team
        union select escalation_notify_email from ai_config where tenant_id = p_tenant_id
    )
    select nullif(string_agg(distinct lower(trim(email)), ', '), '')
    from everyone where email is not null and trim(email) <> '';
$$;

-- Hot leads now go through the same escalation path as everything else
-- (workflow 10 calls 24), so give them their own reason instead of "other".
do $$
declare
    c text;
begin
    for c in
        select conname from pg_constraint
        where conrelid = 'public.escalations'::regclass and contype = 'c'
          and pg_get_constraintdef(oid) ilike '%reason%'
    loop
        execute format('alter table escalations drop constraint %I', c);
    end loop;
end $$;
alter table escalations add constraint escalations_reason_check check (reason in (
    'low_confidence', 'customer_requested_human', 'angry_customer',
    'legal_issue', 'refund_requested', 'sensitive_info',
    'no_trusted_source', 'action_exceeds_permissions', 'hot_lead', 'other'
));

-- ── Live chat takeover ──
-- conversations.assigned_human set => a person is answering, Elliot stays
-- quiet (workflow 01 checks this through log_user_message below).

-- Workflow 01 logs the visitor's message with this instead of log_message,
-- so it learns in the same call whether a person has taken over.
create or replace function log_user_message(p_tenant_id uuid, p_conversation_id uuid, p_content text)
returns jsonb
language plpgsql
as $$
declare
    v_id uuid;
    v_human boolean;
begin
    perform set_config('app.current_tenant', p_tenant_id::text, true);
    insert into messages (tenant_id, conversation_id, role, content)
    values (p_tenant_id, p_conversation_id, 'user', p_content)
    returning id into v_id;

    select c.assigned_human is not null into v_human
    from conversations c where c.id = p_conversation_id;

    update conversations set updated_at = now() where id = p_conversation_id;

    return jsonb_build_object('message_id', v_id, 'human_takeover', coalesce(v_human, false));
end;
$$;

-- Dashboard: a team member takes over a conversation.
create or replace function take_over_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := current_tenant_id();
    v_me uuid;
    v_name text;
begin
    select id, coalesce(full_name, split_part(email, '@', 1)) into v_me, v_name
    from tenant_users where auth_user_id = auth.uid() and tenant_id = v_tenant;
    if v_me is null then
        raise exception 'Only a member of this agency can take over a conversation';
    end if;

    update conversations
       set assigned_human = v_me, status = 'escalated', updated_at = now()
     where id = p_conversation_id and tenant_id = v_tenant;
    if not found then
        raise exception 'Conversation not found';
    end if;

    insert into messages (tenant_id, conversation_id, role, content)
    values (v_tenant, p_conversation_id, 'system', v_name || ' joined the conversation.');
end;
$$;

-- Dashboard: hand the conversation back to Elliot.
create or replace function hand_back_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := current_tenant_id();
begin
    update conversations
       set assigned_human = null, status = 'open', updated_at = now()
     where id = p_conversation_id and tenant_id = v_tenant;
    if not found then
        raise exception 'Conversation not found';
    end if;
    insert into messages (tenant_id, conversation_id, role, content)
    values (v_tenant, p_conversation_id, 'system', 'Handed back to Elliot.');
end;
$$;

-- Dashboard: a team member's chat reply. The website widget picks it up by
-- polling (GET /api/widget/messages on the dashboard).
create or replace function send_human_chat_message(p_conversation_id uuid, p_content text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := current_tenant_id();
    v_id uuid;
begin
    if coalesce(trim(p_content), '') = '' then
        raise exception 'Message is empty';
    end if;
    if not exists (
        select 1 from conversations
        where id = p_conversation_id and tenant_id = v_tenant and assigned_human is not null
    ) then
        raise exception 'Take over the conversation before replying';
    end if;

    insert into messages (tenant_id, conversation_id, role, content)
    values (v_tenant, p_conversation_id, 'human_agent', trim(p_content))
    returning id into v_id;
    update conversations set updated_at = now() where id = p_conversation_id;
    return v_id;
end;
$$;

create index if not exists idx_messages_conversation_role_time
    on messages(conversation_id, role, created_at);

-- ═════════════════════════════════════════════════════════════
-- D. Daily summary email
-- ═════════════════════════════════════════════════════════════

alter table ai_config add column if not exists daily_digest_enabled boolean not null default true;

-- One row per (agency, recipient) who should get today's summary.
-- Figures cover the last 24 hours; viewings are today's (agency timezone).
create or replace function get_daily_digests()
returns table (
    tenant_id             uuid,
    tenant_name           text,
    recipient_email       text,
    recipient_name        text,
    conversations_count   bigint,
    new_leads_count       bigint,
    hot_leads_count       bigint,
    viewings_booked_count bigint,
    viewings_today        jsonb,
    open_escalations      bigint,
    pending_approvals     bigint,
    hot_leads             jsonb
)
language sql
stable
security definer
set search_path = public
as $$
    select
        t.id,
        t.name,
        u.email,
        coalesce(u.full_name, split_part(u.email, '@', 1)),
        (select count(*) from conversations c where c.tenant_id = t.id and c.created_at >= now() - interval '24 hours'),
        (select count(*) from leads l where l.tenant_id = t.id and l.created_at >= now() - interval '24 hours'),
        (select count(*) from leads l where l.tenant_id = t.id and l.status = 'HOT'),
        (select count(*) from appointments a where a.tenant_id = t.id and a.created_at >= now() - interval '24 hours'),
        (select coalesce(jsonb_agg(jsonb_build_object(
                    'time', to_char(a.starts_at at time zone t.timezone, 'HH24:MI'),
                    'name', coalesce(ct.name, ct.email, 'Unknown contact'),
                    'notes', a.notes) order by a.starts_at), '[]'::jsonb)
           from appointments a left join contacts ct on ct.id = a.contact_id
          where a.tenant_id = t.id and a.status = 'confirmed'
            and (a.starts_at at time zone t.timezone)::date = (now() at time zone t.timezone)::date),
        (select count(*) from escalations e where e.tenant_id = t.id and e.status <> 'resolved'),
        (select count(*) from email_drafts d where d.tenant_id = t.id and d.status = 'pending'),
        (select coalesce(jsonb_agg(jsonb_build_object(
                    'name', coalesce(ct.name, ct.email, 'Unknown contact'),
                    'phone', ct.phone,
                    'email', ct.email) order by l.updated_at desc), '[]'::jsonb)
           from (select * from leads l where l.tenant_id = t.id and l.status = 'HOT'
                  and (l.assigned_to = u.id or l.assigned_to is null or u.role = 'admin')
                  order by l.updated_at desc limit 5) l
           left join contacts ct on ct.id = l.contact_id)
    from tenants t
    join ai_config ac on ac.tenant_id = t.id and ac.daily_digest_enabled
    join tenant_users u on u.tenant_id = t.id and u.removed_at is null and coalesce(u.notify_digest, u.role = 'admin')
    where t.status = 'active';
$$;

-- ═════════════════════════════════════════════════════════════
-- A (continued). Control panel overview -- needs listings, so it comes last.
-- ═════════════════════════════════════════════════════════════

-- ── One row per agency for the control panel ──
create or replace function public.platform_tenant_overview(p_days int default 30)
returns table (
    tenant_id           uuid,
    name                text,
    slug                text,
    industry            text,
    plan                text,
    status              text,
    created_at          timestamptz,
    trial_ends_at       timestamptz,
    paid_until          timestamptz,
    monthly_price       numeric,
    contact_email       text,
    users_count         bigint,
    listings_count      bigint,
    conversations_count bigint,
    leads_count         bigint,
    hot_leads_count     bigint,
    appointments_count  bigint,
    open_escalations    bigint,
    pending_approvals   bigint,
    failed_crm_syncs    bigint,
    tool_errors         bigint,
    input_tokens        bigint,
    output_tokens       bigint,
    ai_replies          bigint,
    last_activity_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    with since as (select now() - (p_days || ' days')::interval as ts)
    select
        t.id, t.name, t.slug, t.industry, t.plan, t.status, t.created_at,
        t.trial_ends_at, t.paid_until, t.monthly_price, t.contact_email,
        (select count(*) from tenant_users u where u.tenant_id = t.id and u.removed_at is null),
        (select count(*) from listings l where l.tenant_id = t.id and l.status = 'available'),
        (select count(*) from conversations c where c.tenant_id = t.id and c.created_at >= (select ts from since)),
        (select count(*) from leads l where l.tenant_id = t.id and l.created_at >= (select ts from since)),
        (select count(*) from leads l where l.tenant_id = t.id and l.status = 'HOT'),
        (select count(*) from appointments a where a.tenant_id = t.id and a.created_at >= (select ts from since)),
        (select count(*) from escalations e where e.tenant_id = t.id and e.status <> 'resolved'),
        (select count(*) from email_drafts d where d.tenant_id = t.id and d.status = 'pending'),
        (select count(*) from crm_sync_log s where s.tenant_id = t.id and s.status = 'failed'),
        (select count(*) from tool_call_log g where g.tenant_id = t.id and g.error is not null
            and g.requested_at >= (select ts from since)),
        (select coalesce(sum(u.input_tokens), 0)::bigint from ai_usage_daily u
            where u.tenant_id = t.id and u.day >= (select ts from since)::date),
        (select coalesce(sum(u.output_tokens), 0)::bigint from ai_usage_daily u
            where u.tenant_id = t.id and u.day >= (select ts from since)::date),
        (select coalesce(sum(u.replies), 0)::bigint from ai_usage_daily u
            where u.tenant_id = t.id and u.day >= (select ts from since)::date),
        (select max(m.created_at) from messages m where m.tenant_id = t.id)
    from tenants t
    order by t.created_at desc;
$$;

comment on function public.platform_tenant_overview is
    'Control-panel overview across ALL tenants. Bypasses RLS on purpose, so execute is revoked from anon/authenticated below: only the service role (the dashboard server, after its ADMIN_EMAILS check) can call it.';

-- ═════════════════════════════════════════════════════════════
-- Permissions: functions that bypass RLS for all tenants are service-role
-- only. (Supabase grants EXECUTE on new functions to anon/authenticated by
-- default, so revoke explicitly -- same as 0026.)
-- ═════════════════════════════════════════════════════════════
revoke all on function public.platform_tenant_overview(int) from public;
revoke all on function public.get_daily_digests() from public;
revoke all on function public.escalation_recipients(uuid, uuid) from public;
revoke all on function public.log_ai_usage(uuid, bigint, bigint) from public;
revoke all on function public.assign_lead_round_robin() from public;
-- search_listings / log_user_message take a tenant id as a parameter and set
-- app.current_tenant themselves, so they must never be callable through the
-- public API: n8n calls them over its service-role Postgres connection.
revoke all on function public.search_listings(uuid, jsonb) from public;
revoke all on function public.log_user_message(uuid, uuid, text) from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        execute 'revoke all on function public.platform_tenant_overview(int) from anon, authenticated';
        execute 'revoke all on function public.get_daily_digests() from anon, authenticated';
        execute 'revoke all on function public.escalation_recipients(uuid, uuid) from anon, authenticated';
        execute 'revoke all on function public.log_ai_usage(uuid, bigint, bigint) from anon, authenticated';
        execute 'revoke all on function public.assign_lead_round_robin() from anon, authenticated';
        execute 'revoke all on function public.search_listings(uuid, jsonb) from anon, authenticated';
        execute 'revoke all on function public.log_user_message(uuid, uuid, text) from anon, authenticated';
    end if;
end $$;

commit;
