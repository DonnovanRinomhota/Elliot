// Run with: npm test. The built-in assistant's understanding of questions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseQuestion, parseRange, placeStem, fold } from "./parse";

// Saturday 7 Nov 2026, 15:00 in Warsaw.
const NOW = new Date("2026-11-07T14:00:00Z");
const q = (s: string) => parseQuestion(s, NOW, "Europe/Warsaw");

test("dates", () => {
  assert.deepEqual(parseRange("viewings today", NOW), { from: "2026-11-07", to: "2026-11-08", label: "today" });
  assert.equal(parseRange("tomorrow", NOW)!.from, "2026-11-08");
  assert.deepEqual(parseRange("this week", NOW), { from: "2026-11-02", to: "2026-11-09", label: "this week" });
  assert.equal(parseRange("next week", NOW)!.from, "2026-11-09");
  assert.equal(parseRange("last week", NOW)!.from, "2026-10-26");
  assert.deepEqual(parseRange("in the last 30 days", NOW), { from: "2026-10-09", to: "2026-11-08", label: "the last 30 days", days: 30 });
  assert.deepEqual(parseRange("this month", NOW), { from: "2026-11-01", to: "2026-12-01", label: "this month" });
  assert.deepEqual(parseRange("last month", NOW), { from: "2026-10-01", to: "2026-11-01", label: "last month" });
  assert.deepEqual(parseRange("on wednesday", NOW), { from: "2026-11-11", to: "2026-11-12", label: "on Wednesday" });
  assert.equal(parseRange(fold("w środę"), NOW)!.from, "2026-11-11");
  assert.equal(parseRange(fold("jutro"), NOW)!.from, "2026-11-08");
  assert.equal(parseRange("hello", NOW), null);
});

test("amounts", () => {
  assert.equal(parseAmount("1m"), 1_000_000);
  assert.equal(parseAmount("1.5 mln"), 1_500_000);
  assert.equal(parseAmount("900k"), 900_000);
  assert.equal(parseAmount("900 tys"), 900_000);
  assert.equal(parseAmount("1 200 000"), 1_200_000);
  assert.equal(parseAmount("4500"), 4500);
});

test("help, navigation and to-do", () => {
  assert.deepEqual(q(""), { kind: "help" });
  assert.deepEqual(q("what can you do?"), { kind: "help" });
  assert.deepEqual(q("open settings"), { kind: "navigate", href: "/dashboard/settings", label: "Settings" });
  assert.deepEqual(q("go to the calendar"), { kind: "navigate", href: "/dashboard/calendar", label: "Calendar" });
  assert.deepEqual(q("Team"), { kind: "navigate", href: "/dashboard/team", label: "Team" });
  assert.equal(q("What needs me today?").kind, "needs_me");
  assert.equal(q("co czeka na mnie").kind, "needs_me");
});

test("counts and lists", () => {
  assert.deepEqual(q("How many leads this week?"), {
    kind: "count", entity: "leads", range: { from: "2026-11-02", to: "2026-11-09", label: "this week" }, status: undefined, booked: false, list: false,
  });
  const hot = q("how many hot leads do we have");
  assert.equal(hot.kind, "count");
  assert.equal(hot.kind === "count" && hot.status, "HOT");
  const chats = q("Chats in the last 30 days");
  assert.equal(chats.kind === "count" && chats.entity, "conversations");
  assert.equal(chats.kind === "count" && chats.range?.days, 30);
  assert.equal(chats.kind === "count" && chats.list, true);
  const booked = q("how many viewings were booked yesterday");
  assert.equal(booked.kind === "count" && booked.booked, true);
  const pl = q("ile leadów w tym tygodniu");
  assert.equal(pl.kind === "count" && pl.entity, "leads");
  assert.equal(q("how many listings do we have").kind, "count");
  assert.equal(q("emails waiting for approval").kind, "count");
});

test("schedule", () => {
  const t = q("Viewings tomorrow");
  assert.deepEqual(t, { kind: "schedule", mine: false, range: { from: "2026-11-08", to: "2026-11-09", label: "tomorrow" } });
  const mine = q("what are my viewings this week");
  assert.equal(mine.kind === "schedule" && mine.mine, true);
  const def = q("upcoming appointments");
  assert.equal(def.kind === "schedule" && def.range.label, "in the next 7 days");
  assert.equal(q("who is viewing on Friday").kind, "schedule");
});

test("listings", () => {
  assert.deepEqual(q("Flats in Mokotów under 1m"), {
    kind: "listings", filters: { maxPrice: 1_000_000, transaction: "sale", propertyType: "apartment", location: "Mokotów" },
  });
  assert.deepEqual(q("2 rooms for rent"), { kind: "listings", filters: { rooms: 2, transaction: "rent" } });
  assert.deepEqual(q("3+ room apartments in Wilanów"), {
    kind: "listings", filters: { rooms: 3, roomsAtLeast: true, propertyType: "apartment", location: "Wilanów" },
  });
  assert.deepEqual(q("penthouse in Śródmieście between 2m and 3m"), {
    kind: "listings", filters: { minPrice: 2_000_000, maxPrice: 3_000_000, transaction: "sale", propertyType: "apartment", location: "Śródmieście" },
  });
  assert.equal(placeStem("Wilanowie"), "Wilan");
  assert.equal(placeStem("Śródmieściu"), "Śródmieśc");
  assert.equal(placeStem("Żoliborzu"), "Żoliborz");
  assert.equal(placeStem("Mokotów"), "Mokotów");
  assert.equal(placeStem("Woli"), "Woli");
  const pl = q("mieszkania na wynajem w Wilanowie do 6000");
  assert.deepEqual(pl, { kind: "listings", filters: { maxPrice: 6000, transaction: "rent", propertyType: "apartment", location: "Wilanowie" } });
  assert.deepEqual(q("houses over 2m"), { kind: "listings", filters: { minPrice: 2_000_000, transaction: "sale", propertyType: "house" } });
  assert.deepEqual(q("studio under 3000"), { kind: "listings", filters: { maxPrice: 3000, transaction: "rent", propertyType: "apartment" } });
});

test("people and the rest", () => {
  assert.deepEqual(q("Who is Anna Kowalska?"), { kind: "person", query: "Anna Kowalska" });
  assert.deepEqual(q("anna@example.com"), { kind: "person", query: "anna@example.com" });
  assert.deepEqual(q("+48 601 234 567"), { kind: "person", query: "+48601234567" });
  assert.deepEqual(q("Piotr Nowak"), { kind: "person", query: "Piotr Nowak" });
  assert.equal(q("hot leads").kind, "hot_leads");
  assert.equal(q("unassigned viewings").kind, "unassigned");
  assert.equal(q("parking garage key 44").kind, "search");
  assert.equal(q("count").kind, "search");
});
