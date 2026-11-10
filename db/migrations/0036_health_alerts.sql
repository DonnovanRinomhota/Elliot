-- 0036_health_alerts.sql
--
-- System health checks and alerts (workflow 33) -- see
-- docs/workflow-specs/33-health-check.md.
--
-- Two audiences, each with email and WhatsApp that can be switched on and off
-- separately:
--   * Platform (you, the Elliot operator): every check (Claude, Gmail,
--     Calendar, WhatsApp, Voyage, database) plus every failure in any agency.
--     Settings live in platform_alert_settings (one row), edited in the
--     Control panel.
--   * Each agency: only failures in its own account (a reply that couldn't be
--     sent, Elliot failing to answer, a booking that failed). Settings are
--     columns on ai_config, edited by the agency on its Settings page.
--
-- health_alert_plan() does all the deciding (what changed, who to tell, on
-- which channel, when to repeat) so the n8n workflow only sends what it gets
-- back. That keeps the rules in one place and testable here.
--
-- For n8n's service-role connection, except the ai_config columns, which the
-- agency edits through the existing ai_config RLS policy. One transaction;
-- safe to run again.

begin;

-- ── 1. Agency alert settings ──
alter table ai_config add column if not exists alert_email_enabled boolean not null default false;
alter table ai_config add column if not exists alert_email text;
alter table ai_config add column if not exists alert_whatsapp_enabled boolean not null default false;
alter table ai_config add column if not exists alert_whatsapp_number text;

comment on column ai_config.alert_email is
  'Where problems in this agency''s account are emailed (reply not sent, Elliot failed, booking failed). Only used when alert_email_enabled.';
comment on column ai_config.alert_whatsapp_number is
  'WhatsApp number (international format, digits only) for the same alerts. Only used when alert_whatsapp_enabled.';

-- ── 2. Platform alert settings: exactly one row ──
create table if not exists platform_alert_settings (
    id                      boolean primary key default true check (id),
    email_enabled           boolean not null default true,
    email_to                text,
    whatsapp_enabled        boolean not null default false,
    whatsapp_to             text,
    -- the WhatsApp number alerts are sent FROM (a phone_number_id in your Meta app)
    whatsapp_sender_id      text,
    daily_summary_enabled   boolean not null default true,
    repeat_hours            integer not null default 6 check (repeat_hours between 1 and 168),
    last_event_scan_at      timestamptz not null default now(),
    last_daily_summary_on   date,
    -- how the last alert on each channel went, shown in the Control panel
    last_email_status       text,
    last_email_at           timestamptz,
    last_whatsapp_status    text,
    last_whatsapp_at        timestamptz,
    updated_at              timestamptz not null default now()
);
insert into platform_alert_settings (id) values (true) on conflict (id) do nothing;

alter table platform_alert_settings enable row level security;
revoke all on platform_alert_settings from anon, authenticated;

-- ── 3. Last known state of each check ──
create table if not exists health_check_state (
    check_key       text primary key,
    label           text not null,
    ok              boolean not null,
    detail          text,
    failing_since   timestamptz,
    last_alert_at   timestamptz,
    checked_at      timestamptz not null default now()
);
alter table health_check_state enable row level security;
revoke all on health_check_state from anon, authenticated;

