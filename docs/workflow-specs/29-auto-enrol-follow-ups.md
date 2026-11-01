# Workflow Spec: 29 - Auto-Enrol Follow-Ups

## Why this exists
Workflow 20 sends follow-up steps for runs that already exist, but until
now only a hand-called webhook (21) created runs, so sequences sent
nothing on their own. This is the missing "who joins a sequence" half.

## Trigger
Schedule, every 15 minutes (same cadence as 20).

## Nodes
| Node | What it does |
|---|---|
| Every 15 Minutes | Schedule trigger |
| Enrol Quiet Leads | `select * from enrol_quiet_leads(100);` (service-role Postgres) |

All eligibility logic lives in the SQL function from migration `0026`, not
in n8n, so it's covered by `db/seed/test_0026_auto_sync_and_enrolment.sql`
and can change without re-importing this workflow.

## Who gets enrolled
A tenant opts in by turning on auto-enrol for **one** sequence at
`/dashboard/follow-ups` (`follow_up_sequences.auto_enrol`; a partial unique
index enforces one per tenant). A lead is enrolled when all of these hold:

- the sequence is active and has at least one step
- the lead was created after auto-enrol was switched on
  (`auto_enrol_since`, stamped by a trigger). Switching it on never
  back-fills the existing lead list.
- the lead isn't `CONVERTED` or `LOST`
- the contact has an email address (workflow 20 only sends email)
- the lead has never been in this sequence before, so a completed or
  stopped run is never restarted
- the contact has no upcoming `confirmed` appointment; someone who booked
  a viewing doesn't need chasing
- nothing inbound from the contact for `auto_enrol_after_hours` (default 24)

## The run it creates
Same row shape as 21: `current_step_index = 0`, `status = 'running'`,
`next_run_at = now() + first step's day_offset`. Because the run's
`created_at` is the enrolment time, workflow 20's "contact replied" check
counts only replies after enrolment. The chat that produced the lead
doesn't stop the run, but any reply afterwards does.

## Output
One row per run created (`run_id, tenant_id, lead_id, sequence_id,
next_run_at`). Zero rows on most sweeps is normal. At most 100 enrolments
per sweep; a backlog spreads across sweeps.

## Credentials
Shared Postgres credential (service role). `enrol_quiet_leads()` has
EXECUTE revoked from `public`, `anon` and `authenticated`, so dashboard
users can't trigger it through PostgREST.

## Known limits
- WhatsApp-only leads (no email) are skipped. Follow-ups over WhatsApp
  would also need template messages (see `KNOWN_ISSUES.md`).
- "Quiet" is measured from inbound messages on any channel. Outbound
  messages from staff don't reset it.
- The existing sweep behaviours documented in `20-follow-up-sweep.md` still
  apply (deactivating only blocks new runs; runs advance even if a draft is
  still awaiting approval).
