# Workflow Spec: 18 - Demo Request Intake

## Trigger
Public webhook (`POST /demo-request`) — called directly by the marketing site's `DemoRequestForm`, via `submitDemoRequest()` in `elliot-web/services/elliotApi.ts`. Not tenant-scoped: this is a sales lead for Elliot itself (someone wants to become a tenant), not a tenant's own customer lead, so it does NOT go through the `contacts`/`leads` tables or any tenant auth.

## Inputs
```json
{
  "name": "Jane Kowalski",
  "company": "Acme Realty",
  "email": "jane@acme.com",
  "website": "acme.com",
  "industry": "Real Estate",
  "employees": "11–50",
  "automate": "answering property enquiries and booking viewings"
}
```
Matches the `DemoRequestPayload` contract in `elliot-web` exactly. `website` and `automate` are optional; everything else is required.

## Nodes (in order)
| Node | What it does |
|---|---|
| Demo Request Webhook | Public POST trigger, no auth |
| Validate Input | Checks required fields are present and non-empty, validates email format, trims/normalizes strings |
| Insert Demo Request | Inserts into `demo_requests` (platform-level table, no `tenant_id`) |
| Build Notification Email | Builds a raw RFC 2822 message summarizing the request, same base64url encoding approach as workflow 15 |
| Send Notification via Gmail | Sends the notification via the Gmail send API. `continueOnFail: true` — a notification failure must never lose the lead, since it's already committed to the DB by this point |
| Respond to Webhook | Returns `{ success: true, id }` |

## Credentials required
- **Elliot Postgres (service role)** — same shared credential used everywhere else.
- **A new internal Gmail OAuth2 credential** — deliberately separate from any tenant's connected inbox (used in 15/16 for tenant customer replies). This one sends from/as Elliot's own team, not on behalf of a tenant. Needs `gmail.send` scope.

## Requires
- `0017_demo_requests.sql` applied (creates the table, no tenant scoping, RLS enabled with no policies — service-role-only by design, same pattern as `audit_log`'s `tenant_id IS NULL` rows).

## Error paths
- Missing/invalid required fields → `Validate Input` throws, n8n's default webhook error response handles it (matches the pattern in workflow 17 — no custom error branch).
- Gmail notification failing does NOT fail the whole request — the DB insert already happened, so the lead is safe even if notification delivery is broken. Check `demo_requests` directly if notifications seem to have stopped.
- **`Insert Demo Request` must use `returning *`, not a partial column list.** A Postgres node's output *replaces* `$json` with only the columns named in `RETURNING` — the original input fields (name, company, email, etc.) are gone from that point on, not merged. An earlier version of this workflow used `returning id, created_at` and every downstream field showed as `undefined` in the notification email as a result. If a future edit narrows the `RETURNING` clause again, this bug comes back.

## Expected output
```json
{ "success": true, "id": "…uuid…" }
```

## Connecting this to the frontend
1. Import this workflow into n8n, set both credentials, activate it.
2. Copy the real Production webhook URL.
3. In the `elliot-web` Vercel project, set `NEXT_PUBLIC_ELLIOT_API_URL` — **note:** `services/elliotApi.ts` currently expects a base URL + `/v1/leads/demo-request` path (`ELLIOT_API_URL`), but n8n webhooks are full URLs, not a REST API with sub-paths, same as `NEXT_PUBLIC_ELLIOT_CHAT_WEBHOOK_URL` elsewhere in that file. `elliotApi.ts` needs a small update to match (see accompanying frontend change) — set `NEXT_PUBLIC_ELLIOT_DEMO_REQUEST_WEBHOOK_URL` to the full webhook URL instead.
4. Set `NEXT_PUBLIC_ELLIOT_MODE=live` when ready to go live (currently defaults to `demo`, which no-ops instead of calling this).