-- ── 4. The decision function ──
-- p_results: [{ "key": "claude", "label": "Claude (AI replies)", "ok": true, "detail": "..." }, ...]
-- Returns one row per message to send:
--   channel 'email' | 'whatsapp', recipient, subject (email), body (email, may
--   have newlines), short (one line, for the WhatsApp template), audience
--   'platform' | 'agency', tenant_id.
create or replace function health_alert_plan(p_results jsonb, p_now timestamptz default now())
returns table (
    channel     text,
    recipient   text,
    sender_id   text,
    subject     text,
    body        text,
    short       text,
    audience    text,
    tenant_id   uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
    s               platform_alert_settings%rowtype;
    r               jsonb;
    v_key           text;
    v_label         text;
    v_ok            boolean;
    v_detail        text;
    prev            health_check_state%rowtype;
    v_new_fail      text[] := '{}';
    v_still_fail    text[] := '{}';
    v_recovered     text[] := '{}';
    v_all_lines     text[] := '{}';
    v_event_lines   text[] := '{}';
    v_scan_from     timestamptz;
    v_lines         text;
    v_subject       text;
    v_short         text;
    v_send_daily    boolean := false;
    v_local         timestamp;
    t               record;
begin
    select * into s from platform_alert_settings where id;
    if not found then
        insert into platform_alert_settings (id) values (true) returning * into s;
    end if;

    -- 4a. Compare each check with its previous state.
    for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
        v_key    := r->>'key';
        v_label  := coalesce(nullif(r->>'label', ''), v_key);
        v_ok     := coalesce((r->>'ok')::boolean, false);
        v_detail := left(coalesce(r->>'detail', ''), 300);
        continue when v_key is null;

        select * into prev from health_check_state where check_key = v_key;

        if v_ok then
            v_all_lines := v_all_lines || ('OK: ' || v_label);
            if found and not prev.ok then
                v_recovered := v_recovered || v_label;
            end if;
            insert into health_check_state as h (check_key, label, ok, detail, failing_since, last_alert_at, checked_at)
            values (v_key, v_label, true, null, null, null, p_now)
            on conflict (check_key) do update
                set label = excluded.label, ok = true, detail = null, failing_since = null,
                    last_alert_at = null, checked_at = p_now;
        else
            v_all_lines := v_all_lines || ('FAILING: ' || v_label || ' -- ' || v_detail);
            if not found or prev.ok then
                v_new_fail := v_new_fail || (v_label || ' -- ' || v_detail);
                insert into health_check_state as h (check_key, label, ok, detail, failing_since, last_alert_at, checked_at)
                values (v_key, v_label, false, v_detail, p_now, p_now, p_now)
                on conflict (check_key) do update
                    set label = excluded.label, ok = false, detail = excluded.detail,
                        failing_since = p_now, last_alert_at = p_now, checked_at = p_now;
            else
                if prev.last_alert_at is null or prev.last_alert_at <= p_now - make_interval(hours => s.repeat_hours) then
                    v_still_fail := v_still_fail || (v_label || ' -- ' || v_detail || ' (failing since '
                        || to_char(prev.failing_since at time zone 'Europe/Warsaw', 'DD Mon HH24:MI') || ')');
                    update health_check_state
                        set detail = v_detail, last_alert_at = p_now, checked_at = p_now, label = v_label
                        where check_key = v_key;
                else
                    update health_check_state
                        set detail = v_detail, checked_at = p_now, label = v_label
                        where check_key = v_key;
                end if;
            end if;
        end if;
    end loop;

    -- 4b. Failures recorded by the workflows since the last scan.
    v_scan_from := s.last_event_scan_at;

    for t in
        select a.tenant_id, coalesce(tn.name, 'Platform') as tenant_name, a.event_type,
               count(*) as n, (array_agg(left(coalesce(a.details->>'error', a.details->>'message', ''), 160) order by a.created_at desc))[1] as last_error
        from audit_log a
        left join tenants tn on tn.id = a.tenant_id
        where a.created_at > v_scan_from and a.created_at <= p_now
          and (a.event_type like '%\_failed' escape '\' or a.event_type in ('email_unmatched_mailbox', 'workflow_error'))
        group by a.tenant_id, tn.name, a.event_type
        order by tenant_name, a.event_type
    loop
        v_event_lines := v_event_lines || (t.tenant_name || ': ' || t.n || ' x ' || replace(t.event_type, '_', ' ')
            || case when t.last_error <> '' then ' -- ' || t.last_error else '' end);
    end loop;

    -- 4c. Daily summary, once a day after 08:00 Warsaw time.
    v_local := p_now at time zone 'Europe/Warsaw';
    if s.daily_summary_enabled and extract(hour from v_local) >= 8
       and (s.last_daily_summary_on is null or s.last_daily_summary_on < v_local::date) then
        v_send_daily := true;
    end if;

    update platform_alert_settings
        set last_event_scan_at = p_now,
            last_daily_summary_on = case when v_send_daily then v_local::date else last_daily_summary_on end
        where id;

    -- 4d. Platform message.
    if cardinality(v_new_fail) + cardinality(v_still_fail) + cardinality(v_recovered) + cardinality(v_event_lines) > 0 then
        v_lines := '';
        if cardinality(v_new_fail) > 0 then
            v_lines := v_lines || E'NEW PROBLEMS\n- ' || array_to_string(v_new_fail, E'\n- ') || E'\n\n';
        end if;
        if cardinality(v_still_fail) > 0 then
            v_lines := v_lines || E'STILL FAILING\n- ' || array_to_string(v_still_fail, E'\n- ') || E'\n\n';
        end if;
        if cardinality(v_recovered) > 0 then
            v_lines := v_lines || E'BACK TO NORMAL\n- ' || array_to_string(v_recovered, E'\n- ') || E'\n\n';
        end if;
        if cardinality(v_event_lines) > 0 then
            v_lines := v_lines || E'FAILURES SINCE THE LAST CHECK\n- ' || array_to_string(v_event_lines, E'\n- ') || E'\n\n';
        end if;

        if cardinality(v_new_fail) + cardinality(v_still_fail) > 0 then
            v_subject := 'Elliot alert: ' || (cardinality(v_new_fail) + cardinality(v_still_fail)) || ' check(s) failing';
            v_short := 'Elliot alert: ' || array_to_string(array(
                select split_part(x, ' -- ', 1) from unnest(v_new_fail || v_still_fail) x), ', ')
                || ' failing. Details in your email.';
        elsif cardinality(v_event_lines) > 0 then
            v_subject := 'Elliot alert: ' || cardinality(v_event_lines) || ' type(s) of failure since the last check';
            v_short := 'Elliot alert: some messages failed since the last check. Details in your email.';
        else
            v_subject := 'Elliot: back to normal';
            v_short := 'Elliot: ' || array_to_string(v_recovered, ', ') || ' back to normal.';
        end if;
        v_lines := v_lines || E'Full status\n' || array_to_string(v_all_lines, E'\n');

        if s.email_enabled and nullif(btrim(s.email_to), '') is not null then
            channel := 'email'; recipient := btrim(s.email_to); sender_id := null;
            subject := v_subject; body := v_lines; short := v_short; audience := 'platform'; tenant_id := null;
            return next;
        end if;
        if s.whatsapp_enabled and nullif(btrim(s.whatsapp_to), '') is not null and nullif(btrim(s.whatsapp_sender_id), '') is not null then
            channel := 'whatsapp'; recipient := regexp_replace(s.whatsapp_to, '\D', '', 'g'); sender_id := btrim(s.whatsapp_sender_id);
            subject := v_subject; body := v_lines; short := left(v_short, 900); audience := 'platform'; tenant_id := null;
            return next;
        end if;
    elsif v_send_daily and s.email_enabled and nullif(btrim(s.email_to), '') is not null then
        channel := 'email'; recipient := btrim(s.email_to); sender_id := null;
        subject := 'Elliot daily check: all systems OK';
        body := E'Every check passed this morning.\n\n' || array_to_string(v_all_lines, E'\n');
        short := 'Elliot daily check: all systems OK.'; audience := 'platform'; tenant_id := null;
        return next;
    end if;

    -- 4e. Agency messages: only that agency's own failures.
    for t in
        select a.tenant_id,
               tn.name as tenant_name,
               c.alert_email_enabled, c.alert_email, c.alert_whatsapp_enabled, c.alert_whatsapp_number,
               string_agg(
                   count_line, E'\n- ' order by count_line) as lines
        from (
            select a.tenant_id, a.event_type,
                   count(*) || ' x ' || case a.event_type
                        when 'email_send_failed'    then 'an email reply to a client couldn''t be sent'
                        when 'whatsapp_send_failed' then 'a WhatsApp reply to a client couldn''t be sent'
                        when 'chat_send_failed'     then 'a website chat reply couldn''t be sent'
                        when 'email_elliot_failed'  then 'Elliot couldn''t answer an email'
                        when 'whatsapp_elliot_failed' then 'Elliot couldn''t answer a WhatsApp message'
                        when 'booking_failed'       then 'a viewing couldn''t be booked'
                        else replace(a.event_type, '_', ' ') end as count_line
            from audit_log a
            where a.tenant_id is not null
              and a.created_at > v_scan_from and a.created_at <= p_now
              and a.event_type like '%\_failed' escape '\'
            group by a.tenant_id, a.event_type
        ) a
        join tenants tn on tn.id = a.tenant_id
        join ai_config c on c.tenant_id = a.tenant_id
        where (c.alert_email_enabled and nullif(btrim(c.alert_email), '') is not null)
           or (c.alert_whatsapp_enabled and nullif(btrim(c.alert_whatsapp_number), '') is not null)
        group by a.tenant_id, tn.name, c.alert_email_enabled, c.alert_email, c.alert_whatsapp_enabled, c.alert_whatsapp_number
    loop
        if t.alert_email_enabled and nullif(btrim(t.alert_email), '') is not null then
            channel := 'email'; recipient := btrim(t.alert_email); sender_id := null;
            subject := 'Elliot: something needs your attention';
            body := 'Hello ' || t.tenant_name || E',\n\nSince the last check:\n- ' || t.lines
                || E'\n\nThe conversations involved are marked in your Elliot dashboard. Your Elliot administrator has been told too.';
            short := 'Elliot: something in your account needs attention. Check your dashboard.';
            audience := 'agency'; tenant_id := t.tenant_id;
            return next;
        end if;
        if t.alert_whatsapp_enabled and nullif(btrim(t.alert_whatsapp_number), '') is not null
           and nullif(btrim(s.whatsapp_sender_id), '') is not null then
            channel := 'whatsapp'; recipient := regexp_replace(t.alert_whatsapp_number, '\D', '', 'g'); sender_id := btrim(s.whatsapp_sender_id);
            subject := 'Elliot: something needs your attention';
            body := null;
            short := 'Elliot: ' || replace(t.lines, E'\n- ', '; ') || '. See your dashboard.';
            short := left(short, 900);
            audience := 'agency'; tenant_id := t.tenant_id;
            return next;
        end if;
    end loop;
end;
$$;

revoke all on function health_alert_plan(jsonb, timestamptz) from public, anon, authenticated;

-- ── 5. Status for the /health webhook (UptimeRobot) and the Control panel ──
create or replace function health_status()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
    select jsonb_build_object(
        'status', case
            when not exists (select 1 from health_check_state) then 'unknown'
            when exists (select 1 from health_check_state where not ok) then 'degraded'
            when (select max(checked_at) from health_check_state) < now() - interval '45 minutes' then 'stale'
            else 'all_ok' end,
        'checked_at', (select max(checked_at) from health_check_state),
        'checks', coalesce((select jsonb_agg(jsonb_build_object('key', check_key, 'label', label, 'ok', ok,
                                 'detail', detail, 'failing_since', failing_since, 'checked_at', checked_at)
                             order by check_key) from health_check_state), '[]'::jsonb)
    );
$$;

revoke all on function health_status() from public, anon, authenticated;

-- ── 6. How the last alert went (workflow 33 after each send) ──
create or replace function record_alert_delivery(p_channel text, p_ok boolean, p_detail text, p_recipient text default null)
returns void
language sql
security definer
set search_path = public
as $$
    update platform_alert_settings
       set last_email_status = case when p_channel = 'email'
               then left((case when p_ok then 'Delivered' else 'FAILED' end) || coalesce(' to ' || nullif(p_recipient, ''), '')
                         || coalesce(': ' || nullif(btrim(p_detail), ''), ''), 400) else last_email_status end,
           last_email_at = case when p_channel = 'email' then now() else last_email_at end,
           last_whatsapp_status = case when p_channel = 'whatsapp'
               then left((case when p_ok then 'Delivered' else 'FAILED' end) || coalesce(' to ' || nullif(p_recipient, ''), '')
                         || coalesce(': ' || nullif(btrim(p_detail), ''), ''), 400) else last_whatsapp_status end,
           last_whatsapp_at = case when p_channel = 'whatsapp' then now() else last_whatsapp_at end
     where id;
$$;

revoke all on function record_alert_delivery(text, boolean, text, text) from public, anon, authenticated;

-- ── 7. A test alert from the Control panel: the platform messages only ──
create or replace function health_test_alert()
returns table (channel text, recipient text, sender_id text, subject text, body text, short text, audience text, tenant_id uuid)
language sql
security definer
set search_path = public
stable
as $$
    select 'email', btrim(s.email_to), null::text, 'Elliot test alert',
           E'This is a test alert from the Elliot Control panel. If you can read this, email alerts work.\n\n'
             || coalesce((select string_agg(case when ok then 'OK: ' else 'FAILING: ' end || label, E'\n' order by check_key) from health_check_state), 'No checks have run yet.'),
           'Elliot test alert: WhatsApp alerts work.', 'platform', null::uuid
      from platform_alert_settings s
     where s.id and s.email_enabled and nullif(btrim(s.email_to), '') is not null
    union all
    select 'whatsapp', regexp_replace(s.whatsapp_to, '\D', '', 'g'), btrim(s.whatsapp_sender_id), 'Elliot test alert', null,
           'Elliot test alert: WhatsApp alerts work.', 'platform', null::uuid
      from platform_alert_settings s
     where s.id and s.whatsapp_enabled and nullif(btrim(s.whatsapp_to), '') is not null and nullif(btrim(s.whatsapp_sender_id), '') is not null;
$$;

revoke all on function health_test_alert() from public, anon, authenticated;

-- ── 8. Workflow crashes (workflow 34, n8n's error workflow) ──
create or replace function log_workflow_error(p_workflow text, p_node text, p_error text, p_execution_url text default null)
returns void
language sql
security definer
set search_path = public
as $$
    insert into audit_log (tenant_id, actor_type, actor_id, event_type, details)
    values (null, 'system', 'workflow_34', 'workflow_error',
            jsonb_build_object('workflow', left(coalesce(p_workflow, '?'), 200),
                               'node', left(coalesce(p_node, ''), 200),
                               'error', left(coalesce(p_workflow, '?') || coalesce(' / ' || nullif(p_node, ''), '') || ': '
                                             || coalesce(nullif(btrim(p_error), ''), 'unknown error'), 400),
                               'execution_url', p_execution_url));
$$;

revoke all on function log_workflow_error(text, text, text, text) from public, anon, authenticated;

commit;
