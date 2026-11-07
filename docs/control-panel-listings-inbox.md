# Control panel, listings, team, inbox and daily summary

Added in November 2026. Everything here ships in one migration
(`db/migrations/0027_platform_listings_team_inbox.sql`), changes to
workflows 01, 10 and 24, one new workflow (31), the chat widget, and new
dashboard pages.

## What each part does

| Part | Where | Who sees it |
|---|---|---|
| **Control panel** | `/platform` | Platform admins only (`ADMIN_EMAILS`) |
| **Listings** | `/dashboard/listings` | Every agency |
| **Team** | `/dashboard/team` | Every agency (admins can change others) |
| **Inbox** + live chat takeover | `/dashboard/inbox`, conversation pages | Every agency |
| **Overview** (results first) | `/` | Every agency |
| **Daily summary email** | Workflow 31, 08:00 Europe/Warsaw | Agency admins by default |

### Control panel (`/platform`)
- Every agency with its account state: Free trial, Trial ended, Active,
  Past due, Complimentary, Suspended, Cancelled. Worked out from plan,
  status and dates (`lib/platform.ts`):
  - **Past due** = a paid plan whose *Paid until* date has passed.
  - A paid plan with no *Paid until* yet counts as Active.
- Last 30 days per agency: chats, leads, hot leads, viewings, **AI cost**,
  health problems (failed CRM syncs, tool errors, no listings, quiet for
  7+ days) and last activity.
- **Manage** an agency: plan, status, trial end, *Paid until* (with a
  "+1 month" button for recording a payment), monthly price, billing
  contact, private notes. Every change goes in the **Activity log**.
- **Suspended** or **Cancelled** switches Elliot's chat off for that agency
  straight away (workflow 01 only answers for `status = 'active'`).
- **Open their dashboard**: see the agency's dashboard exactly as they do,
  for up to 8 hours or until *Back to control panel*. A yellow banner shows
  while this is on. It works through `platform_admin_views` +
  `current_tenant_id()`, so RLS shows their data and nothing else.
- **Monthly revenue** = sum of monthly prices of Active agencies.

AI cost uses real token counts. Workflow 01 now adds up the tokens of every
Claude call in a reply and stores them in `ai_usage_daily`. The price per
million tokens comes from `AI_PRICE_INPUT_PER_MTOK` / `AI_PRICE_OUTPUT_PER_MTOK`
(USD, defaults 3 / 15). **Check Anthropic's current price for the model in
workflow 01 and set these in Vercel.** Counting starts once the new 01 is
imported; earlier replies show $0.

### Listings (`/dashboard/listings`)
- Add, edit, delete; status Available / Under offer / Sold / Let / Withdrawn.
- **Import CSV**: English or Polish column names, commas or semicolons,
  Polish number formats (`1 250 000`, `48,5`). A preview shows what will be
  imported and which lines are skipped and why. Rows whose reference already
  exists update that listing. There's a downloadable template.
- Elliot's new `search_listings` tool (workflow 01) searches **only
  Available** listings, with the filters the visitor gave (area, budget,
  rooms, size, sale/rent, a keyword). The prompt forbids inventing
  listings. Each time a listing is shown, its *Suggested* count goes up.

### Team (`/dashboard/team`)
- Invite by email (Supabase sends the invitation; the link opens
  `/reset-password` to choose a password). One person = one agency.
- Roles: Admin, Agent, Viewer. Only admins change others; nobody can
  demote the last admin.
- Per person: **Gets new leads** (round-robin), **Alerts** (escalation
  emails), **Daily summary**.
- **Round-robin**: a new lead without an owner goes to whoever has waited
  longest (`trg_leads_assign_round_robin`). Viewers never get leads.
- **Remove** deletes their login, releases their open leads and chats,
  and keeps the row (marked removed) so history still shows who did what.

### Inbox and live chat takeover
- **Inbox** lists chats that need a person (open escalations, chats a
  colleague is handling) and website chats active in the last 30 minutes.
  It refreshes itself every 15 seconds and works on a phone.
