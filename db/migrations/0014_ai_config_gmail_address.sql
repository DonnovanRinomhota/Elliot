-- 0014_ai_config_gmail_address.sql
-- Phase 7: adds the column "16 - Email Inbound Trigger" uses to look up
-- which tenant a given inbound email belongs to.

alter table ai_config
  add column if not exists connected_gmail_address text;

-- Optional but recommended: prevents two tenants from ever being wired to
-- the same mailbox by accident.
create unique index if not exists idx_ai_config_gmail_address
  on ai_config (connected_gmail_address)
  where connected_gmail_address is not null;

-- Once you connect Zebra's real (or test) Gmail account, set it with:
--   update ai_config set connected_gmail_address = 'the-real-address@gmail.com'
--   where tenant_id = '<zebra tenant id>';
