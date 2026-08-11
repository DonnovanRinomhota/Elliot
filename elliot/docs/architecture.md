# AI Business Assistant Platform — Technical Blueprint v1

## 0. Ground Rules Before We Start

- This is a **blueprint**, not code. Nothing here is built yet.
- Every "should" below is a recommendation with tradeoffs, not gospel — I'll flag alternatives where they matter.
- n8n node names/behavior change over time — verify current docs before wiring anything, especially the Postgres, HTTP Request, and AI Agent nodes.
- I will not claim an integration "works" until we've actually run it.

---

## 1. System Architecture Overview

Three layers, cleanly separated so no layer has to trust the others blindly:

```
┌─────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER                                          │
│  Web chat widget / dashboard (Next.js) → REST/WebSocket API  │
└───────────────────────────┬───────────────────────────────────┘
                             │
┌───────────────────────────▼───────────────────────────────────┐
│  ORCHESTRATION LAYER (n8n)                                    │
│  - Receives requests via webhook                              │
│  - Calls Claude (Agent) to decide intent + tool                │
│  - Executes tools (deterministic n8n workflows)                │
│  - Enforces guardrails (permission checks, approval gates)     │
│  - Writes to DB, calls external APIs (Calendar, CRM, Email)    │
└───────────────────────────┬───────────────────────────────────┘
                             │
┌───────────────────────────▼───────────────────────────────────┐
│  DATA LAYER                                                    │
│  Supabase/Postgres (relational + pgvector) — multi-tenant       │
│  Row-Level Security enforced at the DB, not just app code       │
└─────────────────────────────────────────────────────────────┘
```

**Key architectural decision:** Claude never calls external systems directly. Claude receives a tool-call *request* from n8n's AI Agent node, and n8n is the thing that actually executes privileged operations, after a permission/validation check. This is the single most important safety boundary in the whole system — it's what prevents "the LLM decided X and X happened" incidents.

*Alternative considered:* Give Claude direct API access via MCP servers for each integration. This is more elegant long-term but harder to audit/gate per-tenant in v1. Recommendation: start with n8n as the enforcement layer, migrate hot-path tools to MCP later once the permission model is proven.

---

## 2. Recommended Tech Stack

| Layer | Choice | Why |
|---|---|---|
| AI reasoning | Claude API (Sonnet for most, Haiku for cheap classification tasks) | Your requirement |
| Orchestration | n8n (self-hosted, not cloud, for data control) | Your requirement |
| DB | Supabase (Postgres + pgvector + Auth + RLS) | Multi-tenancy via RLS is native, saves months |
| Vector store | pgvector inside Supabase (not a separate vector DB) | One less system to operate; fine up to low millions of chunks |
| Frontend | Next.js + Tailwind, hosted on Vercel | Fast to ship, good widget embeddability |
| Auth | Supabase Auth (tenant users) + separate service-role key for n8n | Standard, avoids building auth from scratch |
| Queue (later) | n8n's built-in queue mode (Redis) once volume requires it | Don't add this in MVP |
| Secrets | n8n credential store + environment variables; never in workflow JSON | Non-negotiable |
| Observability | Postgres logging tables + optional Langfuse/Helicone for Claude call tracing | You need to answer "why did the AI do that" |

---

## 3. Database Schema (Multi-Tenant Core)

Every table keyed by `tenant_id` (a.k.a. business_id), enforced via Postgres Row-Level Security so a bug in application code can't leak tenant A's data to tenant B.

**Core tables (v1):**

- `tenants` — business_id, name, industry, plan, settings (jsonb)
- `tenant_users` — staff who log into the dashboard, role (admin/agent/viewer)
- `ai_config` — per-tenant: system prompt overrides, autonomy rules, escalation thresholds, lead scoring weights (jsonb)
- `contacts` — customers/prospects, tenant-scoped
- `leads` — linked to contact, status (NEW/QUALIFYING/HOT/WARM/COLD/CONVERTED), qualification answers (jsonb)
- `conversations` — channel (chat/email), contact_id, status, assigned_human (nullable)
- `messages` — conversation_id, role (user/assistant/system/human_agent), content, tool_calls (jsonb)
- `documents` — uploaded knowledge source metadata, tenant_id, status (processing/ready/failed)
- `document_chunks` — chunk text, embedding (vector), source_document_id, page/section ref
- `appointments` — contact_id, start/end, timezone, status, calendar_event_id (external ref)
- `crm_sync_log` — outbound CRM writes, status, retry count
- `follow_up_sequences` — tenant-configurable steps (day offset, template, stop conditions)
- `follow_up_runs` — active instance per lead, current step, next_run_at
- `escalations` — conversation_id, reason, priority, assigned_to, resolved_at
- `tool_call_log` — every tool invocation: tool name, input, output, approved_by (nullable), timestamp — **this is your audit trail**
- `audit_log` — auth events, permission denials, config changes

