// Run with: npm test. Alert settings validation and the status headline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAlertChannels, formatWhatsapp, healthHeadline, whatsappDigits } from "./alerts";

const base = { email_enabled: false, email: "", whatsapp_enabled: false, whatsapp: "" };

test("everything off and empty is fine", () => {
  assert.deepEqual(checkAlertChannels(base), {
    ok: true,
    value: { email_enabled: false, email: null, whatsapp_enabled: false, whatsapp: null },
  });
});

test("numbers are stored as digits with the country code", () => {
  const r = checkAlertChannels({ ...base, whatsapp_enabled: true, whatsapp: "+48 600-100-200" });
  assert.equal(r.ok && r.value.whatsapp, "48600100200");
  assert.equal(whatsappDigits("(+44) 7700 900123"), "447700900123");
  assert.equal(formatWhatsapp("48600100200"), "+48 600 100 200");
  assert.equal(formatWhatsapp("447700900123"), "+447700900123");
  assert.equal(formatWhatsapp(null), "");
});

test("a switched-on channel needs somewhere to send", () => {
  assert.deepEqual(checkAlertChannels({ ...base, email_enabled: true }), { ok: false, error: "Add an email address, or switch email alerts off." });
  assert.deepEqual(checkAlertChannels({ ...base, whatsapp_enabled: true }), { ok: false, error: "Add a WhatsApp number, or switch WhatsApp alerts off." });
});

test("a switched-off channel keeps its address for later", () => {
  const r = checkAlertChannels({ ...base, email: " boss@agency.pl ", whatsapp: "+48600100200" });
  assert.deepEqual(r, { ok: true, value: { email_enabled: false, email: "boss@agency.pl", whatsapp_enabled: false, whatsapp: "48600100200" } });
});

test("bad input gets a clear message", () => {
  assert.equal(checkAlertChannels({ ...base, email: "boss@agency" }).ok, false);
  const local = checkAlertChannels({ ...base, whatsapp: "0600 100 200" });
  assert.equal(!local.ok && local.error, "Start the WhatsApp number with the country code, e.g. +48 600 100 200.");
  assert.equal(checkAlertChannels({ ...base, whatsapp: "+48 600" }).ok, false);
});

test("status headline", () => {
  const ok = { key: "gmail", label: "Gmail", ok: true, detail: null, failing_since: null, checked_at: "2026-11-10T12:00:00Z" };
  assert.equal(healthHeadline("unknown", []).tone, "unknown");
  assert.deepEqual(healthHeadline("all_ok", [ok, { ...ok, key: "claude", label: "Claude" }]), { tone: "ok", text: "All 2 checks passing" });
  assert.deepEqual(healthHeadline("degraded", [ok, { ...ok, key: "claude", label: "Claude", ok: false }]), {
    tone: "bad",
    text: "1 of 2 checks failing: Claude",
  });
  assert.equal(healthHeadline("stale", [ok]).tone, "bad");
});
