# Workflow Spec: 14 - Draft Email Reply

## Trigger
Sub-workflow, called via Execute Workflow node from 16 (Email Inbound Trigger), after 13 (Classify Email) has already run.

## Inputs
```json
{
  "tenant_id": "…uuid…",
  "conversation_id": "…uuid…",
  "contact_id": "…uuid…",
  "from_email": "prospect@example.com",
  "subject": "...",
  "body": "...",
  "gmail_thread_id": "...",
  "gmail_message_id": "...",
  "category": "faq_answerable",
  "confidence": 0.92
}
```

## The three branches (routed by `category`)
This is the most structurally complex workflow in the codebase — a 3-way `Switch` on `category`, each branch converging back into the same drafting/save logic.

| Category | Branch | What happens |
|---|---|---|
| `faq_answerable` | FAQ | Calls workflow 09 (Knowledge Retrieval) first, then drafts an answer **grounded only in retrieved content** — the prompt explicitly instructs Claude to say the team will follow up rather than invent facts if the retrieved context doesn't actually answer the question |
| `scheduling` | scheduling | Pulls recent conversation history (`Get Recent Messages`) + calls workflow 11 (Check Availability) for real open slots, then asks Claude to decide: is this a fresh request (`propose` a few real slots) or a confirmation of a previously offered time (`confirm`, extracting the specific slot)? A third `clarify` action covers ambiguous cases. Only a `confirm` action with a valid `confirmed_slot` gets carried through as `proposed_appointment` — protects against booking something from a malformed or ambiguous response |
| Everything else (`lead_inquiry`, `complaint`, `spam`, `other`) | `extra` (Switch's fallback output) | A generic draft prompt, explicitly told this will always go to human review, so it's fine to leave placeholders like `[confirm availability]` for details Claude doesn't have |

All three branches converge on **Call Claude (Draft)** → **Shape Draft Record** → **Insert email_drafts Row**.

## Auto-send eligibility
```js
const AUTO_SEND_THRESHOLD = 0.85;
const autoSendEligible = category === 'faq_answerable' && confidence >= AUTO_SEND_THRESHOLD;
```
Only FAQ answers at high classification confidence are ever eligible for autonomous send — scheduling and generic-category drafts always require human approval, regardless of confidence. The threshold has a TODO in the code itself noting it should be tuned after reviewing real classification confidence in production; it was picked reasonably, not measured.

Every draft is saved with `status: 'pending'` regardless of eligibility — `auto_send_eligible` is a separate flag `Insert email_drafts Row` writes for `If Auto-Send Eligible` to act on immediately after, not a different insert path.

## Nodes of note
- **Insert email_drafts Row** — writes `proposed_appointment` as `JSON.stringify(...)` when present, `null` otherwise; workflow 15 reads this at send time to decide whether to also call Book Appointment.
- **If Auto-Send Eligible** → **Execute: Send Approved Email** (workflow 15, with `auto: true`) — the only path in this codebase where an email actually sends without a human clicking anything, and it's narrowly scoped to high-confidence FAQ answers only.

## Credentials required
Anthropic API credential, used by both `Call Claude (Draft)` and `Call Claude (Scheduling)`.

## Error paths
- Claude's draft or scheduling response isn't the expected shape → throws, same pattern as workflow 13.
- An invalid `action` value from the scheduling call → falls back to `clarify` rather than guessing which slot was meant.

## Expected output
The workflow's real "output" is the side effect (a new `email_drafts` row, possibly followed by an autonomous send) — there's no meaningful return value consumed by a caller beyond that.
