# Workflow Spec: 30 - Cancel Appointment

## Why this exists
The dashboard's Cancel button used to set `appointments.status =
'cancelled'` and nothing else, so the Google Calendar event created by
workflow 12 stayed in the tenant's calendar. The Google credential lives in
n8n, so the delete has to happen here.

## Trigger
Internal webhook, `POST /cancel-appointment`, with n8n Header Auth: n8n
refuses calls without the `x-elliot-webhook-secret` header matching the
`Elliot Internal Webhook Secret` credential (see `internal-webhook-auth.md`). Called by
the dashboard's server route `app/api/appointments/[id]/cancel/route.ts`,
which reads the appointment through the user's own RLS session first, so
`tenant_id` always comes from the database, never from the browser.

## Input
`{ appointment_id: uuid, tenant_id: uuid }`

## Nodes
| Node | What it does |
|---|---|
| Validate Input | Both fields required, both uuids |
| Load Appointment | Scalar subqueries, always one row: appointment id/status/`external_calendar_id` scoped to the tenant, plus the tenant's `google_calendar_id` |
| Check Appointment → Can Cancel? | 404 if not found for this tenant; 409 if already cancelled / completed / no-show |
| Has Calendar Event? | Only calls Google when both calendar id and event id are known |
| Delete Calendar Event | `DELETE /calendars/{id}/events/{eventId}`, HTTP Request node with the Google Calendar credential (the pattern from 12), `continueOnFail` |
| Calendar Result | 204 → `deleted`; 404/410 → `already_gone`; anything else → `failed` |
| No Calendar Event | `calendar: 'no_event'` |
| Mark Cancelled | Updates only if still not final; `alwaysOutputData` so a race answers 409 instead of hanging |
| Respond Result | `{ success, appointment_id, status, calendar }` |

## Output
`{ success: true, appointment_id, status: "cancelled", calendar: "deleted" | "already_gone" | "no_event" | "failed" }`

`failed` still cancels the appointment in Elliot. The dashboard tells the
user to remove the event by hand, because a stuck calendar credential
shouldn't block cancelling.

## Side effects
- The status change fires migration `0026`'s CRM trigger, so the tenant's
  CRM gets an `appointment` update with `status: "cancelled"`.
- Freed slot: the double-booking constraint only covers `confirmed`
  appointments, so the time becomes bookable again immediately.

## Not covered
- No cancellation email to the contact. The booking in 12 doesn't send
  Google invites either (`sendUpdates` isn't set), so the two stay
  consistent. Add `?sendUpdates=all` to both if invites are wanted.
- Rescheduling isn't built. Cancel and re-book.

## Credentials
Elliot Internal Webhook Secret (Header Auth, on the Webhook node); shared
Postgres credential (service role); Elliot Google Calendar OAuth2.
