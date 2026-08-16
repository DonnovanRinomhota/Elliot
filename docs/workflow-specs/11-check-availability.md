# Workflow Spec: 11 - Check Availability

## Trigger
Called as a sub-workflow via n8n's "Execute Workflow" node — invoked by the Main AI Agent when Claude requests the `check_availability` tool.

## Inputs
```json
{ "tenant_id": "…uuid…", "date_range_start": "2026-08-17", "date_range_end": "2026-08-21" }
```
The Main Agent's system prompt tells Claude to anchor date ranges to the real current date (injected explicitly — see `main-agent-system-prompt.md`). Without that anchor, Claude has been observed defaulting to plausible-sounding but wrong dates (a full year off), which silently returns zero real slots. This is not a defect in this sub-workflow — it only ever computes correctly against whatever range it's given.

## Nodes (in order)
| Node | What it does |
|---|---|
| When Executed by Another Workflow | Sub-workflow trigger |
| Load AI Config | Pulls `business_hours`, `google_calendar_id`, `timezone` for the tenant |
| Merge Config | Carries the trigger's date range forward alongside the loaded config |
| Get Busy Times (Google FreeBusy API) | **HTTP Request node**, not n8n's native Google Calendar node — see Known Issues for why. Calls `POST /calendar/v3/freeBusy` |
| Compute Available Slots | Computes open hourly slots = business hours minus busy ranges, in the tenant's real timezone (Luxon `DateTime`, available as a global in n8n's Code node — no `require()`), capped at 200 total slots across the range |

## Credentials required
- **Elliot Postgres (service role)**
- **Elliot Google Calendar** (Predefined Credential Type → Google Calendar OAuth2 API) — used by the HTTP Request node, not a native Google Calendar node

## Requires
- `ai_config.google_calendar_id` column — added in `0011_ai_config_calendar_and_leads_unique.sql`

## Error paths
- No calendar credential / expired OAuth token → HTTP Request node fails with a clear auth error.
- The original `MAX_SLOTS = 5` cap silently truncated results mid-day, causing Claude to occasionally tell visitors a genuinely open later time "wasn't available" (it just never got checked). Fixed by raising the cap to 200 — see Known Issues.

## Expected output
```json
{ "available_slots": [{ "starts_at": "2026-08-18T07:00:00.000Z", "ends_at": "2026-08-18T08:00:00.000Z" }, ...], "timezone": "Europe/Warsaw" }
```

## Connecting this to the Main Agent
Copy this workflow's ID from n8n and confirm it matches the workflow ID referenced in the Main Agent's "Execute: Check Availability Sub-Workflow" node.
