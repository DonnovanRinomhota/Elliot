# Client-ready fix pack: setup checklist

Everything in this pack is code that's already in the repo. These are the
manual steps to switch it on, in order. Steps 1–4 are required; step 5 only
if the client is getting WhatsApp.

What the pack does, in one line each:

- **CRM sync runs by itself.** Contacts, leads and appointments queue a sync
  whenever they're created or change (migration `0026`). Nothing calls
  workflow 22 any more.
- **Follow-ups start by themselves.** One sequence per tenant can auto-enrol
  leads that go quiet (migration `0026` + workflow `29`). Staff can also
  start or stop a follow-up on any lead from the Leads page.
- **Cancelling removes the calendar event.** The dashboard's Cancel button
  now goes through workflow `30`, which deletes the Google Calendar event.
- **Internal webhooks need a secret.** `19`, `21`, `22` and `30` reject any
  call without the `x-elliot-webhook-secret` header.
- **WhatsApp checks Meta's signature.** `25` drops any POST not signed with
  your Meta App Secret.
- **Bug fix: mid-scoring leads now save.** `10` used to write status
  `QUALIFIED`, which the database rejects, so every lead scoring 40–69 was
  lost. It now saves as `WARM`.

---

## 1. Database (Supabase SQL editor)

1. Run `db/migrations/0026_auto_crm_sync_and_follow_up_enrolment.sql`.
   It's idempotent, so running it twice is harmless.
2. Optional, on a **scratch** database only (it inserts test data):
   `db/seed/test_0026_auto_sync_and_enrolment.sql` should end with
   `ALL 0026 CHECKS PASSED`.

## 2. n8n environment variables

Set these on the n8n instance (Docker env / n8n Cloud variables), then
restart n8n.

| Variable | Value | Used by |
|---|---|---|
| `ELLIOT_WEBHOOK_SECRET` | A long random string, 16+ characters. Generate one with `openssl rand -hex 32`. | 19, 21, 22, 30 |
| `META_APP_SECRET` | Meta App Dashboard → App settings → Basic → App Secret | 25 (WhatsApp only) |
| `NODE_FUNCTION_ALLOW_BUILTIN` | `crypto` (or add it to your existing list) | 25 (WhatsApp only) |

If your n8n has `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, Code nodes can't read
`$env`. Workflow 25's verify-token check already depends on this, so it
should already be `false`. If it isn't, every gated webhook will reject all
calls (they fail closed).

## 3. n8n workflows

Re-import the changed workflows over the existing ones (open each in n8n →
⋯ → Import from file), re-select credentials if n8n asks, and save.

| File | Change | After import |
|---|---|---|
| `10-lead-capture.json` | 40–69 band saves as `WARM` | Save |
| `19-tenant-onboarding.json` | Secret check | Save, keep active |
| `21-start-follow-up-run.json` | Secret check | Save, keep active |
| `22-queue-crm-sync.json` | Secret check | Save, keep active |
| `23-crm-sync-sweep.json` | Lead and appointment payloads now include the contact | Save, keep active |
| `25-whatsapp-inbound-trigger.json` | Meta signature check, Raw Body on | Save |

Import the two new workflows:

| File | Credentials to select | Then |
|---|---|---|
| `29-auto-enrol-follow-ups.json` | Elliot Postgres (service role) | Activate |
| `30-cancel-appointment.json` | Elliot Postgres (service role), Elliot Google Calendar | Activate, copy its **Production** webhook URL |

Both new files import **inactive** on purpose.

## 4. Vercel (dashboard) environment variables

Settings → Environment Variables, enabled for Production, Preview and
Development. Then redeploy.

| Variable | Value |
|---|---|
| `ELLIOT_WEBHOOK_SECRET` | The **same** value as on n8n |
| `N8N_CANCEL_APPOINTMENT_WEBHOOK_URL` | Workflow 30's Production URL |
| `N8N_ONBOARD_WEBHOOK_URL` | Workflow 19's Production URL (same value as the old `NEXT_PUBLIC_N8N_ONBOARD_WEBHOOK_URL`) |

You can delete `NEXT_PUBLIC_N8N_ONBOARD_WEBHOOK_URL` once
`N8N_ONBOARD_WEBHOOK_URL` is set. The dashboard falls back to the old name
until then.

Until `N8N_CANCEL_APPOINTMENT_WEBHOOK_URL` and `ELLIOT_WEBHOOK_SECRET` are
set, Cancel still works but only inside Elliot, and the card says the
calendar event has to be removed by hand.

## 5. WhatsApp (only if the client gets it)

On top of steps 2–3: confirm `META_APP_SECRET` and
`NODE_FUNCTION_ALLOW_BUILTIN=crypto` are set, then send a real message to
the test number. If messages stop arriving after this change, look at
workflow 25's executions: `Verify Meta Signature` outputs a `_signature`
field saying why (`no_secret_configured`, `missing`, `invalid`,
`no_raw_body`).

For local testing with hand-written payloads only, set
`WHATSAPP_SIGNATURE_CHECK=off`. Never leave that on in production.

## 6. Per-client switches (in the dashboard)

- **CRM:** Settings → Integrations → CRM webhook URL. Syncs only queue for
  tenants that have one, so tenants without a CRM aren't affected. Changes
  made before the URL was set are not back-filled.
- **Follow-ups:** Follow-ups → pick a sequence → "Auto-enrol new leads that
  go quiet for …" → Turn on. Only leads created **after** you turn it on
  are enrolled, so existing leads are never mass-emailed.

## 7. Smoke test (about 15 minutes)

1. **Webhook secret:** `curl -X POST <19's URL> -d '{}'` without the header
   should return `401 {"success":false,"error":"unauthorized"}`.
2. **Onboarding:** create a test tenant from `/dashboard/onboarding`. It
   should succeed.
3. **Lead + CRM:** chat with the widget as a fake buyer and give a budget
   and intent. A WARM or HOT lead should appear in Leads, and within 5
   minutes the CRM webhook should receive a `contact` and a `lead` payload.
4. **Booking + cancel:** book a viewing in the chat, check the event is in
   Google Calendar, then press Cancel in Appointments. The event should
   disappear, and the CRM should receive an `appointment` payload with
   `status: "cancelled"`.
5. **Follow-up:** on a lead with an email, press "Start follow-up". A
   draft should appear in Approvals at the first step's day (day 0 means
   within 15 minutes).
