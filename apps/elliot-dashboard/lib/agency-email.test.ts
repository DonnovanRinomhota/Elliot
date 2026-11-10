// Run with: npm test. The agency's email set-up in Settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { forwardingCode, forwardingStatus, inboundAddress, isEmail, senderPreview } from "./agency-email";

test("each agency's Elliot address comes from its slug", () => {
  assert.equal(inboundAddress(" Simon-RE "), "simon-re@in.getelliot.eu");
});

test("clients see the agency's name, and reply to the agency", () => {
  assert.deepEqual(senderPreview({ slug: "simon", agencyName: "Simon Real Estate", agencyEmail: " Biuro@Simon.pl " }), {
    from: "Simon Real Estate <simon@mail.getelliot.eu>",
    replyTo: "biuro@simon.pl",
  });
  assert.deepEqual(senderPreview({ slug: "simon", agencyName: "Simon", fromName: " Biuro Simon ", ownFromAddress: "elliot@simon.pl", agencyEmail: "" }), {
    from: "Biuro Simon <elliot@simon.pl>",
    replyTo: "simon@in.getelliot.eu",
  });
  assert.equal(senderPreview({ slug: "s", agencyName: "S", agencyEmail: "not an email" }).replyTo, "s@in.getelliot.eu");
});

test("forwarding status", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  assert.equal(forwardingStatus(null, null, now).tone, "waiting");
  const ok = forwardingStatus("2026-11-10T09:00:00Z", "anna@x.pl", now);
  assert.deepEqual(ok, { tone: "ok", label: "Working. Last email arrived 3 h ago from anna@x.pl." });
  assert.equal(forwardingStatus("2026-11-10T11:30:00Z", null, now).label, "Working. Last email arrived less than an hour ago.");
  assert.equal(forwardingStatus("2026-11-09T11:00:00Z", null, now).label, "Working. Last email arrived 1 day ago.");
  assert.equal(forwardingStatus("2026-10-01T12:00:00Z", null, now).tone, "quiet");
});

test("Gmail's code is shown for a week", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  assert.equal(forwardingCode("612345678", "2026-11-09T12:00:00Z", now), "612345678");
  assert.equal(forwardingCode("612345678", "2026-11-01T12:00:00Z", now), null);
  assert.equal(forwardingCode(null, "2026-11-09T12:00:00Z", now), null);
});

test("email check", () => {
  assert.equal(isEmail(" a@b.pl "), true);
  assert.equal(isEmail("a@b"), false);
  assert.equal(isEmail(null), false);
});
