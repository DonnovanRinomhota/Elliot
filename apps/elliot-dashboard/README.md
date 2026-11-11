# Elliot dashboard

Next.js app at https://app.getelliot.eu. Agencies sign in with Supabase Auth
and see only their own data (row-level security, `current_tenant_id()`).
Platform admins (`ADMIN_EMAILS`) also get the control panel at `/platform`,
behind two-step sign-in.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:3000 (copies ../web-chat-widget/widget.js into public/)
npm test           # unit tests (lib/*.test.ts)
npx tsc --noEmit -p .
```

Put the environment variables in `.env.local`. The full list, and what each
is for, is in the root [`README.md`](../../README.md#dashboard-environment-variables-vercel).
Server-only values (no `NEXT_PUBLIC_` prefix) never reach the browser; calls
to n8n go through `lib/n8n-webhook.ts` with the shared webhook secret.

## Screens

**For agencies**

| Route | What it shows |
|---|---|
| `/` | Overview: conversations, leads, viewings, response times, estimated pipeline |
| `/dashboard/inbox` | Chats that need a person and live chats, refreshing itself |
| `/dashboard/escalations` | Hand-overs with the reason and summary; acknowledge, resolve |
| `/dashboard/approvals` | Email and WhatsApp messages waiting for approval (including follow-ups) |
| `/dashboard/leads` | Leads by status with why they scored as they did; buyers, renters, sellers; start or stop follow-ups |
| `/dashboard/appointments`, `/dashboard/calendar` | Viewings and valuation visits, per agent; cancel, details |
| `/dashboard/conversations/[id]` | Every channel's messages, files clients attached, take over and reply |
| `/dashboard/follow-ups` | Sequences of email and WhatsApp steps; auto-enrol |
| `/dashboard/listings` | Listings with photos; import from spreadsheets, PDFs and Word files; ASARI listings marked |
| `/dashboard/knowledge` | Knowledge base: text, PDFs, website pages |
| `/dashboard/team` | Team members, roles, who gets leads and alerts, each agent's calendar |
| `/dashboard/settings` | Business details, what Elliot may do alone, email address and forwarding, WhatsApp, viewings, alerts, ASARI, support access |
| `/p/[id]` | Public page of a listing, which Elliot links to |

**For the Elliot team** (`ADMIN_EMAILS`, two-step sign-in at `/two-step`)

| Route | What it shows |
|---|---|
| `/platform` | Every agency: account state, usage, AI cost, health; open their dashboard (with permission) |
| `/platform/tenants/[id]`, `/platform/activity`, `/platform/alerts` | One agency's details, the activity log, health alerts |
| `/dashboard/onboarding` | Create an agency (workflow 19) |

`/login`, `/forgot-password` and `/reset-password` handle sign-in.

## Where things are

- `app/api/*` — server routes: anything needing the service role or an n8n
  webhook (drafts, appointments, team, ASARI, attachments, platform).
- `lib/` — pure logic with unit tests next to it (`*.test.ts`), plus the
  Supabase clients (`lib/supabase/`) and the n8n webhook helper.
- `app/_ui/` — shared components; the look is described in
  [`docs/dashboard-design.md`](../../docs/dashboard-design.md).
