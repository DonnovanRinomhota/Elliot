# Roadmap / Feature Backlog

What's built, what's verified on the real stack, and what's next. The
newest work is under "November 2026" near the end; "Next" lists what to
pick up. Keep this file
in sync going forward: when an item is started, flip it to 🟡; when it's
actually built *and verified* (not just merged), flip it to ✅ and add a
one-line pointer to where it's proven (a `KNOWN_ISSUES.md` entry, a
workflow spec, "tested live", etc.), in the **same commit/PR** as the
feature -- not as a follow-up you might not get to.

Status legend: ✅ Done and verified · 🟡 Partial / has a real gap · ⬜ Not started

**Nov 2026 client-ready fix pack** (branch `fix/client-ready-pack`): automatic
CRM sync, automatic follow-up enrolment, calendar cleanup on cancel, auth on
internal webhooks, Meta signature check, and a lead-scoring bug fix. All of it
is verified against a real Postgres 16 + pgvector with every migration applied
(`db/seed/test_0026_auto_sync_and_enrolment.sql`), the Code-node logic is
unit-tested straight from the workflow JSON
(`n8n/workflows/tests/client_ready_fixes.test.js`), and the dashboard passes
`tsc`, a production build and its unit tests. **The live smoke test in
`docs/client-ready-setup.md` passed on 2026-11-01** on the real stack (n8n
Cloud, Vercel, Supabase, Google Calendar): webhook auth refusing calls
without the secret, onboarding, lead capture with CRM sync, booking and
cancel (calendar event removed, CRM updated), and a manually started
follow-up. Two pieces couldn't be covered by a 15-minute test and stay 🟡:
auto-enrol (needs a lead to go quiet for hours) and anything WhatsApp.
Production showed no runtime errors over the deploys and tests.

## Customer-facing channels

- ✅ **Web chat widget** (`apps/web-chat-widget`, in this repo). A single
  dependency-free `widget.js` (Shadow DOM, no framework runtime required
  on the host site), matching the real `chat` webhook's request/response
  contract. Unit-tested (jsdom + mocked fetch) covering mount, send,
  conversation-id persistence/threading, network-failure handling, and
  XSS-safety of rendered replies -- 30/30 assertions passing. Served
  automatically at `apps/elliot-dashboard/public/widget.js` via a
  `prebuild`/`predev` npm hook that copies the canonical source, so the
  two can't silently drift out of sync. Full round-trip confirmed live on
  a real third-party origin (GitHub Pages,
  donnovanrinomhota.github.io/Elliot-web) -- message sent, reached n8n,
  resolved the tenant, hit Anthropic's API, and a real reply rendered back
  in the widget with no console errors. This unblocks the two items below
  it, and unblocks selling Elliot as an "AI website assistant" rather than
  just an email agent.
