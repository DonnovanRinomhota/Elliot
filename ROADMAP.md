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
- ⬜ **WhatsApp.** Not started. High-value for the real-estate/Europe
  niche specifically.

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
- 🟡 **Knowledge base upload** (`/dashboard/knowledge`) -- PDF and website
  ingestion are now built (PR #32). PDFs are parsed client-side in the
  browser via `pdfjs-dist` and submitted through the same pasted-text
  contract as before; website ingestion sends a `url` and workflow 08
  fetches and extracts readable text server-side (new `Is Website?` /
  `Fetch Website` / `Extract Website Text` / `Resolve Content` nodes,
  `documents.source_url` now populated). Verified so far: production
  build passes and all workflow JSONs re-validated -- **not yet tested
  live** with a real PDF or a real URL end to end, so this stays 🟡 until
  it is. Known gaps, documented in
  `docs/workflow-specs/08-knowledge-ingestion.md`: scanned/image-only PDFs
  fail (no OCR); website extraction is regex-based and breaks on
  JS-rendered pages (would need a headless browser); no de-duplication, so
  re-ingesting the same content creates duplicate documents and chunks.
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
- ⬜ **Follow-up sequence configuration UI.** Sequences are still
  hand-authored via SQL (see `docs/workflow-specs/20-follow-up-sweep.md`);
  a run can still advance on schedule even if a pending draft wasn't
  actually approved/sent yet. No dashboard page exists for a client to
  configure their own Day 0 / Day 1 / Day 3 / Day 7 / Day 14 steps.

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
