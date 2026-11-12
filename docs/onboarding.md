# Setting up a new agency

The same steps for every agency, from the first call to the end of the trial.
The **Go-live checklist** on the agency's page in the control panel
(`/platform/tenants/<id>`) ticks itself off from the agency's real data, so
you can see what's left without asking. This page explains each step.

Allow one session of about an hour with the agency, plus a test you do on your own.

## Before you start

- [ ] A call or demo, and agreement on the price (see the pricing note).
- [ ] What they use: email provider (Gmail, Outlook, other), calendars (Google
      only, for now), CRM (ASARI, other, none), WhatsApp Business (yes/no).
- [ ] The data processing agreement (umowa powierzenia). Elliot handles their
      clients' personal data for them, so this is signed before real clients
      talk to Elliot. (Its text is part of the GDPR work; until then, don't go
      live with a paying agency.)

## 1. Create the agency

Control panel → **Add agency**: name, short name (slug, used in their widget
and email addresses), admin's name and email. Workflow 19 creates the account
and emails the admin an invitation.

Checklist: *An admin can sign in*.

## 2. Team

The admin (or you, in their dashboard with their support permission) invites
each agent on the **Team** page and ticks who gets leads and escalations.

Checklist: *Agents added*, *Someone gets hand-overs*.

## 3. Calendars

Each agent who does viewings shares their Google Calendar with Elliot's
Google account, with **Make changes to events**, and pastes the calendar ID on
the Team page. **Check access** must say *Connected*. Details:
[`agent-calendars.md`](agent-calendars.md).

Checklist: *Calendars Elliot can book into*.

## 4. Listings and knowledge

- **Listings:** Listings page → Import (spreadsheet, PDF, Word), or Settings →
  ASARI if they use ASARI (still in testing: check a few listings by hand
  after the first sync).
- **Knowledge base:** their fees, areas they cover, how viewings and offers
  work, the questions clients ask most. One short document each is fine.

Checklist: *Listings loaded*, *Fees, areas and FAQs in the knowledge base*.

## 5. Settings

- **What Elliot may do on its own:** whether viewings are booked straight away
  or wait for the team to confirm; whether follow-ups need approval.
- Business hours, earliest booking time, gap between viewings, reminders the
  day before, sender name, problem alerts.

Checklist: *Approval rules chosen* (ticks once they press Save on that card).

## 6. Channels

- **Email:** they forward their enquiries inbox to `<slug>@in.getelliot.eu`
  (Settings → Email shows the address, and Gmail's confirmation code when it
  arrives). Then send a test email from your own address.
  [`agency-email.md`](agency-email.md)
- **Website chat:** one line on their website, before `</body>`:
  `<script src="https://app.getelliot.eu/widget.js" data-tenant="<slug>" async></script>`
- **WhatsApp** (optional): needs Meta business verification first.
  [`whatsapp-setup.md`](whatsapp-setup.md)
- **CRM** (optional): webhook, Zapier or Make. Settings → Connected services.

Checklist: *Email reaches Elliot*, and *Website chat*, *WhatsApp number*,
*CRM connection* where they use them.

## 7. Test it as a client

From your own phone and email, before any real client:

- [ ] Ask about a listing by area and budget. The right listings come back, with links.
- [ ] Ask about fees. The answer comes from their knowledge base, not made up.
- [ ] Book a viewing. The event is in the right agent's calendar; the confirmation email arrives.
- [ ] Move it, then cancel it, by message.
- [ ] Say you want to sell your flat. A seller lead and a valuation visit.
- [ ] Ask for a person. The escalation email reaches the right people.
- [ ] Reply STOP to a follow-up. No more follow-ups.

Delete or close the test leads afterwards, or tell the team which they are.

Checklist: *A test conversation answered*.

## 8. Go live and start the trial

When every required step on the checklist is ticked, press **Start trial**
(7 days) on the agency's page. The trial starts now, not when the account was
created, so set-up time doesn't eat into it. The agency sees "Free trial:
N days left" at the top of their dashboard.

During the trial:

- Day 1: read their first conversations (Conversations page). Fix anything in
  the knowledge base.
- Mid-way: a short call. What did clients ask that Elliot couldn't answer?
- Before the end: agree the plan.

## 9. When the trial ends

- **They continue:** on the agency's page set **Plan** (e.g. Starter),
  **Paid until** and **Monthly price**, Save. Elliot carries on.
- **They need a few more days:** change **Trial ends** and Save.
- **They don't continue:** do nothing. Elliot pauses by itself: clients get
  one short holding reply a day ("Thank you for your message to <agency>.
  Our team will get back to you as soon as possible."), and their messages
  stay in the agency's inbox. No follow-ups, auto-enrol or reminders are
  sent. Their data is kept until it is deleted on request (GDPR work).

Trials only pause if they were started with **Start trial** (migration 0050).
Agencies created before that keep working whatever their old trial date says.

## Afterwards

The control panel's **Problems** page and the health alerts show failures
per agency; the agencies table flags agencies with failures this week,
calendars Elliot can't use, AI cost above 30% of their price, or no activity
for 7 days.
