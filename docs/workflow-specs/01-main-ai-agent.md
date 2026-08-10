# Workflow Spec: 01 - Main AI Agent

## Trigger
`POST /webhook/chat` (n8n Webhook node, path `chat`). Public-facing — this is what the eventual web chat widget calls.

## Inputs (JSON body)
```json
{
  "tenant_slug": "zebra-dev",
  "message": "Do you have any 3-bedroom apartments in Mokotów?",
  "conversation_id": null,
  "contact": { "name": "Jan Kowalski", "email": "jan@example.com", "phone": "+48123456789" }
}
```
- `tenant_slug` — required. Maps to `tenants.slug`.
- `message` — required. The customer's latest message.
- `conversation_id` — optional. Omit on the first message of a session; the workflow creates one and returns its id for the client to reuse on subsequent calls.
- `contact` — optional in Phase 2 (not yet wired to `contacts` — that lands in Phase 5, Lead Capture). Accepted but currently unused past this phase; safe to send anyway so the client doesn't need to change later.

## Nodes (in order)

| Node | What it does |
|---|---|
| Chat Webhook | Receives the POST, starts the execution |
| Validate Input | Fails fast with a clear error if `tenant_slug` or `message` is missing |
| Resolve Tenant | Looks up `tenants` by slug; fails if unknown/inactive — this is the tenant boundary starting point |
| Merge Tenant Context | Combines resolved tenant fields with the validated input into one object carried through the rest of the flow |
| Set Tenant Session (RLS) | Runs `select set_config('app.current_tenant', ...)` — **must share a DB session with every Postgres node after it**, see caveat below |
| Load AI Config | Reads `ai_config` for this tenant (prompt override, autonomy rules) |
| Get or Create Conversation | Creates a new `conversations` row if none was passed |
| Load Conversation History | Pulls the last 20 messages for context |
| Log User Message | Writes the incoming message to `messages` before calling Claude, so it's captured even if the Claude call later fails |
| Build Claude Request | Assembles the system prompt + message history into the Claude API payload shape |
| Call Claude (turn 1) | POST to `https://api.anthropic.com/v1/messages`, tools = `[search_company_knowledge]` |
| Did Claude Request a Tool? | Branches on `stop_reason === 'tool_use'` |
| Extract Tool Call *(tool branch)* | Pulls the tool name/input out of Claude's response; denies anything not on the allow-list |
| Log Tool Call | Writes to `tool_call_log` **before** execution — audit trail exists even if the sub-workflow fails |
| Was Tool Approved? | Branches on `decision === 'auto_approved'`. A denied tool call never reaches the execution node — see fix note below |
| Execute: Knowledge Retrieval Sub-Workflow | Calls workflow `09 - Knowledge Retrieval` (built in Phase 3) with the tenant id + query |
| Tool Denied — Fallback Response *(denied branch)* | Returns a safe "I'll pass this along" message instead of executing, then skips straight to logging the assistant message |
| Build Tool Result Message | Formats retrieval results as a Claude `tool_result` block, appends to message history |
| Call Claude (turn 2) | Second Claude call, now with retrieved knowledge in context |
| Extract Final Text *(both branches merge here)* | Pulls plain text out of whichever Claude response is final |
| Log Assistant Message | Writes the final answer to `messages` |
| Respond to Webhook | Returns `{ conversation_id, reply }` to the caller |

## Data passed between nodes
Each Code node re-reads named upstream nodes directly (e.g. `$('Merge Tenant Context').first().json`) rather than relying only on the immediately-previous node's output — this is intentional, since the branch after the tool-use fork needs data from several nodes back. If you rename a node in the n8n editor, these references break; rename with care or update the references.

## Credentials required
- **Elliot Postgres (service role)** — used only by Resolve Tenant, before a tenant is known (this one query is exempt from RLS scoping by design — it's how the system finds out *which* tenant to scope to).
- **Elliot Postgres (RLS-scoped)** — used by every other Postgres node once the tenant is resolved. In Supabase, this can be the same underlying database, but conceptually it's the connection whose session gets `app.current_tenant` set.
- **Anthropic API Key** — HTTP Header Auth credential, header name `x-api-key`. Verify against current Claude API docs before first use.

## Error paths
- Unknown/inactive `tenant_slug` → Resolve Tenant returns no rows → downstream Merge Tenant Context throws → n8n's default error behavior (workflow fails, webhook caller gets a 500). **Not yet built:** a friendly error response and an Error Trigger workflow (Phase 3+) to log this instead of just failing silently from the caller's perspective.
- Claude API error (rate limit, auth failure, etc.) → HTTP Request node fails → same default failure behavior. **Not yet built:** retry/backoff — add before production use.
- Tool call to anything other than `search_company_knowledge` → `decision = 'denied_by_policy'` is logged, then the "Was Tool Approved?" gate routes to a safe fallback response instead of executing the sub-workflow. This was initially built as a gap where denial was logged but not enforced — caught during spec review and fixed before this doc was finalized, not left as a known issue.

## Expected output
```json
{
  "conversation_id": "…uuid…",
  "reply": "Yes — we currently have two 3-bedroom listings in Mokotów. Want me to share details or set up a viewing?"
}
```

## Known unresolved risk — flagging honestly

The **RLS session persistence** note on the "Set Tenant Session (RLS)" node is the single biggest unverified assumption in this workflow. n8n's Postgres node connection pooling behavior determines whether `set_config(..., false)` (session-scoped, not transaction-scoped) actually persists across the several separate Postgres nodes that follow it. If it doesn't, every subsequent query in this workflow will see no rows (RLS fails closed, so this fails safe, not unsafe — but it will look like "nothing works," not a security hole). **First thing to test when you run this**: check whether Load AI Config actually returns the tenant's config row. If it comes back empty, the session isn't persisting, and the fix is either (a) combine the RLS-scoped queries into fewer nodes using multi-statement `Execute Query` calls, or (b) switch to setting `app.current_tenant` via a transaction-scoped mechanism per query instead of relying on session persistence — verify current n8n Postgres node docs for the right pattern.
