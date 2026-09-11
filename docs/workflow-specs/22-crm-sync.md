# Workflow Spec: 22 - Queue CRM Sync (+ 23 - CRM Sync Sweep)

## Why "generic," and what that actually means
`crm_sync_log` has existed since Phase 1 with `crm_provider` as a free-text column and nothing built against it. No real tenant/CRM target exists yet to justify hardcoding a specific integration (HubSpot's API, Pipedrive's API, etc.) — building toward one specific CRM nobody's actually using would be guesswork. Instead: each tenant configures `ai_config.crm_webhook_url`, and the sweep POSTs a normalized JSON payload there. This works with anything that accepts an incoming webhook — a CRM's native webhook trigger, or a Zapier/Make step in front of a CRM that doesn't take webhooks directly. `crm_provider` stays a purely descriptive label (defaults to `'generic_webhook'`); nothing in either workflow branches on its value.

## What this does NOT solve
- **Nothing queues a sync automatically yet.** Workflow 22 is a manual/internal entry point — wiring it into `10` (lead capture) or `12` (book appointment) so syncs queue themselves on every creation would mean editing already-live production workflows. Same tradeoff already made once for the follow-up engine's run-advancement limitation — deliberately out of scope here too.
- **No response-shape assumptions.** A truly generic receiver could return anything (or nothing) on success, so `crm_record_id` is left `null` on a successful sync rather than guessed at. If your specific receiver does return a stable external ID, that's a small, receiver-specific addition to make later — not something a generic version can assume.

## Workflow 22 — Queue CRM Sync
**Trigger:** internal webhook (`POST /queue-crm-sync`), not linked anywhere public, same convention as `19`/`21`.
**Input:** `{ tenant_slug, entity_type, entity_id, crm_provider? }` — `entity_type` must be `contact`, `lead`, or `appointment`; `crm_provider` defaults to `generic_webhook`.
**Real safety check, not just validation:** verifies `entity_id` actually belongs to the tenant named by `tenant_slug` before queuing anything — without this, one tenant could queue a sync for another tenant's data by guessing a UUID.
**No dedup.** Calling this twice for the same entity creates two log rows; acceptable for an audit-log-shaped table with no unique constraint to conflict on.

## Workflow 23 — CRM Sync Sweep
**Trigger:** cron, every 5 minutes — shorter than the follow-up sweep's 15, since this is closer to real-time integration than a multi-day drip sequence.
**Per pending row:**
| Case | Result |
|---|---|
| Tenant has no `crm_webhook_url` configured | Immediately marked `failed` with a clear `last_error` — not left pending forever with no explanation |
| Send succeeds | Marked `synced` |
| Send fails | `retry_count` incremented; stays `pending` (next sweep retries automatically) until 5 total attempts, then `failed` permanently |

**Payload sent to the tenant's webhook:**
```json
{
  "tenant_slug": "acme-realty",
  "entity_type": "lead",
  "entity_id": "…uuid…",
  "provider": "generic_webhook",
  "data": { "status": "HOT", "score": 85, "qualification_answers": {...} }
}
```
`data`'s shape depends on `entity_type` — `contact` gives name/email/phone/source, `lead` gives status/score/qualification_answers, `appointment` gives starts_at/ends_at/status/notes.

## Design decisions worth knowing
- **Both the queue query and the sweep query are single round trips**, same lesson as workflows 20/21: `Verify Entity Belongs To Tenant` uses scalar subqueries (always exactly one row, `NULL` rather than a vanished item on no match); `Query Pending Syncs` uses three `LEFT JOIN`s gated by `entity_type`, so exactly one contributes to the `CASE`-built payload per row — no chained Postgres node to strip fields via a narrow `RETURNING` or lose the item on zero rows.
- **The 5-attempt retry cap reuses the existing `retry_count` column** rather than adding new scheduling logic — the sweep's own 5-minute cadence *is* the retry backoff.

## Credentials required
The shared Postgres credential (same as everywhere else). `Send To CRM Webhook` has no credential of its own — it POSTs to whatever URL the tenant configured, which is data, not a fixed endpoint needing a stored credential.

## Requires
- `0019_ai_config_crm_webhook.sql` applied (adds `ai_config.crm_webhook_url`).