- On a website-chat conversation: **Take over this chat**. Elliot stops
  answering that chat (workflow 01 checks `assigned_human` through
  `log_user_message()` and returns `{reply: null, human: true}`). Your
  replies appear in the visitor's chat window within about 4 seconds. The
  widget polls `GET /api/widget/messages` on the dashboard while it's open.
  **Hand back to Elliot** when you're done. Elliot sees your messages
  as "[Team member]" and stays consistent with them.
- **Hot leads now email the right person.** Workflow 10 used to insert a
  hot-lead escalation silently; it now goes through workflow 24 like every
  other handover (reason `hot_lead`). Workflow 24 emails
  `escalation_recipients()`: the lead's owner (if they have alerts on), or
  everyone with alerts on if nobody owns it, plus the agency address from
  Settings. The email links straight to the conversation.

### Daily summary (workflow 31)
08:00 Europe/Warsaw, once a day (about 30 n8n executions a month). One plain
email per person: the last 24 hours' chats, new leads and viewings booked,
today's viewings, hot leads with phone numbers, and what's waiting. Admins
get it by default; anyone can switch it on or off in Team, and an agency
admin can switch it off for the whole agency.

## Setup, in this order

1. **Supabase**: run `db/migrations/0027_platform_listings_team_inbox.sql`
   in the SQL editor. It runs as one transaction and can be re-run.
   Optional check on a scratch database:
   `db/seed/test_0027_platform_listings_team_inbox.sql` (ends with
   "0027 checks passed", rolls everything back).
2. **Vercel** (dashboard project), optional:
   - `AI_PRICE_INPUT_PER_MTOK` and `AI_PRICE_OUTPUT_PER_MTOK` if the
     defaults (3 and 15) don't match the model's price.
   - `ADMIN_EMAILS` and `SUPABASE_SERVICE_ROLE_KEY` must already be set
     (they are, from earlier). The control panel needs both.

   Then redeploy.
3. **n8n**, re-import these workflows (Import from File over the existing
   ones, or delete the old one first), then for each:
   - **01 Main AI Agent**: open *Log User Message* (changed) and the two
     new Postgres nodes, *Search Listings* and *Log AI Usage*, and make sure
     each uses the **Elliot Postgres (service role)** credential. These
     database functions are deliberately not callable through the public
     API. Check *Execute: Escalate To Human Sub-Workflow*
     still points at 24.
   - **10 Lead Capture**: open *Escalate Hot Lead (24)* and pick
     "24 - Escalate To Human" in the workflow dropdown.
   - **24 Escalate To Human**: re-select the Postgres and Gmail
     credentials if n8n asks.
   - **31 Daily Summary Email** (new): pick the Postgres (service role) and
     Gmail credentials, then **Publish** it when you want summaries to
     start. It runs once a day.

   If the dashboard moves to its own domain, change `DASHBOARD_URL` at the
   top of the code in 24's *Build Notification Email* and 31's *Build
   Summary Email*.
4. **Website chat**: the widget served by the dashboard (`/widget.js`) has
   the takeover polling. Agencies using
   `<script src="https://<dashboard>/widget.js" ...>` get it automatically.
   The Elliot-web marketing site has its own chat component, so takeover
   replies don't appear there yet.

## Smoke test
1. `/platform` lists your agencies. Open one, change *Paid until*, save.
   The change appears in Activity log.
2. *Open their dashboard*. The yellow banner shows; *Back to control panel*
   ends it.
3. Listings → Import CSV → *Download a template* → import it. One listing
   appears.
4. In the website chat, ask "what flats do you have in Mokotów?". Elliot
   answers with that listing, and its *Suggested* count goes up.
5. Ask the chat for a human. The alert email arrives with a link. Open
   it, *Take over this chat*, reply. Your reply shows in the chat window,
   and Elliot doesn't answer the visitor's next message. *Hand back to
   Elliot*, and Elliot answers again.
6. In n8n, run workflow 31 once by hand. The summary email arrives.

## Limits worth knowing
- Billing is manual: dates and prices you enter. There's no card payment
  or invoicing yet.
- One person can belong to one agency.
- Takeover replies reach website chat (dashboard widget) and email.
  WhatsApp takeover isn't built.
- The widget polls only while the chat window is open. A visitor who
  closes it sees team replies when they open it again.
- The widget endpoint is public. It returns only team replies for the one
  conversation whose random id the visitor's browser holds, and only when it
  matches the agency.
