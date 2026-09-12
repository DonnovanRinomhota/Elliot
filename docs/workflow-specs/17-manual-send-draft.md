# Workflow Spec: 17 - Manual Send Draft

## Trigger
Public-ish webhook (`POST /send-approved-draft`) — the thin trigger a human's "Send" click (from the dashboard, or any other approval UI) hits to actually fire off an approved draft. Simpler than 18/19/21/22's "internal" webhooks in that it doesn't verify tenant ownership of the draft itself — it's a bare pass-through to workflow 15, which loads the draft by ID and does the actual send.

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
