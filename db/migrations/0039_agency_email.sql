-- 0039_agency_email.sql
--
-- Every agency gets its own email address on Elliot, and every email Elliot
-- sends for an agency goes out under the agency's name -- no longer from the
-- platform owner's personal Gmail. See docs/agency-email.md.
--
--   * Inbound: the agency forwards its inbox (biuro@agency.pl) to
--     <slug>@in.getelliot.eu. Resend receives it and calls workflow 40, which
--     hands it to Elliot (workflow 01) and replies in the same thread.
--   * Outbound: workflow 39 sends every agency email through Resend from
--     "Agency name <slug@mail.getelliot.eu>" with Reply-To the agency's own
--     address, so a client's answer lands in the agency's inbox (and, through
--     the forward, with Elliot). An agency can send from its own domain once
--     that domain is verified in Resend (email_sending_identities, set by the
--     Elliot administrator).
--   * Gmail's forwarding confirmation code is caught and shown in Settings.
--
-- For n8n's service-role connection (functions) and the agency's Settings
-- page (ai_config columns under the existing RLS policy; the sending identity
-- is read-only for the agency). One transaction; safe to run again.

begin;

-- ── 1. Settings ──
alter table ai_config add column if not exists email_from_name text;
alter table ai_config add column if not exists email_inbound_last_at timestamptz;
alter table ai_config add column if not exists email_inbound_last_from text;
alter table ai_config add column if not exists email_forwarding_code text;
alter table ai_config add column if not exists email_forwarding_url text;
alter table ai_config add column if not exists email_forwarding_code_at timestamptz;
comment on column ai_config.email_from_name is 'Name clients see on emails from Elliot. Empty = the agency name.';
comment on column ai_config.connected_gmail_address is 'The agency''s own email address: client replies go here (Reply-To), and email sent to it and forwarded to <slug>@in.getelliot.eu reaches Elliot.';
comment on column ai_config.email_inbound_last_at is 'Last email that reached Elliot through the forwarding address (workflow 40).';
comment on column ai_config.email_forwarding_code is 'Gmail''s forwarding confirmation code, caught by workflow 40 and shown in Settings.';

-- The agency's own sending domain, once verified in Resend. Only the service
-- role (the Elliot administrator, n8n) can change it; the agency can see it.
create table if not exists email_sending_identities (
    tenant_id    uuid primary key references tenants(id) on delete cascade,
    from_address text not null check (from_address ~* '^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$'),
    created_at   timestamptz not null default now()
);
comment on table email_sending_identities is 'An agency''s own From address (domain verified in Resend). Without a row, Elliot sends from <slug>@mail.getelliot.eu.';
alter table email_sending_identities enable row level security;
drop policy if exists tenant_read_email_sending_identities on email_sending_identities;
create policy tenant_read_email_sending_identities on email_sending_identities
    for select using (tenant_id = current_tenant_id());
revoke all on email_sending_identities from anon, authenticated;
grant select on email_sending_identities to authenticated;

-- ── 2. Elliot's email domains ──
create or replace function elliot_email_domain(p_kind text)
returns text language sql immutable as $$
    select case p_kind when 'inbound' then 'in.getelliot.eu' else 'mail.getelliot.eu' end;
$$;

create or replace function agency_inbound_address(p_slug text)
returns text language sql immutable as $$
    select lower(btrim(p_slug)) || '@' || elliot_email_domain('inbound');
$$;

