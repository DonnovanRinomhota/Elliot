# Elliot

**Elliot** is a configurable, multi-tenant AI Business Assistant platform — an "AI employee" businesses can deploy for customer support, lead qualification, appointment scheduling, email handling, and CRM automation, built on Claude + n8n + Supabase.

> Status: **active build.** Every phase in the original roadmap (1-10) is now built, except item 10 itself (a second real tenant) -- that one is inherently gated on having a real business to onboard, not a build task. Everything else, including the full email agent, follow-up engine, CRM sync, and human escalation handling, is built and verified end-to-end. Beyond the original 10-phase roadmap, the dashboard now also covers tenant onboarding, knowledge base uploads, human takeover on email conversations, and structured lead-scoring reasoning -- see "What's built beyond the original roadmap" below. See `docs/architecture.md` for the full technical blueprint and `KNOWN_ISSUES.md` for resolved bugs and open items.

## Live links

- **Dashboard (production):** https://elliot-real-estate-five.vercel.app
- **Vercel project:** https://vercel.com/elliot-1b82/elliot-real-estate — deployments, env vars, build logs
- **GitHub repo:** https://github.com/DonnovanRinomhota/Elliot
- **n8n instance:** https://makodevops.app.n8n.cloud — workflow editor, executions, credentials
- **Supabase project:** Project ref `drnthityffeuwlddjorx` — https://supabase.com/dashboard/project/drnthityffeuwlddjorx — table editor, SQL editor, auth users

Deploys are automatic: pushing to `main` on GitHub triggers a new Vercel
build. n8n workflow changes do **not** deploy automatically -- exported
JSON in `n8n/workflows/` is the source-controlled copy, but you have to
manually re-import/activate a workflow in the n8n editor for a change to
actually take effect. Database migrations are the same: files in
`db/migrations/` are source-controlled, but you have to run each one
against Supabase yourself (SQL Editor) -- nothing applies them
automatically. See "Making a change" below.

## Making a change

Different parts of this repo deploy differently -- there's no single "push
and everything updates" step:

| Change type | Where it lives | How it goes live |
|---|---|---|
| Dashboard code (`apps/elliot-dashboard`) | Next.js / Vercel | Push to `main` → Vercel auto-builds & deploys |
| n8n workflow (`n8n/workflows/*.json`) | n8n | Manually re-import the JSON into the n8n editor and activate/publish -- git push does **not** touch the live workflow |
| Database schema (`db/migrations/*.sql`) | Supabase | Manually run the new migration file's SQL in Supabase's SQL Editor -- git push does **not** run it |
| Env vars (Supabase keys, n8n webhook URLs) | Vercel project settings | Add/edit directly in Vercel → Settings → Environment Variables, enabled for Production **and** Preview **and** Development |

Normal flow for a dashboard-only change: edit on a feature branch, push,
open a PR into `main`, merge, Vercel builds automatically.

Normal flow for anything touching n8n or the database: make the change
locally, run the SQL migration in Supabase and/or re-import the workflow
in n8n **first**, confirm it actually works, *then* push/merge the code
that depends on it -- merging the dashboard code first (with an RPC or
webhook it depends on not existing yet) will deploy successfully but the
feature will fail at runtime.

## What Elliot does

- Customer support & FAQ answering, grounded in a business's own documents (RAG — no invented answers)
- Lead capture, qualification, and scoring (HOT/WARM/COLD), configurable per business
- Appointment booking, rescheduling, cancellation with double-booking protection
- Email classification, drafting, and gated auto-response
- CRM sync — generic webhook adapter, not tied to one provider (see workflow 22/23)
- Human escalation with full conversation context handoff
- Full audit logging of every AI decision and tool call

## Core design principle

The AI (Claude) never performs privileged actions directly. It proposes a tool call; the orchestration layer (n8n) validates that call against the tenant's permission and approval rules before anything actually happens. Every tool call is logged. This is the boundary that makes the system auditable and safe to sell to businesses that don't want to hand an LLM the keys to their CRM.

## Repo layout

```
/apps
  /elliot-dashboard    — tenant admin UI (Next.js) -- the real, built one
  /web-chat-widget     — embeddable customer-facing chat UI (Next.js) -- NOT built yet, placeholder only
  /dashboard           — stray leftover placeholder from before the dashboard was renamed to elliot-dashboard; dead, safe to delete
/n8n
  /workflows           — exported n8n workflow JSON (version-controlled)
/db
  /migrations          — Supabase/Postgres schema + RLS policies
  /seed                — seed data for local dev
/docs
  architecture.md       — full technical blueprint
  /workflow-specs        — one spec per n8n workflow (trigger, nodes, credentials, error paths)
/scripts               — dev/deploy helper scripts
```

## Tech stack

Claude API · n8n · Supabase (Postgres + pgvector) · Next.js · Google/Microsoft Calendar APIs · HubSpot (or similar CRM)

## Development approach

Built incrementally, one component at a time, in this order:

1. ✅ Multi-tenant schema + Row-Level Security
2. ✅ Main AI Agent loop — restructured since initial build into a proper
   agentic loop (single `Call Claude` node, loops on tool calls up to a
   safety cap, `disable_parallel_tool_use` to keep the tool-result contract
   simple)
