-- 0051: Data protection: export or erase a client, keep data only as long as
-- the agency chooses, and remove an agency's data when it leaves.
--
--   1. export_client(contact) / erase_client(contact): an agency admin answers
--      a client's access or erasure request from the conversation page.
--      Erasing removes the client's contact, conversations, messages, leads,
--      viewings, drafts, follow-ups, hand-overs, tool and CRM log rows and
--      file records, and returns the stored files for the dashboard to delete.
--      One audit row records that it happened (counts only, no personal data).
--   2. ai_config.retention_months: when set, clients with no activity for
--      that many months are erased by workflow 43 every night
--      (apply_retention). Off (null) unless the agency or you set it.
--      retention_preview() shows who would go, without changing anything.
--   3. erase_agency(tenant, slug): removes everything of a cancelled agency.
--      Only from the control panel, only when the agency is cancelled and the
--      slug is typed. Returns the stored files and logins to remove.
--
-- None of this runs by itself until you set a retention period or press a
-- button. Undo: drop the functions; alter table ai_config drop column
-- retention_months. Erased data can only come back from a backup.

begin;
select begin_migration('0051', 'data_protection', '0050');

-- ─────────────────────────────────────────────────────────────
-- 0. Who may: an admin of this agency (or you, viewing it with permission)
-- ─────────────────────────────────────────────────────────────
create or replace function require_agency_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_tenant uuid := current_tenant_id();
begin
    if v_tenant is null or coalesce(current_member_role(), '') <> 'admin' then
        raise exception 'Only an admin of the agency can do this.' using errcode = '42501';
    end if;
    return v_tenant;
end;
$$;
revoke all on function require_agency_admin() from public, anon;
grant execute on function require_agency_admin() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 1. One client's data
-- ─────────────────────────────────────────────────────────────
-- Everything Elliot holds about one contact, as one JSON document (a copy for
-- the client, GDPR Art. 15 and 20). Service role only; see export_client().
create or replace function client_data(p_tenant_id uuid, p_contact_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with c as (select * from contacts where id = p_contact_id and tenant_id = p_tenant_id),
         conv as (select * from conversations where tenant_id = p_tenant_id and contact_id = p_contact_id)
    select case when not exists (select 1 from c) then null else jsonb_build_object(
        'exported_at', now(),
        'agency', (select name from tenants where id = p_tenant_id),
        'contact', (select jsonb_build_object('name', name, 'email', email, 'phone', phone, 'company', company,
                                              'source', source, 'first_seen', created_at,
                                              'follow_ups_stopped_at', follow_up_opt_out_at) from c),
        'conversations', coalesce((
            select jsonb_agg(jsonb_build_object(
                'channel', v.channel, 'started', v.created_at,
                'messages', coalesce((select jsonb_agg(jsonb_build_object('from', case m.role when 'user' then 'client' when 'assistant' then 'Elliot (AI)' when 'human_agent' then 'agency team' else m.role end,
                                                                         'at', m.created_at, 'text', m.content) order by m.created_at)
                                      from messages m where m.conversation_id = v.id and m.role in ('user', 'assistant', 'human_agent')), '[]'::jsonb),
                'files', coalesce((select jsonb_agg(jsonb_build_object('name', a.filename, 'type', a.content_type, 'received', a.created_at))
                                   from message_attachments a where a.conversation_id = v.id), '[]'::jsonb)
            ) order by v.created_at) from conv v), '[]'::jsonb),
        'enquiries', coalesce((select jsonb_agg(jsonb_build_object('status', l.status, 'intent', l.intent, 'score', l.score,
                                                                   'answers', l.qualification_answers, 'created', l.created_at))
                               from leads l where l.tenant_id = p_tenant_id and l.contact_id = p_contact_id), '[]'::jsonb),
        'appointments', coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
                                                                      'status', a.status, 'location', a.location, 'notes', a.notes) order by a.starts_at)
                                  from appointments a where a.tenant_id = p_tenant_id and a.contact_id = p_contact_id), '[]'::jsonb),
        'messages_drafted', coalesce((
            select jsonb_agg(d) from (
                select jsonb_build_object('channel', 'email', 'subject', e.subject, 'text', e.body, 'status', e.status, 'created', e.created_at) as d
                  from email_drafts e where e.tenant_id = p_tenant_id
                   and (e.contact_id = p_contact_id or e.conversation_id in (select id from conv))
                union all
                select jsonb_build_object('channel', 'whatsapp', 'text', w.body, 'status', w.status, 'created', w.created_at)
                  from whatsapp_drafts w where w.tenant_id = p_tenant_id
                   and (w.contact_id = p_contact_id or w.conversation_id in (select id from conv))) x), '[]'::jsonb)
    ) end;
