-- 0019_ai_config_crm_webhook.sql
--
-- CRM sync is deliberately generic, not tied to one provider (no real
-- tenant/CRM target exists yet to justify a specific integration -- see
-- docs/workflow-specs/22-crm-sync.md). Each tenant points this at whatever
-- their CRM-side incoming webhook is: HubSpot/Pipedrive/etc.'s native
-- webhook trigger, or a Zapier/Make webhook step in front of any CRM that
-- doesn't take webhooks directly. crm_sync_log.crm_provider stays a free-text
-- label for whichever this is -- purely descriptive, nothing branches on it.

alter table ai_config add column if not exists crm_webhook_url text;

comment on column ai_config.crm_webhook_url is
    'Tenant-configured receiving endpoint for CRM sync payloads. NULL means CRM sync is not configured for this tenant -- rows queued in crm_sync_log will be marked failed with a clear last_error rather than retried forever.';
