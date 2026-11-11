-- 0047_security_hardening.sql
--
-- Security audit, November 2026. Each part closes something that was tested
-- and reproduced on a scratch database built with Supabase's default grants
-- (db/seed/test_0047_tenant_isolation.sql repeats every attack).
--
--  1. Six helper functions from the first build (get_ai_config,
--     get_conversation_history, log_message, log_tool_call, insert_escalation,
--     get_or_create_conversation) took an agency ID, switched the session to
--     it, and could be called by anyone with the public (anon) key: reading an
--     agency's prompt and conversations, and writing into them. n8n calls
--     them as the service role, so they are now closed to everyone else, and
--     anonymous visitors keep exactly one function (public_listing).
--  2. current_tenant_id() no longer trusts the app.current_tenant session
--     value for API users, and ignores removed team members.
--  3. Inside an agency: only admins change the team, the agency's own row
--     (and only its safe columns) and Elliot's settings; viewers can't change
--     anything; nobody edits the logs.
--  4. A row can't point at another agency's records, and a conversation can't
--     be pulled into another agency through the public chat.
--  5. On the website chat, where identity is only typed in, a visitor sees
--     and changes only viewings booked in that same chat, and can't rename
--     an existing client. Email and WhatsApp prove who is writing, and stay
--     as they were.
-- One transaction; safe to run again. Run before importing workflows 01, 16,
-- 25, 37 and 40 from the same release.

begin;

-- ════════════════════════════════════════════════════════════════════════
-- 1. Who may call what
-- ════════════════════════════════════════════════════════════════════════

