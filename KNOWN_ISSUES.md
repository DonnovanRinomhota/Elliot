# Known Issues / Resolved-but-worth-remembering

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

## OPEN — book_appointment does not gracefully handle a double-booking collision
If two visitors (or a stale offer) try to book the same slot, the DB's
`excl_no_overlapping_appointments` exclusion constraint correctly rejects
the second insert — but `12-book-appointment.json` doesn't catch that and
turn it into a graceful "that time's no longer available, try another"
reply. The error currently just propagates. Not yet fixed.

## OPEN — Repo has a duplicated nested `elliot/` folder
An early "Add files via upload" commit committed a full copy of the repo
*inside itself*. Dropped entirely from this update package rather than
carried forward — if anything only existed in that nested copy, it's now
gone. Worth double-checking nothing important was lost.

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
