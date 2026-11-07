-- 0031_chat_contacts_and_duplicate_messages.sql
--
-- 1. Removes visitor messages that were saved more than once. Workflow 01's
--    "Log User Message" ran once per row of conversation history, so the
--    5th message in a chat was saved 5 times (fixed in 01: it now runs once).
--    A copy = same conversation, same text, saved within 10 seconds of the
--    first. The first one is kept.
-- 2. upsert_conversation_contact(): one place that saves a person's details
--    for a conversation and links the conversation to them. Matches an
--    existing contact by email, then by phone (digits only, so "+48 601 234
--    567" and "48601234567" are the same person), then the conversation's
--    own contact; otherwise creates one. Used by workflows 01 (website
--    chat), 10 (lead capture), 16 (email) and 25 (WhatsApp; these two use
--    upsert_conversation_contact_row, which returns the row), replacing their
--    INSERT ... ON CONFLICT (tenant_id, email|phone), which Postgres rejects
--    because those unique indexes are partial ("where email is not null").
-- 3. identify_chat_visitor(): workflow 01 calls this on every website chat
--    message. Saves the details the chat window sends and says whether the
--    chat has a name plus an email or phone. Elliot doesn't answer until it
--    does.
--
-- Both functions are for n8n's service-role connection only.
--
-- One transaction; safe to run again.

begin;

-- ── 1. Duplicate visitor messages ──
create or replace function remove_duplicate_visitor_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
    delete from messages m
    using messages first_copy
    where m.role = 'user'
      and first_copy.role = 'user'
      and first_copy.conversation_id = m.conversation_id
      and first_copy.content = m.content
      and (first_copy.created_at, first_copy.id) < (m.created_at, m.id)
      and m.created_at - first_copy.created_at < interval '10 seconds';
    get diagnostics n = row_count;
    return n;
end;
$$;

revoke all on function remove_duplicate_visitor_messages() from public, anon, authenticated;

do $$
begin
    raise notice 'Removed % duplicate visitor message(s)', remove_duplicate_visitor_messages();
end $$;

-- ── 2. Save a person's details for a conversation ──
create or replace function upsert_conversation_contact(
    p_tenant_id uuid,
    p_conversation_id uuid,
    p_name text,
    p_email text,
    p_phone text,
    p_company text default null,
    p_source text default 'chat_widget'
)
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
    -- Ignore things that can't be an email address or a phone number.
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

    -- Same person: by email, then phone, then whoever this chat already belongs to.
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
        -- Fill in what's new. An email or phone already belonging to someone
        -- else in the agency is left where it is.
        -- A name typed into the chat window replaces the old one; a WhatsApp
        -- profile name or email display name only fills a blank, so a name
        -- the team corrected isn't overwritten.
        update contacts c
        set name    = case when coalesce(p_source, 'chat_widget') = 'chat_widget'
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

-- Same, returning the saved contact's details. For workflows that need the
-- row: a query that joins contacts to the function's id can't see a contact
-- the function has just created (it's read with the statement's snapshot),
-- so the first email or WhatsApp from a new person would return nothing.
create or replace function upsert_conversation_contact_row(
    p_tenant_id uuid,
    p_conversation_id uuid,
    p_name text,
    p_email text,
    p_phone text,
    p_company text default null,
    p_source text default 'chat_widget'
)
returns table (id uuid, name text, email text, phone text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid := upsert_conversation_contact(p_tenant_id, p_conversation_id, p_name, p_email, p_phone, p_company, p_source);
begin
    return query select c.id, c.name, c.email, c.phone from contacts c where c.id = v_id;
end;
$$;

revoke all on function upsert_conversation_contact_row(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

-- ── 3. Website chat: who is this, and can Elliot start? ──
create or replace function identify_chat_visitor(
    p_tenant_id uuid,
    p_conversation_id uuid,
    p_name text,
    p_email text,
    p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
    c record;
begin
    if nullif(btrim(coalesce(p_name, '')), '') is not null
       or nullif(btrim(coalesce(p_email, '')), '') is not null
       or nullif(btrim(coalesce(p_phone, '')), '') is not null then
        v_id := upsert_conversation_contact(p_tenant_id, p_conversation_id, p_name, p_email, p_phone, null, 'chat_widget');
    else
        select contact_id into v_id from conversations where id = p_conversation_id and tenant_id = p_tenant_id;
    end if;

    select id, name, email, phone into c from contacts where id = v_id;

    return jsonb_build_object(
        'contact_id', c.id,
        'name', c.name,
        'email', c.email,
        'phone', c.phone,
        'ready', c.id is not null and c.name is not null and (c.email is not null or c.phone is not null)
    );
end;
$$;

revoke all on function identify_chat_visitor(uuid, uuid, text, text, text) from public, anon, authenticated;

commit;
