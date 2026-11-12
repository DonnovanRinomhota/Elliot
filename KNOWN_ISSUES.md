# Known Issues / Resolved-but-worth-remembering

## OPEN (Nov 2026) — No database backups on the Free plan
Supabase's Free plan has no backups you can restore from (daily backups start
at Pro). Before the first paying agency: move to Pro, or take your own dump
before every migration and weekly. Steps in [`RELEASING.md`](RELEASING.md#backups).

## OPEN (Nov 2026) — `N8N_SEND_WHATSAPP_WEBHOOK_URL` not set in Vercel
Found by comparing the dashboard's code with the variable names in Vercel
(values not read). Sending an approved WhatsApp draft from the dashboard
answers "not configured". Fix: add it in Vercel, set to workflow 28's
production webhook URL, then redeploy.

## RESOLVED (Nov 2026) — Release process: what's live was a matter of memory
- Nothing recorded which migrations Supabase had. The migrations README said
  every file was "safe to run again"; 13 fail on a second run, and others
  would silently put back older function definitions (re-running 0009 undoes
  part of 0047). **Fix:** 0049 (`migration_status()`, `begin_migration()`);
  from 0049 on a migration refuses to run twice or out of order.
- No automatic checks on pull requests. **Fix:** GitHub Actions in both
  repos (`.github/workflows/checks.yml`).
- The SQL inside workflows was never run before n8n ran it. The new check
  found one real bug: 25's "Log Unanswered Messages" (added in 0048's patch)
  would have failed every time with "could not determine data type of
  parameter $3". **Fixed** (`$3::text`).
- The dashboard had no ESLint configuration, so `npm run lint` only asked
  questions. **Fix:** `.eslintrc.json` (Next.js rules); no warnings.
- `apps/elliot-dashboard/public/widget.js` was out of date with
  `apps/web-chat-widget/widget.js` (the build copies it anyway; now in sync).

## RESOLVED (Nov 2026) — Reliability review: silent failures and duplicates
- **Claude unavailable crashed workflow 01.** No retry, no timeout. Email and
  WhatsApp clients got "someone will get back to you" from the channel
  workflow, but nothing told the team; website visitors got an error.
- **A tool that crashed took Elliot down with it** (a refused Google
  Calendar call, a sub-workflow whose ID was reset by an import).
- **Follow-up steps could be sent twice.** The sweep moved a run on only at
  the very end; a crash in between meant the same step went out again 15
  minutes later.
- **Emails could be sent twice.** "Send via Resend" retried on a dropped
  connection without an idempotency key.
- **Clients had no way to stop follow-ups**, and follow-ups kept going to
  leads marked CONVERTED or LOST.
- **WhatsApp messages Meta accepted but never delivered were invisible**
  (status updates were dropped).
- **CRM sync gave up after 25 minutes** (5 tries, 5 minutes apart).

**Fix:** migration `0048`, workflows 01 / 20 / 23 / 25 / 39, retries and
timeouts in eight more. See [`docs/reliability.md`](docs/reliability.md).

**Verified:** `db/seed/test_0048_reliability.sql` on a scratch Postgres
(including the crash case: a second sweep straight after the first hands out
nothing) and `n8n/workflows/tests/reliability.test.js`. Not run in a live n8n.

## RESOLVED (Nov 2026) — Importing a workflow reset sub-workflow links and the error workflow
`01` and `10` referred to workflows 24 and 37 by placeholder, and no file
named workflow 34 as its error workflow, so every import silently broke
hand-overs and viewing changes and stopped crashes being recorded until they
were picked again by hand.

**Fix:** the real IDs are in the files (24 `jfcGGkCo29OLxONR`, 37
`ySMoLU4Vf6EM6FAE`, 34 `seDI8X3d4J3gLEgw` as `settings.errorWorkflow` on
every other workflow). `reliability.test.js` guards it.

## RESOLVED (Nov 2026) — Security review: agency isolation and roles
The public Supabase key could call n8n's helper functions with any agency's
ID; any team member could make themselves admin or change their agency's
plan and settings; the public chat webhook let a caller pose as an email or
WhatsApp client; a website visitor who typed a client's email could see and
cancel that client's viewings; "Book appointments: Needs approval" did
nothing.

**Root cause:** Supabase grants new tables and functions to the public key by
default, and RLS policies were "same agency" only, with no roles. Workflow
01 trusted fields from the request body.

**Fix:** migration `0047`, workflows 01 / 16 / 25 / 37 / 40, dashboard. Full
list, roll-out order and what is still open: [`docs/security.md`](docs/security.md).