$$;
revoke all on function client_data(uuid, uuid) from public, anon, authenticated;

create or replace function export_client(p_contact_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := require_agency_admin();
    v jsonb := client_data(v_tenant, p_contact_id);
begin
    if v is null then raise exception 'Client not found.' using errcode = 'P0002'; end if;
    insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
    values (v_tenant, 'tenant_user', coalesce(auth.uid()::text, 'unknown'), 'privacy.client_exported',
            jsonb_build_object('contact_id', p_contact_id));
    return v;
end;
$$;
revoke all on function export_client(uuid) from public, anon;
grant execute on function export_client(uuid) to authenticated;

-- Erases one client. Returns what was removed (counts), the stored files the
-- caller must delete from Storage (email-attachments bucket), and the Google
-- Calendar events that still exist (the database can't reach Google).
create or replace function erase_client_data(p_tenant_id uuid, p_contact_id uuid, p_actor text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_conv uuid[];
    v_leads uuid[];
    v_appts uuid[];
    v_files text[];
    v_events jsonb;
    n_msg int; n_conv int; n_leads int; n_appts int; n_drafts int; n_files int; n_log int;
    v_ids text[];
begin
    if not exists (select 1 from contacts where id = p_contact_id and tenant_id = p_tenant_id) then
        raise exception 'Client not found.' using errcode = 'P0002';
    end if;

    select coalesce(array_agg(id), '{}') into v_conv from conversations where tenant_id = p_tenant_id and contact_id = p_contact_id;
    select coalesce(array_agg(id), '{}') into v_leads from leads where tenant_id = p_tenant_id and contact_id = p_contact_id;
    select coalesce(array_agg(id), '{}') into v_appts from appointments where tenant_id = p_tenant_id and contact_id = p_contact_id;
    select coalesce(array_agg(storage_path), '{}') into v_files from message_attachments where tenant_id = p_tenant_id and conversation_id = any(v_conv);
    select coalesce(jsonb_agg(jsonb_build_object('calendar', coalesce(booked_calendar_id, ''), 'event_id', external_calendar_id, 'starts_at', starts_at, 'status', status)), '[]'::jsonb)
      into v_events
      from appointments
     where id = any(v_appts) and nullif(external_calendar_id, '') is not null and status = 'confirmed' and ends_at > now();
    select count(*) into n_msg from messages where conversation_id = any(v_conv);

    v_ids := array(select unnest(v_conv)::text union all select unnest(v_leads)::text
                   union all select unnest(v_appts)::text union all select p_contact_id::text);

    -- Logs that hold their words or details.
    delete from tool_call_log where tenant_id = p_tenant_id and conversation_id = any(v_conv);
    get diagnostics n_log = row_count;
    delete from crm_sync_log where tenant_id = p_tenant_id and entity_id::text = any(v_ids);
    delete from audit_log where tenant_id = p_tenant_id
       and (details ->> 'conversation_id' = any(v_ids) or details ->> 'contact_id' = any(v_ids)
            or details ->> 'appointment_id' = any(v_ids) or details ->> 'lead_id' = any(v_ids));

    delete from email_drafts where tenant_id = p_tenant_id and (contact_id = p_contact_id or conversation_id = any(v_conv));
    get diagnostics n_drafts = row_count;
    delete from whatsapp_drafts where tenant_id = p_tenant_id and (contact_id = p_contact_id or conversation_id = any(v_conv));
    get diagnostics n_files = row_count;
    n_drafts := n_drafts + n_files;
    delete from message_attachments where tenant_id = p_tenant_id and conversation_id = any(v_conv);
    get diagnostics n_files = row_count;
    delete from appointments where id = any(v_appts);
    get diagnostics n_appts = row_count;
    delete from leads where id = any(v_leads);            -- follow-up runs go with them
    get diagnostics n_leads = row_count;
    delete from conversations where id = any(v_conv);     -- messages and hand-overs go with them
    get diagnostics n_conv = row_count;
    delete from contacts where id = p_contact_id and tenant_id = p_tenant_id;

    insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
    values (p_tenant_id, case when p_actor like 'workflow%' then 'system' else 'tenant_user' end, p_actor, 'privacy.client_erased',
            jsonb_build_object('reason', p_reason, 'conversations', n_conv, 'messages', n_msg, 'leads', n_leads,
                               'appointments', n_appts, 'drafts', n_drafts, 'files', n_files, 'log_rows', n_log));

    return jsonb_build_object('conversations', n_conv, 'messages', n_msg, 'leads', n_leads, 'appointments', n_appts,
                              'drafts', n_drafts, 'files', n_files, 'log_rows', n_log,
                              'storage_paths', to_jsonb(v_files), 'calendar_events', v_events);
end;
$$;
revoke all on function erase_client_data(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function erase_client(p_contact_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := require_agency_admin();
begin
    return erase_client_data(v_tenant, p_contact_id, coalesce(auth.uid()::text, 'unknown'), 'request');
end;
$$;
revoke all on function erase_client(uuid) from public, anon;
grant execute on function erase_client(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Keeping data only as long as needed
-- ─────────────────────────────────────────────────────────────
alter table ai_config add column if not exists retention_months integer;
alter table ai_config drop constraint if exists ai_config_retention_months_check;
alter table ai_config add constraint ai_config_retention_months_check check (retention_months is null or retention_months between 3 and 120);
comment on column ai_config.retention_months is
    '0051: erase clients with no activity for this many months (workflow 43, nightly). Null = keep until the agency deletes them.';

-- The last time anything happened with a client: a message, a booking, a
-- change to their enquiry, or the contact itself.
create or replace function client_last_activity(p_contact_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
    select greatest(
        (select coalesce(updated_at, created_at) from contacts where id = p_contact_id),
        (select max(m.created_at) from messages m join conversations c on c.id = m.conversation_id where c.contact_id = p_contact_id),
        (select max(greatest(a.updated_at, a.ends_at)) from appointments a where a.contact_id = p_contact_id),
        (select max(l.updated_at) from leads l where l.contact_id = p_contact_id));
$$;
revoke all on function client_last_activity(uuid) from public, anon, authenticated;

-- Who retention would erase now. Changes nothing; run it before switching
-- retention on for an agency.
create or replace function retention_preview(p_now timestamptz default now())
returns table (tenant_id uuid, agency text, contact_id uuid, contact_name text, last_activity timestamptz)
language sql
stable
security definer
set search_path = public
as $$
    select t.id, t.name, c.id, coalesce(c.name, c.email, c.phone, 'Unknown'), client_last_activity(c.id)
    from ai_config ac
    join tenants t on t.id = ac.tenant_id
    join contacts c on c.tenant_id = ac.tenant_id
    where ac.retention_months is not null
      and client_last_activity(c.id) < p_now - make_interval(months => ac.retention_months)
      -- Never someone with a viewing still to come.
      and not exists (select 1 from appointments a where a.contact_id = c.id and a.status = 'confirmed' and a.ends_at > p_now)
    order by t.name, 5;
$$;
revoke all on function retention_preview(timestamptz) from public, anon, authenticated;

-- Workflow 43, nightly: erase up to p_limit clients that retention_preview()
-- lists, plus Elliot's own website enquiries (demo_requests) older than the
-- sales account's retention. Returns the stored files to delete.
create or replace function apply_retention(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r record;
    v jsonb;
    v_files jsonb := '[]'::jsonb;
    v_events jsonb := '[]'::jsonb;
    n int := 0;
    n_requests int := 0;
    v_sales_months int;
begin
    for r in select * from retention_preview() limit greatest(coalesce(p_limit, 200), 1) loop
        v := erase_client_data(r.tenant_id, r.contact_id, 'workflow_43', 'retention');
        v_files := v_files || coalesce(v -> 'storage_paths', '[]'::jsonb);
        v_events := v_events || coalesce(v -> 'calendar_events', '[]'::jsonb);
        n := n + 1;
    end loop;

    select ac.retention_months into v_sales_months
      from tenants t join ai_config ac on ac.tenant_id = t.id
     where t.assistant_mode = 'sales' and ac.retention_months is not null
     order by t.created_at limit 1;
    if v_sales_months is not null then
        delete from demo_requests where created_at < now() - make_interval(months => v_sales_months);
        get diagnostics n_requests = row_count;
    end if;

    return jsonb_build_object('clients_erased', n, 'website_enquiries_erased', n_requests,
                              'storage_paths', v_files, 'calendar_events', v_events);
end;
$$;
revoke all on function apply_retention(integer) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. An agency that has left
-- ─────────────────────────────────────────────────────────────
create or replace function erase_agency(p_tenant_id uuid, p_confirm_slug text, p_actor text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    t tenants;
    v_files jsonb;
    v_logins jsonb;
    v_counts jsonb;
begin
    select * into t from tenants where id = p_tenant_id;
    if not found then raise exception 'Agency not found.' using errcode = 'P0002'; end if;
    if t.status <> 'cancelled' then
        raise exception 'Set the agency to Cancelled first. Only a cancelled agency''s data can be deleted.';
    end if;
    if p_confirm_slug is distinct from t.slug then
        raise exception 'Type the agency''s short name (%) to confirm.', t.slug;
    end if;
    if t.assistant_mode <> 'agency' then
        raise exception 'Elliot''s own and demo accounts can''t be deleted this way.';
    end if;

    -- Stored files: everything under the agency's folder in both buckets.
    select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name)), '[]'::jsonb) into v_files
      from storage.objects o
     where o.bucket_id in ('email-attachments', 'listing-photos') and o.name like p_tenant_id::text || '/%';
    -- Logins used only for this agency.
    select coalesce(jsonb_agg(u.auth_user_id), '[]'::jsonb) into v_logins
      from tenant_users u
     where u.tenant_id = p_tenant_id
       and not exists (select 1 from tenant_users o where o.auth_user_id = u.auth_user_id and o.tenant_id <> p_tenant_id);
    v_counts := jsonb_build_object(
        'contacts', (select count(*) from contacts where tenant_id = p_tenant_id),
        'conversations', (select count(*) from conversations where tenant_id = p_tenant_id),
        'messages', (select count(*) from messages where tenant_id = p_tenant_id),
        'listings', (select count(*) from listings where tenant_id = p_tenant_id),
        'team', (select count(*) from tenant_users where tenant_id = p_tenant_id));

    delete from tenants where id = p_tenant_id;   -- every agency table cascades from here

    insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
    values (null, 'system', coalesce(p_actor, 'platform'), 'platform.agency_erased',
            jsonb_build_object('name', t.name, 'slug', t.slug, 'counts', v_counts));
    return jsonb_build_object('name', t.name, 'counts', v_counts, 'files', v_files, 'logins', v_logins);
end;
$$;
revoke all on function erase_agency(uuid, text, text) from public, anon, authenticated;

commit;
