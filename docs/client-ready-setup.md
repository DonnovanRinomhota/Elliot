# Client-ready fix pack: setup checklist

Everything in this pack is code that's already in the repo. These are the
manual steps to switch it on, in order. Steps 1–3 are required; step 4 only
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
- **Internal webhooks need a secret.** `19`, `21`, `22` and `30` use n8n's
  built-in Header Auth and reject any call without the
  `x-elliot-webhook-secret` header.
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

## 2. Vercel (dashboard) environment variables

Vercel → **elliot-real-estate** → Settings → Environment Variables. Tick
Production, Preview and Development for each, then redeploy (Deployments →
⋯ on the latest → Redeploy).

| Variable | Value |
|---|---|
| `ELLIOT_WEBHOOK_SECRET` | A random secret. Generate one with `openssl rand -hex 32` and keep it in your password manager. The same value goes into n8n in step 3. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key (needed by self-serve signup) |
| `N8N_ONBOARD_WEBHOOK_URL` | Workflow 19's Production URL (same value as the old `NEXT_PUBLIC_N8N_ONBOARD_WEBHOOK_URL`) |
| `N8N_CANCEL_APPOINTMENT_WEBHOOK_URL` | Workflow 30's Production URL (after step 3) |

You can delete `NEXT_PUBLIC_N8N_ONBOARD_WEBHOOK_URL` once
`N8N_ONBOARD_WEBHOOK_URL` is set. The dashboard falls back to the old name
until then.

Until `N8N_CANCEL_APPOINTMENT_WEBHOOK_URL` is set, Cancel still works but
only inside Elliot, and the card says the calendar event has to be removed
by hand.

## 3. n8n

Written for **n8n Cloud** on any plan, including Starter (no Variables, no
environment variables). Secrets live in an n8n credential or are pasted
into a node; nothing reads `$env`.

### 3a. Create the webhook-secret credential (once)

1. n8n → **Overview** → **Credentials** → **Create credential** → search
   **Header Auth**.
2. Name it exactly **`Elliot Internal Webhook Secret`**.
3. **Name:** `x-elliot-webhook-secret`
4. **Value:** the same secret you put in Vercel's `ELLIOT_WEBHOOK_SECRET`.
5. Save.

### 3b. Switch on Header Auth in 19, 21 and 22 (no import needed)

For each of **19 - Tenant Onboarding**, **21 - Start Follow-Up Run** and
**22 - Queue CRM Sync**:

1. Open the workflow and double-click its Webhook node (the first node).
2. **Authentication** → **Header Auth**.
3. **Credential for Header Auth** → `Elliot Internal Webhook Secret`.
4. Close the node, **Save**, and keep the workflow active.

Do 19 **after** Vercel's `ELLIOT_WEBHOOK_SECRET` is set and redeployed,
otherwise the onboarding page will be rejected in between.

The repo's JSON for these three has exactly that change, so editing in
place and re-importing end up the same. Editing in place keeps the
workflow IDs and webhook URLs you already have.

### 3c. Edit 10 and 23 in place

- **10 - Lead Capture** → `Score Lead` node: change
  `else if (score >= 40) status = 'QUALIFIED';` to `'WARM'`. Save.
  (Edit in place: workflow 01 calls 10 by its ID, so an imported copy
  would never run.)
- **23 - CRM Sync Sweep** → `Query Pending Syncs` node: replace the query
  with the one in `n8n/workflows/23-crm-sync-sweep.json`. Save.

### 3d. Import the new workflows

For each file: **Overview** → **Create workflow** → ⋯ (top right) →
**Import from File**, pick the file, select credentials on the flagged
nodes, Save, then switch it to **Active**. Both import inactive on purpose.

| File | Credentials to select | Then |
|---|---|---|
| `29-auto-enrol-follow-ups.json` | Elliot Postgres (service role) | Activate |
| `30-cancel-appointment.json` | `Elliot Internal Webhook Secret` (Webhook node), Elliot Postgres (service role), Elliot Google Calendar | Activate, copy its **Production** URL into Vercel's `N8N_CANCEL_APPOINTMENT_WEBHOOK_URL` and redeploy |

## 4. WhatsApp (only if the client gets it)

1. Import `25-whatsapp-inbound-trigger.json` as a new workflow (as in 3d)
   and delete the old 25. Both use the `whatsapp` webhook path, so only one
   can be active.
2. Open **Check Verify Token** and replace
   `PASTE_WHATSAPP_VERIFY_TOKEN_HERE` with your verify token (the same one
   you enter in Meta's webhook settings).
3. Open **Verify Meta Signature** and replace
   `PASTE_META_APP_SECRET_HERE` with your App Secret (Meta App Dashboard →
   App settings → Basic → App Secret).
4. Select credentials on the flagged nodes, Save, Activate.

The real values live only in your n8n. **Never export this workflow back
into the repo with them filled in**; the repo keeps the placeholders. If
you ever move to a plan with Variables, or self-host, variables named
`WHATSAPP_VERIFY_TOKEN` / `META_APP_SECRET` take priority over the pasted
values.

`require('crypto')` (used for the signature) works on n8n Cloud. Self-hosted
n8n needs `NODE_FUNCTION_ALLOW_BUILTIN=crypto`.

If messages stop arriving, look at workflow 25's executions: `Verify Meta
Signature` outputs a `_signature` field saying why (`no_secret_configured`,
`missing`, `invalid`, `no_raw_body`).

## 5. Per-client switches (in the dashboard)

- **CRM:** Settings → Integrations → CRM webhook URL. Syncs only queue for
  tenants that have one, so tenants without a CRM aren't affected. Changes
  made before the URL was set are not back-filled.
- **Follow-ups:** Follow-ups → pick a sequence → "Auto-enrol new leads that
  go quiet for …" → Turn on. Only leads created **after** you turn it on
  are enrolled, so existing leads are never mass-emailed.

## 6. Smoke test (about 15 minutes)

1. **Webhook secret:** `curl -i -X POST <19's URL> -d '{}'` without the
   header should be refused by n8n (401 or 403), before the workflow runs.
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
