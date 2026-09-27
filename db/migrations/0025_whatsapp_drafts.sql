-- 0025_whatsapp_drafts.sql
-- WhatsApp channel support.
--
-- Deliberately a SIBLING table (whatsapp_drafts), not a generalization of
-- email_drafts, per the decision to keep email's working path untouched
-- while WhatsApp is new and unproven. Same pending/approved/rejected/
-- sent/auto_sent lifecycle and the same approve/reject RPC shape as
-- 0013_email_drafts.sql, so the dashboard's Approvals page can treat both
-- tables the same way in application code even though they're not one
-- table in the database.
--
-- One real difference from email that IS reflected in the schema:
-- 'blocked_needs_template' -- WhatsApp's 24-hour free-form messaging
-- window (see docs/workflow-specs/27-send-approved-whatsapp.md). A draft
-- that would be sent outside that window can't go out as free text at
-- all (Meta rejects it, error 131047), and pre-approved template messages
-- aren't built yet -- so workflow 27 marks it blocked instead of trying
-- and failing silently.

-- ─────────────────────────────────────────────────────────────
-- conversations.channel: add 'whatsapp' alongside the existing
-- chat_widget / email / sms values.
-- ─────────────────────────────────────────────────────────────
alter table conversations drop constraint if exists conversations_channel_check;
alter table conversations add constraint conversations_channel_check
  check (channel in ('chat_widget', 'email', 'sms', 'whatsapp'));

-- ─────────────────────────────────────────────────────────────
-- ai_config: which Meta phone_number_id belongs to this tenant.
--
-- Unlike connected_gmail_address (one Gmail OAuth2 credential wired into
-- the trigger node itself, so only one tenant's inbox is ever actually
-- reachable regardless of how many rows have a value here -- see
-- docs/workflow-specs/16-email-inbound-trigger.md), this column is
-- expected to really route multiple tenants: WhatsApp Cloud API lets many
-- phone numbers live under one Business Account behind a single access
-- token, and Meta's webhook payload names the receiving phone_number_id
-- on every request. Workflow 25 looks tenants up by this column the same
-- way 16 looks tenants up by connected_gmail_address, but here it isn't a
-- known dead end -- it's expected to work for every tenant with a real
-- number configured, using one shared WhatsApp credential.
-- ─────────────────────────────────────────────────────────────
alter table ai_config add column if not exists whatsapp_phone_number_id text;

create unique index if not exists idx_ai_config_whatsapp_phone_number_id
  on ai_config (whatsapp_phone_number_id)
  where whatsapp_phone_number_id is not null;

-- ─────────────────────────────────────────────────────────────
-- contacts: a phone-based upsert (workflow 25) needs the same kind of
-- unique target idx_contacts_tenant_email already gives the email upsert
-- in 0002 -- there wasn't one for phone before because nothing wrote
-- contacts by phone yet.
-- ─────────────────────────────────────────────────────────────
create unique index if not exists idx_contacts_tenant_phone
  on contacts (tenant_id, phone)
  where phone is not null;

-- ─────────────────────────────────────────────────────────────
-- whatsapp_drafts
-- ─────────────────────────────────────────────────────────────
create table if not exists whatsapp_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,

  -- WhatsApp identifiers.
  -- to_wa_id: the contact's WhatsApp ID (their phone number, no '+' or
  -- separators, per Meta's format) -- the whatsapp equivalent of
  -- email_drafts.to_email.
  -- phone_number_id: WHICH of the tenant's numbers this should send from
  -- (copied from ai_config.whatsapp_phone_number_id at draft time so a
  -- later change to that setting can't silently redirect an
  -- already-drafted reply to a different number).
  -- last_inbound_at: the timestamp of the contact's message this is
  -- replying to -- workflow 27 uses this, not now(), to check the 24-hour
  -- free-form window at SEND time (which can be later than draft time if
  -- a human sits on an approval).
  to_wa_id text not null,
  phone_number_id text not null,
  wa_message_id text,
  last_inbound_at timestamptz not null,

  body text not null,

  -- Same categories as email_drafts (0013/0018) minus the ones that can't
  -- happen on an inbound WhatsApp message today: no 'spam' (Meta requires
  -- an opt-in before a business number can message someone, so unsolicited
  -- inbound spam isn't the same risk as open email) is still possible in
  -- principle (a wrong-number text), so it stays. Category set kept
  -- identical to email_drafts on purpose: workflow 13 (Classify) is reused
  -- as-is for WhatsApp, and it only ever emits these six values.
  category text not null check (category in (
    'faq_answerable', 'lead_inquiry', 'complaint', 'scheduling', 'spam', 'other', 'follow_up'
  )),
  confidence numeric(4,3),

  status text not null default 'pending' check (status in (
    'pending', 'approved', 'rejected', 'sent', 'auto_sent', 'blocked_needs_template'
  )),
  auto_send_eligible boolean not null default false,

  proposed_appointment jsonb,
  follow_up_run_id uuid references follow_up_runs(id) on delete set null,

  reviewed_by uuid references tenant_users(id) on delete set null,
  reviewed_at timestamptz,
  sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_drafts_tenant_status
  on whatsapp_drafts (tenant_id, status);

create index if not exists idx_whatsapp_drafts_follow_up_run
  on whatsapp_drafts (follow_up_run_id) where follow_up_run_id is not null;

drop trigger if exists trg_whatsapp_drafts_updated_at on whatsapp_drafts;
create trigger trg_whatsapp_drafts_updated_at
  before update on whatsapp_drafts
  for each row execute function set_email_drafts_updated_at(); -- generic body, reused as-is (just sets updated_at = now())

alter table whatsapp_drafts enable row level security;

create policy tenant_isolation_whatsapp_drafts on whatsapp_drafts
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- Mirrors approve_email_draft() / reject_email_draft() from 0013 exactly,
-- just against whatsapp_drafts.
create or replace function approve_whatsapp_draft(
  p_draft_id uuid,
  p_reviewed_by uuid,
  p_edited_body text default null
)
returns whatsapp_drafts
language plpgsql
security definer
as $$
declare
  result whatsapp_drafts;
begin
  update whatsapp_drafts
  set status = 'approved',
      body = coalesce(p_edited_body, body),
      reviewed_by = p_reviewed_by,
      reviewed_at = now()
  where id = p_draft_id
    and tenant_id = current_tenant_id()
  returning * into result;

  return result;
end;
$$;

create or replace function reject_whatsapp_draft(
  p_draft_id uuid,
  p_reviewed_by uuid
)
returns whatsapp_drafts
language plpgsql
security definer
as $$
declare
  result whatsapp_drafts;
begin
  update whatsapp_drafts
  set status = 'rejected',
      reviewed_by = p_reviewed_by,
      reviewed_at = now()
  where id = p_draft_id
    and tenant_id = current_tenant_id()
  returning * into result;

  return result;
end;
$$;

comment on table whatsapp_drafts is 'Sibling of email_drafts for the WhatsApp channel -- same approval lifecycle, deliberately not merged into one table (see migration header comment).';
