// Run with: npm test. The WhatsApp 24-hour reply window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { timeLeftLabel, whatsappReplyProblem, whatsappWindow } from "./whatsapp";

const now = new Date("2026-11-09T12:00:00Z");

test("the window is open for 24 hours after the client's last message", () => {
  const w = whatsappWindow("2026-11-09T10:00:00Z", now);
  assert.equal(w.open, true);
  assert.equal(w.minutesLeft, 22 * 60);
  assert.equal(w.closesAt?.toISOString(), "2026-11-10T10:00:00.000Z");

  const late = whatsappWindow("2026-11-08T11:59:00Z", now);
  assert.equal(late.open, false);
  assert.equal(late.minutesLeft, 0);

  assert.equal(whatsappWindow("2026-11-08T12:00:00Z", now).open, false, "exactly 24 h is closed");
  assert.deepEqual(whatsappWindow(null, now), { open: false, closesAt: null, minutesLeft: 0 });
  assert.equal(whatsappWindow("not a date", now).open, false);
});

test("time left reads naturally", () => {
  assert.equal(timeLeftLabel(45), "45 min");
  assert.equal(timeLeftLabel(120), "2 h");
  assert.equal(timeLeftLabel(200), "3 h 20 min");
  assert.equal(timeLeftLabel(0), "0 min");
});

test("a reply is refused with a reason a person understands", () => {
  const open = whatsappWindow("2026-11-09T10:00:00Z", now);
  assert.equal(whatsappReplyProblem("Hi Tomek", open), null);
  assert.equal(whatsappReplyProblem("   ", open), "Write a message first.");
  assert.match(whatsappReplyProblem("x".repeat(4097), open)!, /4096/);
  assert.match(whatsappReplyProblem("Hi", whatsappWindow("2026-11-07T10:00:00Z", now))!, /within 24 hours/);
  assert.match(whatsappReplyProblem("Hi", whatsappWindow(null, now))!, /hasn't written/);
});