RLS policy pattern: every table has `tenant_id` and a policy like `USING (tenant_id = current_setting('app.current_tenant')::uuid)`. n8n sets this session variable per request using the tenant resolved from the incoming webhook/auth token.

---

## 4. n8n Workflow Architecture (Modular, Not One Giant Flow)

Each workflow is independently triggered and testable. They talk to each other via **webhooks (for synchronous handoffs)** and **Postgres rows + a lightweight polling/cron loop (for async work like follow-ups)** — not an internal queue in v1, to keep this simple.

1. **Main AI Agent** — webhook trigger (chat message in) → loads tenant config + conversation history → calls Claude Agent node with tool definitions → routes tool-call requests to the matching sub-workflow → returns response.
2. **Customer Support** — called by Main Agent for `search_company_knowledge`; embeds query, pgvector similarity search, returns chunks + source doc for Claude to cite.
3. **Lead Capture** — `create_lead`/`update_lead`; validates required fields, dedupes against `contacts`.
4. **Lead Qualification** — `qualify_lead`/`score_lead`; applies tenant's configured scoring rubric from `ai_config`.
5. **Appointment Management** — `get_calendar_availability`/`book_appointment`/`reschedule`/`cancel`; wraps Google/Microsoft Calendar API, includes a DB-level lock check to prevent double-booking races.
6. **Email Processing** — IMAP/Gmail trigger → classify (Haiku, cheap) → route to draft or auto-send based on risk tier from `ai_config`.
7. **Follow-Up Engine** — cron trigger (e.g. every 15 min) → queries `follow_up_runs` for due steps → sends → advances or stops sequence if contact replied.
8. **Knowledge Ingestion** — webhook/manual trigger on document upload → extract text → chunk → embed → insert into `document_chunks`.
9. **Knowledge Retrieval** — sub-workflow reused by Support and Main Agent; pure retrieval, no side effects.
10. **CRM Synchronization** — `update_crm`; writes to HubSpot (or configured CRM), retries with backoff, logs to `crm_sync_log`.
11. **Human Escalation** — `escalate_to_human`; creates `escalations` row, notifies via Slack/email, packages conversation summary + context.
12. **Notifications** — generic fan-out (Slack, email, SMS) called by other workflows; not tool-callable directly by Claude.
13. **Error Handling** — global error workflow (n8n's "Error Trigger" attached to every other workflow) → logs to `audit_log`, alerts if repeated.
14. **Scheduled Tasks** — cron housekeeping: stale escalation reminders, follow-up sweeps, embedding re-index jobs.

Each workflow document (when we build it) will spell out trigger, inputs, node-by-node config, credentials needed, error paths, and expected output — per your requirement. Not doing that now to keep this response at blueprint level.

---

## 5. Claude Agent / Tool Architecture

**System prompt (conceptual shape, not final text):**
- Identity: "You are the AI assistant for {tenant_name}, operating within {industry} rules."
- Hard constraints: never invent prices/policies/availability; if `search_company_knowledge` returns nothing relevant, say so and offer escalation.
- Tool-use instructions: which tools exist, when to prefer retrieval before answering, when to ask clarifying questions vs. act.
- Autonomy boundaries, loaded dynamically from `ai_config` per tenant (e.g. "auto-send email replies only if classified low-risk AND confidence > 0.9").

**Tools (initial set, matches your list):** each is a JSON schema with strict typing — e.g. `book_appointment(contact_id, start_time, end_time, timezone)`. Claude only *proposes* a tool call; n8n validates the call against the tenant's permission table before executing. High-risk tools (`send_email`, `update_crm` with financial fields, `cancel_appointment`) get an **approval gate**: n8n creates a pending-approval row and notifies a human instead of executing immediately, until the tenant's config says otherwise.

**Guardrails:**
- Retrieval-required tools refuse to answer past a confidence threshold without a citation from `document_chunks`.
- Every tool call and its result is written to `tool_call_log` before the response reaches the user — this is what gives you debuggability.
- Prompt-injection resistance: content pulled from documents/emails is wrapped and explicitly marked as untrusted data, not instructions, in the prompt sent to Claude.

**Memory:** short-term = last N messages from `messages`; long-term = nothing implicit — anything durable about a contact lives in `contacts`/`leads`, not in freeform memory, so it's auditable and correctable.

---

## 6. API Architecture

- `POST /chat` — webhook into Main Agent workflow; tenant resolved via API key or embedded widget token.
- `POST /documents` — upload trigger for Knowledge Ingestion.
- `GET/POST /appointments` — thin wrapper if you want a non-chat booking UI later.
- `POST /webhooks/email` — inbound email provider webhook.
- `POST /webhooks/crm` — inbound CRM events (e.g. deal stage changed) for sync-back.
- Internal-only n8n webhooks (workflow-to-workflow) are separately secured, not exposed publicly.

All public endpoints: rate-limited per tenant, authenticated, and validated against a schema before touching n8n.

---

## 7. Security Architecture

- Tenant isolation: Postgres RLS + tenant_id enforced at every query, not just app-layer filtering.
- Least privilege: n8n credentials scoped per integration; the CRM credential can't touch Calendar, etc.
- Secrets: n8n credential store only; never in workflow JSON exports, never in prompts sent to Claude, never logged.
- Webhook verification: HMAC signature checks on all inbound webhooks (email provider, CRM, calendar).
- Prompt injection: untrusted content (emails, documents, customer messages) is never treated as system-level instructions; tool-call requests from Claude are always re-validated against permissions in n8n, not trusted at face value.
- Audit logs: every tool call, approval, and permission denial logged with tenant_id + actor.
- Rate limiting at the public API gateway layer, separate from n8n's own execution limits.

---

## 8. Folder / Project Structure (conceptual)

```
/platform
  /apps
    /web-chat-widget       (Next.js embeddable widget)
    /dashboard             (Next.js tenant admin UI)
  /n8n
    /workflows              (exported JSON, version-controlled)
    /credentials.md          (list of required credential types — never actual secrets)
  /db
    /migrations              (SQL migrations, RLS policies)
    /seed
  /docs
    /architecture
    /workflow-specs          (one doc per n8n workflow, per your template)
  /scripts
```

---

## 9. Development Phases

1. **Foundation** — Supabase schema + RLS, tenant provisioning, auth.
2. **Core Agent Loop** — Main Agent workflow + one tool (`search_company_knowledge`) end-to-end, single tenant.
3. **Knowledge/RAG** — ingestion + retrieval workflows, real documents.
4. **Lead Capture & Qualification** — tools + scoring config.
5. **Appointments** — calendar integration, double-booking protection.
6. **Escalation & Approval Gates** — human-in-the-loop plumbing (needed before email autosend).
7. **Email Agent** — classification, drafting, gated sending.
8. **Follow-Up Engine**.
9. **CRM Sync**.
10. **Multi-tenant hardening** — second real tenant to prove isolation, config-driven behavior.
11. **Observability/Analytics dashboard.**

---

## 10. MVP Definition

**Recommended MVP scope:** one tenant-configurable assistant doing (a) RAG-based customer support, (b) lead capture + qualification, (c) appointment booking, with (d) human escalation and (e) full tool-call logging. Cut email automation and CRM sync from MVP — they're the highest-risk, highest-integration-cost pieces and not needed to prove the core loop.

**Recommended MVP niche:** local/regional **real estate agencies**. Reasoning: high-value leads (worth qualifying carefully), heavy appointment-scheduling need (viewings), FAQ-heavy (listings, pricing, process), and — relevant to you — you already have a warm intro path via your friend's agency (Zebra Real Estate), which gives you a real design partner instead of building blind.

---

## 11. Testing Strategy

- Unit-level: each n8n sub-workflow tested standalone with fixed mock inputs before wiring to the Agent.
- Tool-contract tests: for every tool, assert schema validation rejects malformed calls.
- RAG eval set: a fixed list of Q&A pairs per tenant to check retrieval doesn't regress as documents change.
- Multi-tenant isolation test: automated check that tenant A's API key can never read tenant B's rows (run against RLS directly, not just app code).
- Human-in-the-loop dry runs before enabling any auto-send behavior.

---

## 12. Deployment Strategy

- n8n: self-hosted (Docker) on a VPS or small K8s setup — cloud n8n is fine for prototyping but you'll want control over data residency for a B2B product.
- Supabase: managed, start on a paid tier for RLS + backups.
- Frontend: Vercel.
- Environments: dev → staging → prod, with staging using a synthetic tenant, never real customer data.

---

## 13. Complexity Estimates (rough, relative)

| Component | Complexity |
|---|---|
| Multi-tenant schema + RLS | Medium |
| Main Agent + tool routing | Medium-High |
| RAG ingestion/retrieval | Medium |
| Appointment booking (no double-book) | Medium |
| Lead qualification/scoring | Low-Medium |
| Email agent (classify/draft/send) | High |
| Follow-up engine | Low-Medium |
| CRM sync | Medium (depends entirely on CRM's API quirks) |
| Escalation + approval gates | Medium |
| Multi-tenant config UI | Medium-High |

---

## 14. Build First

Schema + RLS → Main Agent loop with one real tool → RAG → escalation/approval plumbing (build this *before* email, since email autosend depends on it) → lead capture/qualification → appointments.

## 15. Do NOT Build Yet

- Email auto-send (needs approval gates proven first)
- CRM sync (highest external-API flakiness, lowest learning value early)
- Multi-industry config UI (premature — prove it with one tenant first)
- Analytics/reporting dashboard (needs real usage data to be worth building)
- Queue-based scaling (Redis/n8n queue mode) — not needed until you have real concurrent load

---

**Next step:** tell me which component you want to build first, and I'll go deep on that one — schema migration, or the Main Agent workflow spec, or the RAG pipeline. I'd suggest starting with #1 (Supabase schema + RLS) since everything else depends on it.
