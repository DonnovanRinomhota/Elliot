# Internal webhook auth (shared secret)

Applies to: `08` knowledge ingestion, `17` manual email send, `19` tenant
onboarding, `21` start follow-up run, `22` queue CRM sync, `28` manual
WhatsApp send, `30` cancel appointment.

Since 0047 also: `01`'s second webhook **`/chat-internal`**, which workflows
16, 40 (email) and 25 (WhatsApp) call from their "Ask Elliot" node with the
same credential. Only requests that arrive there may say which channel they
are, attach files, or count as a verified client; the public `/chat` webhook
is always the website chat. See [`../security.md`](../security.md).

## Why
These webhooks create tenants, start email sequences, queue CRM writes and
cancel bookings. Before this, anyone who found a URL could call them.
Workflow 19 was the one flagged first; the rest got the same protection
because they're the same kind of endpoint. 08 mattered most after that: it
let anyone add documents to any tenant's knowledge base, which the AI then
answers customers from.

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

`n8n/workflows/tests/client_ready_fixes.test.js` checks all seven Webhook
nodes use Header Auth with that credential and that none of them reads
`$env`.

## Callers
- The dashboard calls them only from server route handlers, through
  `lib/n8n-webhook.ts`, which sends Vercel's `ELLIOT_WEBHOOK_SECRET` as the
  header:

  | Route | Workflow | What the route checks first |
  |---|---|---|
  | `app/api/admin/onboard` | 19 | caller is in `ADMIN_EMAILS` |
  | `app/api/appointments/[id]/cancel` | 30 | appointment is the user's tenant's (RLS); tenant id taken from the row |
  | `app/api/drafts/[id]/send` | 17 / 28 | draft is the user's tenant's (RLS) and `approved` |
  | `app/api/knowledge/ingest` | 08 | tenant slug taken from the session, never from the browser |

  That value must match the credential's Value. The secret is a
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
- The public `chat` webhook (01) and `demo-request` (18) are public by
  design.
