# Workflow Spec: 16 - Email Inbound Trigger

## Trigger
Gmail Trigger node, polling `INBOX` every minute. This is the entry point for the entire email agent — every inbound email that reaches any tenant's connected Gmail account starts here.

## How a mailbox maps to a tenant
`Lookup Tenant by Mailbox` selects from `ai_config` where `connected_gmail_address = <the email's "to" address>`. This is the mechanism that makes the single shared Gmail Trigger multi-tenant-aware in principle — in practice, since only one Gmail OAuth2 credential is wired into the trigger node itself (same limitation as 15/18/20/24), only whichever mailbox that credential polls will ever produce events here, regardless of how many tenants have a `connected_gmail_address` on file.

## Nodes (in order)
| Node | What it does |
|---|---|
| Gmail Trigger | Polls INBOX every minute |
| Extract Email Fields | Pulls `from`/`to`/`subject`/`text`/`html`/`id`/`threadId` from n8n's Gmail Trigger output. **Worth knowing:** a code comment notes this shape was confirmed via a live test to differ from what was originally assumed — n8n's Gmail Trigger returns a pre-parsed (MIME-parsed) object with `from.value[0].address`-style nesting, not the raw Gmail API `headers`/`parts` structure. If this ever needs revisiting, don't assume the raw API shape without checking a real trigger payload first |
| Lookup Tenant by Mailbox | Resolves tenant via `connected_gmail_address` |
| If Tenant Found | Drops the email silently if no tenant matches (see Error paths) |
| If Not Self-Sent | Filters out emails the tenant's own connected address sent to itself — prevents the agent from replying to its own sent mail in a loop |
| Upsert Contact | Creates or updates the `contacts` row for the sender |
| Get or Create Conversation (Email) | Resolves or creates a `conversations` row for this thread |
| Insert Inbound Message | Logs the email as a `role: 'user'` message |
| Execute: Classify Email | Calls 13 |
| Execute: Draft Email Reply | Calls 14 with 13's classification result merged in |

## Credentials required
Gmail OAuth2 credential on the trigger node itself (polling), and the shared Postgres credential.

## Error paths
- **If Tenant Found is false → the email is silently dropped, no error, no log.** This is worth being aware of: if `connected_gmail_address` is ever misconfigured or unset for a tenant whose mailbox this trigger is polling, inbound mail goes nowhere with no visible failure. This exact gap is already flagged in the workflow file itself — a node note reads: "No-match branch should log/alert rather than silently drop -- TODO: wire the false branch to a simple logging step (or Slack alert) so misrouted mail doesn't vanish silently." Still not built.
- **If Not Self-Sent is false → also silently dropped**, but this one is intentional (loop prevention), not a gap.

## Expected output
No return value consumed by anything — this is a top-level trigger workflow, not a sub-workflow.
