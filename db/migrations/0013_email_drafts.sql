-- 0013_email_drafts.sql
-- Phase 7: Email agent (classify + draft + gated auto-send)
--
-- Confirmed against live schema:
--   - Tenant-scoped RLS helper function: current_tenant_id()
--   - Staff/reviewer table: tenant_users (reviewed_by below is a FK into it)

create table if not exists email_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,

  -- Gmail identifiers (for threading replies correctly)
  gmail_thread_id text,
  gmail_message_id text,

  to_email text not null,
  from_email text,
  subject text,
  body text not null,

  -- classification result from "13 - Classify Email"
  category text not null check (category in (
    'faq_answerable', 'lead_inquiry', 'complaint', 'scheduling', 'spam', 'other'
  )),
  confidence numeric(4,3), -- 0.000–1.000

  -- lifecycle
  status text not null default 'pending' check (status in (
    'pending', 'approved', 'rejected', 'sent', 'auto_sent'
  )),
  auto_send_eligible boolean not null default false,

  reviewed_by uuid references tenant_users(id) on delete set null,
  reviewed_at timestamptz,
  sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_drafts_tenant_status
  on email_drafts (tenant_id, status);

create index if not exists idx_email_drafts_gmail_thread
  on email_drafts (gmail_thread_id);

-- updated_at trigger (mirrors pattern likely already used on leads/contacts)
create or replace function set_email_drafts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_email_drafts_updated_at on email_drafts;
create trigger trg_email_drafts_updated_at
  before update on email_drafts
  for each row execute function set_email_drafts_updated_at();

-- RLS
alter table email_drafts enable row level security;

create policy tenant_isolation_email_drafts on email_drafts
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- Tenant-scoped RPC for approving a draft (dashboard calls this rather than
-- writing to the table directly, same pattern as insert_escalation() in 0012)
create or replace function approve_email_draft(
  p_draft_id uuid,
  p_reviewed_by uuid,
  p_edited_body text default null
)
returns email_drafts
language plpgsql
security definer
as $$
declare
  result email_drafts;
begin
  update email_drafts
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

create or replace function reject_email_draft(
  p_draft_id uuid,
  p_reviewed_by uuid
)
returns email_drafts
language plpgsql
security definer
as $$
declare
  result email_drafts;
begin
  update email_drafts
  set status = 'rejected',
      reviewed_by = p_reviewed_by,
      reviewed_at = now()
  where id = p_draft_id
    and tenant_id = current_tenant_id()
  returning * into result;

  return result;
end;
$$;
