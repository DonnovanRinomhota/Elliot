# Workflow Spec: 25 - WhatsApp Inbound Trigger

## Trigger
Two webhook nodes sharing the same path (`/webhook/whatsapp`), distinguished by HTTP method — this is how Meta's WhatsApp Cloud API integration works: it verifies the URL once with a `GET`, then delivers every subsequent event as a `POST` to the same URL.

## How a phone number maps to a tenant
`Lookup Tenant by Phone Number Id` selects from `ai_config` where `whatsapp_phone_number_id` = the `phone_number_id` Meta's payload says the message arrived on. **This is a real improvement over the equivalent email mechanism, not just a copy of it:** `16-email-inbound-trigger.md` documents that only one Gmail OAuth2 credential is wired into that trigger node, so only one tenant's mailbox is ever actually reachable no matter how many rows have `connected_gmail_address` set. WhatsApp Cloud API doesn't have that constraint — many phone numbers can live under one Meta Business Account behind a single access token, and every webhook payload names which number received it. So this lookup is expected to genuinely route more than one tenant once more than one tenant has a real number configured, using the one shared credential on workflow 27's send node.

## Nodes (in order)
| Node | What it does |
|---|---|
| WhatsApp Verify (GET) | Receives Meta's one-time (or repeated, if you re-verify) handshake request |
| Check Verify Token | Compares `hub.verify_token` against the `WHATSAPP_VERIFY_TOKEN` environment variable; `hub.mode` must be `subscribe` |
| Verify OK? | Branches on the result |
| Respond Challenge / Respond Verify Failed | Echoes `hub.challenge` back as plain text (200) if valid, else a 403 |
| WhatsApp Webhook (POST) | Receives every inbound message and delivery/read status update Meta sends |
| Respond Ack | Fires immediately, in parallel with the processing branch below — Meta expects a fast 200 regardless of content and will retry aggressively (eventually disabling the webhook) if it doesn't get one quickly |
| Extract WhatsApp Fields | Parses Meta's payload; sets `skip: true` for status-update pings (no `messages` key at all) and for any message that isn't `type: "text"` |
| Should Process? | Drops anything flagged `skip` |
| Lookup Tenant by Phone Number Id | Resolves tenant via `whatsapp_phone_number_id` |
| If Tenant Found | Branches to the real pipeline, or to logging |
| Log Unmatched Number *(false branch)* | Inserts an `audit_log` row (`event_type: 'whatsapp_unmatched_phone_number_id'`) — see Error paths |
| Upsert Contact | Creates or updates the `contacts` row by `(tenant_id, phone)`, keeping an existing name rather than overwriting it with WhatsApp's profile display name |
| Get or Create Conversation (WhatsApp) | Resolves or creates the one `conversations` row for `(tenant, contact, channel='whatsapp')` — reused forever, same simplification `16` uses for email, no thread concept needed since the phone number itself is the thread |
| Insert Inbound Message | Logs the message as `role: 'user'` |
| Execute: Classify (reused) | Calls workflow `13` — see note below |
| Execute: Draft WhatsApp Reply | Calls workflow `26` |

## Workflow 13 is reused as-is, not forked
Classification is genuinely channel-agnostic — it only ever looks at subject+body text to pick one of six categories. Rather than duplicating it, this workflow calls the existing `13 - Classify Email` sub-workflow, passing the WhatsApp sender id as `from_email` and empty strings for `subject`/`gmail_thread_id`/`gmail_message_id` (13 never reads the latter two). This is cosmetic — the field names say "email" but nothing about the classification logic actually depends on the channel — not a functional risk. If this is ever confusing in practice, the fix is renaming 13's input parameters to be channel-neutral, not building a second classifier.

## Credentials required
None on this workflow's own nodes beyond the shared Postgres credential — no WhatsApp credential is needed to *receive* messages, only to send them (see workflow `27`).

## Environment variables required
`WHATSAPP_VERIFY_TOKEN` — a secret string you choose and enter in both n8n's environment and the Meta App dashboard's webhook configuration. Meta echoes it back on the verify `GET`; this workflow checks it matches before confirming the subscription.

## Error paths
- **Unmatched `phone_number_id` → logged to `audit_log`, not silently dropped.** This is a deliberate improvement over `16`'s documented gap (a misconfigured `connected_gmail_address` drops mail with zero trace). Still requires someone to actually look at `audit_log`; no alerting is built.
- **Non-text messages (image, audio, location, document, etc.) are skipped, not handled.** `Extract WhatsApp Fields` flags these and the pipeline stops there — no draft, no reply, no record beyond nothing happening. Building real media support (downloading from Meta's authenticated media URL, storing it, giving Claude something to look at) is future work.
- **The POST payload's signature is not verified.** Meta signs every webhook body with `X-Hub-Signature-256` (HMAC-SHA256 using the Meta App Secret); this workflow doesn't check it. Anyone who discovers the webhook URL could POST a forged message that would be processed as if it came from a real customer. Same class of gap as `KNOWN_ISSUES.md`'s note on the tenant-onboarding webhook having no auth of its own — acceptable for a sandbox test number, not for anything beyond that.
- **The `WhatsApp Webhook (POST)` node has two outputs firing per event** (`Respond Ack` and `Extract WhatsApp Fields`) — this is intentional (see Trigger notes above), not a duplicate-processing bug; only one branch touches the database.

## Expected output
No return value consumed by anything — like `16`, this is a top-level trigger workflow.
