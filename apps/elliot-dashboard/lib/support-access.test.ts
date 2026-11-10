// Run with: npm test. Support access state (0040).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCESS_OPTIONS, supportAccessState, untilLabel } from "./support-access";

const now = new Date("2026-11-10T20:00:00Z");

test("Elliot's own accounts are always open", () => {
  assert.deepEqual(supportAccessState(null, "sales", now), { open: true, reason: "own_account" });
  assert.deepEqual(supportAccessState(null, "demo", now), { open: true, reason: "own_account" });
});

test("an agency is closed until it allows access, and again after it runs out", () => {
  assert.deepEqual(supportAccessState(null, "agency", now), { open: false, reason: "off" });
  assert.deepEqual(supportAccessState(null, undefined, now), { open: false, reason: "off" });
  assert.deepEqual(supportAccessState({ expires_at: "2026-11-11T20:00:00Z", granted_by_email: "boss@a.pl" }, "agency", now), {
    open: true,
    reason: "granted",
    until: "2026-11-11T20:00:00Z",
    by: "boss@a.pl",
  });
  assert.deepEqual(supportAccessState({ expires_at: "2026-11-10T19:59:00Z" }, "agency", now), {
    open: false,
    reason: "expired",
    expiredAt: "2026-11-10T19:59:00Z",
  });
});

test("while the switch is off (testing), every agency is open", () => {
  assert.deepEqual(supportAccessState(null, "agency", now, false), { open: true, reason: "not_required" });
  assert.deepEqual(supportAccessState(null, "sales", now, false), { open: true, reason: "own_account" });
});

test("durations match the database", () => {
  assert.deepEqual(ACCESS_OPTIONS.map((o) => o.hours), [24, 168, 720]);
});

test("dates in the agency's time zone", () => {
  assert.equal(untilLabel("2026-11-17T20:40:00Z"), "Tue 17 Nov, 21:40");
});
