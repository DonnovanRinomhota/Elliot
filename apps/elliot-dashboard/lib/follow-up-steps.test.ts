// Run with: npm test  (uses Node's built-in test runner via tsx -- no test
// framework dependency). Covers the validation rules that protect what
// workflow 20 (the sweep) would otherwise send to real contacts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSequence,
  findUnsupportedPlaceholders,
  hasSingleBracePlaceholder,
  stepsFromJson,
  displaySteps,
  type DraftStep,
} from "./follow-up-steps";

const step = (key: string, day: string, subject = "Following up", body = "Hi {{contact_name}}, checking in."): DraftStep => ({
  key,
  day,
  subject,
  body,
});

test("accepts a valid sequence and emits the documented step shape", () => {
  const r = validateSequence({ name: "  New lead  ", steps: [step("a", "0"), step("b", "3")] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.name, "New lead");
  assert.deepEqual(r.steps[0], {
    day_offset: 0,
    channel: "email",
    subject: "Following up",
    body: "Hi {{contact_name}}, checking in.",
  });
});

test("sorts steps by day_offset ascending regardless of entry order", () => {
  const r = validateSequence({ name: "x", steps: [step("a", "7"), step("b", "0"), step("c", "3")] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.steps.map((s) => s.day_offset), [0, 3, 7]);
});

test("rejects a blank name and an empty step list", () => {
  const r = validateSequence({ name: "   ", steps: [] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.errors.name);
  assert.ok(r.errors.steps);
});

test("rejects more than 10 steps", () => {
  const steps = Array.from({ length: 11 }, (_, i) => step(`k${i}`, String(i)));
  const r = validateSequence({ name: "x", steps });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.errors.steps ?? "", /at most 10/);
});

test("rejects blank, negative, fractional, non-numeric and oversized days", () => {
  for (const bad of ["", "  ", "-1", "1.5", "abc", "366"]) {
    const r = validateSequence({ name: "x", steps: [step("a", bad)] });
    assert.equal(r.ok, false, `day "${bad}" should be rejected`);
    if (!r.ok) assert.ok(r.errors.stepErrors.a, `day "${bad}" should produce a step error`);
  }
});

test("accepts the boundary days 0 and 365", () => {
  const r = validateSequence({ name: "x", steps: [step("a", "0"), step("b", "365")] });
  assert.equal(r.ok, true);
});

test("rejects two steps on the same day and flags the later one", () => {
  const r = validateSequence({ name: "x", steps: [step("a", "3"), step("b", "3")] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.errors.stepErrors.a, undefined);
  assert.match(r.errors.stepErrors.b, /day 3/);
});

test("rejects blank subject and blank message", () => {
  const r = validateSequence({ name: "x", steps: [step("a", "0", "  ", "ok"), step("b", "1", "ok", "")] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.errors.stepErrors.a, /Subject is required/);
  assert.match(r.errors.stepErrors.b, /Message is required/);
});

test("rejects placeholders the sweep does not substitute", () => {
  const r = validateSequence({ name: "x", steps: [step("a", "0", "Hi {{first_name}}")] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.errors.stepErrors.a, /first_name/);
});

test("allows {{contact_name}} with or without inner spaces", () => {
  assert.deepEqual(findUnsupportedPlaceholders("Hi {{contact_name}} and {{ contact_name }}"), []);
});

test("flags single-brace {contact_name} but not the correct double-brace form", () => {
  assert.equal(hasSingleBracePlaceholder("Hi {contact_name}"), true);
  assert.equal(hasSingleBracePlaceholder("{contact_name} at the start"), true);
  assert.equal(hasSingleBracePlaceholder("Hi {{contact_name}}"), false);
  const r = validateSequence({ name: "x", steps: [step("a", "0", "ok", "Hi {contact_name}")] });
  assert.equal(r.ok, false);
});

test("reports every bad step, not just the first", () => {
  const r = validateSequence({ name: "x", steps: [step("a", "abc"), step("b", "1", "", "ok")] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(Object.keys(r.errors.stepErrors).sort(), ["a", "b"]);
});

test("stepsFromJson tolerates hand-authored rows (template key, missing fields, non-arrays)", () => {
  let n = 0;
  const key = () => `k${n++}`;
  assert.deepEqual(stepsFromJson(null, key), []);
  assert.deepEqual(stepsFromJson({ nope: true }, key), []);
  const drafts = stepsFromJson(
    [{ day_offset: 1, channel: "email", template: "follow_up_1" }, { day_offset: 3, subject: "S", body: "B" }, null],
    key
  );
  assert.equal(drafts.length, 3);
  assert.equal(drafts[0].day, "1");
  assert.equal(drafts[0].subject, "");
  assert.equal(drafts[1].subject, "S");
  assert.equal(drafts[2].day, "0");
  assert.equal(new Set(drafts.map((d) => d.key)).size, 3);
});

test("displaySteps preserves array order (the order the sweep runs them)", () => {
  const out = displaySteps([
    { day_offset: 7, subject: "Last" },
    { day_offset: 0, subject: "" },
  ]);
  assert.deepEqual(out, [
    { day: 7, subject: "Last" },
    { day: 0, subject: "(no subject)" },
  ]);
});
