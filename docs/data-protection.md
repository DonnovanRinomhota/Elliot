# Data protection (GDPR)

What personal data Elliot holds, where it goes, and how to answer a client
who asks for a copy or for deletion. This is an engineering description,
not legal advice: the items marked **Legal review** need a lawyer before the
first paying agency.

## Who is responsible for what

| Data | Controller (decides) | Elliot's role |
|---|---|---|
| Clients of an estate agency (chats, emails, WhatsApp, viewings, enquiries) | The agency | **Processor**: we process it on the agency's instructions. Needs a written data processing agreement (umowa powierzenia, GDPR Art. 28) with each agency. |
| Visitors of getelliot.eu, demo sign-ups, people who book a call with us | Elliot (you) | Controller. Covered by the privacy policy on getelliot.eu. |
| The agency's team (logins, names, calendars) | Elliot for the account; the agency for its staff | Both; covered by the agency agreement. |

## What is stored, and where

| What | Where | Holds personal data |
|---|---|---|
| Contacts, conversations, messages, enquiries (leads), viewings, drafts, follow-ups, hand-overs | Supabase (Postgres) | Names, emails, phones, everything the client wrote |
| Email attachments (IDs, payslips, mortgage letters…) | Supabase Storage, bucket `email-attachments`, under `<agency id>/` | Yes, often sensitive |
| Listing photos | Supabase Storage, bucket `listing-photos` | Normally no |
| Logs: `tool_call_log`, `crm_sync_log`, `audit_log` | Supabase | Some rows hold message text or client details |
| Workflow runs | n8n Cloud → Executions | **Yes**: each run stores its input and output (messages, emails) |
| Viewings | The agent's Google Calendar | Client name, phone, notes |
| Sent and received email | The agency's Gmail / your Gmail; Resend's logs | Yes |
| CRM copies | The agency's CRM (webhook, ASARI) | Yes |
| Website chat (agency site, `widget.js`) | The visitor's browser: `sessionStorage` (conversation id), `localStorage` (their name, email, phone) | Yes, on their device only |
| getelliot.eu chat and demo | The visitor's browser `localStorage`: `elliot_visitor`, demo access, theme | Yes, on their device only |

## Who processes it (subprocessors)

Taken from the code (every external API the workflows and dashboard call):

