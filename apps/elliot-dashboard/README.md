# Elliot Dashboard

Next.js tenant admin UI, authenticated via Supabase Auth. Every screen
except onboarding is scoped to the logged-in user's own tenant via RLS.

## Setup

1. `npm install`
2. Create `.env.local` with:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase project settings → API)
   - `NEXT_PUBLIC_N8N_SEND_WEBHOOK_URL` (workflow 17's webhook, Production URL, after importing and activating it)
   - `NEXT_PUBLIC_N8N_ONBOARD_WEBHOOK_URL` (workflow 19's webhook)
   - `NEXT_PUBLIC_N8N_INGEST_WEBHOOK_URL` (workflow 08's webhook)
   - `ADMIN_EMAILS` (comma-separated, no `NEXT_PUBLIC_` prefix -- gates `/dashboard/onboarding`; see `lib/admin.ts`)
3. `npm run dev` and open http://localhost:3000

Same four env vars need to be set in Vercel (Settings → Environment
Variables) for the production/preview deployments, each enabled for
Production, Preview, and Development.

## Screens

- **`/`** — Overview analytics: conversations, new leads, appointments,
  auto-resolved/escalation rates, avg response time, activity charts. Real
  data via `get_dashboard_overview_stats`.
- **`/dashboard/escalations`** — Open escalations with acknowledge/resolve
  actions and a link into the conversation.
- **`/dashboard/approvals`** — Review/approve/reject Elliot's AI-drafted
  emails before they send.
- **`/dashboard/leads`** — Leads with status, score, and a structured
  breakdown of *why* they scored that way (mirrors `10-lead-capture.json`'s
  scoring logic exactly). Status can be updated inline.
- **`/dashboard/appointments`** — Booked appointments.
- **`/dashboard/conversations`** / **`/dashboard/conversations/[id]`** —
  Full message history per conversation. On `email`-channel conversations
  with a known contact email, includes a "Reply as human" box that sends a
  real email through the existing draft-approval pipeline (see
  `KNOWN_ISSUES.md` for why this doesn't work on `chat_widget`
  conversations yet).
- **`/dashboard/knowledge`** — Add content to the tenant's knowledge base
  as pasted text, a PDF (parsed in the browser), or a website URL (fetched
  and extracted server-side). Scanned/image-only PDFs and JavaScript-
  rendered websites don't extract -- see
  `docs/workflow-specs/08-knowledge-ingestion.md`.
- **`/dashboard/follow-ups`** — Create, edit, activate/deactivate, and
  delete follow-up sequences (the scheduled emails workflow 20 sends).
  Writes `follow_up_sequences` directly under RLS. Starting a sequence for
  a lead is still manual -- see `docs/workflow-specs/20-follow-up-sweep.md`.
- **`/dashboard/onboarding`** — Create a new tenant, wrapping workflow 19.
  Gated to admins listed in `ADMIN_EMAILS`. The n8n webhook underneath
  still has no auth of its own -- see `KNOWN_ISSUES.md`.
- **`/dashboard/settings`** — Tenant profile, autonomy rules per action,
  integration config (Gmail/Calendar/CRM/escalation email).

## Known gaps

See the root `KNOWN_ISSUES.md` for the two real open items that affect
this app specifically: the onboarding webhook itself still has no auth
(the dashboard route is gated, the webhook underneath isn't), and human
takeover being email-only since the chat widget has no persistent
connection to receive an interrupting reply.
