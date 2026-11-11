import test from "node:test";
import assert from "node:assert/strict";
import { isNewAccount, selfSignupEnabled, NEW_ACCOUNT_WINDOW_MS } from "./self-signup";

test("self sign-up is off unless switched on with exactly 'true'", () => {
  const before = process.env.NEXT_PUBLIC_SELF_SIGNUP_ENABLED;
  try {
    delete process.env.NEXT_PUBLIC_SELF_SIGNUP_ENABLED;
    assert.equal(selfSignupEnabled(), false);
    for (const v of ["", "false", "1", "yes", "TRUE", " true"]) {
      process.env.NEXT_PUBLIC_SELF_SIGNUP_ENABLED = v;
      assert.equal(selfSignupEnabled(), false, JSON.stringify(v));
    }
    process.env.NEXT_PUBLIC_SELF_SIGNUP_ENABLED = "true";
    assert.equal(selfSignupEnabled(), true);
  } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_SELF_SIGNUP_ENABLED;
    else process.env.NEXT_PUBLIC_SELF_SIGNUP_ENABLED = before;
  }
});

test("only an account created a moment ago counts as new", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  assert.equal(isNewAccount("2026-11-11T11:59:00Z", now), true);
  assert.equal(isNewAccount(new Date(now - NEW_ACCOUNT_WINDOW_MS).toISOString(), now), true);
  assert.equal(isNewAccount(new Date(now - NEW_ACCOUNT_WINDOW_MS - 1000).toISOString(), now), false);
  assert.equal(isNewAccount("2026-01-01T00:00:00Z", now), false, "an existing account");
  assert.equal(isNewAccount("2026-11-11T12:05:00Z", now), false, "a date in the future");
  assert.equal(isNewAccount(null, now), false);
  assert.equal(isNewAccount("not a date", now), false);
});
