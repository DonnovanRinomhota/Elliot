# Before the first paying agency

What still stands between Elliot and a paying customer, split by who can fix
it. As of 12 Nov 2026. "Technical" means code or configuration; the other
two need you, a company registration, or a lawyer.

## Blockers

### Technical (configuration you can do now)

| | What | Why it blocks | How |
|---|---|---|---|
| T1 | **Backups** | Supabase Free has no restorable backups. One bad migration or mistaken delete loses every agency's data. | Move to Pro, or own dumps before each migration and weekly ([RELEASING.md](../RELEASING.md#backups)). Try one restore. |
| T2 | **Retention running** | The privacy policy promises deletion after 12 months; nothing deletes until set. | Run 0051, import workflow 43, set `retention_months = 12` for the `elliot` account after `retention_preview()` ([data-protection](data-protection.md#keeping-data-only-as-long-as-needed-retention)). |
| T3 | **n8n execution data** | Executions store client messages; their retention isn't known or documented. | Check the plan's execution retention in n8n Cloud; turn off saving successful executions where you don't need them. Write the period in data-protection.md. |
| T4 | **Support access permission** | Testing mode lets you open any agency's dashboard without their permission. | Control panel → Agencies → require permission, before real clients ([support-access](support-access.md)). |
| T5 | **Google OAuth app in production** | An unverified Google app shows a warning screen, is limited to test users and its tokens can expire after 7 days in testing mode. | Google Cloud Console → OAuth consent screen → publish; verification for Gmail/Calendar scopes may be required. Not verified from here. |
| T6 | **Per-agency credentials** | Each agency's Gmail/forwarding address, calendars shared with Elliot, CRM webhook or ASARI key. | The go-live checklist on the agency's control-panel page ([onboarding](onboarding.md)). Never paste them in chat or the repository. |

### Administrative (you)

| | What | Depends on |
|---|---|---|
| A1 | **Register the business (NIP)** | Needed to invoice, for Meta business verification and to be named in contracts. |
| A2 | **Meta business verification + real WhatsApp number** | A1. Until then WhatsApp runs on the test number ([whatsapp-setup](whatsapp-setup.md)). |
| A3 | **Invoicing** | A1. How you bill the monthly price and setup fee. |
| A4 | **A support address** | A mailbox agencies write to, that you read daily. (Not shown on the website, per your choice; give it to agencies in their agreement.) |

### Legal (needs a lawyer; not decided by this document)

| | What |
|---|---|
| L1 | **Agency agreement** with the data processing agreement (umowa powierzenia, GDPR Art. 28): subject, duration, data types, security measures (see the annex list in data-protection.md), subprocessors and how you notify changes, deletion at the end, breach notification timing, audits. |
| L2 | **Review of the privacy policy and terms on getelliot.eu**, in both languages. Engineering checked that they match what the system does (12 Nov 2026); not that they are legally sufficient. |
| L3 | **Transfers to US providers** (Anthropic, Voyage AI, Resend; possibly others): confirm each one's DPA and transfer basis. |
| L4 | **AI disclosure**: Elliot says it is an AI in its replies and on the website. Check this against the EU AI Act transparency duties that apply from August 2026 and any Polish requirements. |
| L5 | **Marketing consent**: follow-ups and re-engagement messages to an agency's clients. Who collects consent, and how a client opts out (they can reply to stop; `follow_up_opt_out_at` is recorded). Electronic marketing rules in Poland (Prawo komunikacji elektronicznej) may require prior consent. |
| L6 | **A paragraph for agencies' own privacy policies** naming Elliot as processor and the widget's browser storage. |

## Answering a customer (support procedure)

1. Agencies write to the support address (A4) or tell you directly.
2. Reply the same working day, even if only "seen, looking".
3. To look at their dashboard: they grant support access in Settings →
   Support access; you use **Open their dashboard**. Every page you open is
   recorded in their activity log.
4. Check **Control panel → Problems** for that agency first: most issues
   (a calendar Elliot can't book, an email that couldn't be sent) are listed
   there with what to do.
5. Close by telling them what happened and what changed.

Data requests from their clients: they do these themselves (data-protection.md).
If they can't, do it with their written request, through view-as.

## When something breaks (incident response)

**Signals:** health alert email/WhatsApp (workflow 33), Control panel →
Health and Problems, n8n Executions (red runs), an agency telling you.

1. **Stop the harm.** If Elliot is replying wrongly to clients: deactivate
   the workflow in n8n (01 for all channels, or 16/40 for email only, 25 for
   WhatsApp). Clients' messages wait in the dashboard; nothing is lost.
   If one agency only: set its status to Suspended in the control panel.
   Elliot then stops answering that agency's clients (no reply at all,
   unlike an ended trial) and its follow-ups and reminders stop.
2. **Find the cause.** The Problems page and the failing n8n execution.
   A dashboard deploy can be rolled back in seconds (RELEASING.md §3).
3. **Fix and release** the usual way (pull request, checks, release order).
4. **Tell the affected agencies** what happened and when it was fixed.
5. **Personal data breach** (data seen by someone who shouldn't, lost, or
   changed): this is different from an outage.
   - Write down at once: what, when found, which agencies, which data, how
     many people.
   - Tell the affected agency **without undue delay** (they are the
     controller and have 72 hours to notify UODO, GDPR Art. 33). The exact
     time you promise belongs in the DPA (L1).
   - For getelliot.eu's own visitors you are the controller: you decide
     whether to notify UODO within 72 hours. **Legal review** of the process.
   - Keep the record even if no notification is needed (Art. 33(5)).
6. **Write it up** in KNOWN_ISSUES.md: cause, fix, what prevents a repeat.

Secrets: if a key may have leaked (it appeared in a log, chat or commit),
rotate it at the provider first, then update Vercel and n8n.

## Backup and recovery

See [RELEASING.md → Backups](../RELEASING.md#backups). In short: no restorable
backups on the Free plan; take your own or move to Pro (T1). Files in
Storage are never in database backups; their loss means asking clients to
send them again. Write down where backups are kept and test a restore once.

## Already done in code

- Agency isolation, roles, viewer read-only, platform two-step login,
  logged support access, no self-signup (docs/security.md).
- Retries, failure recording, health alerts, Problems page (docs/reliability.md).
- Trials that pause, go-live checklist (docs/onboarding.md).
- Client copy and deletion, retention, agency deletion (docs/data-protection.md).
- Checks on every pull request; release steps (RELEASING.md).
