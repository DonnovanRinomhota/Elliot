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

- ⬜ **Web chat widget** (`apps/web-chat-widget`, in this repo). The
  embeddable chat bubble a client puts on *their own* website, for *their*
  customers to talk to Elliot through. Still an empty placeholder README.
  This is the one that blocks the two items below it, and blocks selling
  Elliot as an "AI website assistant" rather than just an email agent.
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
  workflow 19 exists and works. Gap: **no access control** -- any user
  logged into any tenant's dashboard can currently reach it and create
  new tenants. See `KNOWN_ISSUES.md`.
- 🟡 **Knowledge base upload** (`/dashboard/knowledge`) -- form wrapping
  workflow 08 exists and works, but it's plain-text paste only. No real
  PDF, brochure, or website ingestion yet, regardless of which source
  type you pick in the form.
- ⬜ **AI Revenue / ROI dashboard.** Turning "Elliot answered 500
  conversations" into "Elliot generated an estimated €84k pipeline" --
  qualified leads × an assumed commission value per tenant. Would build on
  the analytics work already done. Not started.
- ⬜ **Follow-up sequence configuration UI.** Sequences are still
  hand-authored via SQL (see `docs/workflow-specs/20-follow-up-sweep.md`);
  a run can still advance on schedule even if a pending draft wasn't
  actually approved/sent yet. No dashboard page exists for a client to
  configure their own Day 0 / Day 1 / Day 3 / Day 7 / Day 14 steps.

## Reliability (tracked in detail in `KNOWN_ISSUES.md`)

- ✅ Orphaned Google Calendar event on a booking collision -- fixed with a
  compensating delete, tested live against a real double-booking.
- ⬜ Onboarding page access control (same item as above, listed here too
  since it's a real reliability/security gap, not just a missing feature).

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