| Provider | What for | Notes |
|---|---|---|
| Supabase Inc. | Database, file storage, logins | Check the project's region in Supabase → Project Settings → General and write it here |
| n8n GmbH (n8n Cloud) | Runs every workflow | EU (Germany), per the privacy policy |
| Anthropic PBC | The AI model that writes replies | US |
| Voyage AI (part of MongoDB, Inc.) | Turns questions and knowledge articles into search data | US. Receives the client's question text |
| Google (Gmail, Calendar, Meet, Drive) | Email, viewings, calls, listing photo import | |
| Meta Platforms Ireland | WhatsApp | |
| Resend (Plus Five Five, Inc.) | Sending and receiving email | US |
| Vercel Inc. | Hosts the dashboard and website | |
| ASARI (agency's own account) | Listings import | Agency's own provider |

**Legal review:** a signed DPA (or accepted online DPA) with each provider,
and the transfer basis for US providers (EU-US Data Privacy Framework or
Standard Contractual Clauses). Check each provider's current DPA page; this
document does not confirm they are in place.

The privacy policy on getelliot.eu lists these (Voyage AI and Gmail were
added on 12 Nov 2026). The agency's own privacy policy must name Elliot as
its processor; give agencies a short paragraph to use (**Legal review**).

## A client asks for a copy, or to be deleted

The agency is the controller, so the request normally reaches the agency.
They answer it in the dashboard; you only help if they ask. Deadline: one
month from the request (GDPR Art. 12(3)).

1. **Confirm who is asking.** Reply from the address or number already in the
   conversation, or ask a question only the client can answer. Don't send a
   copy to a new address without checking.
2. **Copy (access / portability):** open any conversation with the client →
   **Client's data → Download a copy**. It is one JSON file: details, every
   conversation and message (all channels), file names, enquiries, viewings
   and drafted messages. Agency admins only; the download is recorded in the
   activity log. Send it to the client.
3. **Deletion:** same panel → **Delete this client…** → type `delete`. This
   removes the contact, every conversation and message, the stored files,
   enquiries, viewings, follow-ups, drafts and the log rows about them, for
   all channels. The activity log keeps one line that a deletion happened,
   with counts only.
4. **Then by hand**, because Elliot can't reach them:
   - Upcoming viewings in Google Calendar: the dashboard lists them after
     deleting. Delete those events.
   - The agency's inbox and CRM copies.
   - n8n executions that contain the client (see below), if within the
     retention window.

Only agency admins see the panel. A platform admin viewing the agency (view
as, with permission) can do the same.

For people who used **getelliot.eu** (you are controller): find them under
the `elliot` sales account in the dashboard and use the same panel. Demo
sign-ups older than the retention period are removed by workflow 43.

## Keeping data only as long as needed (retention)

Migration 0051 adds `ai_config.retention_months` per agency. When set, the
nightly workflow **43 Data Retention** deletes every client with no activity
(no message, conversation, enquiry or viewing) for that long, the same way
as a manual deletion, and removes their files. Clients with a viewing still
ahead are never touched. It is **off** for every agency until set.

Setting it deletes data, so look first:

```sql
-- Who would be deleted (changes nothing):
select * from retention_preview();
-- after setting a period, e.g. for Elliot's own sales account:
update ai_config set retention_months = 12
 where tenant_id = (select id from tenants where slug = 'elliot');
select * from retention_preview();   -- check, then let workflow 43 run
```

- **getelliot.eu (`elliot` account):** the privacy policy promises "up to 12
  months after our last contact". Set 12 for this account once workflow 43 is
  imported. Demo sign-ups (`demo_requests`) older than the same period are
  deleted with it.
- **Agencies:** the period is the agency's decision as controller; agree it
  in their agreement and set it then (allowed: 3 to 120 months).
- The live demo pages clean up after 3 days (workflow 36), as the policy says.

Workflow 43 records each run's deletions in the activity log
(`privacy.client_erased`, reason `retention`) and any file it couldn't
remove as `retention_files_failed`, which the health alerts pick up.

## An agency leaves

1. Export anything they ask for (each client's copy, or ask for a database
   export of their rows).
2. Control panel → the agency → set **Status: Cancelled** → Save.
3. A **Delete this agency's data** panel appears. Type the agency's short name.
   It removes all their rows, their files in both buckets and the logins
   that belonged only to them. Your own login is never removed. One line
   stays in your activity log.
4. By hand: disconnect their Gmail/Calendar from n8n credentials if they
   were separate, remove their WhatsApp number, and delete n8n executions
   for them if needed.

Agree the timing in the agency contract (for example: data deleted within 30
days of the end of the contract, unless they ask for a copy first).
**Legal review.**

## Things erasure can't reach

| Where | What to do |
|---|---|
| n8n Executions | n8n Cloud keeps execution data for a limited time that depends on the plan. In n8n → each workflow's Settings you can choose not to save successful executions. At least know the retention period and write it here. |
| Google Calendar events | Listed after deletion; delete by hand |
| Gmail inboxes, Resend logs | The mail itself stays with the mailbox owner |
| CRM / ASARI | The agency deletes it there |
| Backups | If you keep your own dumps (see RELEASING.md), deleted data stays in them until they expire. Keep backups for a fixed period (e.g. 30 days) and say so. |
| The client's browser | Their own `localStorage`; they can clear it |

## Security measures (for the DPA's technical annex)

Already in place, described in `docs/security.md`: row-level security per
agency on every table, roles (admin, agent, viewer), two-step verification
for the control panel, support access only with the agency's permission and
logged, webhook secrets between the website, n8n and the dashboard, no keys
in the repository (checked on every pull request), HTTPS everywhere.
