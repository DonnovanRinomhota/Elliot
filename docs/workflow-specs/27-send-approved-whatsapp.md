# Workflow Spec: 27 - Send Approved WhatsApp

## Trigger
Sub-workflow, called from three places: workflow `26` (autonomous FAQ path, `auto: true`), workflow `28` (human clicked send, `auto: false`), and the dashboard's Approvals screen (also `auto: false`) — same calling shape as `15 - Send Approved Email`.

## Inputs
```json
{ "draft_id": "…uuid…", "auto": false }
```

## Nodes (in order)
| Node | What it does |
|---|---|
| When Executed by Another Workflow | Sub-workflow trigger |
| Load Draft | Selects the full `whatsapp_drafts` row by `draft_id` |
| If Not Already Sent | Guards against double-send (`status !== 'sent'`), same as `15` |
| Check 24h Window | Computes hours elapsed since `last_inbound_at`; see below |
| Within 24h Window? | Branches on that |
| Send via WhatsApp API *(within window)* | `POST https://graph.facebook.com/v20.0/{phone_number_id}/messages` |
| Update Draft Status (Sent) | Sets `status`/`sent_at` |
| If Conversation Id Exists → Insert Outbound Message | Logs the sent message into `messages` (`role: 'assistant'`), same pattern as `15` |
| If Proposed Appointment Exists → Execute: Book Appointment | Calls workflow `12`, same as `15` |
| Update Draft Status (Blocked) *(outside window)* | Sets `status = 'blocked_needs_template'` instead of attempting the send |

## The 24-hour free-form window — the one real behavioral difference from email
Meta only allows a business to send a plain-text reply within 24 hours of the customer's *last* inbound message. Outside that window, a free-form send is rejected outright (Meta error `131047`); the only legal way to message the contact again is a pre-approved **template message** (fixed wording, submitted to Meta for approval ahead of time, e.g. "Hi {{1}}, following up on your enquiry"). **Template sending is not built.** This workflow checks the window and marks a late draft `blocked_needs_template` rather than attempting a send that would fail, or silently doing nothing. The check happens here, at send time, not in `26` at draft time, because a human can sit on an approval for longer than 24 hours — the window can close between drafting and approving.

This directly affects follow-up sequences (`20-follow-up-sweep.md`) if they're ever extended to WhatsApp: a day-3 or day-7 step will almost always land outside the window and needs a template, not a free-form draft.

## Credentials required
- The shared Postgres credential.
- An HTTP Header Auth credential (named e.g. "WhatsApp Cloud API token": header `Authorization`, value `Bearer <token>`) on `Send via WhatsApp API`. **Genuinely one credential for every tenant** — unlike Gmail's per-workflow single-mailbox limitation, WhatsApp Cloud API lets one system-user token send from any phone number under the same Business Account; only the URL's `phone_number_id` (read from the draft row, set by `25` from `ai_config.whatsapp_phone_number_id`) needs to vary per tenant. **Currently a placeholder** (`PLACEHOLDER_CRED_ID`) — set the real credential before this can send anything, even to the sandbox test number.

## Error paths
- `If Not Already Sent` prevents a double-send, same as `15`.
- Outside the 24h window → `blocked_needs_template`, not a failed send retried forever and not a silent no-op — see above.
- No verification that the draft belongs to whoever is calling this, same acceptable-scope gap `17`/`15` already have.
- Meta API errors (invalid token, number not yet verified in the sandbox, rate limit) → the HTTP Request node fails with n8n's default behavior. No retry/backoff built, same as `15`'s equivalent gap for Gmail.

## Expected output
No meaningful return value — like `15`, this workflow's purpose is its side effects (send, log, optionally book).
