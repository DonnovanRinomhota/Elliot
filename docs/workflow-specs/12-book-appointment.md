# Workflow Spec: 12 - Book Appointment

## Trigger
Called as a sub-workflow via n8n's "Execute Workflow" node — invoked by the Main AI Agent when Claude requests the `book_appointment` tool. The system prompt requires Claude to have called `check_availability` and gotten explicit visitor confirmation of a specific slot first, and to have a real `contact_id` (typically from a prior `capture_lead` call) before calling this.

## Inputs
```json
{
  "tenant_id": "…uuid…",
  "contact_id": "…uuid…",
  "starts_at": "2026-08-17T10:00:00.000Z",
  "ends_at": "2026-08-17T11:00:00.000Z",
  "notes": "Property viewing requested via chat"
}
```

## Nodes (in order)
| Node | What it does |
|---|---|
| When Executed by Another Workflow | Sub-workflow trigger |
| Load Tenant + Contact Info | Pulls `google_calendar_id`, `timezone`, `contact_name`, `contact_email` |
| HTTP Request | Creates the Google Calendar event directly via `POST /calendar/v3/calendars/{calendarId}/events` — **HTTP Request node, not the native Google Calendar node** (see Known Issues) |
| Insert Appointment | Inserts into `appointments`, using the Google event's returned `id` as `external_calendar_id`. DB-level `excl_no_overlapping_appointments` exclusion constraint (0004) is what actually prevents double-booking — this is a real safety net, not just application logic |
| Format Results | Normalizes output for the Main Agent's tool_result formatting |

## Credentials required
- **Elliot Postgres (RLS-scoped)** for the appointment insert (note: different credential than most other Postgres nodes in this project, which use service-role — worth double-checking this is intentional if debugging future RLS issues here)
- **Elliot Google Calendar** (Predefined Credential Type → Google Calendar OAuth2 API)

## Error paths
- Double-booking a slot → Postgres exclusion constraint violation surfaces as a clear DB error. This sub-workflow does not currently catch that and turn it into a graceful "that time's no longer available, please pick another" reply — the error just propagates. **Flagged as unhandled, not yet fixed.**
- Google Calendar API failure (auth, invalid calendar ID) → HTTP Request node fails before any DB write happens, so no orphaned appointment rows.

## Expected output
```json
{ "success": true, "appointment_id": "…uuid…", "starts_at": "2026-08-17T10:00:00.000Z", "ends_at": "2026-08-17T11:00:00.000Z", "status": "confirmed" }
```

## Connecting this to the Main Agent
Copy this workflow's ID from n8n and confirm it matches the workflow ID referenced in the Main Agent's "Execute: Book Appointment Sub-Workflow" node.
