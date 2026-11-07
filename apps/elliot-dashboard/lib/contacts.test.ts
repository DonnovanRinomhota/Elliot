// Run with: npm test. How people are shown, and hiding repeated messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanEmail, cleanPhone, contactLabel, isIdentified, withoutRepeats } from "./contacts";

test("contact label falls back to email, phone, then the channel", () => {
  assert.equal(contactLabel({ name: "Anna", email: "a@x.pl" }), "Anna");
  assert.equal(contactLabel({ name: " ", email: "a@x.pl" }), "a@x.pl");
  assert.equal(contactLabel({ phone: "+48 601" }, "whatsapp"), "+48 601");
  assert.equal(contactLabel(null, "chat_widget"), "Website visitor");
  assert.equal(contactLabel({}, "email"), "Email sender");
  assert.equal(contactLabel(null), "No name given");
});

test("identified = a name plus an email or phone", () => {
  assert.ok(isIdentified({ name: "Anna", phone: "601234567" }));
  assert.ok(!isIdentified({ name: "Anna" }));
  assert.ok(!isIdentified({ email: "a@x.pl" }));
});

test("email and phone checks", () => {
  assert.equal(cleanEmail(" Anna@X.pl "), "anna@x.pl");
  assert.equal(cleanEmail("anna"), "invalid");
  assert.equal(cleanEmail(""), null);
  assert.equal(cleanPhone(" +48 601 234 567 "), "+48 601 234 567");
  assert.equal(cleanPhone("12"), "invalid");
});

test("repeated copies of a visitor message are hidden, real repeats stay", () => {
  const t = (s: number) => new Date(Date.UTC(2026, 9, 10, 13, 55, s)).toISOString();
  const msgs = [
    { id: 1, role: "user", content: "hello", created_at: t(0) },
    { id: 2, role: "user", content: "hello", created_at: t(0) },
    { id: 3, role: "user", content: "hello", created_at: t(1) },
    { id: 4, role: "assistant", content: "hi", created_at: t(5) },
    { id: 5, role: "user", content: "hello", created_at: t(8) },
    { id: 6, role: "user", content: "other", created_at: t(9) },
    { id: 7, role: "user", content: "other", created_at: t(40) },
  ];
  assert.deepEqual(withoutRepeats(msgs).map((m) => m.id), [1, 4, 5, 6, 7]);
});
