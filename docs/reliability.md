# Reliability: what happens when something fails

The rule: **nothing is sent twice, and nothing fails silently.** Every
failure ends in one of three places a person will see: a holding reply to the
client plus an escalation for the team, a note in the conversation, or the
audit log (which the health alerts in workflow 33 read every 15 minutes).

Migration `0048_reliability.sql`; tests `db/seed/test_0048_reliability.sql`
and `n8n/workflows/tests/reliability.test.js`.

## When Elliot can't answer

| What breaks | What the client sees | What the team sees |
|---|---|---|
| Claude overloaded, slow or down | Nothing, if one of 3 tries works (5 s apart, 45 s each). Otherwise a short holding reply in their language: "…someone will get back to you shortly." | A high-priority escalation on the conversation (one per conversation per hour) and `*_elliot_failed` in the alerts |
| A tool crashes (Google refuses a booking, a sub-workflow is missing, a database error) | Elliot says it couldn't do it and that the team will follow up. It never says it was done. | Elliot hands the conversation over; `booking_failed` / `tool_failed` in the alerts |
| The hand-over itself crashes | "Someone from the team will contact you" | The database opens the escalation directly (no email alert) |
| Workflow 01 crashes somewhere else (database down) | Email / WhatsApp: the channel workflow's own holding message. Website chat: an error in the widget. | `*_elliot_failed` from the channel workflow; `workflow_error` if workflow 34 is set as the error workflow |
| A reply can't be sent (Meta or Resend refuses) | Nothing | A note in the conversation and `*_send_failed` in the alerts |
| WhatsApp accepted a message, then couldn't deliver it | Nothing | A note in the conversation and `whatsapp_delivery_failed` in the alerts |

## Nothing twice

| Thing | How a duplicate is prevented |
|---|---|
| WhatsApp message from a client delivered twice by Meta | `claim_whatsapp_message` (0032): only the first copy is answered |
| Email delivered twice | Claimed by its message ID before Elliot sees it (0035, 0039) |
| A follow-up step | `claim_due_follow_up_runs` (0048): the step is claimed and the run moved to its next step in one transaction, *before* anything is sent. A sweep that crashes or overlaps the next one finds nothing to resend. |
| An email | Every email to Resend carries an `Idempotency-Key`; Resend sends a key once in 24 hours, so the retry after a dropped connection can't produce a second copy |
| A viewing in the same calendar slot | Database rule `excl_no_overlapping_appointments` (per calendar); the calendar event is removed again if the insert loses the race |
| A viewing reminder | Recorded per viewing (`record_viewing_reminder`); `due_viewing_reminders` skips those already done |
| A delivery-failure note | One per WhatsApp message ID |

The price of "never twice" for follow-ups is "at most once": if a step is
claimed and then the send fails, that step is skipped, not retried. The draft
(with the error) stays in Approvals / the conversation, and the failure is in
the alerts.

## Retries

Retried automatically (3 tries): calls that only *read* or that are safe to
repeat — Claude, Voyage embeddings, Google free/busy, fetching an email and
its attachments from Resend, ASARI listings, Resend sends (safe because of
the idempotency key).

Never retried automatically: anything that *sends or creates* without an
idempotency key — WhatsApp messages, Google Calendar events, Gmail sends, the
agency's CRM webhook within one run. `reliability.test.js` fails if someone
switches retries on for one of these.

CRM sync waits longer after each failure: at once, then 15 min, 45 min,
2 h 15 and 6 h 45 later (`due_crm_syncs`), so a CRM that is down for an
afternoon doesn't lose the sync. After five failures it is marked `failed`.

## Clients can stop follow-ups

A client who answers **STOP**, **unsubscribe**, **wypisz**, **rezygnuję** or
**nie pisz** (as the whole first line of a WhatsApp message or email) gets no
more follow-up steps: their running sequences stop (`stop_reason =
'opted_out'`), new ones stop at their first step, and the conversation gets a
note saying so. Elliot still answers when they write. **START** / **wznów**
switches follow-ups back on. Stored in `contacts.follow_up_opt_out_at`.

Follow-ups also stop when the lead is marked CONVERTED or LOST, and (as
before) as soon as the client replies.

Elliot does not add an opt-out line to follow-up messages; the agency writes
its own steps. Whether one is legally required for a given message is a
question for the legal review, not something this code decides.

## After importing a workflow into n8n

The files carry the real n8n IDs of every workflow they call, and each names
*34 - Workflow Error Recorder* as its error workflow, so an import no longer
resets those. What an import still asks for: **credentials** (pick the same
ones as before on any node n8n flags) and, where a workflow has them, the
secrets pasted into its Code nodes (listed in that workflow's doc).

The IDs are in [`workflow-specs/README.md`](workflow-specs/README.md#workflow-ids-in-n8n).
`reliability.test.js` fails if a file points at a placeholder or forgets the
error workflow.

If a workflow is ever deleted and re-created in n8n it gets a new ID: update
the table and the files that call it.

## Known limits

- **Gmail (workflow 16)**: several emails in one check are handled one at a
  time. If a step crashes outright, the later emails of that check wait until
  someone looks at the failed run in n8n.
- **WhatsApp (workflow 25)** answers the first message when Meta puts several
  in one delivery; the others are counted in the alerts
  (`whatsapp_unanswered_failed`) so someone reads the chat.
- **Website chat** has no retry on the visitor's side: if n8n itself is down
  the widget shows an error. The `/webhook/health` monitor is what catches
  that.
- n8n Cloud Starter allows 2,500 executions a month. Every message, sweep and
  check is one. When the allowance runs out, n8n stops running workflows.
- None of this has been exercised in a live n8n. The database side is tested
  on a scratch Postgres; the workflow side from the exported JSON.
