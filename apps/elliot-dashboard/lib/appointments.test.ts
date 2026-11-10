// Run with: npm test. Calendar dates for viewings.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  clientNotes,
  addMonths,
  dayKey,
  groupByDay,
  isDayKey,
  listingAddress,
  mapsUrl,
  monthGrid,
  parseMonth,
  parseWeek,
  personName,
  queryBounds,
  shortName,
  timeRange,
  weekLabel,
  weekStart,
  bookedAtLabel,
  channelLabel,
} from "./appointments";

test("day keys are in the agency's time zone", () => {
  // 23:30 UTC on 7 Nov is 00:30 on 8 Nov in Warsaw.
  assert.equal(dayKey("2026-11-07T23:30:00Z", "Europe/Warsaw"), "2026-11-08");
  assert.equal(dayKey("2026-11-07T23:30:00Z", "UTC"), "2026-11-07");
  assert.equal(timeRange({ starts_at: "2026-11-09T09:00:00Z", ends_at: "2026-11-09T10:00:00Z" }, "Europe/Warsaw"), "10:00–11:00");
});

test("weeks start on Monday; months and day arithmetic", () => {
  assert.equal(weekStart("2026-11-07"), "2026-11-02"); // Saturday
  assert.equal(weekStart("2026-11-08"), "2026-11-02"); // Sunday
  assert.equal(weekStart("2026-11-09"), "2026-11-09"); // Monday
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(addDays("2026-03-28", 2), "2026-03-30"); // over the clock change
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(parseWeek("2026-11-12", "2026-11-07"), "2026-11-09");
  assert.equal(parseWeek("bad", "2026-11-07"), "2026-11-02");
  assert.equal(parseWeek("2026-02-30", "2026-11-07"), "2026-11-02");
  assert.equal(parseMonth("2026-13", "2026-11-07"), "2026-11");
  assert.equal(parseMonth("2027-02", "2026-11-07"), "2027-02");
  assert.ok(isDayKey("2026-02-28"));
  assert.ok(!isDayKey("2026-02-29"));
});

test("month grid covers the month in whole Monday-first weeks", () => {
  const nov = monthGrid("2026-11");
  assert.equal(nov[0][0], "2026-10-26");
  assert.equal(nov[nov.length - 1][6], "2026-12-06");
  assert.ok(nov.every((w) => w.length === 7));
  assert.equal(nov.length, 6);
  assert.equal(monthGrid("2021-02").length, 4); // Feb 2021 starts on a Monday
});

test("week labels", () => {
  assert.equal(weekLabel("2026-11-02"), "2–8 Nov 2026");
  assert.equal(weekLabel("2026-11-30"), "30 Nov – 6 Dec 2026");
  assert.equal(weekLabel("2025-12-29"), "29 Dec 2025 – 4 Jan 2026");
});

test("grouping by day, and query bounds wide enough for any time zone", () => {
  const rows = [
    { id: "b", starts_at: "2026-11-09T15:00:00Z" },
    { id: "a", starts_at: "2026-11-09T08:00:00Z" },
    { id: "c", starts_at: "2026-11-09T23:30:00Z" },
  ];
  const g = groupByDay(rows, "Europe/Warsaw");
  assert.deepEqual(g.get("2026-11-09")!.map((r) => r.id), ["a", "b"]);
  assert.deepEqual(g.get("2026-11-10")!.map((r) => r.id), ["c"]);
  assert.deepEqual(queryBounds("2026-11-09", "2026-11-16"), { from: "2026-11-08T00:00:00Z", to: "2026-11-17T00:00:00Z" });
});

test("names, addresses and map links", () => {
  assert.equal(shortName("Anna Kowalska"), "Anna K.");
  assert.equal(shortName("Anna Maria Kowalska"), "Anna K.");
  assert.equal(shortName("inquiry.2291@proton.me"), "inquiry.2291");
  assert.equal(shortName(null), "Client");
  assert.equal(personName({ full_name: null, email: "ola@agency.pl" }), "ola");
  assert.equal(personName(null), "Unassigned");
  assert.equal(listingAddress({ address: "ul. Puławska 145", district: "Mokotów", city: " " }), "ul. Puławska 145, Mokotów");
  assert.equal(mapsUrl("ul. Puławska 145, Warszawa"), "https://www.google.com/maps/search/?api=1&query=ul.%20Pu%C5%82awska%20145%2C%20Warszawa");
});

test("when and where a viewing was booked", () => {
  assert.equal(bookedAtLabel("2026-11-09T15:12:00Z", "Europe/Warsaw"), "9 Nov 2026, 16:12");
  assert.equal(bookedAtLabel("2026-11-09T15:12:00Z", "Europe/Warsaw", false), "9 Nov, 16:12");
  assert.equal(channelLabel("whatsapp"), "WhatsApp");
  assert.equal(channelLabel("chat_widget"), "website chat");
  assert.equal(channelLabel("phone_call"), "phone call");
  assert.equal(channelLabel(null), null);
});

test("what the client did shows on the viewing (0038)", () => {
  const base = { status: "confirmed", reminder_sent_at: null, reminder_channel: null, client_confirmed_at: null, cancelled_by: null, previous_starts_at: null };
  assert.deepEqual(clientNotes(base, "Europe/Warsaw"), []);
  assert.deepEqual(clientNotes({ ...base, client_confirmed_at: "2026-11-11T16:05:00Z", reminder_sent_at: "2026-11-11T16:00:00Z", reminder_channel: "whatsapp" }, "Europe/Warsaw"), [
    { text: "Client confirmed", tone: "ok" },
    { text: "Reminder sent by WhatsApp", tone: "muted" },
  ]);
  assert.deepEqual(clientNotes({ ...base, previous_starts_at: "2026-11-12T09:00:00Z" }, "Europe/Warsaw"), [{ text: "Client moved it from 12 Nov, 10:00", tone: "muted" }]);
  assert.deepEqual(clientNotes({ ...base, reminder_sent_at: "x", reminder_channel: "failed:email" }, "Europe/Warsaw"), [{ text: "Reminder failed", tone: "warn" }]);
  assert.deepEqual(clientNotes({ ...base, reminder_sent_at: "x", reminder_channel: "none" }, "Europe/Warsaw"), []);
  assert.deepEqual(clientNotes({ ...base, status: "cancelled", cancelled_by: "client", client_confirmed_at: "x" }, "Europe/Warsaw"), [{ text: "Cancelled by the client", tone: "warn" }]);
});
