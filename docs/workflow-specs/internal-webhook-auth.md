# Internal webhook auth (shared secret)

Applies to: `19` tenant onboarding, `21` start follow-up run, `22` queue
CRM sync, `30` cancel appointment.

## Why
These webhooks create tenants, start email sequences, queue CRM writes and
cancel bookings. Before this, anyone who found a URL could call them.
Workflow 19 was the one flagged in `KNOWN_ISSUES.md`; 21, 22 and 30 got the
same gate because they're the same kind of endpoint.

## How it works
Each workflow starts with **Check Webhook Secret → Authorized?**:

- The caller sends `x-elliot-webhook-secret: <secret>`.
- The Code node compares it with the n8n env var `ELLIOT_WEBHOOK_SECRET`
  using a constant-time comparison.
- Mismatch, missing header, or an unset / too-short (< 16 chars) env var
  returns `401 {"success":false,"error":"unauthorized"}`. It fails closed:
  a fresh n8n without the variable rejects everything.
- On success, the original webhook item (body, headers, query) passes
  through unchanged, so the existing **Validate Input** nodes didn't need
  changing.

The node's code is identical in all four workflows;
`n8n/workflows/tests/client_ready_fixes.test.js` checks that, and runs the
code itself.

## Callers
- The dashboard calls 19 and 30 from server route handlers
  (`app/api/admin/onboard`, `app/api/appointments/[id]/cancel`) through
  `lib/n8n-webhook.ts`. The secret is a server-only env var and never
  reaches the browser.
- 21 and 22 have no automatic callers any more: CRM sync queues from
  database triggers, follow-ups start from workflow 29 or the Leads page.
  Calling them by hand:

  ```bash
  curl -X POST "$N8N/webhook/queue-crm-sync" \
    -H "Content-Type: application/json" \
    -H "x-elliot-webhook-secret: $ELLIOT_WEBHOOK_SECRET" \
    -d '{"tenant_slug":"acme-realty","entity_type":"lead","entity_id":"<uuid>"}'
  ```

## Not covered
- Not per-tenant: one secret for the whole platform. Fine while one
  operator runs everything.
- `08` knowledge ingestion is called from the dashboard's browser code, so
  it can't hold a secret the same way. It's left as it was; moving it
  behind a server route is the follow-up.
- The public `chat` webhook (01) and `demo-request` (18) are public by
  design.
- `17`/`28` (manual send) are still called from the browser; same
  follow-up as 08.
