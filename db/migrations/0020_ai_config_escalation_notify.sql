-- 0020_ai_config_escalation_notify.sql
--
-- Where to send a human alert when the agent escalates. Separate from
-- connected_gmail_address (that's the tenant's customer-facing send-from
-- inbox, used by 15/16/20) -- an escalation alert should go to whoever on
-- the tenant's team handles handoffs, which may well be a different inbox.

alter table ai_config add column if not exists escalation_notify_email text;

comment on column ai_config.escalation_notify_email is
    'Where to send an email alert when escalate_to_human creates a new escalation. NULL means no notification is sent -- the escalation still gets recorded and is visible on the dashboard, just without a push alert.';
