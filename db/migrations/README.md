# Database migrations

Postgres schema, row-level security and functions for Supabase. Run every file
in number order in **Supabase → SQL Editor** (paste the whole file, Run). Each
file is one transaction and safe to run again. Nothing runs them for you: a
merged migration isn't live until you run it.

Some files end with a one-off step (for example 0046's `update platform_settings
set supabase_url = …`); the feature doc for each migration lists its set-up.

## How access works

- **Agencies (dashboard):** signed in with Supabase Auth. Policies use
  `current_tenant_id()`, the user's agency, or the agency a platform admin is
  viewing (0027, 0040: only with two-step sign-in and, when the switch is on,
  the agency's permission).
- **n8n:** connects as the service role (`Elliot Postgres (service role)`) and
  passes the agency explicitly to each query or function.
- Tables an agency must never read directly (credentials, tokens) are
  revoked from `anon` and `authenticated`; only n8n and the dashboard server
  use them, through functions that leave secrets out.

## Files

| # | What it adds |
|---|---|
| 0001–0008 | Core schema: tenants, contacts, leads, conversations, messages, knowledge (pgvector), appointments, follow-ups, escalations, CRM sync, audit log, row-level security |
| 0009 | Tenant-scoped functions for n8n |
| 0010 | Embedding size fix (Voyage, 1024) |
| 0011 | Calendar ID on `ai_config`, one lead per contact |
| 0012 | Escalation function |
| 0013 | Email drafts and approval |
| 0014 | Agency Gmail address |
| 0015 | `current_tenant_id()` for the dashboard |
| 0016 | Proposed appointment on email drafts |
| 0017 | Demo requests from the website |
| 0018 | Follow-ups through email drafts |
| 0019 | CRM webhook URL |
| 0020 | Escalation alert email |
| 0021–0022 | Overview stats |
| 0023 | Team reply on email |
| 0024 | Revenue estimate |
| 0025 | WhatsApp drafts |
| 0026 | Automatic CRM sync and follow-up auto-enrol |
| 0027 | Control panel, listings, team, inbox, live takeover |
| 0028 | Listing available-from date |
| 0029 | Listing photos (Storage) |
| 0030 | Viewings linked to a property and an agent |
| 0031 | Chat contacts; duplicate messages removed |
| 0032 | WhatsApp instant replies |
| 0033 | Listing links, booking details |
| 0034 | Better search and viewings |
| 0035 | Email instant replies |
| 0036 | Health checks and alerts |
| 0037 | getelliot.eu: sales assistant, calls, demo agency |
| 0038 | Clients confirm, move or cancel viewings; reminders |
| 0039 | Agency email addresses (Resend) |
| 0040 | Support access and two-step sign-in for the control panel |
| 0041 | Switch: support access needs the agency's permission |
| 0042 | Each agent's own Google Calendar; overlapping viewings for different agents |
| 0043 | Sellers, landlords and valuation visits |
| 0044 | ASARI CRM listing sync |
| 0045 | Follow-ups by WhatsApp |
| 0046 | Email attachments (private Storage bucket) |

## Tests

`db/seed/test_00NN_*.sql` is a scenario test for migration 00NN (0026 onward).
Run them only on a **scratch** database with every migration applied: each
wraps itself in a transaction, rolls back, and ends with "00NN checks
passed". Some need Supabase's `storage` and `auth` schemas (present in every
Supabase project; the tests create small stand-ins if missing).
`db/seed/dev_seed.sql` adds example agencies for local development.
