# Workflow Spec: 25 - WhatsApp Inbound Trigger

## What it does
Every WhatsApp message a client sends to an agency's number arrives here.
The workflow hands it to **Elliot** (workflow `01`, the same agent as the
website chat) and sends Elliot's answer back on WhatsApp, usually within a
few seconds. So WhatsApp gets everything the website chat gets: answers
from the knowledge base, listing search, viewings booked with the property,
lead capture and scoring, hand-over to a person, and a team member taking
the chat over from the dashboard.

Until November 2026 this workflow classified the message (`13`) and wrote a
draft (`26`) that waited in Approvals. That made clients wait for someone
to click Send, so it was replaced by instant replies (migration `0032`).
Workflows `26`/`27`/`28` stay in the repo so drafts already in Approvals can
still be sent, but `25` no longer creates new drafts.

## Trigger
Two webhook nodes sharing the path `/webhook/whatsapp`: Meta verifies the
URL once with a `GET`, then delivers every event as a `POST`.

## Nodes (in order)
| Node | What it does |
|---|---|
| WhatsApp Verify (GET) → Check Verify Token → Verify OK? → Respond Challenge / Respond Verify Failed | Meta's subscription handshake. Unchanged. |
| WhatsApp Webhook (POST) | Every message and delivery/read status. Raw Body on (for the signature). |
| Respond Ack | 200 straight away, in parallel with the rest, so Meta doesn't retry. |
| Verify Meta Signature → Signature Valid? | Drops anything not signed with the Meta App Secret. Unchanged. |
| Extract WhatsApp Fields | Reads Meta's payload. Text and button replies pass through as they are. Photos, voice notes, documents, stickers, locations and contact cards become a short note, e.g. `[Sent a photo: is this the building?]`, so Elliot can answer (it can't open media yet). Statuses, reactions and empty messages are skipped. |
| Should Process? | Stops skipped events. |
| Lookup Tenant by Phone Number Id | `ai_config.whatsapp_phone_number_id` (Settings → WhatsApp phone number ID) → the agency, with its slug for Elliot. Always outputs, so an unknown number reaches the next node. |
| If Tenant Found → Log Unmatched Number | Unknown number → `audit_log` (`whatsapp_unmatched_phone_number_id`). |
| Claim Message | `claim_whatsapp_message()` (0032). Meta sometimes delivers a message twice; only the first copy carries on, so the client never gets two answers. |
| Is New Message? | Stops repeats. |
| Upsert Contact | The contact by phone (any format, saved as `+48…`). WhatsApp's profile name only fills a blank name. |
| Get or Create Conversation (WhatsApp) | One conversation per client on WhatsApp, reused. |
| Build Elliot Request | Elliot's chat webhook address (worked out from this n8n's own address, or pasted), plus `{ tenant_slug, message, conversation_id, channel: 'whatsapp', contact: { name, phone } }`. |
| Ask Elliot | `POST` to workflow `01`. Elliot saves the client's message and its own answer in the conversation. Never errors the workflow; the next node reads the result. |
| Read Elliot Answer | Elliot's `reply`; or nothing when a team member has taken the chat over (`human: true`: the person answers from the dashboard); or, if Elliot failed, a short holding message so the client isn't ignored. |
| Has Reply? → Format for WhatsApp | Turns Elliot's Markdown into WhatsApp formatting (`**bold**` → `*bold*`, `[text](link)` → `text: link`, no headings, bullets as `•`), max 4096 characters. |
| Send WhatsApp Reply | `POST https://graph.facebook.com/v20.0/{phone_number_id}/messages` with the "WhatsApp Cloud API token" credential. |
| Check Send Result → Send Failed? → Log Send Failure | If Meta refuses the message, `log_whatsapp_send_failure()` (0032) writes `audit_log` (`whatsapp_send_failed`) and a note the team sees in the conversation. |
| Elliot Failed? → Log Elliot Failure | `audit_log` (`whatsapp_elliot_failed`) when Elliot errored or answered nothing. |

## Workflow 01 and WhatsApp
`01` accepts an optional `channel: 'whatsapp'`. For WhatsApp:
- the website's "name and email or phone first" form doesn't apply (the
  phone number is always known). If the name isn't known, Elliot asks for
  it in the conversation and saves it with `capture_lead`;
- Elliot is told to write like a text message: short, plain text, links
  written out, `*single asterisks*` for bold, same language as the client;
- a `[Sent a photo]`-style note means Elliot can't open the attachment and
  asks the client to type what they need.

Elliot's conversation history is now the latest 20 messages (it was the
first 20, which broke long WhatsApp chats; fixed in 0032).

## Credentials
- **Elliot Postgres (service role)** on every Postgres node.
- **WhatsApp Cloud API token** (HTTP Header Auth: `Authorization` =
  `Bearer <token>`) on *Send WhatsApp Reply*. The same credential as `27`
  and `32`; one token covers every agency's number.

## Secrets pasted after import
n8n Cloud Starter has no Variables and blocks `$env`, so these are pasted
into their Code node, replacing a placeholder. Never export the workflow
back into the repo with real values.
- **Verify token** (`Check Verify Token`, `PASTE_WHATSAPP_VERIFY_TOKEN_HERE`).
- **Meta App Secret** (`Verify Meta Signature`, `PASTE_META_APP_SECRET_HERE`).
- **Elliot's chat address** (`Build Elliot Request`,
  `PASTE_ELLIOT_CHAT_WEBHOOK_URL_HERE`): optional. Left as the placeholder,
  it's worked out from this n8n's own address
  (`https://<you>.app.n8n.cloud/webhook/chat`).

A variable of the same name (`WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`,
`ELLIOT_CHAT_WEBHOOK_URL`) wins on plans that have Variables.

## Error paths
- Unsigned or forged POST → dropped after the 200 ack; `_signature` says why.
- Unknown phone number id → `audit_log`.
- Repeated delivery → ignored.
- Elliot errors or times out (2 minutes) → holding message to the client +
  `audit_log`.
- Meta refuses the reply → `audit_log` + a note in the conversation. Common
  codes: `190` token expired, `131030` the test number can only message
  numbers added in Meta's API Setup, `131047` more than 24 hours since the
  client's last message.
- Several quick messages in a row are answered one by one (each runs
  through Elliot separately), as on the website. If Meta puts several in
  *one* delivery, the first is answered and the rest are counted in the
  alerts (`whatsapp_unanswered_failed`, 0048).
- Meta accepted a message and later reports it as failed (status update)
  → `record_whatsapp_delivery_failure` (0048): `audit_log` + a note in the
  client's conversation, once per message.

## Expected output
None; a top-level trigger.
