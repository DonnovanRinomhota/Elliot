# Elliot

**Elliot** is a configurable, multi-tenant AI Business Assistant platform — an "AI employee" businesses can deploy for customer support, lead qualification, appointment scheduling, email handling, and CRM automation, built on Claude + n8n + Supabase.

> Status: **active build.** Core agent loop, RAG, lead capture, and appointment scheduling are built and verified end-to-end against a live tenant (Zebra Real Estate, dev). See `docs/architecture.md` for the full technical blueprint and `KNOWN_ISSUES.md` for resolved bugs and open items.

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

1. ✅ Multi-tenant schema + Row-Level Security
2. ✅ Main AI Agent loop — restructured since initial build into a proper
   agentic loop (single `Call Claude` node, loops on tool calls up to a
   safety cap, `disable_parallel_tool_use` to keep the tool-result contract
   simple)
3. ✅ RAG knowledge ingestion + retrieval
4. 🟡 Human escalation & approval gates — **partially built out of order**:
   the hot-lead escalation path inside Lead Capture (5) is built and fixed
   (see `KNOWN_ISSUES.md`), but the broader phase — general escalation
   triggers, a real approval-gate mechanism driven by `ai_config.autonomy_rules`,
   human notification delivery — has not been built as its own phase yet.
   **This is the actual next phase**, not a new "phase 6."
5. ✅ Lead capture & qualification
6. ✅ Appointment management — check-availability + book-appointment, with
   DB-level double-booking protection
7. ⬜ Email agent (gated auto-send) — blocked on (4) being finished first,
   same as originally planned
8. ⬜ Follow-up engine
9. ⬜ CRM sync
10. ⬜ Multi-tenant hardening (second real tenant)

See `docs/architecture.md` for reasoning, database schema, security model, and what's deliberately **not** being built yet.

## MVP niche

Real estate agencies — high-value leads worth qualifying, heavy scheduling need, FAQ-heavy, and a real design-partner relationship available to validate against before generalizing to other industries.

## License

TBD — private/proprietary while pre-revenue. Add a license before any public distribution.
