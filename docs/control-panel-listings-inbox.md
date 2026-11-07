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
- Add, edit, delete; status Available / Under offer / Sold / Let / Withdrawn;
  **Available from** date (0028) for rentals advertised before they're free.
- **Photos** (0029): up to 20 per listing, uploaded from the listing's page
  (shrunk in the browser to about 1600 px first), reordered with arrows; the
  first is the cover shown in the list. Stored in the public Supabase Storage
  bucket `listing-photos` under `<agency id>/<listing id>/`, and only the
  agency's own users can add or delete files there. A photo can also be a
  link to an image hosted elsewhere.
- **Photos from Google Drive folders**: when a listing's link is a shared
  Drive folder (as in most agency spreadsheets), Elliot reads the folder with
  the Google Drive API and shows its photos, with no uploading. The photos
  stay in Drive; Elliot stores a link to each (`lib/google-drive.ts`).
  - Runs by itself right after an import, and from the banner on the Listings
    page ("Get photos from Drive" for listings without photos, "Re-check all
    folders" after photos were added to folders). Works in batches of 20
    listings, so 10,000 listings is just a longer progress bar (roughly
    5-10 minutes per 1,000; keep the page open).
  - One listing: "Get photos from the Drive folder" on its page.
  - Takes images in the folder and one level of subfolders, in name order,
    up to 20. Photos uploaded in Elliot stay first, so a chosen cover stays
    the cover.
  - The folder must be shared as "Anyone with the link". Folders that aren't
    are listed with the fix.
  - Needs `GOOGLE_DRIVE_API_KEY` in Vercel (see Setup).
- The list is numbered (first added = 1) and shows 12 per page (they have
  photos). Every other list in the dashboard is numbered too and shows 20
  per page. Page titles and status tabs (All / Open / Resolved…) stay at
  the top while you scroll.
- **Import from any file** (Listings → Import):
  - **Excel (.xlsx) and CSV**: the header row is found automatically (even
    under a title or merged cells), and counter/summary rows are dropped. If the
    column names are recognisable (English or Polish, or Elliot's template),
    they're matched directly. Otherwise Claude is shown the headers and about
    a dozen sample rows (not the whole file) and returns a *recipe*: which
    column is the price, how to build the title, which codes mean what, which
    columns are internal and must be left out. Code then applies that recipe to
    every row (`lib/listings-import.ts`), so a 1,000-row sheet takes one AI
    call. The person sees how each field was read, the assumptions, and the
    columns left out, before importing. There's a "Let Elliot read it" button
    if header matching got it wrong.
  - **PDF, Word (.docx), text or pasted text**: Claude reads the text in parts
    of about 6,000 characters and returns the listings it finds. Scanned PDFs
    and photos can't be read yet.
  - Everything goes through the same checks as a listing typed in by hand,
    and a preview. Rows with problems are listed with the row number and reason.
  - Re-importing updates listings with the same reference. Tick "This file is
    my full list" to withdraw listings (with a reference) that aren't in the
    file. Listings added by hand are never touched.
  - Needs `ANTHROPIC_API_KEY` in Vercel for the AI parts. Files that match by
    column names work without it.
- Elliot's `search_listings` tool (workflow 01) searches **only
  Available** listings, with the filters the visitor gave (area, budget,
  rooms, size, sale/rent, a keyword, move-in date). The prompt forbids
  inventing listings. Without a move-in date, only listings free within 60
  days are offered; Elliot says "available from …" when it isn't free yet.
  Each time a listing is shown, its *Suggested* count goes up.

### Viewings: property, agent and calendar (0030)
- Every appointment can be linked to the **listing being viewed** and the
  **agent doing the viewing**:
  - Elliot passes the listing when it books (`book_appointment` now takes the
    `listing_id` that `search_listings` returned; workflows 01 and 12).
  - Otherwise a listing reference in the booking notes (e.g. "W-101") is
    used, if exactly one listing matches.
  - The agent defaults to whoever owns the client's lead (round-robin).
  - Both can be changed on the appointment's page.
- **Appointments** shows each viewing's cover photo, title, address and
  agent, with an *Agent* filter and a **List / Calendar** switch. The
  calendar is a month grid (phone: a list of days).
- **An appointment's page** (click the client or the property) has the
  photos, address with *Open in Google Maps*, price and size, the client's
  phone and email, the conversation with Elliot, the agent picker and the
  booking notes. If Elliot didn't record a property, you pick it there.
- **Calendar** (`/dashboard/calendar`): week by week.
  - *My calendar* is the default for team members. *Whole team* shows a
    row per agent and a column per day; any one agent or *Unassigned* can be
    picked too.
  - *Coming weeks* shows how many viewings each of the next six weeks has.
  - Cancelled viewings are left out.
- New Google Calendar events get the address as their location, the
  property and agent in the description, and the agent as a guest (if the
  client's lead has an owner). Changing the agent in the dashboard later
  doesn't change the Google event.
- The Overview's *Viewings today* shows the property and agent, and opens
  the viewing.

### Who you're talking to (0031)
- **Website chat needs a name plus an email or phone before Elliot answers.**
  The chat window (dashboard `widget.js` and the Elliot-web site) shows a
  short form first and sends the details with every message. Workflow 01
  saves them (`identify_chat_visitor`), links the chat to the contact, tells
  Elliot who it's talking to (so it doesn't ask again), and replies
  `needs_contact: true` without answering if they're missing, so an old or
  hand-made client can't skip it.
- **WhatsApp** gives the phone number and profile name; **email** gives the
  address and the sender's display name (workflow 16 now saves it). If the
  name is still unknown, the drafted reply (workflows 14 / 26) ends by asking
  for it; anyone in the team can then fill it in.
- **Contact panel** on a conversation: *Edit* (or *Add details*) to fill in or
  correct the name, email and phone. It stays on screen while the messages
  scroll, and the page title stays at the top.
- Contacts are matched by email (any case) and by phone (digits only, so
  "+48 601 234 567" and "48601234567" are the same person), through one
  database function used by workflows 01, 10, 16 and 25. Lead capture (10)
  now links the contact to the conversation too, so chats no longer show as
  "Unknown contact". Where there's no name, the email, phone or channel is
  shown ("Website visitor", "WhatsApp contact", "Email sender").
- **Repeated visitor messages**: workflow 01 saved each visitor message once
  per earlier message in the chat (so the 8th message was saved 8 times).
  Fixed (*Log User Message* runs once), and 0031 deletes the existing copies
  (same chat, same text, within 10 seconds of the first).

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
   Then `db/migrations/0028_listings_available_from.sql`,
   `db/migrations/0029_listing_photos.sql` and
   `db/migrations/0030_appointment_listing_and_agent.sql` and
   `db/migrations/0031_chat_contacts_and_duplicate_messages.sql` (same way;
   0031 prints how many duplicate messages it removed). 0029
   creates the `listing-photos` storage bucket and its access rules; check it
   appears under Supabase → Storage. 0030 also fills in the property and
   agent on existing appointments where it can.
2. **Vercel** (dashboard project):
   - `ANTHROPIC_API_KEY`: an Anthropic API key for the "read any file"
     listings import (console.anthropic.com → API keys; can be the same key
     n8n uses). Mark it Sensitive. Optional: `ANTHROPIC_MODEL` (defaults to
     the model workflow 01 uses).

   - `GOOGLE_DRIVE_API_KEY`: lets Elliot read photos from shared Google
     Drive folders. In Google Cloud Console (the project n8n's Gmail
     connection uses is fine): APIs & Services → Library → **Google Drive
     API** → Enable; then Credentials → Create credentials → API key; edit
     the key → API restrictions → Restrict key → Google Drive API → Save.
     Leave "Application restrictions" as None (Vercel has no fixed address).
     Mark it Sensitive in Vercel. Free within Google's normal quota.

   Optional:
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
   - **12 Book Appointment** (changed in 0030): re-select the Postgres
     credentials (*Load Tenant + Contact Info* = service role, *Insert
     Appointment* = RLS-scoped, as before) and the Google Calendar
     credential if n8n asks. Re-import **01** too: *Execute: Book
     Appointment Sub-Workflow* must still point at 12.
   - **24 Escalate To Human**: re-select the Postgres and Gmail
     credentials if n8n asks.
   - **0031 (chat contacts)**: re-import **01, 10, 14, 16, 25 and 26**. The
     new *Identify Visitor* node in 01 and every *Upsert Contact* node use the
     **Elliot Postgres (service role)** credential.
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