- ✅ **Marketing site** (separate repo:
  [`DonnovanRinomhota/Elliot-web`](https://github.com/DonnovanRinomhota/Elliot-web)
  -- intentionally kept out of this monorepo, not a stray duplicate). The
  public-facing site for *finding* clients -- not something a pilot
  client's customers would ever touch. Built and deployed to Vercel
  (`elliot-web` project); the demo-request form and the chat widget are
  wired to the real n8n webhooks (Elliot-web PRs #1–#3, Sep 2026). This
  entry used to say "README only, nothing built" -- that was stale.
- ⬜ **Voice** (e.g. Retell or similar usage-based voice agent
  infrastructure). Not started.
- 🟡 **WhatsApp** (workflows `25`, `27`, `28`, `32`; migrations `0025`,
  `0032`, `0045`). Elliot answers each message instantly through workflow 01,
  like the website chat (0032; the old draft-and-approve path, 26, is
  retired). The team can take over a WhatsApp chat and reply from the
  dashboard (32). Reminders (`viewing_reminder`), alerts (`elliot_alert`) and
  follow-ups after 24 hours (`elliot_follow_up`, 0045) go as approved
  templates. Photos, voice notes, documents and locations are noted in the
  conversation but not opened yet. Meta's request signature is checked.
  Working on Meta's test number; waiting on Meta business verification and
  the agency's real number (needs the business registered). Set-up:
  `docs/whatsapp-setup.md`, `docs/whatsapp-follow-ups.md`.

## Dashboard / operator experience

- ✅ **Real analytics dashboard** (`/`) -- conversations, new leads,
  appointments, escalation rate, avg response time, activity/leads charts.
  Backed by a real Postgres RPC (`get_dashboard_overview_stats`).
- ✅ **Structured lead-scoring reasoning** (`/dashboard/leads`) -- each
  lead shows *why* it scored what it did, mirroring
  `10-lead-capture.json`'s actual scoring logic exactly.
- ✅ **Human takeover** (`/dashboard/conversations/[id]`) -- email
  replies, and live takeover of website chats (Elliot pauses, the widget
  polls for team replies), and WhatsApp chats (team replies go out
  through workflow 32). See
  `docs/control-panel-listings-inbox.md`.
- ✅ **Control panel** (`/platform`) -- every agency's account state,
  usage, AI cost, health; manual billing dates; "open their dashboard";
  activity log.
- ✅ **Listings** (`/dashboard/listings`) -- properties with CSV import;
  Elliot searches them with the `search_listings` tool.
- ✅ **Team, inbox, alerts, daily summary** -- invites, roles, round-robin
  lead assignment, escalation emails to the lead's owner, Inbox page,
  08:00 summary email (workflow 31).
- ✅ **Tenant onboarding UI** (`/dashboard/onboarding`) -- form wrapping
  workflow 19 exists and works. Route is gated to admins listed in
  `ADMIN_EMAILS` (`lib/admin.ts`), now enforced server-side too: the form
  posts to `app/api/admin/onboard`, which re-checks the admin list and
  calls workflow 19 with the shared webhook secret. Workflow 19 rejects
  calls without it (n8n Header Auth). Tested live 2026-11-01: a test
  tenant created from the page, and a call without the secret refused.
- ✅ **Knowledge base upload** (`/dashboard/knowledge`) -- pasted text, PDF,
  and website ingestion (PR #32). PDFs are parsed client-side in the
  browser via `pdfjs-dist` and submitted through the same pasted-text
  contract as before; website ingestion sends a `url` and workflow 08
  fetches and extracts readable text server-side (new `Is Website?` /
  `Fetch Website` / `Extract Website Text` / `Resolve Content` nodes,
  `documents.source_url` populated). Tested live 2026-09-21 end to end
  against the real stack (dashboard, n8n, Voyage, Supabase): a real PDF and
  a real URL were ingested, chunks were stored with embeddings, and the
  chat assistant answered from the ingested content. The extraction,
  chunking, and website-stripping logic was also checked ahead of that
  against purpose-built test files (multi-page PDF with Polish characters,
  an image-only PDF, and an HTML page with script/style/comment markers).
  Known gaps, documented in `docs/workflow-specs/08-knowledge-ingestion.md`:
  scanned/image-only PDFs fail (no OCR); website extraction is regex-based
  and breaks on JS-rendered pages (would need a headless browser); no
  de-duplication, so re-ingesting the same content creates duplicate
  documents and chunks; and a run that fails partway (for example n8n's
  execution limit or a Voyage error) leaves the document stuck in
  `processing` rather than marking it `failed`.
- ✅ **AI Revenue / ROI dashboard.** `tenants.avg_deal_value` (tenant-set,
  Settings page) drives `get_revenue_dashboard_stats()`
  (`0024_revenue_dashboard_stats.sql`), showing estimated pipeline
  (qualified leads × avg deal value) and estimated closed value (converted
  leads × avg deal value) as a banner on the Overview page. Returns null
  estimates, not zero, until a tenant actually sets a value -- never
  invents a number. Verified live against real Supabase data. No currency
  field exists anywhere in the schema, so the figure is shown unlabeled
  (assumed to match whatever the tenant is thinking in) -- fine for a
  single-currency pilot, would need a real currency field before this
  means anything with multiple tenants in different countries.
- ✅ **Follow-up sequence configuration UI** (`/dashboard/follow-ups`) --
  create, edit, activate/deactivate, and delete sequences without SQL. Each
  step is a day, Email or WhatsApp (0045), subject (email only) and message,
  saved in the same `steps` shape workflow 20 reads. Only `{{contact_name}}` is substituted by the sweep, so
  any other placeholder is rejected before saving (it would otherwise be sent
  to the contact literally), and steps are saved sorted by day because the
  sweep indexes them by position. Validation is unit-tested (`npm test` in
  `apps/elliot-dashboard`, 14 cases), the UI was exercised in a browser with
  the Supabase calls intercepted, and it was tested live 2026-09-21 end to
  end against the real database with RLS: a sequence created and edited in
  the dashboard, a test lead enrolled through workflow 21, and the sweep run
  against it. Known behaviours, all documented in
  `docs/workflow-specs/20-follow-up-sweep.md`: deactivating only blocks new
  enrolments, since the sweep doesn't filter on `is_active` and in-flight
  runs finish; a run can still advance on schedule even if a pending draft
  wasn't approved yet; and editing steps under in-flight runs can skip or
  repeat a message, because runs track progress by step position (the
  editor warns about this).
- 🟡 **Automatic follow-up enrolment** (migration `0026`, workflow `29`,
  `/dashboard/follow-ups`, `/dashboard/leads`). One sequence per tenant can
  be set to auto-enrol: leads created after it's switched on that go quiet
  for N hours (12h–7 days) are enrolled, unless they've booked a viewing,
  are Converted/Lost, can't be reached (no email and no WhatsApp chat,
  0045), or were in that sequence before. Staff
  can also Start / Stop a follow-up on any lead from the Leads page. All
  enrolment rules tested in SQL (see the fix-pack note above), including
  "switching it on never back-fills old leads" and RLS on the dashboard's
  writes. Start / Stop follow-up tested live 2026-11-01. Remaining: the
  first real auto-enrolment by workflow 29 (needs a lead to stay quiet for
  the configured hours). See
  `docs/workflow-specs/29-auto-enrol-follow-ups.md`.
- ✅ **Automatic CRM sync** (migration `0026`, workflow `23`). Contacts,
  leads and appointments queue a CRM sync on create and on meaningful
  change -- including dashboard edits like "Mark CONVERTED" or Cancel --
  for tenants with a `crm_webhook_url`. Lead and appointment payloads now
  embed the contact. Tested live 2026-11-01: contact, lead and cancelled
  appointment payloads all arrived at the receiver. Still one-way (CRM → Elliot changes don't come back). See
  `docs/workflow-specs/22-crm-sync.md`.
- ✅ **Cancel removes the Google Calendar event** (workflow `30`,
  `app/api/appointments/[id]/cancel`). Falls back to an Elliot-only cancel
  with a visible warning when the webhook isn't configured. Tested live
  2026-11-01 against Google Calendar. No reschedule flow and no cancellation email
  to the contact. See `docs/workflow-specs/30-cancel-appointment.md`.
- 🟡 **Self-serve signup + forgot/reset password** (PR #35, Sep 2026).
  "Create Business" on the login page creates the tenant, its `ai_config`
  and the first admin user. Built and merged; a live test isn't recorded
  here yet.

## Reliability (tracked in detail in `KNOWN_ISSUES.md`)

- ✅ Orphaned Google Calendar event on a booking collision -- fixed with a
  compensating delete, tested live against a real double-booking.
- ✅ Onboarding page access control -- route gated, server route
  re-checks, n8n webhook requires the shared secret. Tested live
  2026-11-01. All internal webhooks (08, 17, 19, 21, 22, 28, 30) now use
  the same Header Auth and are only called from the dashboard's server;
  see `docs/workflow-specs/internal-webhook-auth.md`.
- ✅ Lead scoring wrote `QUALIFIED` for scores 40–69, which
  `leads_status_check` rejects, so those leads never saved. Workflow 10 now
  writes `WARM`. Unit-tested from the workflow JSON; leads saved live in
  the 2026-11-01 smoke test.
- 🟡 WhatsApp inbound (25) now verifies Meta's `X-Hub-Signature-256`.
  Unit-tested with real HMACs; pending a live Meta number (same as the rest
  of WhatsApp).
- 🟡 **Health checks and alerts** (workflows 33/34, migration 0036) -- every
  15 minutes checks Claude, Voyage, Gmail, Calendar, WhatsApp and the
  database, plus failures logged by other workflows; alerts by email (Resend,
  Gmail fallback) and WhatsApp template, each switchable, for the platform
  (Control panel → Health & alerts) and per agency (Settings → Problem
  alerts). `/webhook/health` for an uptime monitor. Unit- and DB-tested
  (`health_alerts.test.js`, `test_0036_health.sql`); pending live import.
  Spec: `docs/workflow-specs/33-health-check.md`.

- 🟡 **getelliot.eu split: sales assistant, call booking, live demo**
  (0037, workflows 01/11/12/18 changed, 35/36 new, Elliot-web /book and
  /demo). Accounts now have a mode: agency (unchanged, verified byte-for-byte
  against the previous prompt and tools), sales (Elliot's own chat, 15/30-min
  Google Meet calls) and demo (sample agency, DEMO emails, 3-day clean-up).
  Unit- and DB-tested (`sales_demo.test.js`, `test_0037_sales_demo.sql`),
  website flows tested in a browser against mocked webhooks; pending live
  import. Spec: `docs/website-sales-and-demo.md`. Also fixed: workflow 18
  notified an old hard-coded address; `ai_config.business_hours` had no
  migration.

- 🟡 **Reminders and changes by message** (0038, workflows 37/38, 01/11
  changed). Clients confirm, move or cancel their own bookings by message
  (tool change_viewing; only their own, enforced in the database), reminders
  at 17:00 for tomorrow (WhatsApp template or email, logged into the
  conversation), and a minimum notice and buffer between viewings
  (Settings → Viewings). Dashboard shows client confirmed / moved / cancelled /
  reminder sent. Unit- and DB-tested (`viewing_changes.test.js`,
  `test_0038_viewing_changes.sql`); pending live import and the
  `viewing_reminder` template. Spec: `docs/workflow-specs/37-38-viewing-changes-reminders.md`.
  The old limit (two agents couldn't have viewings at the same time) is gone
  since 0042: the no-overlap rule is per calendar.

- 🟡 **Lower running costs** (workflow 01). Prompt caching on tools,
  instructions and the conversation (re-reads at 0.1x the price), cached
  tokens logged at their real cost, and plain thank-yous ("thanks", "dziękuję", 👍)
  answered without calling Claude (never after a question or a reminder).
  Dashboard AI cost now uses Sonnet 5 prices ($2 / $10 per million). Tested in
  `token_savings.test.js`; pending live import.

## November 2026: agencies, sellers, ASARI, files

Each is unit- and database-tested (`db/seed/test_00NN_*.sql`,
`n8n/workflows/tests/`); "live" means used on the real stack.

- ✅ **Agency email addresses** (0039, workflows 39/40). Each agency gets
  `<slug>@in.getelliot.eu`, forwards its inbox there (any provider), and
  Elliot replies in the client's thread in the agency's name via Resend.
  Working live. `docs/agency-email.md`.
- ✅ **Control panel two-step sign-in and support access** (0040/0041). The
  Elliot team opens an agency's dashboard only with two-step sign-in and,
  when the switch is on, the agency's permission; every visit is listed for
  the agency. Switch currently **off** for testing: turn on before the first
  paying agency. `docs/support-access.md`.
- ✅ **Agents' own Google Calendars** (0042, workflows 11/12/30/41). Viewings
  go into a free agent's calendar (the client's own agent first); the Team
  page checks each calendar is shared correctly. `docs/agent-calendars.md`.
- 🟡 **Sellers and landlords** (0043). Valuation requests, seller leads
  (hot within 3 months), valuation visits at the property. Pending the first
  live seller. `docs/valuations.md`.
- ✅ **AI disclosure** (EU AI Act art. 50). The chat header and Elliot's
  first WhatsApp/email reply say clients are talking to an AI assistant.
- 🟡 **ASARI CRM listings** (0044, workflow 42). Hourly copy of the
  agency's exported ASARI listings, Sync now in Settings. Pending the first
  real agency's credentials: check the field mapping then.
  `docs/asari-sync.md`.
- 🟡 **Follow-ups by WhatsApp** (0045, workflows 20/27). Pending Meta's
  approval of `elliot_follow_up` for steps after 24 hours.
  `docs/whatsapp-follow-ups.md`.
- 🟡 **Email attachments** (0046, workflows 01/16/40). Files kept in a
  private bucket and shown on the conversation; Elliot reads PDFs and photos.
  Pending the first real email with files. `docs/email-attachments.md`.

- 🟡 **Security review** (0047, workflows 01/16/25/37/40, dashboard). Public
  key locked down, roles enforced in the database, public chat can't pose
  as email or WhatsApp, booking approval enforced. Tested on a scratch
  database and from the workflow files; pending roll-out. `docs/security.md`.

- 🟡 **Reliability review** (0048, workflows 01/20/23/25/39 and retries in
  eight more). Claude retried with a holding reply and escalation when it
  can't answer; crashed tools never reported as done; follow-up steps and
  emails can't be sent twice; STOP for follow-ups; failed WhatsApp deliveries
  recorded. Tested on a scratch database and from the workflow files;
  pending roll-out. `docs/reliability.md`.

- 🟡 **Release checks** (0049, GitHub Actions, `RELEASING.md`). Every pull
  request in both repos runs tests, types, lint, builds, a key scan, every
  migration on a fresh database, every SQL query in the workflows against it,
  and seven customer journeys. `migration_status()` shows which migrations
  Supabase has. Pending: run 0049; set the missing Vercel variable.

- 🟡 **Trials, onboarding and monitoring** (0050, workflow 01, control
  panel). "Start trial" at go-live; when it ends Elliot pauses (one holding
  reply a day, nothing sent on its own). Go-live checklist per agency from
  their real data. Problems page and per-agency failures, calendar problems
  and AI cost against price. Agencies see a trial banner. `docs/onboarding.md`.

## Next

- Workflow 16 (Gmail) answers only the first of several emails that arrive
  in the same minute; make it handle each one.
- WhatsApp: open photos and documents clients send (like email attachments).
- Elliot could prefer fresh ASARI listings when suggesting properties.
- Outlook / Microsoft 365 calendars; phone calls (voice).

## Business / non-code

The full list of what blocks the first paying agency (technical,
administrative, legal) is `docs/business-readiness.md`.

Not something to build -- these are decisions, listed here so they don't
get lost either:

- Pricing: one plan for estate agencies, from €199 a month plus setup from
  €500 (net), confirmed in writing per agency (shown on getelliot.eu).
- Register the business (NIP), then Meta business verification and the real
  WhatsApp number.
- Competitive positioning: lean into "bring your own website/CRM/calendar,
  Elliot operates the front office" rather than competing feature-for-
  feature with vertical-specific players like Ylopo or Structurely.
- Keep the product narrative to one coherent story (Talk / Understand /
  Convert / Book / Follow up / Sync / Escalate / Measure) rather than
  listing 20 disconnected features -- worth revisiting once there's a real
  second tenant to sanity-check positioning against.
