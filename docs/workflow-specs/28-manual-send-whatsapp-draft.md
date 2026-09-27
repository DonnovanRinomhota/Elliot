# Workflow Spec: 28 - Manual Send WhatsApp Draft

## Trigger
Public-ish webhook (`POST /send-approved-whatsapp-draft`) — the thin trigger the dashboard's Approvals "Approve & Send" button hits for a WhatsApp draft. Exact mirror of `17 - Manual Send Draft`, against `27` instead of `15`.

## Inputs
```json
{ "draft_id": "…uuid…" }
```

## Nodes (in order)
| Node | What it does |
|---|---|
| Send WhatsApp Draft Webhook | Public POST trigger |
| Validate Input | Just checks `draft_id` is present |
| Execute: Send Approved WhatsApp | Calls workflow `27` with `auto: false` — hardcoded, regardless of what the caller passes, same as `17` |
| Respond to Webhook | Returns `{ success: true, draft_id }` |

## Credentials required
None directly — the real work happens inside `27`.

## Error paths
Identical to `17`'s: missing `draft_id` throws; no ownership check on the draft itself (left to `27`'s `Load Draft` guard) — acceptable given only the dashboard's own button is expected to call this.

## Expected output
```json
{ "success": true, "draft_id": "…uuid…" }
```