**Verified:** every finding reproduced on a scratch Postgres with Supabase's
default grants, then `db/seed/test_0047_tenant_isolation.sql` (fails before
0047, passes after) and `n8n/workflows/tests/security_hardening.test.js`.
Not run against production; the n8n side is tested from the workflow files,
not in a live n8n.

## RESOLVED (Nov 2026) — Leads scoring 40–69 were never saved
`10 - Lead Capture`'s `Score Lead` node set `status = 'QUALIFIED'` for
scores 40–69, but `leads_status_check` (`0002`) only allows NEW /
QUALIFYING / HOT / WARM / COLD / CONVERTED / LOST. `Upsert Lead` failed
with a check-constraint violation for every mid-scoring lead, so the
agent's `capture_lead` tool errored and the lead was lost. The dashboard
never showed a `QUALIFIED` folder, which is why nothing looked wrong.

**Root cause:** the scoring node and the schema used different names for
the middle band. The spec (`10-lead-capture.md`) had copied the node.

**Fix:** the 40–69 band now writes `WARM`, which the schema, the Leads
folders and the revenue stats (`0024`, which counts QUALIFYING/HOT/WARM as
pipeline) already expected.

**Verified:** reproduced the constraint violation against a fresh database
with all migrations applied; `n8n/workflows/tests/client_ready_fixes.test.js`
runs the node's own code and asserts every status it can produce is
allowed. Leads saved live in the 2026-11-01 smoke test.

## RESOLVED — Hot-lead escalation insert failed with a false FK violation
`10 - Lead Capture`'s "Insert Escalation" node intermittently failed with
`conflicting key value violates ... escalations_conversation_id_fkey` even
though the referenced `conversations` row demonstrably existed.

**Root cause:** RLS-visibility race. `escalations` (and `conversations`) are
RLS-protected (`0008_row_level_security.sql`), and a bare
`set_config('app.current_tenant', ...)` set in one n8n Postgres node does not
reliably carry into a separate node's connection/session — `0009` already
solved this for `conversations`/`messages`/`tool_call_log` via tenant-scoped
PL/pgSQL RPC functions, but the pattern was never extended to `escalations`,
so it inherited the same bug.

**Fix:** `0012_escalation_rpc.sql` adds `insert_escalation(...)`, following
the same pattern as `get_or_create_conversation` / `log_message` in `0009`.
`10-lead-capture.json`'s "Insert Escalation" node now calls
`select * from insert_escalation($1, $2, $3, $4, $5);` instead of a raw
`insert into escalations ...` statement.

**Verified live:** a HOT-scored test lead correctly produced a real
`escalations` row (`reason: 'other'`, `priority: 'high'`, `status: 'open'`)
with no error.

## RESOLVED — Lead Capture's conversation_id was always null
Once the escalation insert above was fixed at the SQL level, testing
surfaced a second bug: the Main Agent's "Execute: Lead Capture Sub-Workflow"
node mapped `conversation_id` from `$('Merge Tenant Context').first().json.conversation_id`
— but that node runs *before* a conversation exists, so this value was
always `null`. This had never been noticed before because `capture_lead`,
`check_availability`, and `book_appointment` don't otherwise depend on
`conversation_id` — escalation was the first thing that actually required
it to be non-null (`escalations.conversation_id` is `not null`).

**Fix:** the mapping now reads from
`$('Get or Create Conversation').first().json.conversation_id` instead,
which is the node that actually creates/looks up the real conversation row.

## RESOLVED — check_availability had no anchor for "today"
Nothing in the system prompt told Claude the actual current date. Left to
infer it, Claude defaulted to dates around a year in the past relative to
real time. `Compute Available Slots` correctly found zero slots in that
stale range (working exactly as designed) — but Claude then told the
visitor no viewing times existed at all, which was false; it had simply
never checked any real dates.

**Fix:** `Build Claude Request` now computes
`new Date().toISOString().split('T')[0]` and includes an explicit
"Today's date is X" line in the system prompt. See
`docs/workflow-specs/main-agent-system-prompt.md`.

**Verified live:** correct current-date ranges requested, correct real
available slots returned, and a day with a genuine pre-existing appointment
correctly did not get double-booked.

## RESOLVED — n8n's native Google Calendar node is unreliable with expressions
The built-in Google Calendar node's "By ID" calendar-selector mode, when fed
an `fx` expression (even one resolving to a perfectly valid value like
`primary`), threw `Calendar parameter's value is invalid...` — a validation
bug in the node itself, not a data problem.

**Fix, established pattern for any future Google Calendar work:** use an
HTTP Request node instead, with Authentication set to Predefined Credential
Type → Google Calendar OAuth2 API, calling the Calendar API endpoints
directly (`freeBusy`, `calendars/{id}/events`). Used in both
`11-check-availability.json` and `12-book-appointment.json`.

