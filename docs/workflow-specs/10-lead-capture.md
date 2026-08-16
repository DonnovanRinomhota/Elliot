# Workflow Spec: 10 - Lead Capture

## Trigger
Called as a sub-workflow via n8n's "Execute Workflow" node — invoked by the Main AI Agent when Claude requests the `capture_lead` tool. Not directly webhook-triggered.

## Inputs
```json
{
  "tenant_id": "…uuid…",
  "conversation_id": "…uuid…",
  "contact": { "name": "Jan", "email": "jan@example.com", "phone": null, "company": null },
  "qualification_answers": { "budget": "2M PLN", "timeline": "ASAP", "property_type": "apartment", "intent_signal": "wants to schedule a viewing" },
  "source": "chat_widget"
}
```
`conversation_id` must come from the Main Agent's `Get or Create Conversation` node's real output, not carried forward from before that conversation existed — this was a real bug (see Known Issues), so double-check the mapping any time this sub-workflow's trigger node is touched.

## Nodes (in order)
| Node | What it does |
|---|---|
| When Executed by Another Workflow | Sub-workflow trigger |
| Upsert Contact | Inserts/updates the contact by `(tenant_id, email)`, coalescing new fields onto an existing row rather than overwriting with nulls |
| Score Lead | Simple additive scoring (budget +25, urgent timeline +25, property_type +15, intent_signal +20, email +10, phone +5) → status `QUALIFYING` / `QUALIFIED` (≥40) / `HOT` (≥70) |
| Upsert Lead | Inserts/updates the lead by `(tenant_id, contact_id)`, merging `qualification_answers` (`||` jsonb merge, not overwrite) so repeated calls accumulate info rather than lose it |
| Is Hot Lead? | Branches on `status == 'HOT'` |
| Insert Escalation | (HOT branch only) Calls `insert_escalation($1..$5)` — see Known Issues for why this is an RPC call and not raw SQL |
| Format Results | Normalizes output for the Main Agent's tool_result formatting; critically returns `contact_id` so a later `book_appointment` call has a real UUID to use |

## Credentials required
- **Elliot Postgres (service role)** — used throughout.

## Requires
- `contacts_tenant_email_unique` on `(tenant_id, email)`
- `leads_tenant_contact_unique` on `(tenant_id, contact_id)` — added in `0011_ai_config_calendar_and_leads_unique.sql`
- `insert_escalation(...)` RPC — added in `0012_escalation_rpc.sql`

## Error paths
- HOT lead insert failing was a real, previously-parked bug (RLS visibility race on `escalations`/`conversations`) — see `KNOWN_ISSUES.md`. Fixed by moving the insert into a tenant-scoped RPC function.
- Non-HOT leads skip escalation entirely and go straight to Format Results.

## Expected output
```json
{ "success": true, "lead_id": "…uuid…", "contact_id": "…uuid…", "status": "HOT", "score": 95, "contact_email": "jan@example.com" }
```

## Connecting this to the Main Agent
Copy this workflow's ID from n8n and confirm it matches the workflow ID referenced in the Main Agent's "Execute: Lead Capture Sub-Workflow" node.
