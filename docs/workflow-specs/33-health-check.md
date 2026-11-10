# 33 - Health Check & Alerts (and 34 - Workflow Error Recorder)

Tells you when part of Elliot stops working, before a client notices.
Migration `0036_health_alerts.sql`; tests in
`n8n/workflows/tests/health_alerts.test.js` and `db/seed/test_0036_health.sql`.

## What it checks (every 15 minutes)

| Check | How | Typical failure |
|---|---|---|
| Database (Supabase) | Reads the alert settings | Supabase down, password changed |
| Claude | One-token request, same key and model as workflow 01 | Key expired or revoked, credit balance empty (busy/overloaded is **not** an alert) |
| Voyage AI | Embeds the word "ping" | Key revoked |
| Gmail | Reads the mailbox profile (`Gmail account`) | Google login expired |
| Google Calendar | Lists one calendar (`Elliot Google Calendar`) | Google login expired |
| WhatsApp (Meta) | Reads the sending phone number with the token | Token expired or revoked (skipped if no WhatsApp number is set up anywhere) |

It also picks up every failure the other workflows wrote to `audit_log` since
the last run: replies that couldn't be sent (`*_send_failed`), Elliot failing
to answer (`*_elliot_failed`), failed bookings, emails to a mailbox no agency
owns, and crashes of whole workflows (`workflow_error`, from workflow 34).

## Who is told

* **You (platform):** everything. Settings in the Control panel → Health &
  alerts: email on/off, WhatsApp on/off, the daily "all OK" email (08:00
  Warsaw) and how often to repeat an alert while something stays broken.
* **Each agency:** only problems in its own account. The agency switches
  email and/or WhatsApp on under Settings → Problem alerts. Off by default.

`health_alert_plan()` decides: a new failure is sent straight away, a
continuing one is repeated every *repeat_hours*, a recovery sends "back to
normal", and each logged failure is reported once.

## How it is sent

* **Email:** Resend (`alerts@getelliot.eu`), so alerts still arrive when Gmail
  is what broke. If Resend isn't set up or refuses, the same email goes out
  through Gmail instead.
* **WhatsApp:** the approved template `elliot_alert` (body: `Elliot alert:
  {{1}}`), sent from the phone number ID in the Control panel. A template is
  needed because WhatsApp only allows free-form messages within 24 hours of the
  person writing to you. The text is one line; details are in the email.

How each send went is stored and shown in the Control panel ("Last email
alert", "Last WhatsApp alert"), so a route that silently fails is visible.

## Other triggers in workflow 33

* `POST /webhook/health-test-alert` (internal secret): the Control panel's
  "Save and send a test alert" button.
* `GET /webhook/health`: `{ status: all_ok | degraded | stale | unknown, checks }`
  for an uptime monitor such as UptimeRobot (keyword `all_ok`). Answers 503 if
  the database can't be reached. This is what catches n8n itself being down,
  which no n8n workflow can report.

## Workflow 34

An n8n **error workflow**: when any workflow that names it in its settings
crashes, it records which workflow, which node and the error. Workflow 33
includes it in the next alert.

## Setup

See the steps in the PR / handover message: run migration 0036, create the
"Resend API key" credential, create the `elliot_alert` template, import and
publish 33 and 34, set 34 as the error workflow on the main workflows, fill in
Control panel → Health & alerts, send a test alert, add the UptimeRobot monitor.
