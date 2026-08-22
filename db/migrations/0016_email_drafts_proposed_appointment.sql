-- 0016_email_drafts_proposed_appointment.sql
-- Carries a confirmed appointment slot from the drafting step (14) through
-- to send/approval time (15), where it triggers the actual booking via
-- workflow 12 -- keeping booking gated behind the same human-approval step
-- that already exists for sending, per the "always human-approve the actual
-- booking" design decision.

alter table email_drafts
  add column if not exists proposed_appointment jsonb;
