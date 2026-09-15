-- 0023_manual_email_draft_rpc.sql
-- Phase: Human takeover (dashboard agent replying directly on an email
-- conversation, not editing/approving an AI-authored draft).
--
-- Two changes:
--   1. email_drafts.authored_by distinguishes AI-drafted rows from
--      human-composed ones. Existing rows are unaffected (default 'ai').
--   2. create_manual_email_draft() lets a tenant dashboard user insert a
--      new, already-approved draft directly, reusing the existing
--      workflow 17 -> 15 send pipeline rather than building a second send
--      path. It auto-threads onto the most recent email_drafts row for
--      the same conversation (if any) so replies land in the same Gmail
--      thread instead of starting a new one.

alter table email_drafts
  add column if not exists authored_by text not null default 'ai'
    check (authored_by in ('ai', 'human'));

comment on column email_drafts.authored_by is
  'Set by create_manual_email_draft() for dashboard-composed replies (human takeover). Everything else -- including auto-sent and reviewer-edited AI drafts -- remains ''ai''; editing an AI draft''s body before approving does not change authorship, only the wording.';

create or replace function create_manual_email_draft(
  p_conversation_id uuid,
  p_contact_id uuid,
  p_to_email text,
  p_subject text,
  p_body text,
  p_reviewed_by uuid
)
returns email_drafts
language plpgsql
security definer
as $$
declare
  result email_drafts;
  v_tenant_id uuid := current_tenant_id();
  v_thread_id text;
  v_message_id text;
begin
  if v_tenant_id is null then
    raise exception 'create_manual_email_draft: no tenant in session context';
  end if;
  if p_to_email is null or btrim(p_to_email) = '' then
    raise exception 'create_manual_email_draft: to_email is required';
  end if;
  if p_body is null or btrim(p_body) = '' then
    raise exception 'create_manual_email_draft: body is required';
  end if;

  -- Thread onto the most recent draft for this conversation, if any, so
  -- Gmail groups this reply with the existing exchange instead of starting
  -- a new thread. If this is the very first outbound email on the
  -- conversation (e.g. it started on chat_widget and this is the first
  -- time anyone emails the contact), there's nothing to thread onto yet --
  -- that's fine, workflow 15 just sends it as a fresh thread.
  select gmail_thread_id, gmail_message_id
    into v_thread_id, v_message_id
    from email_drafts
   where conversation_id = p_conversation_id
     and tenant_id = v_tenant_id
     and gmail_thread_id is not null
   order by created_at desc
   limit 1;

  insert into email_drafts (
    tenant_id, conversation_id, contact_id,
    gmail_thread_id, gmail_message_id,
    to_email, subject, body,
    category, confidence,
    status, auto_send_eligible, authored_by,
    reviewed_by, reviewed_at
  ) values (
    v_tenant_id, p_conversation_id, p_contact_id,
    v_thread_id, v_message_id,
    p_to_email, p_subject, p_body,
    'other', 1.000,
    'approved', false, 'human',
    p_reviewed_by, now()
  )
  returning * into result;

  return result;
end;
$$;

comment on function create_manual_email_draft is
  'Dashboard-initiated reply on an email conversation ("human takeover"), inserted pre-approved so the caller can immediately trigger workflow 17 (send-approved-draft) the same way approval-card.tsx does for AI drafts. category is fixed to ''other'' -- these are not run through 13-classify-email, so there is no real classification to record.';