## RESOLVED — Claude parallel tool_use calls broke the (old) fixed two-turn agent loop
Claude can legitimately emit more than one `tool_use` block in a single
turn (e.g. `check_availability` + `capture_lead` together, when a visitor
gives everything at once). The original Main Agent design only executed one
tool per turn and returned a single `tool_result`, which the Anthropic API
rejects (`tool_use ids were found without tool_result blocks...`).

**Fix:** `01-main-ai-agent.json` now uses `tool_choice: { type: 'auto',
disable_parallel_tool_use: true }`, and was restructured from a fixed
two-turn design into a proper agentic loop (single `Call Claude` node,
looping on `stop_reason == 'tool_use'` up to a safety cap of 8 turns).

## RESOLVED — check_availability silently hid real availability later in the day
`Compute Available Slots` originally capped at 5 total slots and stopped
scanning as soon as it hit that cap — so a later, genuinely open time (e.g.
3pm) could be completely absent from the returned list purely because 5
earlier slots that day were found first, and Claude would then incorrectly
tell the visitor that time "wasn't available."

**Fix:** cap raised to 200 in `11-check-availability.json`, which for any
realistic date range means the returned list is effectively complete.

## RESOLVED — book_appointment does not gracefully handle a double-booking collision
If two visitors (or a stale offer) try to book the same slot, the DB's
`excl_no_overlapping_appointments` exclusion constraint correctly rejects
the second insert. `12-book-appointment.json`'s `Insert Appointment` node
now runs with `continueOnFail`, and a new `Handle Insert Result` node turns
that into `{ success: false, error: 'slot_unavailable', message: "That
time is no longer available -- someone else just booked it. Please choose
a different slot." }` instead of letting the raw DB error propagate up
through the agent's tool_result.

## RESOLVED — A double-booking collision leaves an orphaned Google Calendar event
`12-book-appointment.json` creates the Google Calendar event *before*
inserting the DB row (`HTTP Request` runs, then `Insert Appointment`). If
the DB insert fails on the exclusion constraint (or any other reason), the
calendar event had already been created and was never cleaned up -- a
phantom event with no matching `appointments` row.

**Fix:** added a compensating delete, not a reorder (reordering just moves
the same problem to the DB side instead). `Insert Succeeded?`'s false
branch now routes to a new `Delete Orphaned Calendar Event` node (`DELETE
/calendars/{google_calendar_id}/events/{event_id}`, using the event id
captured from the original `HTTP Request` node and the calendar id from
`Load Tenant + Contact Info`), then `Finalize Booking Failure` re-emits the
same graceful `slot_unavailable` / `booking_failed` message regardless of
whether the cleanup call itself succeeded -- `continueOnFail: true` on the
delete step ensures a cleanup hiccup (e.g. event already gone) never blocks
the visitor-facing error response. `_calendar_cleanup: 'ok' | 'failed'` is
included in the returned object for internal debugging/logging only.

**Verified live:** tested a real double-booking collision against live Google
Calendar + Supabase. Confirmed working as designed.

## RESOLVED — Repo had a duplicated nested `elliot/` folder
An early "Add files via upload" commit put a full copy of the repo inside
itself. It was dropped and no longer exists.

## RESOLVED (this update) — Schema drift between Supabase (live) and `db/migrations` (git)
Two changes were made directly against the live database during Phase 4/5
development and were never captured as migrations until now:
- `ai_config.google_calendar_id` (added via ad-hoc `ALTER TABLE`)
- `leads_tenant_contact_unique` (required by `10-lead-capture.json`'s
  `ON CONFLICT (tenant_id, contact_id)`, added directly in Supabase)

`0011_ai_config_calendar_and_leads_unique.sql` backfills both, idempotently.
**Process fix going forward:** any schema change made in Supabase's SQL
editor during live debugging should be turned into a numbered migration
file in the same session, not after the fact.

## RESOLVED (Nov 2026) — `/dashboard/onboarding` has no access control
**Fixed:** the dashboard route itself is now gated. `lib/admin.ts`'s
`isAdminEmail()` checks the logged-in user's email against `ADMIN_EMAILS`
(a comma-separated env var, server-only, no `NEXT_PUBLIC_` prefix). Anyone
not on that list sees a plain "you don't have access" message instead of
the form, and the nav link itself is hidden for non-admins too
(`app/(app)/layout.tsx`). Unit-verified against case-sensitivity,
whitespace, empty-list, and multi-entry edge cases.