-- ── 3. Who an email is from ──
-- p_audience 'client': From the agency (its name), Reply-To the agency's own
-- address (or its Elliot address when it has none). 'team': emails for the
-- agency's own people (alerts, summaries) -- From "Elliot", no Reply-To.
-- No tenant: Elliot's own notifications.
create or replace function email_sender(p_tenant_id uuid, p_audience text default 'client')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with t as (
        select t.slug, t.name, t.assistant_mode,
               nullif(btrim(ac.email_from_name), '') as from_name,
               nullif(lower(btrim(ac.connected_gmail_address)), '') as agency_email,
               esi.from_address as own_from
        from tenants t
        left join ai_config ac on ac.tenant_id = t.id
        left join email_sending_identities esi on esi.tenant_id = t.id
        where t.id = p_tenant_id
    )
    select coalesce(
        (select jsonb_build_object(
            'name', case
                when p_audience = 'team' and t.assistant_mode <> 'sales' then 'Elliot · ' || t.name
                when p_audience = 'team' then 'Elliot'
                else coalesce(t.from_name, t.name) end,
            'address', coalesce(t.own_from, t.slug || '@' || elliot_email_domain('sending')),
            'reply_to', case when p_audience = 'team' then null
                             else coalesce(t.agency_email, agency_inbound_address(t.slug)) end,
            'inbound_address', agency_inbound_address(t.slug),
            'own_domain', t.own_from is not null
         ) from t),
        jsonb_build_object('name', 'Elliot', 'address', 'notifications@' || elliot_email_domain('sending'),
                           'reply_to', null, 'inbound_address', null, 'own_domain', false));
$$;
revoke all on function email_sender(uuid, text) from public, anon, authenticated;

-- ── 4. Which agency an incoming email is for ──
-- Its Elliot address (<slug>@in.getelliot.eu) among the recipients first --
-- a forwarded email keeps the original "To", so Resend's envelope recipients
-- are passed in too -- then the agency's own address.
create or replace function email_inbound_tenant(p_recipients text[])
returns table (tenant_id uuid, tenant_slug text, tenant_name text, agency_email text, matched_by text)
language sql
stable
security definer
set search_path = public
as $$
    with r as (select distinct lower(btrim(x)) as addr from unnest(coalesce(p_recipients, '{}')) x where btrim(x) <> '')
    select t.id, t.slug, t.name, nullif(lower(btrim(ac.connected_gmail_address)), ''), m.matched_by
    from (
        select t.id, 'elliot_address'::text as matched_by, 1 as rank
        from tenants t join r on r.addr = agency_inbound_address(t.slug)
        union all
        select ac.tenant_id, 'agency_address', 2
        from ai_config ac join r on r.addr = lower(btrim(ac.connected_gmail_address))
    ) m
    join tenants t on t.id = m.id and t.status = 'active'
    left join ai_config ac on ac.tenant_id = t.id
    order by m.rank
    limit 1;
$$;
revoke all on function email_inbound_tenant(text[]) from public, anon, authenticated;

-- ── 5. Each email answered once ──
-- Keyed by the email's own Message-ID, the same key workflow 16 (Gmail) now
-- uses, so an email that arrives both ways is still answered once.
create or replace function email_inbound_claim(p_tenant_id uuid, p_message_id text, p_from text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_new boolean;
begin
    v_new := claim_whatsapp_message(p_tenant_id,
        case when nullif(btrim(coalesce(p_message_id, '')), '') is null then null
             else 'email:' || lower(btrim(p_message_id)) end);
    if v_new then
        update ai_config set email_inbound_last_at = now(), email_inbound_last_from = left(lower(btrim(p_from)), 200)
        where tenant_id = p_tenant_id;
    end if;
    return v_new;
end;
$$;
revoke all on function email_inbound_claim(uuid, text, text) from public, anon, authenticated;

-- ── 6. Gmail's forwarding confirmation ──
create or replace function record_email_forwarding_code(p_tenant_id uuid, p_code text, p_url text)
returns void
language sql
security definer
set search_path = public
as $$
    update ai_config
       set email_forwarding_code = nullif(left(btrim(coalesce(p_code, '')), 40), ''),
           email_forwarding_url = case when p_url ~* '^https://[a-z0-9.-]*google\.com/' then left(p_url, 1000) end,
           email_forwarding_code_at = now(),
           email_inbound_last_at = now(),
           email_inbound_last_from = 'forwarding-noreply@google.com'
     where tenant_id = p_tenant_id;
    insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
    values (p_tenant_id, 'system', 'workflow_40', 'email_forwarding_code', jsonb_build_object('code', p_code));
$$;
revoke all on function record_email_forwarding_code(uuid, text, text) from public, anon, authenticated;

commit;
