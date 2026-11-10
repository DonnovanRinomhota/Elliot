# getelliot.eu: sales assistant, call booking and live demo

Migration `0037_sales_and_demo.sql`, setup script
`db/setup/sales_and_demo_accounts.sql`, workflows 01/11/12/18 (changed) and
35/36 (new), Elliot-web pages `/book`, `/pl/rezerwacja`, `/demo`, `/pl/demo`.
Tests: `n8n/workflows/tests/sales_demo.test.js`, `db/seed/test_0037_sales_demo.sql`.

## Three kinds of account (`tenants.assistant_mode`)

| Mode | Who | What Elliot does |
|---|---|---|
| `agency` (default) | Every estate agency | Unchanged: listings, viewings, details asked before the chat starts |
| `sales` | "Elliot" (slug `elliot`) | The chat on getelliot.eu. Answers only about Elliot, from the Knowledge page (`docs/sales-knowledge/elliot-for-agencies.md`). Answers straight away; asks for name, email and agency only to book. Books a **15-minute intro call** or a **30-minute live demo** with Google Meet in your calendar, every day 09:00–21:00 Warsaw time, at least 2 hours ahead. No listing search. |
| `demo` | "Demo Nieruchomości" (slug `demo-nieruchomosci`) | The live demo on getelliot.eu/demo. Behaves like an agency with 10 sample flats. Bookings go to a separate "Elliot Demo" calendar; confirmation emails are marked **[DEMO]**; no agent alerts, CRM or follow-ups. Visitor data is deleted after 3 days (workflow 36). |

Set in the Control panel → agency → Account type.

## Flows

**Chat on getelliot.eu** → workflow 01 with `tenant_slug=elliot` → sales
prompt and tools → `check_availability` (11, 15/30-minute slots, 2 h notice)
→ `capture_lead` → `book_appointment` → 12 with `kind=consultation`: Google
Calendar event with a Meet link (`conferenceDataVersion=1`), the visitor as
attendee, appointment in your dashboard with the call type, agency details and
the Meet link in its notes, confirmation email (EN + PL) with the link.

**Booking page /book** → workflow 35:
`GET /webhook/consultation-slots?type=intro|demo` (free times from 11) and
`POST /webhook/book-consultation` → `upsert_sales_lead()` (contact + HOT lead
with agency, agents, listings, CRM) → 12 as above → answer to the page
(409 if the time was just taken) → email to you.

**Live demo /demo** → form (name, email, agency, phone optional) →
`POST /webhook/demo-access` → lead for you (`source: live_demo`) + the demo
agency's slug → the page chats with the demo agency through workflow 01, with
the visitor's details, so no second form → email to you.

**Contact form /contact** → workflow 18, now also a lead in the Elliot account,
and the notification goes to the platform alert email instead of the old
hard-coded address.

"Email to you" = the email under Control panel → Health & alerts.

## Setup

1. Run migration 0037 in Supabase.
2. Create a Google Calendar called "Elliot Demo" (same Google account as n8n's
   calendar credential), copy its Calendar ID into
   `db/setup/sales_and_demo_accounts.sql` and run the script.
3. Knowledge page of the Elliot account (Control panel → Elliot → View as):
   upload `docs/sales-knowledge/elliot-for-agencies.md`.
4. n8n: re-import 01, 11, 12, 18; import 35 and 36. In 35 check "Free Times
   Via 11" points at 11 and "Book Via 12" at 12. Publish all.
5. Vercel (elliot-web): `NEXT_PUBLIC_ELLIOT_DEMO_TENANT=elliot`,
   `NEXT_PUBLIC_ELLIOT_MODE=live`; push the Elliot-web patch.
