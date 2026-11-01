# Elliot Dashboard

Next.js tenant admin UI, authenticated via Supabase Auth. Every screen
except onboarding is scoped to the logged-in user's own tenant via RLS.

## Setup

1. `npm install`
2. Create `.env.local` with:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase project settings → API)
   - `NEXT_PUBLIC_N8N_SEND_WEBHOOK_URL` (workflow 17's webhook, Production URL, after importing and activating it)
   - `NEXT_PUBLIC_N8N_SEND_WHATSAPP_WEBHOOK_URL` (workflow 28's webhook -- the WhatsApp equivalent of the above)
   - `NEXT_PUBLIC_N8N_INGEST_WEBHOOK_URL` (workflow 08's webhook)
   - `ADMIN_EMAILS` (comma-separated, no `NEXT_PUBLIC_` prefix -- gates `/dashboard/onboarding`; see `lib/admin.ts`)
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only; used once, by self-serve signup -- see `lib/supabase/admin.ts`)
   - Server-only, for the internal n8n webhooks (see `lib/n8n-webhook.ts` and
     `docs/workflow-specs/internal-webhook-auth.md`):
     - `ELLIOT_WEBHOOK_SECRET` (same value as on the n8n instance, 16+ chars)
     - `N8N_ONBOARD_WEBHOOK_URL` (workflow 19's webhook; replaces
       `NEXT_PUBLIC_N8N_ONBOARD_WEBHOOK_URL`, which still works as a fallback)
     - `N8N_CANCEL_APPOINTMENT_WEBHOOK_URL` (workflow 30's webhook; without
       it, Cancel only updates Elliot and asks the user to remove the
       calendar event by hand)
3. `npm run dev` and open http://localhost:3000

Same env vars need to be set in Vercel (Settings → Environment Variables)
for the production/preview deployments, each enabled for Production,
Preview, and Development. If `NEXT_PUBLIC_N8N_SEND_WHATSAPP_WEBHOOK_URL`
is left unset, the Approvals page still shows WhatsApp drafts and the
approve/reject RPC calls still work -- only the final "actually send it"
step fails, with an error saying which env var is missing (see
`approval-card.tsx`).

## Screens

- **`/`** — Overview analytics: conversations, new leads, appointments,
  auto-resolved/escalation rates, avg response time, activity charts. Real
  data via `get_dashboard_overview_stats`.
- **`/dashboard/escalations`** — Open escalations with acknowledge/resolve
  actions and a link into the conversation.
- **`/dashboard/approvals`** — Review/approve/reject Elliot's AI-drafted
  emails and WhatsApp messages before they send (two sibling tables,
  `email_drafts` and `whatsapp_drafts`, merged into one list here -- see
  `docs/workflow-specs/25-whatsapp-inbound-trigger.md` for why WhatsApp
  isn't just folded into `email_drafts`). A WhatsApp draft can also land in
  a `blocked_needs_template` state the email side never sees -- see
  `docs/workflow-specs/27-send-approved-whatsapp.md`.
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
  Writes `follow_up_sequences` directly under RLS. One sequence can be set
  to auto-enrol leads that go quiet (workflow 29); any lead can also be
  started or stopped by hand from `/dashboard/leads`. See
  `docs/workflow-specs/29-auto-enrol-follow-ups.md`.
- **`/dashboard/onboarding`** — Create a new tenant, wrapping workflow 19.
  Gated to admins listed in `ADMIN_EMAILS`, checked again server-side in
  `app/api/admin/onboard`, which calls the webhook with the shared secret.
- **`/dashboard/settings`** — Tenant profile, autonomy rules per action,
  integration config (Gmail/Calendar/CRM/escalation email/WhatsApp
  `phone_number_id`).

## Known gaps

See the root `KNOWN_ISSUES.md` for the open items that affect this app
specifically: human takeover being email-only since the chat widget has no
persistent connection to receive an interrupting reply, and three webhooks
(knowledge ingestion, manual email send, manual WhatsApp send) still being
called straight from the browser without the shared secret.
