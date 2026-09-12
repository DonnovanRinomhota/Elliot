# Workflow Spec: 15 - Send Approved Email

## Trigger
Sub-workflow, called from three places: workflow 14 (autonomous FAQ path, `auto: true`), workflow 17 (human clicked send, `auto: false`), and the dashboard's Pending Approvals screen (also `auto: false`).

## Inputs
```json
{ "draft_id": "…uuid…", "auto": false }
```

## Nodes (in order)
| Node | What it does |
|---|---|
| When Executed by Another Workflow | Sub-workflow trigger |
| Load Draft | Selects the full `email_drafts` row by `draft_id` |
| If Not Already Sent | Guards against double-send (checks `status !== 'sent'`) |
| Build Gmail Message | Raw RFC 2822 message, base64url-encoded, threaded as a reply (`In-Reply-To`/`References` set to the original `gmail_message_id`) |
| Send via Gmail API | Actual send |
| Update Draft Status (Sent) | Sets `status`/`sent_at` |
| If Conversation Id Exists | Guards the next step for drafts with no linked conversation |
| Insert Outbound Message | Logs the sent email into `messages` (`role: 'assistant'`) so it shows up in the conversation transcript |
| If Proposed Appointment Exists | Branches on whether this draft had a `proposed_appointment` from workflow 14's scheduling branch |
| Execute: Book Appointment | Calls workflow 12 if a slot was confirmed — this is how a scheduling-category email reply actually results in a real booked appointment, not just a reply saying "sure, that time works" |

## A real, documented n8n bug worked around here
`Update Draft Status (Sent)` is explicitly **not** using n8n's Postgres v2 "Update" operation — a code comment explains why: that operation has known parameter-binding bugs (confirmed via multiple GitHub issues) that can produce a confusing failure where the displayed values look correct but the underlying query is malformed. Uses "Execute Query" with hand-written SQL and explicit parameters instead, which bypasses the buggy code path. Worth remembering if a future edit is tempted to "simplify" this back to the Update operation.

## Credentials required
- The shared Postgres credential.
- A Gmail OAuth2 credential on `Send via Gmail API` — same known limitation as everywhere else in this codebase (15/16/18/20/24 all share this): one credential per workflow, not dynamic per-tenant. Whichever tenant's inbox this credential belongs to is the only one that can actually send today.

## Error paths
- `If Not Already Sent` prevents a draft from being sent twice if this workflow is somehow triggered again for the same `draft_id`.
- If `Execute: Book Appointment` hits the double-booking collision (see workflow 12's spec and `KNOWN_ISSUES.md`), that's handled gracefully by 12 itself as of the 12 Sep polish pass — this workflow doesn't need its own handling for that case.

## Expected output
No meaningful return value — like 14, this workflow's purpose is entirely its side effects (send the email, log the message, optionally book the appointment).
