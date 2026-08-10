# Elliot

**Elliot** is a configurable, multi-tenant AI Business Assistant platform — an "AI employee" businesses can deploy for customer support, lead qualification, appointment scheduling, email handling, and CRM automation, built on Claude + n8n + Supabase.

> Status: **pre-alpha / architecture phase.** No production code yet. See `docs/architecture.md` for the full technical blueprint.

## What Elliot does

- Customer support & FAQ answering, grounded in a business's own documents (RAG — no invented answers)
- Lead capture, qualification, and scoring (HOT/WARM/COLD), configurable per business
- Appointment booking, rescheduling, cancellation with double-booking protection
- Email classification, drafting, and gated auto-response
- CRM sync (HubSpot or similar)
- Human escalation with full conversation context handoff
- Full audit logging of every AI decision and tool call

## Core design principle

The AI (Claude) never performs privileged actions directly. It proposes a tool call; the orchestration layer (n8n) validates that call against the tenant's permission and approval rules before anything actually happens. Every tool call is logged. This is the boundary that makes the system auditable and safe to sell to businesses that don't want to hand an LLM the keys to their CRM.

## Repo layout

```
/apps
  /web-chat-widget     — embeddable chat UI (Next.js)
  /dashboard           — tenant admin UI (Next.js)
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

1. Multi-tenant schema + Row-Level Security
2. Main AI Agent loop (single tool, single tenant)
3. RAG knowledge ingestion + retrieval
4. Human escalation & approval gates
5. Lead capture & qualification
6. Appointment management
7. Email agent (gated auto-send)
8. Follow-up engine
9. CRM sync
10. Multi-tenant hardening (second real tenant)

See `docs/architecture.md` for reasoning, database schema, security model, and what's deliberately **not** being built yet.

## MVP niche

Real estate agencies — high-value leads worth qualifying, heavy scheduling need, FAQ-heavy, and a real design-partner relationship available to validate against before generalizing to other industries.

## License

TBD — private/proprietary while pre-revenue. Add a license before any public distribution.
