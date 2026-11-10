# Sellers and valuation visits (0043)

When someone wants to **sell or let** their property, or asks **what it is
worth**, Elliot:

1. never gives a price, range or estimate (it has no market data);
2. asks, a little at a time, for the address, type, size, rooms, floor,
   condition and when they want to act, and saves it with the tool
   `record_valuation_request`: the lead becomes a **Seller** (or Landlord),
   **HOT** if within 3 months, else WARM;
3. offers a **free valuation visit**: free times from the agents' calendars,
   booked as a *valuation* at the client's address (Google Calendar event
   "Valuation visit — client — address", confirmation email in English and
   Polish);
4. alerts the team (escalation "hot lead") with the property details, even if
   the client doesn't book.

In the dashboard: the lead shows a **Seller** tag and, under Details,
"Property to value"; the appointment shows "Valuation visit" with the address
and a Google Maps link. Changes by the client and reminders the day before
say "valuation visit". Reminders for valuation visits go by **email** (the
WhatsApp reminder template talks about viewings).

## Set-up

1. Supabase → SQL Editor: run `db/migrations/0043_valuations.sql`.
2. n8n: re-import **01**, **12**, **37** and **38**, check credentials, publish.
   01 has a new node *Record Valuation Request* (Postgres: Elliot Postgres
   (service role)).

## Test

In the website chat of an agency: "I'd like to sell my flat, what is it
worth?" Elliot asks about the flat and doesn't name a price. Give an address
and a size, ask for a valuation visit, pick a time. Check: the lead is
tagged Seller with the details, the appointment says Valuation visit, the
calendar event is at your address, the team got an alert.
