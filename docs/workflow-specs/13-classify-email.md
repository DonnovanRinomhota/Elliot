# Workflow Spec: 13 - Classify Email

## Trigger
Sub-workflow, called via Execute Workflow node from 16 (Email Inbound Trigger) — not its own webhook.

## Inputs
```json
{
  "tenant_id": "…uuid…",
  "from_email": "prospect@example.com",
  "subject": "Question about the Warsaw listing",
  "body": "...",
  "gmail_thread_id": "...",
  "gmail_message_id": "..."
}
```

## Nodes (in order)
| Node | What it does |
|---|---|
| When Executed by Another Workflow | Sub-workflow trigger |
| Build Claude Request | Builds a classification prompt listing the 6 categories with real definitions (see below), asks for strict JSON output |
| Call Claude | `claude-sonnet-4-6`, 500 max tokens |
| Parse Classification Result | Parses Claude's JSON, clamps `category` to the allowed set (falls back to `other` on anything unexpected) and `confidence` to 0–1 |

## The 6 categories
- `faq_answerable` — factual, answerable from the knowledge base (hours, general process, pricing structure) — explicitly NOT this if it references a specific property/listing or needs live data
- `lead_inquiry` — new/existing prospect interest, a specific property question, anything beyond a simple FAQ
- `complaint` — dissatisfaction with service already received
- `scheduling` — explicit book/reschedule/cancel request
- `spam` — marketing, phishing, irrelevant solicitation
- `other` — doesn't clearly fit any of the above

## Credentials required
Anthropic API credential (`Anthropic account`) on the `Call Claude` node.

## Error paths
- Claude's response isn't the expected shape, or its JSON doesn't parse → the node throws rather than silently guessing. `Parse Classification Result`'s TODO comment flags this as worth stricter retry handling if real-world testing shows bad output — not yet built.
- An out-of-set category value from Claude → silently clamped to `other` rather than thrown (a different tolerance decision than the parse-failure case, since category drift is lower-stakes than a fully malformed response).

## Expected output
```json
{ "category": "faq_answerable", "confidence": 0.92, "reasoning": "..." }
```

## Downstream
Feeds directly into workflow 16's call to workflow 14 (Draft Email Reply), which branches its whole drafting strategy off `category`.
