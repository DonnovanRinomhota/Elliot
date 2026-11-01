# Workflow Spec: 17 - Manual Send Draft

## Trigger
Internal webhook (`POST /send-approved-draft`) with n8n Header Auth (`Elliot Internal Webhook Secret` credential; see `internal-webhook-auth.md`) — the thin trigger a human's "Send" click hits to actually fire off an approved draft. The dashboard reaches it through its server route `app/api/drafts/[id]/send`, which first checks (under the user's RLS session) that the draft belongs to their tenant and is `approved`; this workflow itself still doesn't check either, so keep the URL internal.

## Inputs
```json
{ "draft_id": "…uuid…" }
```

## Nodes (in order)
| Node | What it does |
|---|---|
| Send Draft Webhook | Public POST trigger |
| Validate Input | Just checks `draft_id` is present |
| Execute: Send Approved Email | Calls workflow 15 with `auto: false` — this is a **human-approved** send, not an autonomous one, hardcoded regardless of what the caller passes |
| Respond to Webhook | Returns `{ success: true, draft_id }` |

## Credentials required
None directly — all the real work (Postgres, Gmail) happens inside workflow 15.

## Error paths
- Missing `draft_id` → `Validate Input` throws, same pattern as every other webhook in this codebase.
- No verification that the draft actually exists, or belongs to whoever is calling this — that's left entirely to workflow 15's `Load Draft`/`If Not Already Sent` guards. A nonexistent `draft_id` would simply produce no matching row downstream rather than a clean error at this layer.

## Expected output
```json
{ "success": true, "draft_id": "…uuid…" }
```

## Note on this workflow's simplicity
Unlike 18/19/21/22 (all written later, all internal-only), this one has no tenant-ownership check on the draft itself before calling 15. Worth tightening if this endpoint is ever exposed more broadly than "the dashboard's own Send button calls it" — right now that's an acceptable scope given who's expected to call it, but it's not defense-in-depth the way the newer webhooks are.
