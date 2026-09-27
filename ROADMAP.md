# Roadmap / Feature Backlog

Tracks everything from the original 10-phase build (see root `README.md`'s
"Development approach" for that) plus a second wave of ideas that came out
of an external product review, re-audited against the real codebase before
being logged here -- nothing on this list is taken on faith. Keep this file
in sync going forward: when an item is started, flip it to 🟡; when it's
actually built *and verified* (not just merged), flip it to ✅ and add a
one-line pointer to where it's proven (a `KNOWN_ISSUES.md` entry, a
workflow spec, "tested live", etc.), in the **same commit/PR** as the
feature -- not as a follow-up you might not get to.

Status legend: ✅ Done and verified · 🟡 Partial / has a real gap · ⬜ Not started

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
- ⬜ **Marketing site** (separate repo:
  [`DonnovanRinomhota/Elliot-web`](https://github.com/DonnovanRinomhota/Elliot-web)
  -- intentionally kept out of this monorepo, not a stray duplicate). The
  public-facing site for *finding* clients -- not something a pilot
  client's customers would ever touch. Currently one commit, README only,
  nothing built. Doesn't block giving Elliot to a pilot client you already
  have a relationship with; only matters for inbound/at-scale client
  acquisition later.
- ⬜ **Voice** (e.g. Retell or similar usage-based voice agent
  infrastructure). Not started. Depends on having a real always-on
  channel first, same underlying gap as the widget.
- 🟡 **WhatsApp** (workflows `25`–`28`, migration `0025`) -- inbound
  messages, classify/draft/approve/send, and dashboard Approvals support,
  built against Meta's WhatsApp Cloud API. High-value for the real-estate/
  Europe niche specifically. Mirrors the email agent's shape (13-17)
  rather than the widget's, since WhatsApp's webhook -- like email's --
  doesn't wait around for a reply in the same request: `25` (inbound
  trigger, routes tenants by `phone_number_id` -- genuinely multi-tenant
  from one shared credential, unlike Gmail's single-mailbox limitation,
  see that workflow's spec) → `13` (classify, reused as-is) → `26` (draft,
  a mirror of `14`) → approve in the dashboard, or auto-send for
  high-confidence FAQ answers → `27` (send) / `28` (manual send trigger).
  Drafts live in a new `whatsapp_drafts` table, a sibling of
  `email_drafts` rather than a merge of it -- kept separate on purpose so
  WhatsApp being new and unproven can't put email's working path at risk.
  The database side is real-verified: all 25 migrations run clean end to
  end (tested locally with Postgres 16 + pgvector, not just read for
  syntax), and RLS tenant isolation plus both approve/reject RPCs were
  tested as an actual non-superuser role, not the table-owning role that
  bypasses RLS by default. The dashboard side (Approvals merging both
  draft tables with the right RPC/webhook per row, the Settings field for
  `whatsapp_phone_number_id`) passed `tsc`, a production build, and a
  browser-driven check of the approve/reject/blocked states with the
  Supabase calls intercepted. **None of this has been tested against a
  real Meta WhatsApp number or run inside n8n itself** -- the four
  workflow JSON files are valid and structurally checked (every
  connection resolves, every node reachable from a trigger, no orphaned
  nodes) but have never actually executed. Needs, before this can go to
  🟢: a Meta Business Account + WhatsApp Cloud API sandbox number, the
  `WHATSAPP_VERIFY_TOKEN` env var and an HTTP Header Auth credential set
  in n8n (currently a placeholder on workflow 27's send node), and
  `NEXT_PUBLIC_N8N_SEND_WHATSAPP_WEBHOOK_URL` set in the dashboard's env.
  Known gaps, all documented in the relevant workflow specs and
  `KNOWN_ISSUES.md`: the inbound webhook doesn't verify Meta's request
  signature; no template-message support, so any reply more than 24 hours
  after the contact's last message gets blocked rather than sent
  (`blocked_needs_template`); non-text messages (images, audio, location)
  aren't handled at all; and human takeover doesn't work on WhatsApp
  conversations, same as it doesn't yet on the chat widget.

## Dashboard / operator experience

- ✅ **Real analytics dashboard** (`/`) -- conversations, new leads,
  appointments, escalation rate, avg response time, activity/leads charts.
  Backed by a real Postgres RPC (`get_dashboard_overview_stats`).
- ✅ **Structured lead-scoring reasoning** (`/dashboard/leads`) -- each
  lead shows *why* it scored what it did, mirroring
  `10-lead-capture.json`'s actual scoring logic exactly.
- 🟡 **Human takeover** (`/dashboard/conversations/[id]`) -- works for
  `email`-channel conversations with a known contact email. Doesn't work
  for `chat_widget` conversations and can't until the widget above exists
  *and* has some persistent connection (polling/Realtime) to receive a
  message that didn't come from its own request. See `KNOWN_ISSUES.md`.
- 🟡 **Tenant onboarding UI** (`/dashboard/onboarding`) -- form wrapping
  workflow 19 exists and works. Route is now gated to admins listed in
  `ADMIN_EMAILS` (`lib/admin.ts`), nav link hidden for everyone else.
  Remaining gap: the underlying n8n webhook itself still has no auth of
  its own -- see `KNOWN_ISSUES.md`.
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
  step is a day, subject, and message, saved in the same `steps` shape
  workflow 20 reads. Only `{{contact_name}}` is substituted by the sweep, so
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
- ⬜ **Automatic follow-up enrolment.** Nothing starts a follow-up run for a
  lead: workflow 21 is only reachable by calling its webhook by hand, so the
  sequences configured at `/dashboard/follow-ups` send nothing until a lead
  is enrolled. Candidate approaches: a "Start follow-up" action on the lead
  card, and/or enrolling a lead automatically when it reaches a chosen
  stage. Not started.

## Reliability (tracked in detail in `KNOWN_ISSUES.md`)

- ✅ Orphaned Google Calendar event on a booking collision -- fixed with a
  compensating delete, tested live against a real double-booking.
- 🟡 Onboarding page access control -- dashboard route gated (see above);
  the n8n webhook underneath still has no auth of its own, so this isn't
  fully closed out yet.

## Business / non-code

Not something to build -- these are decisions, listed here so they don't
get lost either:

- Pricing tiers (Starter / Growth / Pro structure was proposed; not
  decided).
- Competitive positioning: lean into "bring your own website/CRM/calendar,
  Elliot operates the front office" rather than competing feature-for-
  feature with vertical-specific players like Ylopo or Structurely.
- Keep the product narrative to one coherent story (Talk / Understand /
  Convert / Book / Follow up / Sync / Escalate / Measure) rather than
  listing 20 disconnected features -- worth revisiting once there's a real
  second tenant to sanity-check positioning against.
