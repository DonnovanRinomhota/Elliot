# Internal webhook auth (shared secret)

Applies to: `19` tenant onboarding, `21` start follow-up run, `22` queue
CRM sync, `30` cancel appointment.

## Why
These webhooks create tenants, start email sequences, queue CRM writes and
cancel bookings. Before this, anyone who found a URL could call them.
Workflow 19 was the one flagged in `KNOWN_ISSUES.md`; 21, 22 and 30 got the
same protection because they're the same kind of endpoint.

## How it works
Each workflow's Webhook node has **Authentication: Header Auth**, using one
shared n8n credential named **`Elliot Internal Webhook Secret`**
(Name: `x-elliot-webhook-secret`, Value: the secret).

- n8n checks the header itself, before the workflow runs. A missing or
  wrong header gets a 401/403 from n8n, and no execution is created.
- It works on every n8n plan, including **Cloud Starter**. That's why it's
  done this way rather than in a Code node: Cloud blocks `$env`, and
  Variables (`$vars`) need Pro or Enterprise.
- The JSON exports reference the credential by name with a placeholder id
  (`PLACEHOLDER_SET_ON_IMPORT`). On import, n8n asks you to pick the
  credential; the secret never appears in the repo.

`n8n/workflows/tests/client_ready_fixes.test.js` checks all four Webhook
nodes use Header Auth with that credential and that none of them reads
`$env`.

## Callers
- The dashboard calls 19 and 30 from server route handlers
  (`app/api/admin/onboard`, `app/api/appointments/[id]/cancel`) through
  `lib/n8n-webhook.ts`, which sends Vercel's `ELLIOT_WEBHOOK_SECRET` as the
  header. That value must match the credential's Value. The secret is a
  server-only env var and never reaches the browser. A 401/403 from n8n is
  reported as "n8n rejected the webhook secret".
- 21 and 22 have no automatic callers any more: CRM sync queues from
  database triggers, follow-ups start from workflow 29 or the Leads page.
  Calling them by hand:

  ```bash
  curl -X POST "https://<your-n8n>/webhook/queue-crm-sync" \
    -H "Content-Type: application/json" \
    -H "x-elliot-webhook-secret: <the secret>" \
    -d '{"tenant_slug":"acme-realty","entity_type":"lead","entity_id":"<uuid>"}'
  ```

## Rotating the secret
Change the credential's Value in n8n and Vercel's `ELLIOT_WEBHOOK_SECRET`,
then redeploy the dashboard. Calls fail in between, so do it in a quiet
moment.

## Not covered
- Not per-tenant: one secret for the whole platform. Fine while one
  operator runs everything.
- `08` knowledge ingestion, `17` and `28` (manual sends) are still called
  from the dashboard's browser code, so they can't hold the secret. See
  `KNOWN_ISSUES.md`; the fix is moving each behind a server route, then
  switching on Header Auth the same way.
- The public `chat` webhook (01) and `demo-request` (18) are public by
  design.