3. ✅ RAG knowledge ingestion + retrieval
4. ✅ Human escalation & approval gates — `escalate_to_human` is a real
   5th tool on the main agent (01), available in any conversation for any
   of 9 defined reasons (angry customer, legal/refund issue, sensitive
   info, exceeds permissions, etc.), not just the old lead-capture-only
   hot-lead path. Creates a real `escalations` row, sends a notification
   email if `ai_config.escalation_notify_email` is set, and is visible on
   a dedicated dashboard screen with acknowledge/resolve actions. Verified
   live end-to-end. See `docs/workflow-specs/24-escalate-to-human.md`.
   Minor pre-existing redundancy not cleaned up: Lead Capture (5) still
   has its own separate hardcoded escalation path (`reason: 'other'`)
   for hot leads, which could now be unified with the agent's own tool
   call instead, but isn't yet.
5. ✅ Lead capture & qualification
6. ✅ Appointment management — check-availability + book-appointment, with
   DB-level double-booking protection, a graceful response when a
   collision happens (`slot_unavailable`, not a raw DB error), and a
   compensating delete for the Google Calendar event on collision so
   nothing is left orphaned -- see `KNOWN_ISSUES.md`, verified live.
7. ✅ Email agent (classify, draft, gated auto-send) — built ahead of (4)
   despite the original plan; see Phase 7 in commit history
8. ✅ Follow-up engine — cron sweep (20) + entry point (21). Content is
   literal tenant-authored subject/body per step, not Claude-drafted
   (deliberate — unattended/scheduled with no per-send human review in
   autonomous mode). Every send reuses the existing email_drafts
   approval-gate flow. See `docs/workflow-specs/20-follow-up-sweep.md`
   for the real limitations (sequences still hand-authored via SQL; a
   run advances on schedule regardless of whether a pending draft was
   actually approved/sent yet).
9. ✅ CRM sync — generic webhook adapter (22/23), not tied to one CRM
   provider. Each tenant points `ai_config.crm_webhook_url` at whatever
   receives their sync data (a CRM's native webhook, or Zapier/Make in
   front of one that doesn't take webhooks directly). Verified live
   end-to-end. See `docs/workflow-specs/22-crm-sync.md`.
10. 🟡 Multi-tenant hardening (second real tenant) — tenant onboarding
    (workflow 19) removes the manual-SQL friction for this, and it now has
    a dashboard form (`/dashboard/onboarding`) instead of being API-only.
    Calendar/Gmail OAuth connection per tenant is still a manual, one-off
    setup, and the onboarding page itself has no access control yet (see
    `KNOWN_ISSUES.md`); see `docs/workflow-specs/19-tenant-onboarding.md`
    for the OAuth gap specifically.

## What's built beyond the original roadmap

The dashboard grew past "approve/reject email drafts" into a real
operating surface:

- **Real analytics** (`/`) — conversations, new leads, appointments booked,
  auto-resolved rate, escalation rate, avg response time, activity/leads
  charts. Backed by a real Postgres RPC (`get_dashboard_overview_stats`),
  not placeholder numbers.
- **Structured lead-scoring reasoning** (`/dashboard/leads`) — each lead
  shows *why* it scored what it did (budget provided, urgent timeline,
  etc.), mirroring `10-lead-capture.json`'s actual scoring logic exactly,
  not an approximation. Raw qualification answers are still viewable via a
  toggle.
- **Human takeover** (`/dashboard/conversations/[id]`) — reply as a human
  directly from the dashboard, on `email`-channel conversations with a
  known contact email (see `KNOWN_ISSUES.md` for why chat_widget isn't
  supported). Reuses the existing draft-approval send pipeline
  (`create_manual_email_draft` → workflow 17 → 15) rather than a separate
  send path, and correctly tags the message as `human_agent` (not
  `assistant`) in the conversation log.
- **Tenant onboarding UI** (`/dashboard/onboarding`) — a form wrapping
  workflow 19, instead of calling the webhook by hand.
- **Knowledge base upload UI** (`/dashboard/knowledge`) — a form wrapping
  workflow 08's ingestion webhook. Plain text only; no PDF/website parsing
  yet, matching what the backend actually does.

Six more workflows exist outside this original phase list — internal
tooling rather than agent capabilities:
- `18` demo request intake — wires the marketing site's form to a real lead
- `19` tenant onboarding — replaces hand-written SQL per tenant
- `20`/`21` follow-up engine — sweep + entry point
- `22`/`23` CRM sync — sweep + entry point

See their specs in `docs/workflow-specs/`.

See `docs/architecture.md` for reasoning, database schema, security model, and what's deliberately **not** being built yet.

## MVP niche

Real estate agencies — high-value leads worth qualifying, heavy scheduling need, FAQ-heavy. Originally planned around a specific design-partner relationship (Zebra Real Estate) to validate against before generalizing; that partnership didn't materialize, so the vertical is built generic and company-agnostic instead (see the seed data's `zebra-dev` tenant, which is now just example/demo data, not a live client). Whatever real business becomes the first tenant can be configured without rework.

## License

TBD — private/proprietary while pre-revenue. Add a license before any public distribution.
