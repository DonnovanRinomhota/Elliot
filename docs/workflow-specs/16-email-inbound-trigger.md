# Workflow Spec: 16 - Email Inbound Trigger

## What it does (since 0035)
Every email that reaches the agency's connected Gmail inbox is handed to
**Elliot** (workflow `01`, the same agent as WhatsApp and the website chat),
and Elliot's answer is sent back **in the same Gmail thread**, usually within
a minute or two (the trigger checks the inbox every minute). So email gets
everything the other channels get: answers from the knowledge base, listings
with links, viewings booked with a confirmation email, hand-over to the team.

Until November 2026 this workflow classified the email (`13`) and drafted a
reply (`14`) that waited in Approvals. Workflows 13/14/15/17 stay for drafts
already in Approvals and for "Reply yourself" on the conversation page.

## Nodes (in order)
| Node | What it does |
|---|---|
| Gmail Trigger | Checks INBOX every minute (Gmail account credential). |
| Extract Email Fields | Sender, every recipient (To, Cc, Bcc), subject, Gmail ids and the email's own Message-ID. Only the new part of a reply goes on (cut at "On … wrote:" / "W dniu … pisze:" / "Original Message", quoted lines dropped). Skips no-reply senders, mailer-daemon, auto-replies (Auto-Submitted), newsletters (List-Unsubscribe, Precedence: bulk) and empty emails. |
| Should Process? | Stops skipped emails. |
| Lookup Tenant by Mailbox | The agency whose **Settings → Gmail address** is any of the recipients, ignoring case. Always outputs. |
| If Tenant Found → Log Unmatched Mailbox | Unknown mailbox → `audit_log` (`email_unmatched_mailbox`), not silently dropped. |
| If Not Self-Sent | Never answers the agency's own emails. |
| Claim Message → Is New Message? | Each email is answered once (`claim_whatsapp_message`, id `gmail:<id>`). |
| Upsert Contact / Get or Create Conversation (Email) | As before. |
| Build Elliot Request → Ask Elliot → Read Elliot Answer | `POST` to 01's chat webhook with `channel: 'email'`. If a team member has taken the conversation over, nothing is sent. If Elliot fails, the client gets a short holding reply and the failure is logged. |
| Build Reply Email → Send Reply via Gmail → Check Send Result | "Re:" subject, In-Reply-To/References, Gmail `threadId`, plain UTF-8 text. |
| Send Failed? → Log Send Failure | `log_reply_send_failure()` (0035): `audit_log` + a note in the conversation. |

## Workflow 01 and email
`channel: 'email'`: no website details form (the email address is known),
Elliot passes it to `book_appointment` so the confirmation goes there, asks
for the name if unknown, and writes an email: greeting, short paragraphs,
links in full, plain text, signed with the agency name.

## The team
On the conversation page an email conversation has **Take over**: Elliot
stops answering that client's emails until **Hand back to Elliot**. The team
replies with the "Reply yourself" form (workflows 17 → 15).

## Credentials
Gmail account (trigger and *Send Reply via Gmail*), Elliot Postgres (service
role) on every Postgres node. *Build Elliot Request* works out Elliot's
address from n8n's own; a pasted `ELLIOT_CHAT_WEBHOOK_URL` wins.

## Limits
- One Gmail credential, so one agency mailbox per n8n workflow (unchanged).
- Attachments aren't read; Elliot sees the text only.
