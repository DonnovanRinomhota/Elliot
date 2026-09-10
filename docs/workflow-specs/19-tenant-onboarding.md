# Workflow Spec: 19 - Tenant Onboarding

## What this actually solves, and what it doesn't
Before this, creating a tenant meant hand-writing `INSERT` statements into `tenants` and `ai_config` via the Supabase SQL editor. This workflow replaces that with one webhook call.

**It does NOT solve true self-serve signup.** Two real gaps remain, and this workflow is explicit about them in its response rather than pretending they're handled:
1. **Google Calendar and Gmail connections are still manual, per-tenant, one-off n8n credential setup.** The current architecture (workflows 11/12/15/16) uses a single OAuth2 credential assigned directly to each HTTP Request node in n8n — there's no dynamic per-tenant credential resolution at runtime. Genuinely automating this would mean building a real OAuth consent flow (a public redirect URI, encrypted per-tenant token storage, token refresh logic) — a significantly bigger project than tenant provisioning, and deliberately out of scope here.
2. **This endpoint has no auth.** It's meant to be used internally (by you, via curl/Postman), not linked anywhere public. Add a shared-secret header check before this is ever exposed more broadly than that.

## Trigger
Internal webhook (`POST /onboard-tenant`) — not linked from the marketing site or anywhere public.

## Inputs
```json
{
  "name": "Acme Realty",
  "slug": "acme-realty",
  "industry": "real_estate",
  "timezone": "Europe/Warsaw",
  "plan": "trial",
  "autonomy_rules": { "send_email": { "mode": "approval_required" } },
  "escalation_thresholds": { "min_confidence": 0.6 },
  "lead_scoring_rubric": {}
}
```
Only `name` and `slug` are required. Everything else has a safe default — `autonomy_rules` defaults to `approval_required` for both `send_email` and `book_appointment` (deliberately conservative: a brand-new tenant should run gated for a while before anything is relaxed, matching the roadmap's "shadow mode first" recommendation). `slug` must be lowercase letters/digits/hyphens only (used in widget embed URLs).

## Nodes (in order)
| Node | What it does |
|---|---|
| Onboarding Webhook | Internal POST trigger |
| Validate Input | Required-field + slug-format checks, applies defaults |
| Insert Tenant | `INSERT ... ON CONFLICT (slug) DO NOTHING RETURNING *` — a duplicate slug returns zero rows instead of a raw constraint error |
| Tenant Created? | Branches on whether a row actually came back. Uses an explicit boolean expression, not n8n's built-in empty-check operator — that operator has caused a real bug before with `null` values (see 15/KNOWN_ISSUES) |
| Insert AI Config | Creates the matching `ai_config` row for the new tenant |
| Format Onboarding Result | Builds the response, including the manual-steps checklist below |
| Respond Success / Respond Slug Taken | Two response paths — success (200) or slug conflict (409) |

## Credentials required
- **Elliot Postgres (service role)** — same shared credential used everywhere else.

## Requires
- Nothing new at the DB level — uses the existing `tenants`/`ai_config` schema from `0001_extensions_and_tenants.sql`.

## Error paths
- Missing `name`/`slug`, or malformed `slug` → `Validate Input` throws.
- Duplicate `slug` → clean `409 { success: false, error: "slug '...' is already in use" }`, not a raw Postgres error.
- **Known, unhandled edge case:** if `Insert AI Config` fails after `Insert Tenant` already succeeded, you get an orphaned tenant with no config. n8n doesn't span a transaction across separate Postgres nodes by default. Not expected to fail in practice (the only constraint here is the FK, which always resolves), but if it ever does: check for a tenant with no matching `ai_config` row.

## Expected output
```json
{
  "success": true,
  "tenant_id": "…uuid…",
  "slug": "acme-realty",
  "name": "Acme Realty",
  "next_steps": [
    "Connect this tenant's Google Calendar: ...",
    "Connect this tenant's Gmail (if using the email agent): ...",
    "Seed an initial knowledge base document (optional): curl -X POST .../webhook/ingest-document -d '{\"tenant_slug\": \"acme-realty\", ...}'",
    "Embed the chat widget on the tenant's site using tenant slug \"acme-realty\"."
  ]
}
```

## Connecting this to your workflow
Import, set the Postgres credential, activate. Copy the Production URL and keep it somewhere private (a password manager note, not a shared doc) — same reasoning as the "no auth yet" caveat above.
