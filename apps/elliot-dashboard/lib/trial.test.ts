// Run with: npm test. The trial banner on an agency's dashboard (0050).
import { test } from "node:test";
import assert from "node:assert/strict";
import { trialBanner } from "./trial";

const NOW = new Date("2026-11-12T10:00:00Z");
const t = (over = {}) => ({ plan: "trial", status: "active", trial_started_at: "2026-11-10T09:00:00Z", trial_ends_at: "2026-11-17T09:00:00Z", ...over });

test("a running trial shows the days left", () => {
  assert.deepEqual(trialBanner(t(), NOW), { tone: "info", text: "Free trial: 5 days left (ends 17 Nov)." });
  assert.equal(trialBanner(t({ trial_ends_at: "2026-11-13T09:00:00Z" }), NOW)?.tone, "warning");
  assert.match(trialBanner(t({ trial_ends_at: "2026-11-12T20:00:00Z" }), NOW)!.text, /^Free trial: Last day/);
});

test("an ended trial says Elliot is paused and what clients get", () => {
  const b = trialBanner(t({ trial_ends_at: "2026-11-11T09:00:00Z" }), NOW)!;
  assert.equal(b.tone, "alert");
  assert.match(b.text, /^Your free trial ended on 11 Nov\. Elliot is paused: clients get a short holding reply/);
});

test("nothing for paying agencies, agencies being set up, or trials from before 0050", () => {
  assert.equal(trialBanner(t({ plan: "starter" }), NOW), null);
  assert.equal(trialBanner(t({ plan: "complimentary" }), NOW), null);
  assert.equal(trialBanner(t({ trial_started_at: null, trial_ends_at: null }), NOW), null);
  assert.equal(trialBanner(t({ trial_started_at: null, trial_ends_at: "2026-10-01T00:00:00Z" }), NOW), null, "old default date, never started: not paused");
  assert.equal(trialBanner(null, NOW), null);
  assert.equal(trialBanner(t({ trial_ends_at: "not a date" }), NOW), null);
});

test("a suspended agency is told Elliot is paused", () => {
  assert.equal(trialBanner(t({ status: "suspended", plan: "starter" }), NOW)?.tone, "alert");
});
