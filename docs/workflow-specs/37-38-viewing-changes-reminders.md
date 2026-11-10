# 37 - Client Viewing Changes, 38 - Viewing Reminders

Migration `0038_viewing_changes_and_reminders.sql`; tests in
`n8n/workflows/tests/viewing_changes.test.js` and `db/seed/test_0038_viewing_changes.sql`.

## Clients change their own bookings (01 → 37)

Elliot sees the client's upcoming bookings with their `appointment_id`
(`identify_chat_visitor`, 0038). New tool **change_viewing**
`{ appointment_id, action: confirm | reschedule | cancel, new_starts_at, new_ends_at, reason }`.

* The client is taken from the conversation (`Identify Visitor`), never from
  the model: `client_appointment()` only returns a booking that belongs to that
  client in that agency.
* **confirm**: sets `client_confirmed_at` ("Client confirmed" in the dashboard).
* **reschedule**: Elliot first offers times from check_availability. 37 checks
  the agency's notice, moves the booking in the database first (clash check,
  `slot_unavailable` if taken), then moves the Google Calendar event
  (`sendUpdates=all`), emails the agent (or the agency alert email) and the
  client. Old time kept in `previous_starts_at`; reminder and confirmation reset.
* **cancel**: deletes the calendar event, marks it `cancelled` with
  `cancelled_by = client`, emails agent and client.
* Demo agency: no agent emails; client emails marked [DEMO].

## Reminders (38)

Every day at 17:00 Warsaw time (one run a day) for tomorrow's confirmed
bookings in agencies with reminders on (Settings → Viewings), not the demo
agency:

* Client wrote on WhatsApp → template **viewing_reminder** in their language
  (Polish if their last message looks Polish, otherwise English). If WhatsApp
  refuses and there's an email, the email goes instead.
* Otherwise email (EN + PL). Calls with the Elliot team: email with the Meet link.
* The reminder text is added to the conversation, so a reply ("yes",
  "can we make it 18:00?") reaches Elliot with context and change_viewing does
  the rest.
* A failed reminder is logged (`reminder_failed`) and shows in the health
  alerts; it isn't retried.

WhatsApp template `viewing_reminder` (category Utility), English and Polish:

* en: `Hello {{1}}, this is a reminder of your viewing with {{2}} tomorrow, {{3}}, at {{4}}. Reply here to confirm, or let us know if you need to change or cancel it.`
* pl: `Dzień dobry {{1}}, przypominamy o prezentacji z {{2}} jutro, {{3}}, adres: {{4}}. Prosimy o odpowiedź z potwierdzeniem albo informację, jeśli trzeba zmienić lub odwołać termin.`

## Notice and buffer (11)

Settings → Viewings: earliest booking (default 2 hours from now) and a gap kept
free before and after every calendar event (default 30 minutes; 15 for the
Elliot sales account). A caller's own notice (the 2 hours for Elliot calls)
still wins.
