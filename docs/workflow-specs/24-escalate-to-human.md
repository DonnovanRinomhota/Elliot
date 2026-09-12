# Workflow Spec: 24 - Escalate To Human

## Why this exists
The main agent (01) had 4 tools and no way to hand a conversation off to a human — `escalate_to_human` is the 5th. Before this, `escalations` (9 defined reason categories in its schema) was only ever touched by one hardcoded path inside Lead Capture (10), always `reason: 'other'`, and the system prompt's rule 4 told Claude to *say* a human would follow up with no actual mechanism to record it. This closes that gap.

## Trigger
Sub-workflow, called via Execute Workflow node from 01's `Route by Tool` switch — not its own webhook, same pattern as 10/11/12.

## Inputs
```json
{
  "tenant_id": "…uuid…",
  "conversation_id": "…uuid…",
  "reason": "angry_customer",
  "priority": "high",
  "context_summary": "Customer is upset about a delayed refund and has asked twice for a human."
}
```
`reason` must be one of the 9 values in `escalations`' check constraint (`low_confidence`, `customer_requested_human`, `angry_customer`, `legal_issue`, `refund_requested`, `sensitive_info`, `no_trusted_source`, `action_exceeds_permissions`, `other`). `priority` one of `low`/`normal`/`high`/`urgent`. Both are also constrained by the tool's own `input_schema` enum on the Claude side, but re-validated here too (defense in depth, same as every other entry point in this codebase) — an invalid value falls back to `'other'`/`'normal'` rather than failing the whole escalation.

## Nodes (in order)
| Node | What it does |
|---|---|
| When Executed by Another Workflow | Sub-workflow trigger |
| Validate And Default | Re-validates reason/priority against the allowed sets, defaults `context_summary` if empty |
| Insert Escalation | Calls the existing `insert_escalation()` RPC, and pulls `ai_config.escalation_notify_email` + the tenant's name in the **same query** — one round trip, avoids a chained Postgres node stripping those fields via a narrow return value |
| Has Notify Email? | Branches on whether a notify address is configured |
| Build Notification Email / Send Notification via Gmail | Same raw RFC 2822 base64url pattern as 15/18/20, `continueOnFail: true` — the escalation is already saved by this point, so a notification failure never loses the record, only the push alert |
| Return Result | Always returns `{ escalation_id, reason, priority }` regardless of which branch ran, for 01's `Build Tool Result Message` to read |

## Credentials required
- The shared Postgres credential (same as everywhere else).
- A Gmail OAuth2 credential on `Send Notification via Gmail` — same known limitation as 15/16/18/20: one shared credential per workflow, not dynamic per-tenant.

## Requires
- `0020_ai_config_escalation_notify.sql` applied (adds `ai_config.escalation_notify_email`, separate from `connected_gmail_address` since an escalation alert may need to go to a different inbox than the tenant's customer-facing send-from address).

## Error paths
- No `escalation_notify_email` configured → notification step is skipped entirely, not an error. The escalation is still recorded and visible on the dashboard.
- Notification send failure → same treatment, `continueOnFail` means the escalation record is unaffected.

## Connecting this to workflow 01
After importing this workflow, open 01's **`Execute: Escalate To Human Sub-Workflow`** node and repoint its workflow reference at the real imported workflow — the value shipped in the JSON is a placeholder, since this workflow's real n8n-assigned ID can't be known ahead of time. Same one-time manual step as setting a credential on an imported node.

## Visibility
A dedicated **Escalations** screen exists in the dashboard (`apps/elliot-dashboard/app/dashboard/escalations/`) — open/resolved split, acknowledge/resolve actions, and a direct link to the existing conversation viewer for full context. Without this screen, an escalation created by this workflow would have no UI at all.
