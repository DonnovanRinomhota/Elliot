# n8n workflows

The exported workflows live in `n8n/workflows/`; their Code-node logic is
tested in `n8n/workflows/tests/`. A change only goes live once the workflow
is re-imported into n8n (open it → ⋯ → Import from File, so its ID stays) and
saved. Internal webhooks need the "Elliot Internal Webhook Secret" header
(see [`internal-webhook-auth.md`](internal-webhook-auth.md) and
[`../security.md`](../security.md)).

| # | Workflow | What it does | Docs |
|---|---|---|---|
| 01 | Main AI Agent | Elliot itself: `/chat` for the website, `/chat-internal` (secret) for email and WhatsApp; tools, approval rules, logging, prompt caching | [01](01-main-ai-agent.md), [system prompt](main-agent-system-prompt.md) |
| 08 | Knowledge Ingestion | Text, PDF and website pages into the knowledge base | [08](08-knowledge-ingestion.md) |
| 09 | Knowledge Retrieval | `search_company_knowledge` tool | [09](09-knowledge-retrieval.md) |
| 10 | Lead Capture | `capture_lead` tool: contact, lead, score, assignment | [10](10-lead-capture.md) |
| 11 | Check Availability | Free times across the agents' calendars | [11](11-check-availability.md), [agent calendars](../agent-calendars.md) |
| 12 | Book Appointment | Books into a free agent's calendar, confirmation email | [12](12-book-appointment.md) |
| 13 | Classify Email | *Retired:* email is answered instantly by 01 (0035) | [13](13-classify-email.md) |
| 14 | Draft Email Reply | *Retired:* as 13 | [14](14-draft-email-reply.md) |
| 15 | Send Approved Email | Sends an approved email draft (through 39) | [15](15-send-approved-email.md) |
| 16 | Email Inbound Trigger | The agency's Gmail → Elliot → reply in the thread; attachments | [16](16-email-inbound-trigger.md), [attachments](../email-attachments.md) |
| 17 | Manual Send Draft | Dashboard webhook for 15 | [17](17-manual-send-draft.md) |
| 18 | Demo Request Intake | getelliot.eu contact form | [18](18-demo-request-intake.md) |
| 19 | Tenant Onboarding | New agency | [19](19-tenant-onboarding.md) |
| 20 | Follow-Up Sweep | Sends due follow-up steps by email or WhatsApp | [20](20-follow-up-sweep.md), [WhatsApp](../whatsapp-follow-ups.md) |
| 21 | Start Follow-Up Run | Puts a lead on a sequence | [20](20-follow-up-sweep.md) |
| 22 / 23 | Queue CRM Sync / CRM Sync Sweep | Contacts, leads and viewings to the agency's CRM webhook | [22](22-crm-sync.md) |
| 24 | Escalate To Human | Escalation, alert email to the lead's owner | [24](24-escalate-to-human.md) |
| 25 | WhatsApp Inbound Trigger | Meta webhook → Elliot → instant reply | [25](25-whatsapp-inbound-trigger.md), [set-up](../whatsapp-setup.md) |
| 26 | Draft WhatsApp Reply | *Retired:* WhatsApp is answered instantly (0032) | [26](26-draft-whatsapp-reply.md) |
| 27 | Send Approved WhatsApp | Sends WhatsApp drafts; follow-ups after 24 hours as the `elliot_follow_up` template | [27](27-send-approved-whatsapp.md) |
| 28 | Manual Send WhatsApp Draft | Dashboard webhook for 27 | [28](28-manual-send-whatsapp-draft.md) |
| 29 | Auto-Enrol Follow-Ups | Quiet leads into the auto-enrol sequence | [29](29-auto-enrol-follow-ups.md) |
| 30 | Cancel Appointment | Cancels a viewing and its calendar event | [30](30-cancel-appointment.md) |
| 31 | Daily Summary Email | 08:00 summary for each agency | [control panel doc](../control-panel-listings-inbox.md) |
| 32 | Send WhatsApp Message | A team member's reply on WhatsApp | [32](32-send-whatsapp-message.md) |
| 33 / 34 | Health Check & Alerts / Workflow Error Recorder | Checks every 15 minutes; failures from other workflows | [33](33-health-check.md) |
| 35 / 36 | Website Booking & Demo Access / Demo Clean-up | getelliot.eu calls and the demo agency | [website doc](../website-sales-and-demo.md) |
| 37 / 38 | Client Viewing Changes / Viewing Reminders | Confirm, move, cancel by message; reminders the day before | [37-38](37-38-viewing-changes-reminders.md) |
| 39 | Send Email | Every email Elliot sends, via Resend, in the agency's name | [agency email](../agency-email.md) |
| 40 | Email Inbound (Forwarded) | Email forwarded to `<slug>@in.getelliot.eu` → Elliot → reply; attachments | [agency email](../agency-email.md), [attachments](../email-attachments.md) |
| 41 | Calendar Access Check | What Elliot may do with each agent's calendar | [agent calendars](../agent-calendars.md) |
| 42 | ASARI Sync | Listings from ASARI CRM, hourly or on "Sync now" | [ASARI](../asari-sync.md) |

Retired workflows stay in the repo for their history; they can be switched
off in n8n.

## Workflow IDs in n8n

The ID is the part of a workflow's address after `/workflow/` on
`makodevops.app.n8n.cloud`. Workflows that are called by others, with the ID
the calling files use:

| Workflow | ID | Called by |
|---|---|---|
| 09 - Knowledge Retrieval | `q3Q23QZ4329lF5Uk` | 01, 14, 26 |
| 10 - Lead Capture | `XVFzq7X38hyUZDqZ` | 01 |
| 11 - Check Availability | `D94fGN3AjCPhGzCb` | 01, 14, 26, 35 |
| 12 - Book Appointment | `VNROj5sGjnwdFidx` | 01, 15, 27, 35 |
| 15 - Send Approved Email | `5WtBLdM7JIbr0v3O` | 14, 17 |
| 24 - Escalate To Human | `jfcGGkCo29OLxONR` | 01, 10 |
| 27 - Send Approved WhatsApp | `171fa894c0614981` | 20, 26, 28 |
| 34 - Workflow Error Recorder | `seDI8X3d4J3gLEgw` | every workflow's Settings → Error workflow |
| 37 - Client Viewing Changes | `ySMoLU4Vf6EM6FAE` | 01 |
| 39 - Send Email | `gwZAVRJ6G4iph76o` | 12, 15, 18, 20, 24, 31, 35, 37, 38, 40 |

Always import with ⋯ → Import from File **inside the existing workflow**, so
its ID stays. A workflow that is deleted and re-created gets a new ID; then
update this table and the files that call it.
