# Workflow Spec: 26 - Draft WhatsApp Reply

## Trigger
Sub-workflow, called via Execute Workflow node from `25` (WhatsApp Inbound Trigger), after `13` (Classify, reused) has already run.

## Inputs
```json
{
  "tenant_id": "…uuid…",
  "conversation_id": "…uuid…",
  "contact_id": "…uuid…",
  "to_wa_id": "48123456789",
  "phone_number_id": "…meta phone_number_id…",
  "wa_message_id": "wamid.…",
  "last_inbound_at": "2026-09-26T10:00:00.000Z",
  "body": "Do you have any 2-bedroom flats in Mokotów?",
  "category": "faq_answerable",
  "confidence": 0.92
}
```

## Relationship to workflow 14
This is `14 - Draft Email Reply`'s three-way branch (FAQ / scheduling / everything else), rebuilt against `whatsapp_drafts` instead of `email_drafts`, per the decision to keep the two channels' drafting tables separate rather than generalizing `email_drafts` — see migration `0025`'s header comment for why. The branching logic, the auto-send threshold, and the scheduling propose/confirm/clarify decision are **identical** to `14`; only the prompts' wording changed (shorter, no subject line, no email-style greeting/sign-off — a WhatsApp message reads as a text, not a letter) and the fields written to the draft row changed (`to_wa_id`/`phone_number_id`/`wa_message_id`/`last_inbound_at` instead of `to_email`/`subject`/`gmail_thread_id`/`gmail_message_id`).

## The three branches (routed by `category`, reused from 13)
| Category | Branch | What happens |
|---|---|---|
| `faq_answerable` | FAQ | Calls workflow `09` (Knowledge Retrieval) with the message body as the query, then drafts an answer grounded only in retrieved content — same "say the team will follow up rather than invent facts" instruction as `14` |
| `scheduling` | scheduling | Pulls recent messages, calls workflow `11` (Check Availability), asks Claude to `propose`/`confirm`/`clarify` exactly as `14` does. Only a `confirm` with a valid `confirmed_slot` becomes `proposed_appointment` |
| Everything else | `extra` (Switch fallback) | Generic draft, explicitly told this always goes to human review |

All three converge on **Call Claude (Draft)** → **Shape Draft Record** → **Insert whatsapp_drafts Row**.

## Auto-send eligibility
Same rule, same threshold, as `14`:
```js
const AUTO_SEND_THRESHOLD = 0.85;
const autoSendEligible = category === 'faq_answerable' && confidence >= AUTO_SEND_THRESHOLD;
```
An eligible draft is saved `pending` like any other, then immediately passed to **Execute: Send Approved WhatsApp** (workflow `27`, `auto: true`) by `If Auto-Send Eligible`. Whether it actually sends still depends on workflow 27's 24-hour window check (see that workflow's spec) — a high-confidence FAQ answer drafted just outside the window still gets marked `blocked_needs_template` rather than sent, same as a human-approved one would.

## Credentials required
Anthropic API credential, on both Claude calls — same credential already configured for `14`.

## Error paths
Identical to `14`'s: a malformed Claude response throws rather than guessing; an invalid scheduling `action` value falls back to `clarify`.

## Expected output
Side-effect only — a new `whatsapp_drafts` row, possibly followed by an autonomous send via `27`. No return value consumed by a caller.