**Fixed (Nov 2026):** the webhook itself now requires a shared secret.
Workflow 19's Webhook node uses n8n's built-in Header Auth with the
`Elliot Internal Webhook Secret` credential, so n8n refuses any call
without a matching `x-elliot-webhook-secret` header before the workflow
runs. (A first version checked an `$env` variable in a Code node; n8n Cloud
blocks `$env`, so it was switched to Header Auth, which works on every
plan.) The dashboard form no longer calls n8n from the browser: it posts to
`app/api/admin/onboard`, which re-checks `ADMIN_EMAILS` server-side and
adds the secret. Workflows 21, 22 and 30 got the same protection. See
`docs/workflow-specs/internal-webhook-auth.md`. Nothing
in the schema distinguishes "runs the platform" from "runs one tenant"
either (`tenant_users.role` is per-tenant only) -- the env-var allow-list
is a deliberately simple stopgap for a single operator, not a real
permission system; revisit if more than one person ever needs this level
of access.

## RESOLVED (Nov 2026) — Human takeover on every channel
Email: reply as a human (`0023_manual_email_draft_rpc.sql`,
`reply-form.tsx`). Website chat: **Take over this chat** on the
conversation page (0027); workflow 01 stays quiet while `assigned_human` is
set, and the widget polls `/api/widget/messages` for team replies while
it's open. WhatsApp: the same takeover, with team replies sent through
workflow 32 (0032) within WhatsApp's 24-hour window. See
`docs/control-panel-listings-inbox.md`. A website visitor sees team replies
only while their chat window is open.

## RESOLVED (Nov 2026, pending live check) — WhatsApp webhook (25) doesn't verify Meta's request signature
Meta signs every webhook POST body with `X-Hub-Signature-256`
(HMAC-SHA256 using the Meta App Secret). `25-whatsapp-inbound-trigger.json`
didn't check it -- anyone who discovered the webhook URL could POST a
forged payload that got processed as a real customer message.

**Fixed:** `Verify Meta Signature` (between the POST trigger and `Extract
WhatsApp Fields`) recomputes the HMAC over the raw body (Raw Body is now on
in the trigger) and `Signature Valid?` drops anything that isn't valid.
Needs the Meta App Secret pasted into that node after import (n8n Cloud
Starter has no Variables and blocks `$env`; a `META_APP_SECRET` variable
takes priority where available). The repo keeps the placeholder.
Unit-tested with real HMACs (valid, tampered, wrong secret, malformed,
missing). See `docs/workflow-specs/25-whatsapp-inbound-trigger.md`.

## RESOLVED (Nov 2026) — WhatsApp: template messages after 24 hours
WhatsApp only allows free text within 24 hours of the client's last message.
Elliot now uses approved templates where it writes first: `viewing_reminder`
(workflow 38), `elliot_alert` (33) and `elliot_follow_up` (follow-up steps,
27, 0045). Replies to clients are instant, so they're always inside the
window. A WhatsApp draft that isn't a follow-up and is approved after 24 hours
is still marked `blocked_needs_template`; the team replies by email or once
the client writes again. See `docs/whatsapp-follow-ups.md`.

## PARTLY RESOLVED — WhatsApp: photos, voice notes and documents aren't opened
Workflow 25 answers every message type: photos, videos, documents, voice
notes, stickers and locations reach Elliot as a short note ("[Sent a
photo: caption]"), so the client gets a sensible reply and the team sees
what arrived. Elliot doesn't open the media itself yet. Next step: download
it from Meta's media URL and give PDFs and photos to Claude, as email
already does (0046).

## RESOLVED (Nov 2026) — Three webhooks were called straight from the browser
`08` (knowledge ingestion), `17` (manual email send) and `28` (manual
WhatsApp send) were called from client components using `NEXT_PUBLIC_*`
URLs, so they couldn't carry the shared webhook secret. `08` let anyone add
documents to any tenant's knowledge base by slug; `17`/`28` would send any
existing draft by id, approved or not.

**Fixed:** all three now go through server routes
(`app/api/knowledge/ingest`, `app/api/drafts/[id]/send`) and their Webhook
nodes use the same Header Auth credential as 19/21/22/30. The ingest route
takes the tenant from the session; the send route only sends drafts that
belong to the user's tenant and are `approved`. See
`docs/workflow-specs/internal-webhook-auth.md`.

## OPEN — Gmail (workflow 16) answers only the first of several new emails
The Gmail trigger checks the inbox every minute and can hand over several
new emails at once, but the nodes after it read the first one only
(`.first()`). If two clients email in the same minute, the second isn't
answered. Rare at today's volume; agencies that forward to their Elliot
address (workflow 40) aren't affected, since each forwarded email starts its
own run. Fix: process the trigger's items one at a time (Loop Over Items).
