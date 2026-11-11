# Security and agency isolation

How Elliot keeps one agency's data away from another, who may do what, and
what the November 2026 security review found and fixed (migration `0047`,
workflows 01 / 16 / 25 / 37 / 40, dashboard).

## The model

| Who | How they reach the data | What they can do |
|---|---|---|
| A visitor on an agency's website | The public `/chat` webhook (workflow 01) and the property page `/p/<id>` | Talk to Elliot as "website chat". Nothing they send can change the channel, attach files or prove who they are. |
| Someone with only the public Supabase key (`anon`) | Supabase API | `public_listing(id)`: one available listing. No tables, no other functions. |
| An agency's **viewer** | Dashboard (Supabase API, signed in) | Read their own agency. No changes at all. |
| An agency's **agent** | Dashboard | Read and work their own agency's leads, conversations, viewings, listings, drafts. Cannot change the team, settings or connected services. |
| An agency's **admin** | Dashboard | As agent, plus settings and team (team changes go through server routes). Cannot change plan, status, slug or prices. |
| A removed team member | – | Nothing: their sign-in no longer resolves to an agency. |
| Platform admin (`ADMIN_EMAILS`, confirmed address, two-step sign-in) | Control panel; an agency's dashboard only with its support access | Acts as that agency's admin while access is on; every part opened is logged for the agency. |
| n8n and the dashboard's server routes | Postgres as service role | Everything. RLS doesn't apply, so each workflow passes the agency ID it loaded itself, never one from the request. |

Rules the database enforces (not the dashboard):

- **RLS on every table**, by `current_tenant_id()`. For signed-in users that
  is their own agency (or the one a platform admin is viewing); the
  `app.current_tenant` setting is ignored for API users.
- **`anon` has no table access** and may run one function. New functions are
  not callable by `anon` by default (default privileges changed in 0047).
- **Functions that take an agency ID are service-role only.** The dashboard
  calls functions that work out the agency from the signed-in user.
- **Cross-agency links are refused** by a trigger (`enforce_same_tenant`): a
  message can't be put in another agency's conversation, a viewing can't
  point at another agency's contact or listing, and so on, whoever writes it.
- **Viewers can't write** (`block_viewer_writes` trigger on every agency table).
- **Logs are read-only** for agencies: audit log, tool-call log, AI usage, CRM sync log.

## What the review found (all reproduced on a scratch database, all fixed)

| Severity | Finding | Fix |
|---|---|---|
| Critical | Helper functions written for n8n (`get_ai_config`, `get_conversation_history`, `get_or_create_conversation`, `log_message`, `insert_escalation`, `match_document_chunks`, …) could be called through the Supabase API with only the public key and any agency's ID: read its prompt and conversations, add messages, create escalations. | 0047 §1: revoked from `anon` and signed-in users. |
| High | Any team member could make themselves admin, remove an admin or add users, by writing `tenant_users` directly. | 0047 §3: team is read-only through the API; changes only through the admin-checked routes. |
| High | Any team member could change their agency's status, plan and slug, and every Elliot setting, including the CRM webhook address that client data is sent to. | 0047 §3: only admins update settings; only name, industry, time zone and deal value on the agency row. |
| Medium | A removed team member's session still resolved to the agency. | 0047 §2. |
| Medium | "Viewer" was a label only. | 0047 §3. |
| Medium | Records could reference another agency's records; a website visitor who knew another agency's conversation ID could continue that conversation under their own agency. | 0047 §4. |
| Medium | Agencies could edit their own logs and usage counters. | 0047 §3. |
| High | The public `/chat` webhook accepted `channel: "email"` / `"whatsapp"` and attachments from anyone, so a stranger could pose as a verified email or WhatsApp client. | Workflow 01: a second, secret-protected webhook `/chat-internal` for 16, 25 and 40. The public one is always website chat. |
| High | On the website chat a visitor only types their email or phone. Typing a client's address showed that client's upcoming viewings and let the visitor cancel or move them, and rename the contact. | 0047 §5 + workflows 01 and 37: an unverified visitor only sees and changes viewings booked in the same conversation; names are only changed for the conversation's own contact. |
| Medium | "Book appointments: Needs approval" in Settings did nothing; Elliot booked anyway. | Workflow 01: when set, Elliot does not book. The request goes to the team as a high-priority hand-over and the client is told it is requested, not confirmed. |
| Medium | The sign-in page let anyone create an agency (and so run Elliot on our accounts). | Off unless `NEXT_PUBLIC_SELF_SIGNUP_ENABLED=true`. |
| Low | An address listed in `ADMIN_EMAILS` but not yet registered could be registered by someone else. | Control panel requires a confirmed address (as well as two-step sign-in). |
| Low | Settings showed "Saved" to non-admins. | Read-only for non-admins; a refused save says so. |
| Low | "Send email replies" approval switch did nothing (email is answered instantly since 0035). | Removed from Settings. |

