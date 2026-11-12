-- 0049: A record of which migrations this database has.
--
-- Until now nothing recorded which files had been run on Supabase, so the
-- only way to know was memory. From this migration on:
--
--   select * from migration_status();
--
-- in Supabase -> SQL Editor lists every migration, whether this database has
-- it, and when it was recorded. Read-only; safe to run any time.
--
-- How 0001-0048 are detected: each has a marker, something it created that no
-- earlier migration did and no later one removes (checked by applying the
-- migrations one by one on a scratch database). 0015 created nothing that
-- still exists on its own, so it counts as present when later ones are.
-- When 0049 runs, every migration it finds is written to schema_migrations.
--
-- From 0049 on, every migration starts with
--
--   select begin_migration('0050', 'short_name', '0049');
--
-- which stops it, before it changes anything, if the migration before it
-- hasn't been run or if this one already has. Re-running an old migration is
-- not harmless: many of them redefine functions, and an old definition would
-- silently replace a newer one (for example, re-running 0009 would undo part
-- of 0047's security fixes).

begin;

create table if not exists schema_migrations (
    version text primary key check (version ~ '^[0-9]{4}$'),
    name text not null,
    applied_at timestamptz not null default now(),
    how text not null default 'ran' check (how in ('ran', 'found'))
);
comment on table schema_migrations is
    'Which migrations this database has. how = ran: recorded by begin_migration when the file ran. how = found: detected by 0049 from what was already in the database.';
alter table schema_migrations enable row level security;
revoke all on schema_migrations from public, anon, authenticated;

-- What each migration before 0049 left behind (null: nothing of its own).
create or replace function migration_markers()
returns table (version text, name text, check_sql text)
language sql
immutable
set search_path = public
as $$
    values
        ('0001', 'extensions_and_tenants', $m$to_regclass('public.tenants') is not null$m$),
        ('0002', 'contacts_leads_conversations', $m$to_regclass('public.leads') is not null$m$),
        ('0003', 'knowledge_rag', $m$to_regclass('public.documents') is not null$m$),
        ('0004', 'appointments', $m$to_regclass('public.appointments') is not null$m$),
        ('0005', 'follow_up_engine', $m$to_regclass('public.follow_up_runs') is not null$m$),
        ('0006', 'escalations_crm_sync', $m$to_regclass('public.escalations') is not null$m$),
        ('0007', 'audit_and_tool_log', $m$to_regclass('public.audit_log') is not null$m$),
        ('0008', 'row_level_security', $m$to_regprocedure('public.current_tenant_id()') is not null$m$),
        ('0009', 'tenant_scoped_rpcs', $m$to_regprocedure('public.get_ai_config(uuid)') is not null$m$),
        ('0010', 'fix_embedding_dimension', $m$exists (select 1 from pg_attribute where attrelid = to_regclass('public.document_chunks') and attname = 'embedding' and format_type(atttypid, atttypmod) = 'vector(1024)')$m$),
        ('0011', 'ai_config_calendar_and_leads_unique', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_config' and column_name = 'google_calendar_id')$m$),
        ('0012', 'escalation_rpc', $m$to_regprocedure('public.insert_escalation(uuid,uuid,text,text,text)') is not null$m$),
        ('0013', 'email_drafts', $m$to_regclass('public.email_drafts') is not null$m$),
        ('0014', 'ai_config_gmail_address', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_config' and column_name = 'connected_gmail_address')$m$),
        ('0015', 'current_tenant_id_dashboard_fallback', null),
        ('0016', 'email_drafts_proposed_appointment', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'email_drafts' and column_name = 'proposed_appointment')$m$),
        ('0017', 'demo_requests', $m$to_regclass('public.demo_requests') is not null$m$),
        ('0018', 'email_drafts_follow_up_support', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'email_drafts' and column_name = 'follow_up_run_id')$m$),
        ('0019', 'ai_config_crm_webhook', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_config' and column_name = 'crm_webhook_url')$m$),
        ('0020', 'ai_config_escalation_notify', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_config' and column_name = 'escalation_notify_email')$m$),
        ('0021', 'dashboard_overview_stats', $m$to_regprocedure('public.get_dashboard_overview_stats(integer)') is not null$m$),
        ('0022', 'dashboard_overview_stats_resolution_time', $m$exists (select 1 from pg_proc where proname = 'get_dashboard_overview_stats' and pronamespace = 'public'::regnamespace and 'avg_escalation_resolution_seconds' = any(proargnames))$m$),
        ('0023', 'manual_email_draft_rpc', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'email_drafts' and column_name = 'authored_by')$m$),
        ('0024', 'revenue_dashboard_stats', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenants' and column_name = 'avg_deal_value')$m$),
        ('0025', 'whatsapp_drafts', $m$to_regclass('public.whatsapp_drafts') is not null$m$),
        ('0026', 'auto_crm_sync_and_follow_up_enrolment', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'follow_up_sequences' and column_name = 'auto_enrol')$m$),
        ('0027', 'platform_listings_team_inbox', $m$to_regclass('public.listings') is not null$m$),
        ('0028', 'listings_available_from', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'listings' and column_name = 'available_from')$m$),
        ('0029', 'listing_photos', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'listings' and column_name = 'photos')$m$),
        ('0030', 'appointment_listing_and_agent', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'appointments' and column_name = 'agent_id')$m$),
        ('0031', 'chat_contacts_and_duplicate_messages', $m$to_regprocedure('public.remove_duplicate_visitor_messages()') is not null$m$),
        ('0032', 'whatsapp_instant_replies', $m$to_regclass('public.whatsapp_inbound_messages') is not null$m$),
        ('0033', 'listing_links_booking_details', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'appointments' and column_name = 'conversation_id')$m$),
        ('0034', 'better_search_and_viewings', $m$to_regprocedure('public.search_norm(text)') is not null$m$),
        ('0035', 'email_instant_replies', $m$to_regprocedure('public.log_reply_send_failure(uuid,uuid,text,text,jsonb)') is not null$m$),
        ('0036', 'health_alerts', $m$to_regclass('public.health_check_state') is not null$m$),
        ('0037', 'sales_and_demo', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenants' and column_name = 'assistant_mode')$m$),
        ('0038', 'viewing_changes_and_reminders', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'appointments' and column_name = 'cancelled_by')$m$),
        ('0039', 'agency_email', $m$to_regclass('public.email_sending_identities') is not null$m$),
        ('0040', 'support_access', $m$to_regclass('public.support_access_log') is not null$m$),
        ('0041', 'support_permission_switch', $m$to_regclass('public.platform_settings') is not null$m$),
        ('0042', 'agent_calendars', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_config' and column_name = 'calendar_error')$m$),
        ('0043', 'valuations', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'intent')$m$),
        ('0044', 'asari_sync', $m$to_regclass('public.asari_connections') is not null$m$),
        ('0045', 'whatsapp_follow_ups', $m$exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_drafts' and column_name = 'sent_via')$m$),
        ('0046', 'email_attachments', $m$to_regclass('public.message_attachments') is not null$m$),
        ('0047', 'security_hardening', $m$to_regprocedure('public.is_api_user()') is not null$m$),
        ('0048', 'reliability', $m$to_regclass('public.whatsapp_delivery_failures') is not null$m$)
$$;

create or replace function migration_status()
returns table (version text, name text, in_database boolean, applied_at timestamptz, note text)
language plpgsql
volatile -- uses a temporary table
security definer
set search_path = public
as $$
declare
    r record;
    v_found boolean;
    v_latest text;
begin
    create temp table if not exists _migration_status (version text, name text, in_database boolean, applied_at timestamptz, note text) on commit drop;
    truncate _migration_status;

    for r in select * from migration_markers() order by 1 loop
        if r.check_sql is null then
            v_found := null;
        else
            execute 'select ' || r.check_sql into v_found;
        end if;
        insert into _migration_status values (r.version, r.name, v_found, null, null);
    end loop;

    -- Recorded migrations (0049 on), and when each was recorded.
    insert into _migration_status
    select s.version, s.name, true, s.applied_at, null
    from schema_migrations s
    where not exists (select 1 from _migration_status x where x.version = s.version);
    update _migration_status x set applied_at = s.applied_at
    from schema_migrations s where s.version = x.version;

    select max(x.version) into v_latest from _migration_status x where x.in_database;
    -- A migration with nothing of its own counts as present when a later one is.
    update _migration_status x
    set in_database = x.version < coalesce(v_latest, ''),
        note = 'nothing of its own to check; counted by the ones after it'
    where x.in_database is null;
    update _migration_status x
    set note = 'MISSING: a later migration is in the database but this one is not. Run it.'
    where not x.in_database and x.version < v_latest;

    return query select * from _migration_status order by 1;
end;
$$;

-- Called first by every migration from 0049 on (inside its BEGIN ... COMMIT).
create or replace function begin_migration(p_version text, p_name text, p_requires text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_at timestamptz;
begin
    select applied_at into v_at from schema_migrations where version = p_version;
    if found then
        raise exception 'Migration % (%) is already in this database (recorded %). Nothing was changed.', p_version, p_name, v_at
            using hint = 'Run select * from migration_status(); to see which migrations this database has.';
    end if;
    if p_requires is not null
       and not exists (select 1 from schema_migrations where version = p_requires)
       and not exists (select 1 from migration_status() s where s.version = p_requires and s.in_database) then
        raise exception 'Migration % needs migration % first. Nothing was changed.', p_version, p_requires
            using hint = 'Run the migrations in number order.';
    end if;
    insert into schema_migrations (version, name, how) values (p_version, p_name, 'ran');
end;
$$;

revoke all on function migration_markers() from public, anon, authenticated;
revoke all on function migration_status() from public, anon, authenticated;
revoke all on function begin_migration(text, text, text) from public, anon, authenticated;

select begin_migration('0049', 'migration_record', '0048');

-- Record what is already here.
insert into schema_migrations (version, name, how)
select s.version, s.name, 'found'
from migration_status() s
where s.in_database and s.version < '0049'
on conflict (version) do nothing;

commit;
