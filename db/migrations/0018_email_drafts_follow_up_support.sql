-- 0018_email_drafts_follow_up_support.sql
--
-- Follow-up sends reuse email_drafts + its existing approval-gate/dashboard
-- flow rather than inventing a parallel one -- same pending/approved/sent
-- lifecycle, same "Pending Approvals" screen, for free.

-- 'follow_up' is a genuinely distinct category from the existing inbound-
-- email classifications (faq_answerable/lead_inquiry/complaint/scheduling/
-- spam/other) -- these are outbound, engine-initiated, not a reply to
-- anything a contact sent in.
alter table email_drafts drop constraint if exists email_drafts_category_check;
alter table email_drafts add constraint email_drafts_category_check
  check (category in (
    'faq_answerable', 'lead_inquiry', 'complaint', 'scheduling', 'spam', 'other', 'follow_up'
  ));

-- Traceability back to the run that generated this draft. Nullable --
-- every other draft source (13/14) leaves this null.
alter table email_drafts add column if not exists follow_up_run_id
  uuid references follow_up_runs(id) on delete set null;

create index if not exists idx_email_drafts_follow_up_run
  on email_drafts (follow_up_run_id) where follow_up_run_id is not null;