Checked and found sound: dashboard API routes take the agency from the
session, never from the request; inbound email is fetched from Resend by ID
rather than trusted from the webhook body; Meta's signature is verified on
WhatsApp; Elliot's tools use the agency ID loaded by the workflow.

## Tests

- `db/seed/test_0047_tenant_isolation.sql`: two agencies; an anonymous
  caller, an agent, an admin, a viewer and a removed member each try to
  read and write what they shouldn't. It also fails if any table lacks RLS,
  if `anon` gains a grant, or if a signed-in user can run a function that
  takes an agency ID. **Run it after every new migration.**
- `n8n/workflows/tests/security_hardening.test.js`: the two chat webhooks,
  channel spoofing, booking approval, contact identity.

Both run on a scratch database / from the workflow files. They don't touch
production.

## Putting it live (order matters)

1. **Before anything:** in the dashboard open Settings → "What Elliot may do
   on its own" for each live agency. "Book viewings" now does what it says.
   To see what is saved (read-only):
   ```sql
   select t.name, ac.autonomy_rules from ai_config ac join tenants t on t.id = ac.tenant_id;
   ```
   `{}` or no `book_appointment` entry means Elliot books by itself, as before.
   `"book_appointment": {"mode": "approval_required"}` means it will stop
   booking and hand requests to the team once workflow 01 is imported.
2. Supabase → SQL Editor: run `db/migrations/0047_security_hardening.sql`.
   It is safe to run twice. The dashboard keeps working; the old workflows
   keep working (0047 keeps the functions n8n calls, with defaults for the
   new parameters).
3. n8n: import **01** first (open it → ⋯ → Import from File). On the new
   node "Chat Webhook (Internal)" choose the credential
   **Elliot Internal Webhook Secret**. Save, check it is active.
4. n8n: import **16, 25, 40** and on each "Ask Elliot" node choose
   **Elliot Internal Webhook Secret**; import **37**. Re-select the other
   credentials each import asks for, as usual.
5. Vercel: nothing to add. (Leave `NEXT_PUBLIC_SELF_SIGNUP_ENABLED` unset.)
6. Check: a website chat answers; an email and a WhatsApp message get a
   reply; `curl -X POST <n8n>/webhook/chat-internal` without the header is
   refused (401/403).

Between steps 3 and 4 email and WhatsApp still arrive through the public
webhook and are treated as website chat for a few minutes (replies still go
out; attachments are not read). Do 3 and 4 in one sitting.

## Recommended outside the code

- Supabase → Authentication → Sign In / Providers: turn **off** "Allow new
  users to sign up" (team members are invited by the server) and keep
  "Confirm email" on.
- Supabase → Authentication: leaked-password protection on.
- Rotate the internal webhook secret and service-role key if either was ever
  pasted somewhere outside n8n / Vercel.

## Known limits

- Agents can delete their own agency's leads, contacts and listings. That is
  a product decision, not a leak; say if deletes should be admin-only.
- On the website chat Elliot still can't know who a visitor is. They can
  book a viewing under any email address; they can no longer see or change
  anyone's existing viewings.
- Secrets used inside n8n Code nodes are pasted into the node (n8n Cloud
  Starter has no variables). They are not in this repository; anyone with
  n8n editor access can read them.
