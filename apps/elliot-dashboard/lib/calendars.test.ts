// Run with: npm test. Agents' calendars on the Team page (0042).
import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarState, isCalendarId } from "./calendars";

test("each status says what to do", () => {
  assert.equal(calendarState("", null, null, null).label, "No calendar");
  assert.equal(calendarState("ola@a.pl", "ok", null, "e@gmail.com").tone, "ok");
  assert.match(calendarState("ola@a.pl", "read_only", null, "e@gmail.com").help!, /Share it with e@gmail\.com with “Make changes to events”/);
  assert.match(calendarState("ola@a.pl", "not_shared", null, null).help!, /Share it with Elliot's Google account/);
  assert.match(calendarState("ola@a.pl", "error", "Backend Error", null).help!, /Google said: Backend Error/);
  assert.equal(calendarState("ola@a.pl", null, null, null).label, "Not checked yet");
});

test("calendar ids", () => {
  assert.equal(isCalendarId(" ola@gmail.com "), true);
  assert.equal(isCalendarId("abc123@group.calendar.google.com"), true);
  assert.equal(isCalendarId("my calendar"), false);
});
