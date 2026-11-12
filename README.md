# Elliot

**Elliot is an AI front office for estate agencies.** It answers buyers,
renters, sellers and landlords on the agency's website chat, WhatsApp and
email, day and night. It qualifies them, shows matching listings, books
viewings and valuation visits into the agents' own Google Calendars, follows
up with people who go quiet, and hands conversations to the team when a person
is needed. Built on Claude, n8n, Supabase and Next.js.

Made and run by Donnovan Rinomhota (Poland). Public site: [getelliot.eu](https://getelliot.eu)
(separate repo, [Elliot-web](https://github.com/DonnovanRinomhota/Elliot-web)).

## Live links

| What | Where |
|---|---|
| Dashboard (agencies and the control panel) | https://app.getelliot.eu |
| Public website | https://getelliot.eu |
| Vercel project (dashboard) | https://vercel.com/elliot-1b82/elliot-real-estate |
| n8n (workflows, executions, credentials) | https://makodevops.app.n8n.cloud |
| Supabase (database, storage, auth) | https://supabase.com/dashboard/project/drnthityffeuwlddjorx |
| This repo | https://github.com/DonnovanRinomhota/Elliot |

## What Elliot does

| Area | What happens | Docs |
|---|---|---|
| Website chat | One-line widget; asks for name and email/phone first; shows the AI disclosure | `apps/web-chat-widget`, `docs/control-panel-listings-inbox.md` |
| WhatsApp | Instant replies on the agency's number; team can take over; reminders, alerts and follow-ups by approved templates | `docs/whatsapp-setup.md`, `docs/whatsapp-follow-ups.md` |
| Email | Each agency has its own Elliot address; it forwards its inbox (Gmail, Outlook, anything) or connects Gmail; replies stay in the client's thread, in the agency's name; reads PDFs and photos clients attach | `docs/agency-email.md`, `docs/email-attachments.md` |
| Listings | Typed, imported from a spreadsheet, or copied from ASARI CRM every hour; Elliot searches them and sends links with photos | `docs/control-panel-listings-inbox.md`, `docs/asari-sync.md` |
| Viewings | Free times across the agents' own Google Calendars, booking, confirmation email, reminder the day before; clients confirm, move or cancel by message | `docs/agent-calendars.md`, `docs/workflow-specs/37-38-viewing-changes-reminders.md` |
| Sellers and landlords | Valuation requests, seller leads, valuation visits at the property | `docs/valuations.md` |
| Leads | Qualification and hot/warm/cold scoring, round-robin assignment to agents, CRM sync by webhook | `docs/workflow-specs/10-lead-capture.md`, `docs/workflow-specs/22-crm-sync.md` |
| Follow-ups | Sequences of emails and WhatsApp messages for quiet leads, with approval rules and auto-enrol | `docs/workflow-specs/20-follow-up-sweep.md`, `docs/whatsapp-follow-ups.md` |
| Team | Inbox, take over any chat, escalations, approvals, alerts, daily summary email | `docs/control-panel-listings-inbox.md` |
| Control panel (`/platform`) | Every agency's account, usage, AI cost and health; two-step sign-in; support access only with the agency's permission | `docs/support-access.md` |
| Health | Checks every 15 minutes, alerts by email and WhatsApp | `docs/workflow-specs/33-health-check.md` |
| getelliot.eu | Elliot's own sales assistant, call booking, public demo agency | `docs/website-sales-and-demo.md` |

**Core design rule:** Claude never acts directly. It proposes a tool call; n8n
checks it against the agency's rules (what Elliot may do alone, what needs
approval) before anything happens, and every call is logged.

## How changes go live

Each part deploys differently. Nothing applies migrations or workflows for you.

| Change | Lives in | Goes live when |
|---|---|---|
| Dashboard (`apps/elliot-dashboard`) | Vercel | Merged to `main` (Vercel builds automatically) |
| Workflow (`n8n/workflows/*.json`) | n8n | Re-imported in n8n (open the workflow → ⋯ → Import from File, so its ID stays), credentials checked, saved |
| Database (`db/migrations/*.sql`) | Supabase | Run in Supabase → SQL Editor, in number order |
| Environment variables | Vercel → Settings → Environment Variables | Set for Production, Preview and Development, then redeploy |

Order for anything touching n8n or the database: run the migration and import
the workflows first, then merge the dashboard code that depends on them.
Every feature doc in `docs/` ends with its own set-up steps.

### Dashboard environment variables (Vercel)

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase (browser and server) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only admin actions (team invites, ASARI credentials, attachment downloads) |
| `ADMIN_EMAILS` | Who may use the control panel and onboarding (comma-separated) |
| `NEXT_PUBLIC_SELF_SIGNUP_ENABLED` | Leave unset. `true` shows "Create a business" on the sign-in page (anyone could open an agency) |
| `ELLIOT_WEBHOOK_SECRET` | Shared secret for n8n's internal webhooks (n8n credential "Elliot Internal Webhook Secret") |
| `N8N_INGEST_WEBHOOK_URL` | 08: knowledge uploads |
| `N8N_SEND_WEBHOOK_URL` | 17: send an approved email draft |
| `N8N_ONBOARD_WEBHOOK_URL` | 19: new agency |
| `N8N_SEND_WHATSAPP_WEBHOOK_URL` | 28: send an approved WhatsApp draft |
| `N8N_CANCEL_APPOINTMENT_WEBHOOK_URL` | 30: cancel a viewing and its calendar event |
| `N8N_SEND_WHATSAPP_MESSAGE_WEBHOOK_URL` | 32: team reply on WhatsApp |
| `N8N_HEALTH_TEST_WEBHOOK_URL` | 33: "send a test alert" |
| `N8N_CALENDAR_CHECK_WEBHOOK_URL` | 41: check agents' calendars |
| `N8N_ASARI_SYNC_WEBHOOK_URL` | 42: ASARI "Sync now" |
| `ANTHROPIC_API_KEY` (optional `ANTHROPIC_MODEL`) | Listing import: reading listings out of spreadsheets, PDFs and Word files |
| `GOOGLE_DRIVE_API_KEY` | Listing photos from Google Drive folders |
| `AI_PRICE_INPUT_PER_MTOK`, `AI_PRICE_OUTPUT_PER_MTOK` (optional) | AI cost shown in the control panel |

Older `NEXT_PUBLIC_N8N_*` names are still read as a fallback; use the
server-only names above.

## Repo layout

```
apps/
  elliot-dashboard/   Next.js dashboard: agencies (/dashboard), control panel (/platform), public listing pages (/p)
  web-chat-widget/    widget.js, the website chat (copied into the dashboard's public/ at build)
n8n/workflows/        Exported n8n workflows (source of truth; re-import after changes)
  tests/              Code-node logic tested straight from the JSON (node <file>.test.js)
db/migrations/        Postgres schema, RLS and functions, 0001 → latest, run in order
db/seed/              Scenario tests per migration (scratch database only) and dev seed data
docs/                 Feature docs with set-up steps; workflow-specs/ per workflow
brand/                Logo files
```

Workflows, with what each is for: [`docs/workflow-specs/README.md`](docs/workflow-specs/README.md).
Migrations: [`db/migrations/README.md`](db/migrations/README.md).

## Tests

```bash
# Dashboard: unit tests and type check
cd apps/elliot-dashboard && npm test && npx tsc --noEmit -p .

# Workflows: every test file (one needs luxon on NODE_PATH for slot maths)
for f in n8n/workflows/tests/*.test.js; do node "$f" || echo "FAILED: $f"; done

# Database: each db/seed/test_00NN_*.sql against a scratch Postgres with the
# migrations applied; each rolls back and ends with "00NN checks passed".
```

## Docs

| Doc | About |
|---|---|
| [`ROADMAP.md`](ROADMAP.md) | What's built, what's verified live, what's next |
| [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) | Bugs fixed and limits still open |
| [`RELEASING.md`](RELEASING.md) | **How to release a change**: checks, migrations, workflow imports, Vercel settings, rollback, backups |
| [`docs/security.md`](docs/security.md) | Agency isolation, roles, the security review and its roll-out steps |
| [`docs/reliability.md`](docs/reliability.md) | What happens when something fails: retries, duplicates, STOP, what to check after importing a workflow |
| [`docs/agency-email.md`](docs/agency-email.md) | Agency email addresses, forwarding, sending via Resend |
| [`docs/email-attachments.md`](docs/email-attachments.md) | Files clients attach to emails |
| [`docs/whatsapp-setup.md`](docs/whatsapp-setup.md) | Connecting a WhatsApp number |
| [`docs/whatsapp-follow-ups.md`](docs/whatsapp-follow-ups.md) | Follow-up steps by WhatsApp, the `elliot_follow_up` template |
| [`docs/agent-calendars.md`](docs/agent-calendars.md) | Each agent's own Google Calendar |
| [`docs/valuations.md`](docs/valuations.md) | Sellers, landlords and valuation visits |
| [`docs/asari-sync.md`](docs/asari-sync.md) | Listings from ASARI CRM |
| [`docs/support-access.md`](docs/support-access.md) | Control panel two-step sign-in and support access |
| [`docs/control-panel-listings-inbox.md`](docs/control-panel-listings-inbox.md) | Control panel, listings, team, inbox, daily summary |
| [`docs/website-sales-and-demo.md`](docs/website-sales-and-demo.md) | getelliot.eu's sales assistant, call booking and demo |
| [`docs/client-ready-setup.md`](docs/client-ready-setup.md) | Webhook secret, CRM sync, auto-enrol (Nov 2026 fix pack) |
| [`docs/sales-knowledge/elliot-for-agencies.md`](docs/sales-knowledge/elliot-for-agencies.md) | What the getelliot.eu assistant knows (upload on the sales account's Knowledge page) |
| [`docs/dashboard-design.md`](docs/dashboard-design.md) | Dashboard look and components |
| [`docs/architecture.md`](docs/architecture.md), [`docs/setup-guide.md`](docs/setup-guide.md) | The original blueprint and first set-up guide (historical) |

## License

Private and proprietary. Not for distribution.