-- Anonymous visitors: no tables, no sequences, and (below) one function.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
-- TRUNCATE, REFERENCES and TRIGGER are not covered by row-level security.
revoke truncate, references, trigger on all tables in schema public from authenticated;
-- New tables and functions made by later migrations: nothing for anon.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- Every function of ours (not extensions'): closed to PUBLIC and anon.
do $$
declare f record;
begin
    for f in
        select p.oid::regprocedure as sig
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    loop
        execute format('revoke all on function %s from public, anon', f.sig);
    end loop;
end $$;

-- n8n-only helpers that take an agency ID: service role only.
revoke all on function get_ai_config(uuid) from authenticated;
revoke all on function get_conversation_history(uuid, uuid, integer) from authenticated;
revoke all on function get_or_create_conversation(uuid, uuid) from authenticated;
revoke all on function insert_escalation(uuid, uuid, text, text, text) from authenticated;
revoke all on function log_message(uuid, uuid, text, text) from authenticated;
revoke all on function log_tool_call(uuid, uuid, text, jsonb, text) from authenticated;
revoke all on function match_document_chunks(uuid, vector, integer) from authenticated;
revoke all on function support_access_active(uuid) from authenticated;

-- What the dashboard (a signed-in user) calls, stated explicitly so it does
-- not depend on PUBLIC or on a project's default grants.
grant execute on function current_tenant_id() to authenticated;
grant execute on function current_admin_view() to authenticated;
grant execute on function agency_inbound_address(text) to authenticated;
grant execute on function elliot_email_domain(text) to authenticated;
grant execute on function elliot_calendar_account() to authenticated;
grant execute on function search_norm(text) to authenticated;
grant execute on function search_number(text) to authenticated;
grant execute on function approve_email_draft(uuid, uuid, text) to authenticated;
grant execute on function reject_email_draft(uuid, uuid) to authenticated;
grant execute on function approve_whatsapp_draft(uuid, uuid, text) to authenticated;
grant execute on function reject_whatsapp_draft(uuid, uuid) to authenticated;
grant execute on function create_manual_email_draft(uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function take_over_conversation(uuid) to authenticated;
grant execute on function hand_back_conversation(uuid) to authenticated;
grant execute on function send_human_chat_message(uuid, text) to authenticated;
grant execute on function update_team_member(uuid, jsonb) to authenticated;
grant execute on function import_listings(jsonb, boolean) to authenticated;
grant execute on function get_dashboard_overview_stats(integer) to authenticated;
grant execute on function get_revenue_dashboard_stats(integer) to authenticated;
grant execute on function asari_status() to authenticated;
grant execute on function grant_support_access(integer) to authenticated;
grant execute on function revoke_support_access() to authenticated;
grant execute on function log_support_visit(text) to authenticated;
grant execute on function support_permission_required() to authenticated;
-- The public listing page (/p/<id>) is the one thing a visitor may call.
grant execute on function public_listing(uuid) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Which agency a signed-in user belongs to
-- ════════════════════════════════════════════════════════════════════════

-- True for requests through Supabase's API (anon or a signed-in user); false
-- for n8n and the dashboard server, which connect as the service role. The
-- "role" setting keeps the API role even inside security-definer functions.
create or replace function is_api_user()
returns boolean
language sql
stable
as $$
    select coalesce(current_setting('role', true), '') in ('anon', 'authenticated');
$$;
revoke all on function is_api_user() from public, anon;
grant execute on function is_api_user() to authenticated;

-- As 0040, with two changes: app.current_tenant (which n8n's functions set)
-- is ignored for API users, and a removed team member has no agency.
create or replace function current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        case when is_api_user() then null
             else nullif(current_setting('app.current_tenant', true), '')::uuid end,
        current_admin_view(),
        (select tu.tenant_id from tenant_users tu
          where tu.auth_user_id = auth.uid() and tu.removed_at is null
          limit 1)
    );
$$;
revoke all on function current_tenant_id() from public, anon;
grant execute on function current_tenant_id() to authenticated;

-- The signed-in user's role in the agency they are looking at: admin, agent,
-- viewer, or null. A platform admin looking at an agency with support access
-- acts as its admin.
create or replace function current_member_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select case
        when current_admin_view() is not null then 'admin'
        else (select tu.role from tenant_users tu
               where tu.auth_user_id = auth.uid() and tu.removed_at is null
               limit 1)
    end;
$$;
revoke all on function current_member_role() from public, anon;
grant execute on function current_member_role() to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 3. Inside an agency
-- ════════════════════════════════════════════════════════════════════════

-- Team: everyone in the agency reads it; changes go only through
-- update_team_member() and the dashboard's server routes, which check the
-- caller is an admin. (Before: any member could make themselves admin.)
drop policy if exists tenant_isolation_tenant_users on tenant_users;
drop policy if exists tenant_reads_tenant_users on tenant_users;
create policy tenant_reads_tenant_users on tenant_users
    for select using (tenant_id = current_tenant_id());
revoke insert, update, delete on tenant_users from authenticated;

-- The agency's own row: everyone reads it; an admin may change its name,
-- industry, time zone and average deal value. Status, plan, slug, prices and
-- dates belong to the control panel (service role).
drop policy if exists tenant_isolation_tenants on tenants;
drop policy if exists tenant_reads_own_tenant on tenants;
drop policy if exists admin_updates_own_tenant on tenants;
create policy tenant_reads_own_tenant on tenants
    for select using (id = current_tenant_id());
create policy admin_updates_own_tenant on tenants
    for update using (id = current_tenant_id() and current_member_role() = 'admin')
    with check (id = current_tenant_id() and current_member_role() = 'admin');
revoke insert, update, delete on tenants from authenticated;
grant update (name, industry, timezone, avg_deal_value) on tenants to authenticated;

-- Elliot's settings: everyone reads them, an admin changes them.
drop policy if exists tenant_isolation_ai_config on ai_config;
drop policy if exists tenant_reads_ai_config on ai_config;
drop policy if exists admin_updates_ai_config on ai_config;
create policy tenant_reads_ai_config on ai_config
    for select using (tenant_id = current_tenant_id());
create policy admin_updates_ai_config on ai_config
    for update using (tenant_id = current_tenant_id() and current_member_role() = 'admin')
    with check (tenant_id = current_tenant_id() and current_member_role() = 'admin');
revoke insert, delete on ai_config from authenticated;

-- Logs and usage: read-only for agencies (n8n and the server write them).
revoke insert, update, delete on audit_log, tool_call_log, ai_usage_daily, crm_sync_log from authenticated;

-- Viewers look, they don't change. One trigger on every agency table, so it
-- holds for direct writes and for the functions the dashboard calls alike.
create or replace function block_viewer_writes()
returns trigger
language plpgsql
as $$
begin
    if is_api_user() and current_member_role() = 'viewer' then
        raise exception 'Viewers can look but not change anything. Ask an admin of your agency to change your role.'
            using errcode = '42501';
    end if;
    return coalesce(new, old);
end;
$$;
revoke all on function block_viewer_writes() from public, anon;

do $$
declare t record;
begin
    for t in
        select c.oid::regclass as tbl, c.relname
        from pg_class c
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          -- Their own name and photo (update_team_member) and the support
          -- visit log are not "changing the agency's data".
          and c.relname not in ('tenant_users', 'support_access_log', 'support_access_grants')
    loop
        execute format('drop trigger if exists trg_block_viewer_writes on %s', t.tbl);
        execute format('create trigger trg_block_viewer_writes before insert or update or delete on %s
                        for each row execute function block_viewer_writes()', t.tbl);
    end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 4. Records stay inside their agency
-- ════════════════════════════════════════════════════════════════════════

-- A row's links (its conversation, contact, lead...) must belong to the same
-- agency as the row. Arguments: pairs of column, referenced table.
create or replace function enforce_same_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    i int := 0;
    v_ref uuid;
    v_tenant uuid;
begin
    while i < tg_nargs loop
        execute format('select ($1).%I', tg_argv[i]) into v_ref using new;
        if v_ref is not null then
            execute format('select tenant_id from %I where id = $1', tg_argv[i + 1]) into v_tenant using v_ref;
            if v_tenant is not null and v_tenant is distinct from new.tenant_id then
                raise exception '% on % belongs to another agency', tg_argv[i], tg_table_name
                    using errcode = '23514';
            end if;
        end if;
        i := i + 2;
    end loop;
    return new;
end;
$$;
revoke all on function enforce_same_tenant() from public, anon, authenticated;

do $$
declare
    r record;
begin
    for r in
        select * from (values
            ('messages',            array['conversation_id', 'conversations']),
            ('conversations',       array['contact_id', 'contacts']),
            ('leads',               array['contact_id', 'contacts']),
            ('appointments',        array['contact_id', 'contacts', 'conversation_id', 'conversations', 'listing_id', 'listings']),
            ('escalations',         array['conversation_id', 'conversations']),
            ('tool_call_log',       array['conversation_id', 'conversations']),
            ('email_drafts',        array['conversation_id', 'conversations', 'contact_id', 'contacts', 'follow_up_run_id', 'follow_up_runs']),
            ('whatsapp_drafts',     array['conversation_id', 'conversations', 'contact_id', 'contacts', 'follow_up_run_id', 'follow_up_runs']),
            ('follow_up_runs',      array['lead_id', 'leads', 'sequence_id', 'follow_up_sequences']),
            ('document_chunks',     array['document_id', 'documents']),
            ('message_attachments', array['conversation_id', 'conversations'])
        ) as v(tbl, args)
    loop
        execute format('drop trigger if exists trg_same_tenant on %I', r.tbl);
        execute format('create trigger trg_same_tenant before insert or update on %I
                        for each row execute function enforce_same_tenant(%s)',
                       r.tbl, (select string_agg(quote_literal(a), ', ') from unnest(r.args) a));
    end loop;
end $$;

-- The public chat sends a conversation ID. Before, an ID that belonged to
-- another agency was MOVED to the agency named in the request, and its
-- history handed to Claude. Now such an ID is ignored and a new conversation
-- is started.
create or replace function get_or_create_conversation(p_tenant_id uuid, p_conversation_id uuid)
returns uuid
language plpgsql
as $$
declare
    v_id uuid;
    v_owner uuid;
begin
    perform set_config('app.current_tenant', p_tenant_id::text, true);
    if p_conversation_id is not null then
        select tenant_id into v_owner from conversations where id = p_conversation_id;
        if found then
            if v_owner = p_tenant_id then
                return p_conversation_id;
            end if;
            p_conversation_id := null; -- someone else's: start a new one
        end if;
    end if;
    insert into conversations (id, tenant_id, channel, status)
    values (coalesce(p_conversation_id, uuid_generate_v4()), p_tenant_id, 'chat_widget', 'open')
    on conflict (id) do nothing
    returning id into v_id;
    if v_id is null then
        -- Created by a parallel request in the meantime: use it only if it is ours.
        select id into v_id from conversations where id = p_conversation_id and tenant_id = p_tenant_id;
        if v_id is null then
            insert into conversations (tenant_id, channel, status)
            values (p_tenant_id, 'chat_widget', 'open') returning id into v_id;
        end if;
    end if;
    return v_id;
end;
$$;
revoke all on function get_or_create_conversation(uuid, uuid) from public, anon, authenticated;

create or replace function get_conversation_history(p_tenant_id uuid, p_conversation_id uuid, p_limit integer default 20)
returns table(role text, content text)
language plpgsql
as $$
begin
    perform set_config('app.current_tenant', p_tenant_id::text, true);
    return query
        select h.role, h.content
        from (
            select m.role, m.content, m.created_at
            from messages m
            where m.conversation_id = p_conversation_id
              and m.tenant_id = p_tenant_id
            order by m.created_at desc
            limit p_limit
        ) h
        order by h.created_at asc;
end;
$$;
revoke all on function get_conversation_history(uuid, uuid, integer) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 5. Identity on the website chat
-- ════════════════════════════════════════════════════════════════════════

-- As 0031/0039, with one change: details typed into a chat may fill in or
-- correct the chat's OWN contact, but when they match a client who already
-- exists they no longer overwrite that client's name.
create or replace function upsert_conversation_contact(
    p_tenant_id uuid, p_conversation_id uuid, p_name text, p_email text, p_phone text,
    p_company text default null, p_source text default 'chat_widget')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name   text := nullif(btrim(coalesce(p_name, '')), '');
    v_email  text := nullif(lower(btrim(coalesce(p_email, ''))), '');
    v_phone  text := nullif(btrim(coalesce(p_phone, '')), '');
    v_digits text;
    v_id     uuid;
    v_conv   uuid;
begin
    if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        v_email := null;
    end if;
    v_digits := regexp_replace(coalesce(v_phone, ''), '\D', '', 'g');
    if length(v_digits) < 6 then
        v_phone := null;
        v_digits := null;
    end if;

    if p_conversation_id is not null then
        select contact_id into v_conv
        from conversations
        where id = p_conversation_id and tenant_id = p_tenant_id;
    end if;

    if v_email is not null then
        select id into v_id from contacts
        where tenant_id = p_tenant_id and lower(email) = v_email
        limit 1;
    end if;
    if v_id is null and v_digits is not null then
        select id into v_id from contacts
        where tenant_id = p_tenant_id and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_digits
        limit 1;
    end if;
    if v_id is null then
        v_id := v_conv;
    end if;

    if v_id is null then
        if v_name is null and v_email is null and v_phone is null then
            return null;
        end if;
        insert into contacts (tenant_id, name, email, phone, company, source)
        values (p_tenant_id, v_name, v_email, v_phone, nullif(btrim(coalesce(p_company, '')), ''), coalesce(p_source, 'chat_widget'))
        returning id into v_id;
    else
        update contacts c
        set name    = case when coalesce(p_source, 'chat_widget') = 'chat_widget' and c.id is not distinct from v_conv
                           then coalesce(v_name, c.name) else coalesce(c.name, v_name) end,
            email   = case
                        when c.email is null and v_email is not null
                             and not exists (select 1 from contacts o where o.tenant_id = p_tenant_id and lower(o.email) = v_email and o.id <> c.id)
                        then v_email else c.email end,
            phone   = case
                        when c.phone is null and v_phone is not null
                             and not exists (select 1 from contacts o where o.tenant_id = p_tenant_id
                                             and regexp_replace(coalesce(o.phone, ''), '\D', '', 'g') = v_digits and o.id <> c.id)
                        then v_phone else c.phone end,
            company = coalesce(nullif(btrim(coalesce(p_company, '')), ''), c.company)
        where c.id = v_id;
    end if;

    if p_conversation_id is not null then
        update conversations
        set contact_id = v_id
        where id = p_conversation_id and tenant_id = p_tenant_id and contact_id is distinct from v_id;
    end if;

    return v_id;
end;
$$;
revoke all on function upsert_conversation_contact(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

-- p_verified: the channel proves who is writing (email, WhatsApp; set by
-- workflow 01 only for requests from Elliot's own workflows). Not verified
-- (the website chat, where anyone can type any email): the visitor's upcoming
-- viewings are only the ones booked in this same conversation.
drop function if exists identify_chat_visitor(uuid, uuid, text, text, text);
create or replace function identify_chat_visitor(
    p_tenant_id uuid, p_conversation_id uuid, p_name text, p_email text, p_phone text,
    p_verified boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
    c record;
    v_viewings jsonb;
begin
    if nullif(btrim(coalesce(p_name, '')), '') is not null
       or nullif(btrim(coalesce(p_email, '')), '') is not null
       or nullif(btrim(coalesce(p_phone, '')), '') is not null then
        v_id := upsert_conversation_contact(p_tenant_id, p_conversation_id, p_name, p_email, p_phone, null, 'chat_widget');
    else
        select contact_id into v_id from conversations where id = p_conversation_id and tenant_id = p_tenant_id;
    end if;

    select id, name, email, phone into c from contacts where id = v_id;

    select coalesce(jsonb_agg(jsonb_build_object(
               'appointment_id', a.id,
               'when', to_char(a.starts_at at time zone coalesce(a.timezone, t.timezone, 'UTC'), 'Dy DD Mon YYYY, HH24:MI'),
               'starts_at', a.starts_at,
               'ends_at', a.ends_at,
               'client_confirmed', a.client_confirmed_at is not null,
               'listing_id', l.id,
               'title', l.title,
               'address', nullif(concat_ws(', ', l.address, l.district, l.city), ''),
               'url', l.url,
               'photo_count', coalesce(cardinality(l.photos), 0)
           ) order by a.starts_at), '[]'::jsonb)
      into v_viewings
      from appointments a
      join tenants t on t.id = a.tenant_id
      left join listings l on l.id = a.listing_id
     where a.tenant_id = p_tenant_id
       and c.id is not null and a.contact_id = c.id
       and a.status = 'confirmed'
       and a.ends_at > now()
       and (coalesce(p_verified, false) or a.conversation_id = p_conversation_id);

    return jsonb_build_object(
        'contact_id', c.id,
        'name', c.name,
        'email', c.email,
        'phone', c.phone,
        'ready', c.id is not null and c.name is not null and (c.email is not null or c.phone is not null),
        'verified', coalesce(p_verified, false),
        'upcoming_viewings', v_viewings
    );
end;
$$;
revoke all on function identify_chat_visitor(uuid, uuid, text, text, text, boolean) from public, anon, authenticated;

-- The client's own booking (0038). New: p_conversation_id, which workflow
-- 37 passes for the website chat, limits it to a viewing booked in that same
-- conversation; null (email, WhatsApp) leaves it as before.
drop function if exists client_appointment(uuid, uuid, uuid);
create or replace function client_appointment(p_tenant_id uuid, p_contact_id uuid, p_appointment_id uuid, p_conversation_id uuid default null)
returns table(appointment_id uuid, status text, starts_at timestamp with time zone, ends_at timestamp with time zone, timezone text, external_calendar_id text, google_calendar_id text, notes text, tenant_name text, assistant_mode text, contact_name text, contact_email text, contact_phone text, listing_title text, listing_address text, agent_name text, agent_email text, notify_email text, booking_notice_minutes integer, kind text, location text)
language sql
stable
security definer
set search_path = public
as $$
    select a.id, a.status, a.starts_at, a.ends_at, coalesce(a.timezone, t.timezone, 'Europe/Warsaw'),
           a.external_calendar_id, coalesce(nullif(a.booked_calendar_id, ''), ac.google_calendar_id), a.notes,
           t.name, t.assistant_mode,
           c.name, c.email, c.phone,
           l.title, nullif(concat_ws(', ', l.address, l.district, l.city), ''),
           coalesce(ag.full_name, ag.email), ag.email, ac.escalation_notify_email,
           coalesce(ac.booking_notice_minutes, 0),
           a.kind, a.location
    from appointments a
    join tenants t on t.id = a.tenant_id
    join contacts c on c.id = a.contact_id
    left join ai_config ac on ac.tenant_id = a.tenant_id
    left join listings l on l.id = a.listing_id
    left join tenant_users ag on ag.id = a.agent_id and ag.removed_at is null
    where a.id = p_appointment_id and a.tenant_id = p_tenant_id and a.contact_id = p_contact_id
      and (p_conversation_id is null or a.conversation_id = p_conversation_id);
$$;
revoke all on function client_appointment(uuid, uuid, uuid, uuid) from public, anon, authenticated;

commit;
